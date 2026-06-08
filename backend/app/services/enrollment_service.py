# Phase 4 — enrollment persistence + progress tracking. Routers in
# app/api/v1/tracks.py stay thin and only handle request validation and
# delegation, mirroring the Phase 3 assessment_service.py split.
from datetime import datetime, timezone

from fastapi import HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.enrollment import EnrollmentProgress

# Agent Rule #3: Motor (async) driver only — every DB call below is awaited.


def _attach_track_data(enrollment: dict, plan_exists: bool) -> dict:
    """Enrich a stored enrollment doc with its static track entry + plan_exists.

    Deferred import: app.api.v1.tracks imports this module to call its
    functions, and this module needs that module's TRACKS_BY_ID — a top-level
    `from app.api.v1.tracks import TRACKS_BY_ID` would be a circular import.
    Resolving it lazily, inside the function body, breaks the cycle because by
    the time `enroll`/`get_enrollment`/etc. are actually *called*, both modules
    have finished loading.
    """
    from app.api.v1.tracks import TRACKS_BY_ID

    return {**enrollment, "track": TRACKS_BY_ID[enrollment["track_id"]], "plan_exists": plan_exists}


async def _plan_exists(user_id: str, track_id: str, db: AsyncIOMotorDatabase) -> bool:
    plan = await db["plans"].find_one({"user_id": user_id, "track_id": track_id}, {"_id": 1})
    return plan is not None


async def enroll(user_id: str, track_id: str, db: AsyncIOMotorDatabase) -> dict:
    """Enroll the user in a track. Idempotent — returns the existing enrollment
    without creating a duplicate if one already exists (Agent Rule #4)."""
    existing = await db["enrollments"].find_one({"user_id": user_id, "track_id": track_id})
    if existing is not None:
        existing["id"] = str(existing.pop("_id"))
        plan_exists = await _plan_exists(user_id, track_id, db)
        return _attach_track_data(existing, plan_exists)

    # Seed the starting skill level from the most recent assessment result.
    # Falls back to "beginner" only as a safety net — the client always routes
    # through the assessment before enrollment is reachable in the UI.
    assessment = await db["assessments"].find_one(
        {"user_id": user_id, "track_id": track_id},
        sort=[("created_at", -1)],
    )
    skill_level = assessment["skill_level"] if assessment else "beginner"

    now = datetime.now(timezone.utc)
    document = {
        "user_id": user_id,
        "track_id": track_id,
        "skill_level": skill_level,
        "start_date": now,
        "current_day": 1,
        "completed_topics": [],
        "average_score": 0.0,
        "total_sessions": 0,
        "updated_at": now,
    }

    insert_result = await db["enrollments"].insert_one(dict(document))
    document["id"] = str(insert_result.inserted_id)

    plan_exists = await _plan_exists(user_id, track_id, db)
    return _attach_track_data(document, plan_exists)


async def get_enrollment(user_id: str, track_id: str, db: AsyncIOMotorDatabase) -> dict | None:
    """Return this user's enrollment for a track enriched with track data, or None."""
    enrollment = await db["enrollments"].find_one({"user_id": user_id, "track_id": track_id})
    if enrollment is None:
        return None

    enrollment["id"] = str(enrollment.pop("_id"))
    plan_exists = await _plan_exists(user_id, track_id, db)
    return _attach_track_data(enrollment, plan_exists)


async def get_all_enrollments(user_id: str, db: AsyncIOMotorDatabase) -> list[dict]:
    """Return every enrollment for this user, most-recently-updated first."""
    cursor = db["enrollments"].find({"user_id": user_id}).sort("updated_at", -1)

    enrollments: list[dict] = []
    async for enrollment in cursor:
        enrollment["id"] = str(enrollment.pop("_id"))
        plan_exists = await _plan_exists(user_id, enrollment["track_id"], db)
        enrollments.append(_attach_track_data(enrollment, plan_exists))

    return enrollments


async def update_progress(
    user_id: str, track_id: str, progress: EnrollmentProgress, db: AsyncIOMotorDatabase
) -> dict:
    """Apply a session-completion progress update (consumed by Phase 5)."""
    enrollment = await db["enrollments"].find_one({"user_id": user_id, "track_id": track_id})
    if enrollment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You are not enrolled in this track.",
        )

    updates: dict = {
        "current_day": progress.current_day,
        "updated_at": datetime.now(timezone.utc),
    }

    completed_topics = enrollment.get("completed_topics", [])
    if progress.completed_topic is not None and progress.completed_topic not in completed_topics:
        updates["completed_topics"] = [*completed_topics, progress.completed_topic]

    if progress.session_score is not None:
        old_avg = enrollment.get("average_score", 0.0)
        total_sessions = enrollment.get("total_sessions", 0)
        updates["average_score"] = ((old_avg * total_sessions) + progress.session_score) / (
            total_sessions + 1
        )
        updates["total_sessions"] = total_sessions + 1

    await db["enrollments"].update_one({"_id": enrollment["_id"]}, {"$set": updates})

    updated = {**enrollment, **updates}
    updated["id"] = str(updated.pop("_id"))
    plan_exists = await _plan_exists(user_id, track_id, db)
    return _attach_track_data(updated, plan_exists)


async def unenroll(user_id: str, track_id: str, db: AsyncIOMotorDatabase) -> None:
    """Delete the enrollment document for this user+track. Raises 404 if absent."""
    result = await db["enrollments"].delete_one({"user_id": user_id, "track_id": track_id})
    if result.deleted_count == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You are not enrolled in this track.",
        )

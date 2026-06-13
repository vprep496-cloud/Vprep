# Phase 4 — enrollment persistence + progress tracking. Routers in
# app/api/v1/tracks.py stay thin and only handle request validation and
# delegation, mirroring the Phase 3 assessment_service.py split.
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.enrollment import EnrollmentProgress
from app.services.role_catalog import default_role, find_role, infer_seniority_from_label

# Agent Rule #3: Motor (async) driver only — every DB call below is awaited.


async def _attach_track_data(enrollment: dict, plan_exists: bool, db: AsyncIOMotorDatabase) -> dict:
    """Enrich a stored enrollment doc with its track catalog entry + plan_exists.

    Deferred import: app.api.v1.tracks imports this module to call its
    functions, and this module needs that module's runtime catalog helper — a
    top-level import would be a circular import.
    Resolving it lazily, inside the function body, breaks the cycle because by
    the time `enroll`/`get_enrollment`/etc. are actually *called*, both modules
    have finished loading.
    """
    from app.api.v1.tracks import get_track_or_none

    return {
        **enrollment,
        "track": await get_track_or_none(enrollment["track_id"], db),
        "plan_exists": plan_exists,
    }


async def _plan_exists(user_id: str, track_id: str, db: AsyncIOMotorDatabase) -> bool:
    plan = await db["plans"].find_one({"user_id": user_id, "track_id": track_id}, {"_id": 1})
    return plan is not None


async def _get_user(user_id: str, db: AsyncIOMotorDatabase, projection: dict | None = None) -> dict | None:
    try:
        object_id = ObjectId(user_id)
    except (InvalidId, TypeError):
        return None
    return await db["users"].find_one({"_id": object_id}, projection)


async def _profile_skill_level(user_id: str, db: AsyncIOMotorDatabase) -> str:
    user = await _get_user(user_id, db, {"normalized_level": 1, "profile": 1})
    profile = user.get("profile") if user else None
    skill_level = (user or {}).get("normalized_level") or (profile or {}).get("normalized_level")
    return skill_level if skill_level in {"beginner", "intermediate", "advanced"} else "beginner"


async def _resolve_role(
    user_id: str,
    track_id: str,
    db: AsyncIOMotorDatabase,
    *,
    role_id: str | None = None,
    label: str | None = None,
) -> dict:
    """Resolve a target role for an enrollment into the full set of stored
    fields ``{target_role, target_role_id, role_seniority, role_confirmed}``.

    Priority:
      1. An explicitly chosen predefined role (``role_id``) — confirmed.
      2. An explicit custom label — matched to a predefined role if possible,
         else kept as a custom role with inferred seniority — confirmed.
      3. A system-derived default (unconfirmed): the candidate's onboarding role
         when this is their preferred track, otherwise the track's canonical
         default role. This is what makes each track default to its own role.
    """
    from app.api.v1.tracks import get_track_or_none

    track = await get_track_or_none(track_id, db)

    def _from_role(role: dict, *, confirmed: bool) -> dict:
        return {
            "target_role": role["label"],
            "target_role_id": role["id"],
            "role_seniority": role["seniority"],
            "role_confirmed": confirmed,
        }

    if role_id and track is not None:
        role = find_role(track, role_id=role_id)
        if role:
            return _from_role(role, confirmed=True)

    if label and label.strip():
        clean = label.strip()[:120]
        role = find_role(track, label=clean) if track is not None else None
        if role:
            return _from_role(role, confirmed=True)
        return {
            "target_role": clean,
            "target_role_id": None,
            "role_seniority": infer_seniority_from_label(clean),
            "role_confirmed": True,
        }

    # --- derive an unconfirmed default ---
    user = await _get_user(user_id, db, {"target_role": 1, "preferred_track_id": 1, "profile": 1}) or {}
    profile = user.get("profile") if isinstance(user.get("profile"), dict) else {}
    global_role = user.get("target_role") or (profile or {}).get("target_role")
    preferred_track_id = user.get("preferred_track_id") or (profile or {}).get("preferred_track_id")

    if global_role and preferred_track_id == track_id and track is not None:
        matched = find_role(track, label=str(global_role))
        if matched:
            return _from_role(matched, confirmed=False)
        clean = str(global_role).strip()[:120]
        return {
            "target_role": clean,
            "target_role_id": None,
            "role_seniority": infer_seniority_from_label(clean),
            "role_confirmed": False,
        }

    if track is not None:
        return _from_role(default_role(track), confirmed=False)

    clean = str(global_role).strip()[:120] if global_role else "Software Engineer"
    return {
        "target_role": clean,
        "target_role_id": None,
        "role_seniority": infer_seniority_from_label(clean),
        "role_confirmed": False,
    }


async def enroll(
    user_id: str,
    track_id: str,
    db: AsyncIOMotorDatabase,
    target_role: str | None = None,
    target_role_id: str | None = None,
) -> dict:
    """Enroll the user in a track. Idempotent — returns the existing enrollment
    without creating a duplicate if one already exists (Agent Rule #4)."""
    explicit = bool(target_role_id or (target_role and target_role.strip()))
    existing = await db["enrollments"].find_one({"user_id": user_id, "track_id": track_id})
    if existing is not None:
        # Backfill a per-track role for older enrollments (or apply one the
        # caller just provided) without otherwise breaking idempotency.
        if not existing.get("target_role") or explicit:
            role = await _resolve_role(user_id, track_id, db, role_id=target_role_id, label=target_role)
            await db["enrollments"].update_one(
                {"_id": existing["_id"]},
                {"$set": {**role, "updated_at": datetime.now(timezone.utc)}},
            )
            existing.update(role)
        existing["id"] = str(existing.pop("_id"))
        plan_exists = await _plan_exists(user_id, track_id, db)
        return await _attach_track_data(existing, plan_exists, db)

    # Seed from the most recent assessment when available; otherwise use the
    # onboarding/CV profile so newly registered candidates still get matched
    # questions and plans before their first diagnostic assessment.
    assessment = await db["assessments"].find_one(
        {"user_id": user_id, "track_id": track_id},
        sort=[("created_at", -1)],
    )
    skill_level = assessment["skill_level"] if assessment else await _profile_skill_level(user_id, db)
    role = await _resolve_role(user_id, track_id, db, role_id=target_role_id, label=target_role)

    now = datetime.now(timezone.utc)
    document = {
        "user_id": user_id,
        "track_id": track_id,
        "skill_level": skill_level,
        **role,
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
    return await _attach_track_data(document, plan_exists, db)


async def update_target_role(
    user_id: str,
    track_id: str,
    db: AsyncIOMotorDatabase,
    *,
    target_role: str | None = None,
    target_role_id: str | None = None,
) -> dict:
    """Set this enrollment's per-track target role (predefined id or custom
    label). Clearing both re-derives the track's intelligent default."""
    enrollment = await db["enrollments"].find_one({"user_id": user_id, "track_id": track_id})
    if enrollment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You are not enrolled in this track.",
        )

    role = await _resolve_role(user_id, track_id, db, role_id=target_role_id, label=target_role)
    now = datetime.now(timezone.utc)
    await db["enrollments"].update_one(
        {"_id": enrollment["_id"]},
        {"$set": {**role, "updated_at": now}},
    )

    enrollment.update(role)
    enrollment["updated_at"] = now
    enrollment["id"] = str(enrollment.pop("_id"))
    plan_exists = await _plan_exists(user_id, track_id, db)
    return await _attach_track_data(enrollment, plan_exists, db)


async def _backfill_target_role(enrollment: dict, user_id: str, db: AsyncIOMotorDatabase) -> None:
    """Give legacy enrollments (created before per-track roles) a sensible role
    the first time they're read, in place. Only writes when one is missing."""
    if enrollment.get("target_role") and enrollment.get("role_seniority"):
        return
    role = await _resolve_role(user_id, enrollment["track_id"], db)
    enrollment.update(role)
    await db["enrollments"].update_one({"_id": enrollment["_id"]}, {"$set": role})


async def get_enrollment(user_id: str, track_id: str, db: AsyncIOMotorDatabase) -> dict | None:
    """Return this user's enrollment for a track enriched with track data, or None."""
    enrollment = await db["enrollments"].find_one({"user_id": user_id, "track_id": track_id})
    if enrollment is None:
        return None

    await _backfill_target_role(enrollment, user_id, db)
    enrollment["id"] = str(enrollment.pop("_id"))
    plan_exists = await _plan_exists(user_id, track_id, db)
    return await _attach_track_data(enrollment, plan_exists, db)


async def get_all_enrollments(user_id: str, db: AsyncIOMotorDatabase) -> list[dict]:
    """Return every enrollment for this user, most-recently-updated first."""
    cursor = db["enrollments"].find({"user_id": user_id}).sort("updated_at", -1)

    enrollments: list[dict] = []
    async for enrollment in cursor:
        await _backfill_target_role(enrollment, user_id, db)
        enrollment["id"] = str(enrollment.pop("_id"))
        plan_exists = await _plan_exists(user_id, enrollment["track_id"], db)
        enrollments.append(await _attach_track_data(enrollment, plan_exists, db))

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
    return await _attach_track_data(updated, plan_exists, db)


async def unenroll(user_id: str, track_id: str, db: AsyncIOMotorDatabase) -> None:
    """Delete the enrollment document for this user+track. Raises 404 if absent."""
    result = await db["enrollments"].delete_one({"user_id": user_id, "track_id": track_id})
    if result.deleted_count == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You are not enrolled in this track.",
        )


async def reset_progress(user_id: str, track_id: str, db: AsyncIOMotorDatabase) -> dict:
    """Reset a track enrollment's progress counters to their initial values.

    Clears ``current_day``, ``completed_topics``, ``average_score``, and
    ``total_sessions`` without removing the enrollment itself — the candidate
    stays enrolled and their session history in the ``sessions`` collection is
    preserved. This lets them restart the prep track fresh while keeping a
    complete record of prior work in the Progress screen.
    """
    enrollment = await db["enrollments"].find_one({"user_id": user_id, "track_id": track_id})
    if enrollment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You are not enrolled in this track.",
        )

    now = datetime.now(timezone.utc)
    reset_fields: dict = {
        "current_day": 1,
        "completed_topics": [],
        "average_score": 0.0,
        "total_sessions": 0,
        "updated_at": now,
    }
    await db["enrollments"].update_one({"_id": enrollment["_id"]}, {"$set": reset_fields})

    updated = {**enrollment, **reset_fields}
    updated["id"] = str(updated.pop("_id"))
    plan_exists = await _plan_exists(user_id, track_id, db)
    return await _attach_track_data(updated, plan_exists, db)


async def update_skill_level(
    user_id: str, track_id: str, skill_level: str, db: AsyncIOMotorDatabase
) -> dict:
    """Override the skill level recorded on an enrollment.

    Lets the candidate self-correct after an assessment mis-calibration (e.g.
    they want harder questions without re-doing the diagnostic). Only the
    enrollment record is updated — the ``assessments`` collection is left
    untouched so the history remains accurate.
    """
    if skill_level not in {"beginner", "intermediate", "advanced"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="skill_level must be 'beginner', 'intermediate', or 'advanced'.",
        )

    enrollment = await db["enrollments"].find_one({"user_id": user_id, "track_id": track_id})
    if enrollment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You are not enrolled in this track.",
        )

    now = datetime.now(timezone.utc)
    await db["enrollments"].update_one(
        {"_id": enrollment["_id"]},
        {"$set": {"skill_level": skill_level, "updated_at": now}},
    )

    enrollment["skill_level"] = skill_level
    enrollment["updated_at"] = now
    enrollment["id"] = str(enrollment.pop("_id"))
    plan_exists = await _plan_exists(user_id, track_id, db)
    return await _attach_track_data(enrollment, plan_exists, db)


async def get_track_stats(user_id: str, track_id: str, db: AsyncIOMotorDatabase) -> dict:
    """Return aggregated performance statistics for a single track enrollment.

    Counts and aggregates every completed session for the track — the result is
    used to populate the Track Management sheet's stats row and is intentionally
    cheap (a single cursor scan, no aggregation pipeline).
    """
    enrollment = await db["enrollments"].find_one({"user_id": user_id, "track_id": track_id})
    if enrollment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You are not enrolled in this track.",
        )

    # Aggregate completed-session metrics in one pass.
    best_score = 0.0
    worst_score = 100.0
    total_duration = 0
    session_count = 0

    cursor = db["sessions"].find(
        {"user_id": user_id, "track_id": track_id, "status": "completed"},
        {"overall_score": 1, "duration_seconds": 1},
    )
    async for session in cursor:
        score = float(session.get("overall_score") or 0.0)
        best_score = max(best_score, score)
        worst_score = min(worst_score, score)
        total_duration += int(session.get("duration_seconds") or 0)
        session_count += 1

    if session_count == 0:
        best_score = 0.0
        worst_score = 0.0

    # Days since the enrollment was created (not since last active).
    start_date = enrollment.get("start_date")
    days_since = 0
    if isinstance(start_date, datetime):
        days_since = max(0, (datetime.now(timezone.utc) - start_date).days)

    return {
        "track_id": track_id,
        "skill_level": enrollment.get("skill_level", "beginner"),
        "current_day": enrollment.get("current_day", 1),
        "total_sessions": session_count,
        "average_score": enrollment.get("average_score", 0.0),
        "best_score": best_score,
        "worst_score": worst_score,
        "completed_topics_count": len(enrollment.get("completed_topics", [])),
        "days_since_enrollment": days_since,
        "total_practice_time_seconds": total_duration,
    }

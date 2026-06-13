from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.database import get_db
from app.core.dependencies import get_current_user
# --- Phase 4: enrollment additions ---
from app.models.enrollment import (
    EnrollmentCreate,
    EnrollmentProgress,
    EnrollmentSkillLevelUpdate,
    EnrollmentTargetRoleUpdate,
)
from app.services import enrollment_service
# --- end Phase 4 imports ---

router = APIRouter()

# Built-in track catalog. Admin-created tracks live in MongoDB and are merged
# with these defaults by `get_track_catalog`; a database document with the same
# id overrides the built-in entry.
DEFAULT_TRACKS: list[dict] = [
    {
        "id": "ml_ai",
        "name": "ML & AI",
        "description": "Machine learning fundamentals, deep learning, and the "
        "end-to-end model lifecycle — the core of an ML/AI engineering interview loop.",
        "icon": "sparkles-outline",
        "color": "#818CF8",
        "total_days": 30,
        "topic_areas": [
            "machine learning",
            "deep learning",
            "neural networks",
            "NLP",
            "computer vision",
            "model evaluation",
            "Python ML libraries",
            "feature engineering",
            "model deployment",
        ],
    },
    {
        "id": "web_dev",
        "name": "Web Dev",
        "description": "Modern full-stack web development — from markup and "
        "JavaScript fundamentals through React, APIs, and system design for the web.",
        "icon": "code-slash-outline",
        "color": "#38BDF8",
        "total_days": 30,
        "topic_areas": [
            "HTML/CSS",
            "JavaScript",
            "React",
            "REST APIs",
            "databases",
            "authentication",
            "performance",
            "TypeScript",
            "system design for web",
        ],
    },
    {
        "id": "devops",
        "name": "DevOps",
        "description": "CI/CD, containerization, orchestration, and the cloud "
        "infrastructure practices that DevOps and platform engineering interviews probe.",
        "icon": "git-network-outline",
        "color": "#FB923C",
        "total_days": 21,
        "topic_areas": [
            "CI/CD pipelines",
            "Docker",
            "Kubernetes",
            "Linux",
            "monitoring and alerting",
            "cloud infrastructure",
            "Git workflows",
            "Terraform",
        ],
    },
    {
        "id": "data_science",
        "name": "Data Science",
        "description": "Statistics, data wrangling, and the analytical storytelling "
        "skills that data science screening interviews focus on.",
        "icon": "analytics-outline",
        "color": "#34D399",
        "total_days": 30,
        "topic_areas": [
            "statistics",
            "pandas",
            "data wrangling",
            "SQL",
            "data visualization",
            "feature engineering",
            "experimental design",
            "storytelling with data",
        ],
    },
    {
        "id": "cloud",
        "name": "Cloud",
        "description": "Cloud architecture, security, and operations — the topics "
        "most commonly asked about in cloud and solutions-architect interviews.",
        "icon": "cloud-outline",
        "color": "#60A5FA",
        "total_days": 21,
        "topic_areas": [
            "cloud service models",
            "IAM and security",
            "networking",
            "serverless architecture",
            "storage solutions",
            "load balancing",
            "cost management",
        ],
    },
    {
        "id": "mobile_dev",
        "name": "Mobile Dev",
        "description": "React Native and the mobile-specific engineering concerns "
        "— UX, lifecycle, state, and deployment — that mobile interviews dig into.",
        "icon": "phone-portrait-outline",
        "color": "#F472B6",
        "total_days": 30,
        "topic_areas": [
            "React Native",
            "mobile UX principles",
            "app lifecycle",
            "state management",
            "push notifications",
            "performance optimization",
            "app store deployment",
        ],
    },
]

# Backwards-compatible aliases for scripts/imports that only need the built-in
# catalog. Runtime validation should use `get_tracks_by_id(db)` instead.
TRACKS = DEFAULT_TRACKS
TRACKS_BY_ID: dict[str, dict] = {track["id"]: track for track in DEFAULT_TRACKS}

# The curated, per-track target-role catalog (with seniority + focus areas)
# lives in app/services/role_catalog.py — the single source of truth used by
# the enrollment service, interview personalization, and the /roles endpoint.


def _serialize_track(document: dict) -> dict:
    track = {key: value for key, value in document.items() if key != "_id"}
    track.setdefault("topic_areas", [])
    track.setdefault("is_active", True)
    return track


async def get_track_catalog(db: AsyncIOMotorDatabase) -> list[dict]:
    """Return built-in tracks plus active admin-created/overridden tracks."""
    merged: dict[str, dict] = {track["id"]: {**track, "is_active": True} for track in DEFAULT_TRACKS}

    cursor = db["tracks"].find({}).sort("name", 1)
    async for document in cursor:
        track = _serialize_track(document)
        if track.get("is_active") is False:
            merged.pop(track["id"], None)
            continue
        merged[track["id"]] = track

    return sorted(merged.values(), key=lambda track: track["name"].lower())


async def get_tracks_by_id(db: AsyncIOMotorDatabase) -> dict[str, dict]:
    tracks = await get_track_catalog(db)
    return {track["id"]: track for track in tracks}


async def get_track_or_none(track_id: str, db: AsyncIOMotorDatabase) -> dict | None:
    tracks_by_id = await get_tracks_by_id(db)
    return tracks_by_id.get(track_id)


@router.get("/")
async def list_tracks(
    _current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Return the full track catalog. Any authenticated user."""
    return await get_track_catalog(db)


# ---------------------------------------------------------------------------
# Phase 4: enrollment routes — registered ABOVE `GET /{track_id}` on purpose.
# `/enrolled` is a single static path segment, exactly like `/{track_id}`'s
# pattern shape; FastAPI/Starlette matches routes in registration order, so if
# `/{track_id}` were registered first, `GET /enrolled` would be swallowed by it
# (track_id="enrolled" → 404 "Track not found"). `/enroll` and
# `/enrollment/{track_id}` don't collide (different methods / segment counts)
# but are kept in this block for cohesion.
# ---------------------------------------------------------------------------


@router.post("/enroll")
async def enroll_in_track(
    payload: EnrollmentCreate,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Enroll the current user in a track. Idempotent — see enrollment_service.enroll."""
    if await get_track_or_none(payload.track_id, db) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown track_id.")

    enrollment = await enrollment_service.enroll(
        current_user["id"],
        payload.track_id,
        db,
        target_role=payload.target_role,
        target_role_id=payload.target_role_id,
    )
    return {"enrollment": enrollment, "message": "Enrolled successfully."}


@router.get("/enrolled")
async def list_enrolled_tracks(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Return every track the current user is enrolled in, newest-updated first."""
    enrollments = await enrollment_service.get_all_enrollments(current_user["id"], db)
    return {"enrollments": enrollments}


@router.get("/enrollment/{track_id}")
async def get_enrollment(
    track_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Return the current user's enrollment for a single track, or 404 if absent."""
    enrollment = await enrollment_service.get_enrollment(current_user["id"], track_id, db)
    if enrollment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You are not enrolled in this track.",
        )
    return {"enrollment": enrollment}


@router.put("/enrollment/{track_id}/progress")
async def update_enrollment_progress(
    track_id: str,
    payload: EnrollmentProgress,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Update day/topic/score progress for an enrollment.

    Called by the Phase 5 interview module after each completed session — it
    exists now purely so the data model and persistence path are ready ahead
    of that integration.
    """
    enrollment = await enrollment_service.update_progress(current_user["id"], track_id, payload, db)
    return {"enrollment": enrollment}


@router.put("/enrollment/{track_id}/target-role")
async def update_enrollment_target_role(
    track_id: str,
    payload: EnrollmentTargetRoleUpdate,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Set the per-track target role for the current user's enrollment.

    Each track keeps its own role so interview questions and plans personalize
    to the role the candidate is actually targeting on that track. Clearing the
    role re-derives the track's intelligent default.
    """
    enrollment = await enrollment_service.update_target_role(
        current_user["id"],
        track_id,
        db,
        target_role=payload.target_role,
        target_role_id=payload.target_role_id,
    )
    return {"enrollment": enrollment}


@router.delete("/enrollment/{track_id}")
async def unenroll_from_track(
    track_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Remove the current user's enrollment for a track."""
    await enrollment_service.unenroll(current_user["id"], track_id, db)
    return {"message": "Unenrolled successfully"}


@router.post("/enrollment/{track_id}/reset")
async def reset_enrollment_progress(
    track_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Reset the enrollment's progress counters to their initial values.

    Clears current_day (→ 1), completed_topics (→ []), average_score (→ 0),
    and total_sessions (→ 0). The enrollment itself and all session history
    in the sessions collection are preserved — the candidate stays enrolled
    and their past work remains visible in the Progress screen.
    """
    enrollment = await enrollment_service.reset_progress(current_user["id"], track_id, db)
    return {"enrollment": enrollment, "message": "Progress reset successfully."}


@router.patch("/enrollment/{track_id}/skill-level")
async def update_enrollment_skill_level(
    track_id: str,
    payload: EnrollmentSkillLevelUpdate,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Override the skill level recorded on an enrollment.

    Lets the candidate self-correct after an assessment mis-calibration or
    choose a harder / softer difficulty without re-taking the assessment.
    Only the enrollment record is updated; the assessments collection is
    left untouched.
    """
    enrollment = await enrollment_service.update_skill_level(
        current_user["id"], track_id, payload.skill_level.value, db
    )
    return {"enrollment": enrollment, "message": "Skill level updated."}


@router.get("/enrollment/{track_id}/stats")
async def get_enrollment_stats(
    track_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Return aggregated performance statistics for one track enrollment.

    Scans the sessions collection to compute session count, best/worst scores,
    and total practice time — data that supplements the live enrollment fields
    (current_day, average_score, total_sessions) shown in the Track Management
    sheet.
    """
    stats = await enrollment_service.get_track_stats(current_user["id"], track_id, db)
    return {"stats": stats}


# --- end Phase 4 enrollment routes ---


@router.get("/{track_id}/roles")
async def get_track_roles(
    track_id: str,
    _current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Return the curated target roles for a track (each with a seniority level
    and focus areas), so the candidate can choose what they're preparing for."""
    from app.services.role_catalog import roles_for_track, seniority_label

    track = await get_track_or_none(track_id, db)
    if track is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found.")

    roles = [
        {
            "id": role["id"],
            "label": role["label"],
            "seniority": role["seniority"],
            "seniority_label": seniority_label(role["seniority"]),
            "focus": role["focus"],
        }
        for role in roles_for_track(track)
    ]
    return {"track_id": track_id, "roles": roles}


@router.get("/{track_id}")
async def get_track(
    track_id: str,
    _current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Return a single track by ID, or 404 if the ID is unknown/inactive."""
    track = await get_track_or_none(track_id, db)
    if track is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found.")
    return track

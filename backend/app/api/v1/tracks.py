from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.database import get_db
from app.core.dependencies import get_current_user
# --- Phase 4: enrollment additions ---
from app.models.enrollment import EnrollmentCreate, EnrollmentProgress
from app.services import enrollment_service
# --- end Phase 4 imports ---

router = APIRouter()

# Static track catalog — tracks never change, so they live as a hardcoded list
# rather than a MongoDB collection. `topic_areas` is fed directly into the
# Gemini prompts in assessment_service.py (imported via TRACKS_BY_ID below).
# Icon/color/total_days values mirror the placeholder data already shown on
# the mobile Tracks screen so the UI stays visually consistent end to end.
TRACKS: list[dict] = [
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

# O(1) lookup by id — reused by assessment_service.py to build Gemini prompts
# (track name + topic_areas) without a second source of truth.
TRACKS_BY_ID: dict[str, dict] = {track["id"]: track for track in TRACKS}


@router.get("/")
async def list_tracks(_current_user: dict = Depends(get_current_user)):
    """Return the full static track catalog. Any authenticated user."""
    return TRACKS


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
    if payload.track_id not in TRACKS_BY_ID:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown track_id.")

    enrollment = await enrollment_service.enroll(current_user["id"], payload.track_id, db)
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


@router.delete("/enrollment/{track_id}")
async def unenroll_from_track(
    track_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Remove the current user's enrollment for a track."""
    await enrollment_service.unenroll(current_user["id"], track_id, db)
    return {"message": "Unenrolled successfully"}


# --- end Phase 4 enrollment routes ---


@router.get("/{track_id}")
async def get_track(
    track_id: str,
    _current_user: dict = Depends(get_current_user),
):
    """Return a single track by ID, or 404 if the ID is not one of the six tracks."""
    track = TRACKS_BY_ID.get(track_id)
    if track is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found.")
    return track

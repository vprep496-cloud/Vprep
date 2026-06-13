# Phase 4 — full enrollment models. `SkillLevel` is defined here (not in
# assessment.py) because it's fundamentally an enrollment-lifecycle concept —
# Phase 3's models/assessment.py imports it from this module, so it must stay
# put to avoid breaking that import.
from datetime import datetime
from enum import Enum

from pydantic import BaseModel

from app.models.track import Track, TrackId


class SkillLevel(str, Enum):
    beginner = "beginner"
    intermediate = "intermediate"
    advanced = "advanced"


class EnrollmentCreate(BaseModel):
    """Request body for POST /tracks/enroll.

    `track_id` is plain `str` (not the `TrackId` enum) so the route can run its
    own validation and respond 400 on an unknown id — mirroring the
    `TrackIdBody` pattern already used in api/v1/assessment.py — rather than
    pydantic raising a 422 on enum-coercion failure.
    """

    track_id: str
    # Optional per-track target role. Each track keeps its own role (an ML
    # candidate prepping for "MLOps Engineer" vs "AI Engineer"), so this lives
    # on the enrollment rather than globally on the user. Prefer `target_role_id`
    # (a predefined catalog role for the track); `target_role` carries a free
    # custom label. When both are omitted the backend derives a default.
    target_role_id: str | None = None
    target_role: str | None = None


class EnrollmentTargetRoleUpdate(BaseModel):
    """Request body for PUT /tracks/enrollment/{track_id}/target-role."""

    target_role_id: str | None = None
    target_role: str | None = None


class Enrollment(BaseModel):
    """A user's enrollment record, persisted to the `enrollments` collection."""

    id: str
    user_id: str
    track_id: TrackId
    skill_level: SkillLevel
    target_role: str | None = None
    target_role_id: str | None = None
    # Seniority of the chosen role (junior | mid | senior) — blended with the
    # candidate's skill level to set question difficulty.
    role_seniority: str | None = None
    # False while the role is still the system-derived default; True once the
    # candidate explicitly picks one. Lets the UI nudge them to confirm.
    role_confirmed: bool = False
    start_date: datetime
    current_day: int
    completed_topics: list[str] = []
    average_score: float = 0.0
    total_sessions: int = 0
    updated_at: datetime


class EnrollmentProgress(BaseModel):
    """Request body for PUT /tracks/enrollment/{track_id}/progress.

    Consumed by the Phase 5 interview module after each completed session —
    the route exists in Phase 4 purely so this data model and its persistence
    path are ready ahead of that integration.
    """

    current_day: int
    completed_topic: str | None = None
    session_score: float | None = None


class EnrollmentSkillLevelUpdate(BaseModel):
    """Request body for PATCH /tracks/enrollment/{track_id}/skill-level."""

    skill_level: SkillLevel


class EnrollmentResponse(Enrollment):
    """Enrollment enriched with the static track catalog entry and plan status."""

    track: Track
    plan_exists: bool


class TrackStats(BaseModel):
    """Aggregated statistics for one enrollment, returned by GET /enrollment/{track_id}/stats."""

    track_id: str
    skill_level: SkillLevel
    current_day: int
    total_sessions: int
    average_score: float
    best_score: float
    worst_score: float
    completed_topics_count: int
    days_since_enrollment: int
    total_practice_time_seconds: int

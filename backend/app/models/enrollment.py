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


class Enrollment(BaseModel):
    """A user's enrollment record, persisted to the `enrollments` collection."""

    id: str
    user_id: str
    track_id: TrackId
    skill_level: SkillLevel
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


class EnrollmentResponse(Enrollment):
    """Enrollment enriched with the static track catalog entry and plan status."""

    track: Track
    plan_exists: bool

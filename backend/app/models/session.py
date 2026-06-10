# Phase 5 — full mock-interview session models.
#
# Mirrors the open-ended philosophy already established in assessment.py:
# every answer (voice or text) is graded holistically by Gemini against a
# server-side `model_answer` rubric that the candidate never sees mid-session
# (Agent Rule #3) — only afterward, as feedback on their own AnswerResponse.
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

AnswerType = Literal["voice", "text", "image"]
InterviewMode = Literal["hr", "technical", "behavioral", "full_mock"]


class QuestionAnswer(BaseModel):
    """A single scored answer, persisted inside a session's `answers` array and
    surfaced again (read-only) in `PhaseResult.answers` once the session ends."""

    question_id: str
    question_text: str
    phase: str
    answer_type: AnswerType
    transcription: str | None = None  # voice transcript or handwriting extraction
    user_text_answer: str | None = None  # populated for typed (technical) answers
    answer_duration_seconds: int | None = None
    image_width: int | None = None
    image_height: int | None = None
    image_size_bytes: int | None = None
    score: int  # 0-100, overall score for this answer
    criteria_scores: dict[str, int]  # e.g. {"clarity": 8, "relevance": 7} — each 0-10
    feedback: str
    model_answer: str
    confidence: float | None = None
    strengths: list[str] = Field(default_factory=list)
    improvements: list[str] = Field(default_factory=list)
    review_flags: list[str] = Field(default_factory=list)
    evidence: list[str] = Field(default_factory=list)
    score_rationale: str | None = None
    rubric_version: str | None = None
    scoring_mode: str | None = None
    scoring_metadata: dict | None = None
    ai_score: int | None = None
    ai_criteria_scores: dict[str, int] | None = None
    ai_feedback: str | None = None
    ai_confidence: float | None = None
    ai_review_flags: list[str] = Field(default_factory=list)
    ai_scoring_metadata: dict | None = None
    manual_review_status: str | None = None
    reviewer_notes: str | None = None
    reviewed_by: str | None = None
    reviewed_at: datetime | None = None


class PhaseResult(BaseModel):
    phase: str
    score: int  # 0-100, average of this phase's answer scores
    question_count: int
    answers: list[QuestionAnswer]


class SessionCreate(BaseModel):
    track_id: str
    # Plain `str` rather than `InterviewMode` (Literal) — same reasoning as
    # `EnrollmentCreate.track_id` in Phase 4: keeping it a bare string lets
    # `interview_service.start_session` raise its own clean 400 for an unknown
    # mode, instead of a generic Pydantic 422 with no app-specific message.
    mode: str


class SessionStartResponse(BaseModel):
    session_id: str
    track_id: str
    mode: str
    phases: list[str]
    # phase -> sanitized question list (no `model_answer` — Agent Rule #3).
    questions: dict[str, list[dict]]
    started_at: datetime


class AnswerSubmission(BaseModel):
    # Agent Rule #4: `audio_base64` can be a large string (up to ~3 minutes of
    # m4a audio) — this prevents Pydantic from imposing any implicit
    # arbitrary-type/size constraints on it.
    model_config = ConfigDict(arbitrary_types_allowed=True)

    session_id: str
    question_id: str
    phase: str
    answer_type: AnswerType
    audio_base64: str | None = None
    image_base64: str | None = None
    image_mime_type: str | None = None
    image_width: int | None = None
    image_height: int | None = None
    image_size_bytes: int | None = None
    audio_format: str | None = None
    answer_duration_seconds: int | None = None
    text_answer: str | None = None


class BatchTextAnswer(BaseModel):
    question_id: str
    text_answer: str


class BatchTextAnswerSubmission(BaseModel):
    session_id: str
    phase: str
    answers: list[BatchTextAnswer]


class AnswerResponse(BaseModel):
    question_id: str
    score: int
    criteria_scores: dict[str, int]
    feedback: str
    model_answer: str
    transcription: str | None = None
    confidence: float | None = None
    strengths: list[str] = Field(default_factory=list)
    improvements: list[str] = Field(default_factory=list)
    review_flags: list[str] = Field(default_factory=list)
    evidence: list[str] = Field(default_factory=list)
    score_rationale: str | None = None
    rubric_version: str | None = None
    scoring_mode: str | None = None


class BatchAnswerResponse(BaseModel):
    answers: list[AnswerResponse]


class SessionComplete(BaseModel):
    session_id: str


class SessionResult(BaseModel):
    id: str
    user_id: str
    track_id: str
    mode: str
    overall_score: int  # 0-100, weighted across phases
    phase_results: list[PhaseResult]
    started_at: datetime
    completed_at: datetime
    duration_seconds: int

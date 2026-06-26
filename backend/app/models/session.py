# Phase 5 — full mock-interview session models.
#
# Mirrors the open-ended philosophy already established in assessment.py:
# every answer (voice, text, or image) is graded holistically by local AI against a
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
    # Async coding score lifecycle: "pending" → "processing" → "complete" | "failed"
    coding_score_status: Literal["pending", "processing", "complete", "failed"] | None = None
    # Async voice score lifecycle: "pending" → "processing" → "complete" | "failed"
    voice_score_status: Literal["pending", "processing", "complete", "failed"] | None = None
    # Async technical text lifecycle: "pending" → "processing" → "complete" | "failed"
    technical_score_status: Literal["pending", "processing", "complete", "failed"] | None = None


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
    # How many questions per phase. "quick" ≈ 50 %, "standard" = 100 % (default),
    # "deep" ≈ 150 % — clamped to min 1 per phase server-side.
    intensity: Literal["quick", "standard", "deep"] = "standard"


class CodingAnswerSubmission(BaseModel):
    """Submitted immediately for async background scoring."""
    model_config = ConfigDict(arbitrary_types_allowed=True)

    session_id: str
    question_id: str
    phase: str = "coding_logic"
    image_base64: str
    image_mime_type: str | None = None
    image_width: int | None = None
    image_height: int | None = None
    image_size_bytes: int | None = None


class CodingScoreStatus(BaseModel):
    """Polling response for async coding-score job status."""
    question_id: str
    status: Literal["pending", "processing", "complete", "failed"]
    score: int | None = None
    feedback: str | None = None
    transcription: str | None = None
    criteria_scores: dict[str, int] = Field(default_factory=dict)
    estimated_seconds: int = 180


class VoiceAnswerSubmission(BaseModel):
    """Voice answer submitted immediately for async background Whisper+Ollama scoring."""
    model_config = ConfigDict(arbitrary_types_allowed=True)

    session_id: str
    question_id: str
    phase: str  # "hr" | "behavioral"
    audio_base64: str
    audio_format: str | None = None
    answer_duration_seconds: int | None = None


class VoiceScoreStatusItem(BaseModel):
    """Polling response for async voice-score job status."""
    question_id: str
    phase: str
    status: Literal["pending", "processing", "complete", "failed"]
    score: int | None = None
    feedback: str | None = None
    transcription: str | None = None
    criteria_scores: dict[str, int] = Field(default_factory=dict)
    # Voice scoring is faster than coding OCR (no image parsing step)
    estimated_seconds: int = 90


class NotificationTokenRegister(BaseModel):
    """Device push-token registration payload."""
    expo_push_token: str
    platform: Literal["ios", "android", "web"] = "ios"


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


class TechnicalBatchSubmitAck(BaseModel):
    """Acknowledgement for async technical batch scoring."""
    question_ids: list[str]
    status: Literal["pending"] = "pending"
    message: str
    estimated_seconds: int = 90


class TechnicalScoreStatusItem(BaseModel):
    """Polling response for async technical text batch scoring."""
    question_id: str
    status: Literal["pending", "processing", "complete", "failed"]
    score: int | None = None
    feedback: str | None = None
    criteria_scores: dict[str, int] = Field(default_factory=dict)
    estimated_seconds: int = 90


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

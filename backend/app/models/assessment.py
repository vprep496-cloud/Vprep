# Phase 3 — full assessment + personalized-plan models.
#
# Design note: assessments are 100% short-answer / open-ended. There is no
# multiple-choice, no `options`, no `correct_answer` anywhere in this phase —
# Local AI grades free-typed answers holistically against a server-side rubric
# (`model_answer`) that is never exposed to the candidate before they submit.
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models.enrollment import SkillLevel
from app.models.track import TrackId

Difficulty = Literal["easy", "medium", "hard"]


class AssessmentQuestion(BaseModel):
    """A single open-ended interview-style question. No options/correct answer."""

    id: str
    question: str
    topic_area: str
    section_id: str | None = None
    section_title: str | None = None
    difficulty: Difficulty


class QuestionFeedback(BaseModel):
    """Local AI per-question evaluation of the candidate's typed answer."""

    question_id: str
    question: str
    user_answer: str
    score: int  # 0-10
    criteria_scores: dict[str, int] = Field(default_factory=dict)
    confidence: float | None = None
    strengths: list[str] = Field(default_factory=list)
    improvements: list[str] = Field(default_factory=list)
    review_flags: list[str] = Field(default_factory=list)
    evidence: list[str] = Field(default_factory=list)
    score_rationale: str | None = None
    feedback: str
    model_answer: str
    scoring_metadata: dict | None = None


class AssessmentResult(BaseModel):
    """A scored assessment attempt, persisted to the `assessments` collection."""

    id: str
    user_id: str
    track_id: TrackId
    skill_level: SkillLevel
    score: int  # overall score, 0-100
    breakdown: dict[str, int]  # topic_area -> score, scaled 0-100
    per_question_feedback: list[QuestionFeedback]
    scoring_version: str | None = None
    created_at: datetime


class AssessmentSubmission(BaseModel):
    """Request body for POST /assessment/submit."""

    session_id: str
    track_id: TrackId
    answers: dict[str, str]  # question_id -> the candidate's typed answer


class PlanDay(BaseModel):
    day_number: int
    topic: str
    subtopics: list[str]
    estimated_minutes: int
    practice_questions: int


class PlanWeek(BaseModel):
    week_number: int
    title: str
    focus: str
    days: list[PlanDay]


class PersonalizedPlan(BaseModel):
    """A generated day-by-day prep plan, persisted to the `plans` collection."""

    id: str
    user_id: str
    track_id: TrackId
    skill_level: SkillLevel
    total_days: int
    weeks: list[PlanWeek]
    created_at: datetime


class GenerateQuestionsResponse(BaseModel):
    """Shape returned by both /generate-questions and /retake."""

    session_id: str
    questions: list[AssessmentQuestion]
    track_id: TrackId

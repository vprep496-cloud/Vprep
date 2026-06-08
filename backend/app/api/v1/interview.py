from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.v1.tracks import TRACKS_BY_ID
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.session import AnswerSubmission, SessionComplete, SessionCreate
from app.services import interview_service

router = APIRouter()

_VALID_TRACK_IDS = set(TRACKS_BY_ID.keys())


def _object_id_or_404(session_id: str) -> ObjectId:
    try:
        return ObjectId(session_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interview session not found.")


async def _get_owned_session(session_id: str, user_id: str, db: AsyncIOMotorDatabase) -> dict:
    """Shared lookup-and-ownership-check used by /answer and GET /session —
    keeps their 404/403 behavior identical."""
    session = await db["sessions"].find_one({"_id": _object_id_or_404(session_id)})
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interview session not found.")
    if session["user_id"] != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This interview session does not belong to you.",
        )
    return session


@router.post("/start")
async def start_interview(
    payload: SessionCreate,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Start a new mock interview session. Requires an active enrollment in the track."""
    if payload.track_id not in _VALID_TRACK_IDS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown track_id.")

    enrollment = await db["enrollments"].find_one(
        {"user_id": current_user["id"], "track_id": payload.track_id}
    )
    if enrollment is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You must enroll in this track before starting a mock interview.",
        )

    return await interview_service.start_session(current_user["id"], payload.track_id, payload.mode, db)


@router.post("/answer")
async def submit_answer(
    payload: AnswerSubmission,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Score one answer (voice or text) and append it to the session's answers."""
    object_id = _object_id_or_404(payload.session_id)
    session = await _get_owned_session(payload.session_id, current_user["id"], db)

    if session["status"] != "in_progress":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This interview session has already been completed.",
        )

    phase_questions = session.get("questions_by_phase", {}).get(payload.phase, [])
    question = next((q for q in phase_questions if q["id"] == payload.question_id), None)
    if question is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found in this session.")

    already_answered = any(
        answer["question_id"] == payload.question_id for answer in session.get("answers", [])
    )
    if already_answered:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An answer has already been submitted for this question.",
        )

    if payload.answer_type == "voice":
        if not payload.audio_base64:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="audio_base64 is required for voice answers.")
        scored = await interview_service.score_voice_answer(question, payload.audio_base64)
        transcription = scored.get("transcription")
        user_text_answer = None
    else:
        if not payload.text_answer:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="text_answer is required for text answers.")
        scored = await interview_service.score_text_answer(question, payload.text_answer)
        transcription = None
        user_text_answer = payload.text_answer

    answer_doc = {
        "question_id": payload.question_id,
        "question_text": question["question_text"],
        "phase": payload.phase,
        "answer_type": payload.answer_type,
        "transcription": transcription,
        "user_text_answer": user_text_answer,
        "score": max(0, min(int(scored.get("overall_score", 0)), 100)),
        "criteria_scores": scored.get("criteria_scores", {}),
        "feedback": scored.get("feedback", ""),
        # Falls back to the question bank's own model_answer if Gemini omits
        # one — it's the same text either way (we feed it to Gemini as the
        # rubric and ask it to echo it back, mirroring assessment_service).
        "model_answer": scored.get("model_answer") or question.get("model_answer", ""),
    }

    await db["sessions"].update_one({"_id": object_id}, {"$push": {"answers": answer_doc}})

    return {
        "question_id": answer_doc["question_id"],
        "score": answer_doc["score"],
        "criteria_scores": answer_doc["criteria_scores"],
        "feedback": answer_doc["feedback"],
        "model_answer": answer_doc["model_answer"],
        "transcription": answer_doc["transcription"],
    }


@router.post("/complete")
async def complete_interview(
    payload: SessionComplete,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Finalize a session: compute phase/overall scores, advance enrollment
    progress (Agent Rule #6), and return the full SessionResult."""
    return await interview_service.complete_session(payload.session_id, current_user["id"], db)


@router.get("/session/{session_id}")
async def get_session(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Fetch a session by id (ownership-checked).

    Judgment call: the spec's one-line description says "return the full
    session document" — but Agent Rule #3 is explicit that `model_answer`
    must never appear in a "mid-session" response, and an in-progress
    session's `questions_by_phase` entries carry exactly that field. So:
    completed sessions return the same SessionResult shape as /complete and
    /history (their `phase_results[].answers[].model_answer` is intentionally
    visible — that's the post-submission feedback the spec wants surfaced);
    in-progress sessions are returned with every embedded question sanitized,
    keeping this endpoint safe to poll mid-session without leaking the rubric.
    """
    session = await _get_owned_session(session_id, current_user["id"], db)
    session["id"] = str(session.pop("_id"))

    if session["status"] == "completed":
        return interview_service.to_session_result(session)

    return {
        **session,
        "questions_by_phase": {
            phase: [interview_service.sanitize_question(question) for question in questions]
            for phase, questions in session.get("questions_by_phase", {}).items()
        },
    }


@router.get("/history")
async def get_history(
    track_id: str | None = None,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Every completed session for the current user, optionally filtered by track."""
    if track_id is not None and track_id not in _VALID_TRACK_IDS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown track_id.")

    sessions = await interview_service.get_session_history(current_user["id"], track_id, db)
    return {"sessions": sessions}

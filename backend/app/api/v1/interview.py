from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.v1.tracks import get_track_or_none
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.session import AnswerSubmission, BatchTextAnswerSubmission, CodingAnswerSubmission, SessionComplete, SessionCreate, VoiceAnswerSubmission
from app.services import interview_service

router = APIRouter()

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
    if await get_track_or_none(payload.track_id, db) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown track_id.")

    enrollment = await db["enrollments"].find_one(
        {"user_id": current_user["id"], "track_id": payload.track_id}
    )
    if enrollment is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You must enroll in this track before starting a mock interview.",
        )

    return await interview_service.start_session(
        current_user["id"], payload.track_id, payload.mode, db, intensity=payload.intensity
    )


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
    if payload.answer_type != question.get("answer_type"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"This question requires a {question.get('answer_type')} answer.",
        )

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
        scored = await interview_service.score_voice_answer(
            question,
            payload.audio_base64,
            payload.audio_format,
            payload.answer_duration_seconds,
        )
        transcription = scored.get("transcription")
        user_text_answer = None
    elif payload.answer_type == "text":
        if not payload.text_answer:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="text_answer is required for text answers.")
        scored = await interview_service.score_text_answer(question, payload.text_answer)
        transcription = None
        user_text_answer = payload.text_answer
    else:
        if not payload.image_base64:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="image_base64 is required for image answers.")
        scored = await interview_service.score_image_answer(
            question,
            payload.image_base64,
            payload.image_mime_type,
        )
        transcription = scored.get("transcription")
        user_text_answer = None

    review_flags = list(scored.get("review_flags", []))
    if payload.answer_type == "image":
        if payload.image_width and payload.image_height and max(payload.image_width, payload.image_height) < 700:
            review_flags.extend(["low_resolution_image", "manual_review_recommended"])
        if payload.image_size_bytes and payload.image_size_bytes > 8 * 1024 * 1024:
            review_flags.extend(["large_image_upload", "manual_review_recommended"])
        review_flags = sorted(set(review_flags))
    scoring_metadata = dict(scored.get("scoring_metadata") or {})
    scoring_metadata["review_flags"] = review_flags
    manual_review_status = (
        "pending"
        if payload.phase in {"behavioral", "coding_logic"} or "manual_review_recommended" in review_flags
        else "not_required"
    )

    # STAR analysis — present only for behavioral voice answers when LLM scoring produced it.
    star_analysis: dict | None = scored.get("star_analysis") if payload.answer_type == "voice" else None
    # Code analysis — present only for coding image answers scored by qwen2.5-coder.
    code_analysis: dict | None = scored.get("code_analysis") if payload.answer_type == "image" else None

    answer_doc = {
        "question_id": payload.question_id,
        "question_text": question["question_text"],
        "phase": payload.phase,
        "answer_type": payload.answer_type,
        "transcription": transcription,
        "user_text_answer": user_text_answer,
        "answer_duration_seconds": payload.answer_duration_seconds,
        "image_width": payload.image_width,
        "image_height": payload.image_height,
        "image_size_bytes": payload.image_size_bytes,
        "score": max(0, min(int(scored.get("overall_score", 0)), 100)),
        "criteria_scores": scored.get("criteria_scores", {}),
        "feedback": scored.get("feedback", ""),
        # Falls back to the question bank's own model_answer if the local AI
        # omits one. It is the same rubric text we pass into the scoring prompt.
        "model_answer": scored.get("model_answer") or question.get("model_answer", ""),
        "confidence": scored.get("confidence"),
        "strengths": scored.get("strengths", []),
        "improvements": scored.get("improvements", []),
        "review_flags": review_flags,
        "evidence": scored.get("evidence", []),
        "score_rationale": scored.get("score_rationale"),
        "rubric_version": scored.get("rubric_version"),
        "scoring_mode": scored.get("scoring_mode"),
        "scoring_metadata": scoring_metadata,
        "star_analysis": star_analysis,
        "code_analysis": code_analysis,
        "ai_score": max(0, min(int(scored.get("overall_score", 0)), 100)),
        "ai_criteria_scores": scored.get("criteria_scores", {}),
        "ai_feedback": scored.get("feedback", ""),
        "ai_confidence": scored.get("confidence"),
        "ai_review_flags": review_flags,
        "ai_scoring_metadata": scoring_metadata,
        "manual_review_status": manual_review_status,
        "reviewer_notes": None,
        "reviewed_by": None,
        "reviewed_at": None,
    }

    await db["sessions"].update_one({"_id": object_id}, {"$push": {"answers": answer_doc}})

    return {
        "question_id": answer_doc["question_id"],
        "score": answer_doc["score"],
        "criteria_scores": answer_doc["criteria_scores"],
        "feedback": answer_doc["feedback"],
        "model_answer": answer_doc["model_answer"],
        "transcription": answer_doc["transcription"],
        "confidence": answer_doc["confidence"],
        "strengths": answer_doc["strengths"],
        "improvements": answer_doc["improvements"],
        "review_flags": answer_doc["review_flags"],
        "evidence": answer_doc["evidence"],
        "score_rationale": answer_doc["score_rationale"],
        "rubric_version": answer_doc["rubric_version"],
        "scoring_mode": answer_doc["scoring_mode"],
        "scoring_metadata": scoring_metadata,
        "star_analysis": star_analysis,
        "code_analysis": code_analysis,
    }


@router.post("/answer-batch")
async def submit_text_answer_batch(
    payload: BatchTextAnswerSubmission,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Score a whole technical text section in one local AI call."""
    object_id = _object_id_or_404(payload.session_id)
    session = await _get_owned_session(payload.session_id, current_user["id"], db)

    if session["status"] != "in_progress":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This interview session has already been completed.",
        )

    phase_questions = session.get("questions_by_phase", {}).get(payload.phase, [])
    questions_by_id = {question["id"]: question for question in phase_questions}
    requested_ids = [answer.question_id for answer in payload.answers]

    if len(set(requested_ids)) != len(requested_ids):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Duplicate answers in batch.")
    if not requested_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No answers submitted.")

    existing_answer_ids = {answer["question_id"] for answer in session.get("answers", [])}
    invalid_ids = [question_id for question_id in requested_ids if question_id not in questions_by_id]
    already_answered = [question_id for question_id in requested_ids if question_id in existing_answer_ids]
    non_text_ids = [
        question_id
        for question_id in requested_ids
        if questions_by_id.get(question_id, {}).get("answer_type") != "text"
    ]
    empty_ids = [answer.question_id for answer in payload.answers if len(answer.text_answer.strip()) < 20]

    if invalid_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found in this session.")
    if already_answered:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="One or more answers were already submitted.")
    if non_text_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Batch scoring only supports text answers.")
    if empty_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Every technical answer must be at least 20 characters.")

    answers_by_id = {answer.question_id: answer.text_answer.strip() for answer in payload.answers}
    questions = [questions_by_id[question_id] for question_id in requested_ids]
    scored_batch = await interview_service.score_text_answers_batch(questions, answers_by_id)

    answer_docs = []
    responses = []
    for question, scored in zip(questions, scored_batch):
        review_flags = sorted(set(scored.get("review_flags", [])))
        scoring_metadata = dict(scored.get("scoring_metadata") or {})
        scoring_metadata["review_flags"] = review_flags
        score = max(0, min(int(scored.get("overall_score", 0)), 100))
        answer_doc = {
            "question_id": question["id"],
            "question_text": question["question_text"],
            "phase": payload.phase,
            "answer_type": "text",
            "transcription": None,
            "user_text_answer": answers_by_id[question["id"]],
            "answer_duration_seconds": None,
            "image_width": None,
            "image_height": None,
            "image_size_bytes": None,
            "score": score,
            "criteria_scores": scored.get("criteria_scores", {}),
            "feedback": scored.get("feedback", ""),
            "model_answer": scored.get("model_answer") or question.get("model_answer", ""),
            "confidence": scored.get("confidence"),
            "strengths": scored.get("strengths", []),
            "improvements": scored.get("improvements", []),
            "review_flags": review_flags,
            "evidence": scored.get("evidence", []),
            "score_rationale": scored.get("score_rationale"),
            "rubric_version": scored.get("rubric_version"),
            "scoring_mode": scored.get("scoring_mode"),
            "scoring_metadata": scoring_metadata,
            "ai_score": score,
            "ai_criteria_scores": scored.get("criteria_scores", {}),
            "ai_feedback": scored.get("feedback", ""),
            "ai_confidence": scored.get("confidence"),
            "ai_review_flags": review_flags,
            "ai_scoring_metadata": scoring_metadata,
            "manual_review_status": "not_required",
            "reviewer_notes": None,
            "reviewed_by": None,
            "reviewed_at": None,
        }
        answer_docs.append(answer_doc)
        responses.append(
            {
                "question_id": answer_doc["question_id"],
                "score": answer_doc["score"],
                "criteria_scores": answer_doc["criteria_scores"],
                "feedback": answer_doc["feedback"],
                "model_answer": answer_doc["model_answer"],
                "transcription": answer_doc["transcription"],
                "confidence": answer_doc["confidence"],
                "strengths": answer_doc["strengths"],
                "improvements": answer_doc["improvements"],
                "review_flags": answer_doc["review_flags"],
                "evidence": answer_doc["evidence"],
                "score_rationale": answer_doc["score_rationale"],
                "rubric_version": answer_doc["rubric_version"],
                "scoring_mode": answer_doc["scoring_mode"],
            }
        )

    await db["sessions"].update_one({"_id": object_id}, {"$push": {"answers": {"$each": answer_docs}}})
    return {"answers": responses}


@router.post("/answer-coding", status_code=status.HTTP_202_ACCEPTED)
async def submit_coding_answer(
    payload: CodingAnswerSubmission,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Accept a handwritten coding answer immediately (202 Accepted) and kick
    off background OCR+AI scoring.  The client should poll
    GET /session/{id}/coding-status until status == 'complete' | 'failed'.

    This prevents the user waiting 30-90s for OCR+LLM to finish before they
    can navigate to the results screen."""
    # Ownership check
    session = await _get_owned_session(payload.session_id, current_user["id"], db)
    _ = session  # used only for auth — actual validation inside service

    result = await interview_service.submit_coding_answer_async(
        session_id=payload.session_id,
        question_id=payload.question_id,
        image_base64=payload.image_base64,
        image_mime_type=payload.image_mime_type,
        image_width=payload.image_width,
        image_height=payload.image_height,
        image_size_bytes=payload.image_size_bytes,
        db=db,
    )

    # Kick off scoring in the background (non-blocking)
    background_tasks.add_task(
        interview_service._score_coding_answer_background,
        payload.session_id,
        payload.question_id,
        db,
    )

    return result


@router.get("/session/{session_id}/coding-status")
async def get_coding_status(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Poll the async scoring status for all coding_logic answers in a session.

    Returns a list of {question_id, status, score, feedback, ...} objects.
    The client polls this until every status is 'complete' or 'failed'."""
    statuses = await interview_service.get_coding_score_status(session_id, current_user["id"], db)
    return {"coding_answers": statuses}


@router.post("/answer-voice", status_code=status.HTTP_202_ACCEPTED)
async def submit_voice_answer(
    payload: VoiceAnswerSubmission,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Accept a voice answer immediately (202 Accepted) and kick off background
    Whisper transcription + Ollama scoring.  The client should poll
    GET /session/{id}/voice-status until status == 'complete' | 'failed'.

    This lets the user continue to the next question without waiting 10-30s for
    the local AI pipeline to finish — identical async pattern to /answer-coding."""
    if not payload.audio_base64:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="audio_base64 is required.")
    if payload.phase not in ("hr", "behavioral"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Async voice scoring is for hr and behavioral phases.")

    # Ownership check
    session = await _get_owned_session(payload.session_id, current_user["id"], db)
    _ = session  # used only for auth — validation inside service

    result = await interview_service.submit_voice_answer_async(
        session_id=payload.session_id,
        question_id=payload.question_id,
        phase=payload.phase,
        audio_base64=payload.audio_base64,
        audio_format=payload.audio_format,
        duration_seconds=payload.answer_duration_seconds,
        db=db,
    )

    # Kick off Whisper + Ollama scoring in the background (non-blocking)
    background_tasks.add_task(
        interview_service._score_voice_answer_background,
        payload.session_id,
        payload.question_id,
        db,
    )

    return result


@router.get("/session/{session_id}/voice-status")
async def get_voice_status(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Poll the async scoring status for all voice answers in a session.

    Returns a list of {question_id, phase, status, score, feedback, ...} objects.
    The client polls this until every status is 'complete' or 'failed'."""
    statuses = await interview_service.get_voice_score_status(session_id, current_user["id"], db)
    return {"voice_answers": statuses}


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
    if track_id is not None and await get_track_or_none(track_id, db) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown track_id.")

    sessions = await interview_service.get_session_history(current_user["id"], track_id, db)
    return {"sessions": sessions}

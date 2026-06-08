# Phase 5 — mock interview orchestration: question sampling, Gemini scoring
# (voice + text), session completion/scoring math, and history. Routers in
# app/api/v1/interview.py stay thin and only handle request validation,
# ownership checks, and persistence orchestration — mirroring the Phase 3/4
# service/router split (assessment_service.py / enrollment_service.py).
import base64
import json
import logging
import random
from datetime import datetime, timezone

import google.generativeai as genai
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.enrollment import EnrollmentProgress
from app.services import enrollment_service
from app.services.gemini import generate_json, model

logger = logging.getLogger("vprep.interview_service")

VALID_MODES = {"hr", "technical", "behavioral", "full_mock"}

# Which phases each mode includes, and in what order they run. Full Mock runs
# them sequentially — HR, then Technical, then Behavioral — per the spec table.
PHASES_BY_MODE: dict[str, list[str]] = {
    "hr": ["hr"],
    "technical": ["technical"],
    "behavioral": ["behavioral"],
    "full_mock": ["hr", "technical", "behavioral"],
}

_QUESTION_COUNT_BY_PHASE = {"hr": 4, "technical": 5, "behavioral": 4}

# complete_session's weighted-average rule. When a phase is absent (HR Only,
# Technical Only, Behavioral Only sessions), its weight is redistributed
# equally among the phases that ARE present — see _phase_weights below.
_BASE_PHASE_WEIGHTS = {"hr": 0.30, "technical": 0.50, "behavioral": 0.20}

# Required JSON-only tail, mirroring assessment_service.py's Gemini Prompt
# Rule #1 suffix — generate_json() also appends its own, the two stack fine.
_JSON_ONLY_SUFFIX = (
    "\n\nRespond ONLY with valid JSON. No markdown, no backticks, no preamble, "
    "no explanation. Start immediately with `{`."
)
_RETRY_SUFFIX = (
    "\n\nYour previous response was not valid JSON. Output ONLY raw JSON this time."
)


# ---------------------------------------------------------------------------
# Question sanitization / sampling
# ---------------------------------------------------------------------------


def sanitize_question(question: dict) -> dict:
    """Strip `model_answer` (and Mongo's `_id`) from a question doc.

    Agent Rule #3: model_answer must never reach the client in a session-start
    or mid-session response — only inside AnswerResponse, after the candidate
    has already submitted their answer to that exact question.
    """
    return {key: value for key, value in question.items() if key not in ("model_answer", "_id")}


async def _sample_questions(
    db: AsyncIOMotorDatabase, phase: str, track_id: str, count: int
) -> list[dict]:
    """Randomly sample `count` questions for a phase via Mongo's `$sample`.

    HR and Behavioral questions are track-agnostic (`track_id: "all"` in the
    seed data); Technical questions are filtered to the candidate's own track.
    """
    query_track_id = "all" if phase in ("hr", "behavioral") else track_id
    pipeline = [
        {"$match": {"phase": phase, "track_id": query_track_id}},
        {"$sample": {"size": count}},
    ]

    questions: list[dict] = []
    async for document in db["questions"].aggregate(pipeline):
        document["id"] = str(document.pop("_id"))
        questions.append(document)
    return questions


# ---------------------------------------------------------------------------
# Gemini prompt builders + a small local JSON parser for multimodal responses
#
# `generate_json()` in gemini.py only accepts a plain text prompt — voice
# scoring needs a multimodal `[audio_part, text_part]` content list, so it
# can't go through that helper. `_parse_json_response` below intentionally
# duplicates gemini.py's small fence-stripping/parsing logic (rather than
# reaching into its private `_strip_code_fences`) to keep that Phase 1 file
# untouched, exactly as Agent Rule #1 requires.
# ---------------------------------------------------------------------------


def _parse_json_response(raw_text: str) -> dict:
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned.rsplit("```", 1)[0]
    cleaned = cleaned.strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        snippet = raw_text.strip()[:300]
        logger.error("Gemini returned non-JSON output: %s", snippet)
        raise ValueError(f"Gemini did not return valid JSON. Raw response: {snippet!r}") from exc


def _criteria_schema_snippet(criteria: list[str]) -> str:
    return ", ".join(f'"{criterion}": 8' for criterion in criteria)


def _build_voice_scoring_prompt(question: dict, criteria: list[str]) -> str:
    criteria_list = ", ".join(criteria)
    return (
        "You are an experienced interviewer scoring a candidate's SPOKEN answer "
        "to a mock-interview question. An audio recording of their answer is "
        "attached to this message.\n\n"
        f'Interview question: "{question["question_text"]}"\n'
        f'Reference model answer (server-side scoring rubric — never shown to '
        f'the candidate before now): {question["model_answer"]}\n'
        f"Scoring criteria: {criteria_list}\n\n"
        "Steps:\n"
        "1. First, transcribe the audio EXACTLY as spoken — a faithful, verbatim "
        "transcription including filler words and false starts where audible.\n"
        "2. Then score the candidate's spoken answer against the reference "
        f"answer and each of these criteria, independently, on a scale of 0 to "
        f"10: {criteria_list}.\n"
        "3. Compute an overall_score as the average of the criteria scores, "
        "scaled to a 0-100 range (average out of 10, multiplied by 10, rounded "
        "to the nearest whole number).\n"
        "4. Write 1-2 sentences of constructive feedback.\n\n"
        "Respond with strict JSON only, using exactly this schema:\n"
        "{\n"
        '  "transcription": "...",\n'
        '  "overall_score": 78,\n'
        f'  "criteria_scores": {{{_criteria_schema_snippet(criteria)}}},\n'
        '  "feedback": "...",\n'
        '  "model_answer": "..."\n'
        "}" + _JSON_ONLY_SUFFIX
    )


def _build_text_scoring_prompt(question: dict, text_answer: str) -> str:
    criteria = question.get("scoring_criteria", [])
    criteria_list = ", ".join(criteria)
    return (
        "You are an experienced interviewer scoring a candidate's TYPED answer "
        "to a technical mock-interview question.\n\n"
        f'Interview question: "{question["question_text"]}"\n'
        f"Reference model answer (server-side scoring rubric — never shown to "
        f'the candidate before now): {question["model_answer"]}\n'
        f"Scoring criteria: {criteria_list}\n\n"
        f'Candidate\'s typed answer: "{text_answer}"\n\n'
        f"Score the answer against each of these criteria independently, on a "
        f"scale of 0 to 10: {criteria_list}. Compute an overall_score as the "
        "average of the criteria scores, scaled to a 0-100 range (average out "
        "of 10, multiplied by 10, rounded to the nearest whole number). Write "
        "1-2 sentences of constructive feedback.\n\n"
        "Respond with strict JSON only, using exactly this schema:\n"
        "{\n"
        '  "overall_score": 82,\n'
        f'  "criteria_scores": {{{_criteria_schema_snippet(criteria)}}},\n'
        '  "feedback": "...",\n'
        '  "model_answer": "..."\n'
        "}" + _JSON_ONLY_SUFFIX
    )


def _audio_mime_type(audio_format: str | None) -> str:
    """Map the client-reported recording format to a Gemini-friendly mime type.

    `VoiceRecorder.tsx` always records HIGH_QUALITY presets, which default to
    m4a — "audio/wav" is accepted as a defensive fallback per the spec's
    "audio/m4a or audio/wav depending on the recording format" guidance.
    """
    if audio_format and "wav" in audio_format.lower():
        return "audio/wav"
    return "audio/m4a"


# ---------------------------------------------------------------------------
# Public service functions
# ---------------------------------------------------------------------------


async def start_session(user_id: str, track_id: str, mode: str, db: AsyncIOMotorDatabase) -> dict:
    """Sample questions for every phase the mode requires, persist the full
    session document (including model_answer — Agent Rule #5), and return a
    sanitized SessionStartResponse-shaped dict."""
    if mode not in VALID_MODES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid interview mode.")

    phases = PHASES_BY_MODE[mode]
    questions_by_phase: dict[str, list[dict]] = {}

    for phase in phases:
        count = _QUESTION_COUNT_BY_PHASE[phase]
        sampled = await _sample_questions(db, phase, track_id, count)
        if len(sampled) < count:
            logger.error(
                "Question bank shortage: phase=%s track_id=%s wanted=%d got=%d",
                phase, track_id, count, len(sampled),
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Not enough interview questions are available right now. Please try again shortly.",
            )
        questions_by_phase[phase] = sampled

    now = datetime.now(timezone.utc)
    document = {
        "user_id": user_id,
        "track_id": track_id,
        "mode": mode,
        "phases": phases,
        "questions_by_phase": questions_by_phase,
        "answers": [],
        "status": "in_progress",
        "started_at": now,
        "completed_at": None,
    }

    insert_result = await db["sessions"].insert_one(dict(document))

    sanitized_questions = {
        phase: [sanitize_question(question) for question in questions]
        for phase, questions in questions_by_phase.items()
    }

    return {
        "session_id": str(insert_result.inserted_id),
        "track_id": track_id,
        "mode": mode,
        "phases": phases,
        "questions": sanitized_questions,
        "started_at": now,
    }


async def score_voice_answer(question: dict, audio_base64: str, audio_format: str | None = None) -> dict:
    """Send the audio inline to Gemini 1.5 Flash for a single transcribe+score
    call. Retries once on any failure (parse or API error), then raises 503 —
    mirroring assessment_service._call_gemini_json's retry-then-503 pattern."""
    try:
        audio_bytes = base64.b64decode(audio_base64)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid audio data.") from exc

    criteria = question.get("scoring_criteria", [])
    mime_type = _audio_mime_type(audio_format)
    audio_part = genai.protos.Part(inline_data=genai.protos.Blob(mime_type=mime_type, data=audio_bytes))

    async def _attempt(prompt_text: str) -> dict:
        text_part = genai.protos.Part(text=prompt_text)
        response = await model.generate_content_async([audio_part, text_part])
        return _parse_json_response(response.text)

    base_prompt = _build_voice_scoring_prompt(question, criteria)
    try:
        return await _attempt(base_prompt)
    except Exception as first_error:
        logger.warning("Gemini voice scoring failed, retrying once: %s", first_error)
        try:
            return await _attempt(base_prompt + _RETRY_SUFFIX)
        except Exception as second_error:
            logger.error("Gemini voice scoring failed after retry: %s", second_error)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="AI scoring service temporarily unavailable. Please try again.",
            )


async def score_text_answer(question: dict, text_answer: str) -> dict:
    """Score a typed technical answer in one Gemini call via generate_json,
    with the same retry-then-503 behavior as score_voice_answer above."""
    prompt = _build_text_scoring_prompt(question, text_answer)
    try:
        return await generate_json(prompt)
    except Exception as first_error:
        logger.warning("Gemini text scoring failed, retrying once: %s", first_error)
        try:
            return await generate_json(prompt + _RETRY_SUFFIX)
        except Exception as second_error:
            logger.error("Gemini text scoring failed after retry: %s", second_error)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="AI scoring service temporarily unavailable. Please try again.",
            )


def _phase_weights(present_phases: list[str]) -> dict[str, float]:
    """Weighted-average rule from the spec: HR 30% / Technical 50% /
    Behavioral 20% — and "if a phase is not in this session, redistribute its
    weight equally among present phases."""
    missing_weight = sum(weight for phase, weight in _BASE_PHASE_WEIGHTS.items() if phase not in present_phases)
    bonus = missing_weight / len(present_phases) if present_phases else 0.0
    return {phase: _BASE_PHASE_WEIGHTS[phase] + bonus for phase in present_phases}


def to_session_result(session: dict) -> dict:
    """Project a completed session document down to the SessionResult shape
    (also reused by GET /session/{id} and GET /history)."""
    return {
        "id": session["id"],
        "user_id": session["user_id"],
        "track_id": session["track_id"],
        "mode": session["mode"],
        "overall_score": session["overall_score"],
        "phase_results": session["phase_results"],
        "started_at": session["started_at"],
        "completed_at": session["completed_at"],
        "duration_seconds": session["duration_seconds"],
    }


async def complete_session(session_id: str, user_id: str, db: AsyncIOMotorDatabase) -> dict:
    """Validate every question is answered, compute phase + overall scores,
    persist the completed session, advance enrollment progress, and return
    the full SessionResult."""
    try:
        object_id = ObjectId(session_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interview session not found.")

    session = await db["sessions"].find_one({"_id": object_id})
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interview session not found.")
    if session["user_id"] != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This interview session does not belong to you.")

    # Idempotent-ish: a session that's already completed simply returns its
    # already-computed result rather than re-scoring (and re-advancing
    # enrollment progress a second time).
    if session["status"] == "completed":
        session["id"] = str(session.pop("_id"))
        return to_session_result(session)

    questions_by_phase: dict[str, list[dict]] = session["questions_by_phase"]
    answers: list[dict] = session.get("answers", [])
    answers_by_id = {answer["question_id"]: answer for answer in answers}

    all_question_ids = {
        question["id"] for questions in questions_by_phase.values() for question in questions
    }
    missing_ids = all_question_ids - set(answers_by_id.keys())
    if missing_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please answer every question before completing the session.",
        )

    phase_results: list[dict] = []
    phase_scores: dict[str, int] = {}

    for phase in session["phases"]:
        phase_questions = questions_by_phase[phase]
        phase_answers = [answers_by_id[question["id"]] for question in phase_questions]
        phase_score = round(sum(answer["score"] for answer in phase_answers) / len(phase_answers))
        phase_scores[phase] = phase_score
        phase_results.append({
            "phase": phase,
            "score": phase_score,
            "question_count": len(phase_answers),
            "answers": phase_answers,
        })

    weights = _phase_weights(session["phases"])
    overall_score = round(sum(phase_scores[phase] * weights[phase] for phase in session["phases"]))
    overall_score = max(0, min(overall_score, 100))

    completed_at = datetime.now(timezone.utc)
    started_at = session["started_at"]
    duration_seconds = max(0, int((completed_at - started_at).total_seconds()))

    updates = {
        "status": "completed",
        "completed_at": completed_at,
        "phase_results": phase_results,
        "overall_score": overall_score,
        "duration_seconds": duration_seconds,
    }
    await db["sessions"].update_one({"_id": object_id}, {"$set": updates})

    # ------------------------------------------------------------------
    # Agent Rule #6 — must call enrollment_service.update_progress here,
    # advancing `current_day` by 1 and folding this session's overall score
    # into the enrollment's running average. `/start` already verified the
    # candidate is enrolled, but we re-check defensively (e.g. they could in
    # theory unenroll mid-session) — a missing enrollment shouldn't blow up
    # session completion; it just means progress has nothing to advance.
    # ------------------------------------------------------------------
    enrollment = await db["enrollments"].find_one({"user_id": user_id, "track_id": session["track_id"]})
    if enrollment is not None:
        progress = EnrollmentProgress(
            current_day=enrollment.get("current_day", 1) + 1,
            session_score=float(overall_score),
        )
        await enrollment_service.update_progress(user_id, session["track_id"], progress, db)
    else:
        logger.warning(
            "complete_session: no enrollment found for user_id=%s track_id=%s — skipping progress update",
            user_id, session["track_id"],
        )

    result = {**session, **updates}
    result["id"] = str(result.pop("_id"))
    return to_session_result(result)


async def get_session_history(user_id: str, track_id: str | None, db: AsyncIOMotorDatabase) -> list[dict]:
    """Every completed session for this user (optionally filtered by track),
    newest-first, capped at 50, each shaped as a SessionResult."""
    query: dict = {"user_id": user_id, "status": "completed"}
    if track_id is not None:
        query["track_id"] = track_id

    cursor = db["sessions"].find(query).sort("completed_at", -1).limit(50)

    sessions: list[dict] = []
    async for document in cursor:
        document["id"] = str(document.pop("_id"))
        sessions.append(to_session_result(document))
    return sessions

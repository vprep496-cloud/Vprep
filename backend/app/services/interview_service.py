# Phase 5 — mock interview orchestration: question sampling, Gemini scoring
# (voice + text), session completion/scoring math, and history. Routers in
# app/api/v1/interview.py stay thin and only handle request validation,
# ownership checks, and persistence orchestration — mirroring the Phase 3/4
# service/router split (assessment_service.py / enrollment_service.py).
import base64
import logging
from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.enrollment import EnrollmentProgress
from app.services import admin_ai_service, enrollment_service
from app.services.profile_service import normalize_level
from app.services.scoring_engine import (
    RUBRIC_VERSION,
    score_assessment_batch,
    score_interview_audio,
    score_interview_image,
    score_interview_text,
)

logger = logging.getLogger("vprep.interview_service")

VALID_MODES = {"hr", "technical", "behavioral", "full_mock"}

# Which phases each mode includes, and in what order they run. Full Mock runs
# them sequentially — HR, then Technical, then Coding Logic, then Behavioral.
# The product's "technical phase" includes both conceptual short answers and
# handwritten coding-logic uploads, so `coding_logic` is an internal phase key.
PHASES_BY_MODE: dict[str, list[str]] = {
    "hr": ["hr"],
    "technical": ["technical", "coding_logic"],
    "behavioral": ["behavioral"],
    "full_mock": ["hr", "technical", "coding_logic", "behavioral"],
}

_QUESTION_COUNT_BY_PHASE = {"hr": 4, "technical": 4, "coding_logic": 1, "behavioral": 4}

# complete_session's weighted-average rule. When a phase is absent (HR Only,
# Technical Only, Behavioral Only sessions), its weight is redistributed
# equally among the phases that ARE present — see _phase_weights below.
_BASE_PHASE_WEIGHTS = {"hr": 0.30, "technical": 0.35, "coding_logic": 0.15, "behavioral": 0.20}

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


def _serialize_question(document: dict) -> dict:
    serialized = dict(document)
    serialized["id"] = str(serialized.pop("_id"))
    return serialized


def _question_track_filter(phase: str, track_id: str) -> str | dict:
    # HR/Behavioral prompts are reusable across tracks, while technical prompts
    # stay track-specific. Coding logic accepts both reusable and track prompts.
    return {"$in": ["all", track_id]} if phase in ("hr", "behavioral", "coding_logic") else track_id


def _difficulty_for_skill_level(skill_level: str) -> str:
    return {"beginner": "easy", "intermediate": "medium", "advanced": "hard"}.get(
        normalize_level(skill_level),
        "medium",
    )


async def _sample_questions(
    db: AsyncIOMotorDatabase,
    phase: str,
    track_id: str,
    count: int,
    preferred_difficulty: str | None = None,
) -> list[dict]:
    """Randomly sample `count` questions for a phase via Mongo's `$sample`.

    HR and Behavioral can be track-agnostic (`track_id: "all"`) or tied to a
    custom track. Technical/Coding Logic prefer the candidate's track but also
    accept "all" fallback questions for reusable logic prompts.
    """
    questions: list[dict] = []

    async def run_sample(extra_match: dict | None = None, remaining: int = count) -> None:
        if remaining <= 0:
            return
        match: dict[str, Any] = {"phase": phase, "track_id": _question_track_filter(phase, track_id)}
        if extra_match:
            match.update(extra_match)
        if questions:
            match["_id"] = {"$nin": [ObjectId(question["id"]) for question in questions]}

        pipeline = [{"$match": match}, {"$sample": {"size": remaining}}]
        async for document in db["questions"].aggregate(pipeline):
            questions.append(_serialize_question(document))

    if preferred_difficulty:
        await run_sample({"difficulty": preferred_difficulty}, count)
    await run_sample(None, count - len(questions))

    return questions


async def _candidate_profile_for_interview(
    user_id: str,
    track_id: str,
    db: AsyncIOMotorDatabase,
) -> dict[str, Any]:
    user: dict | None = None
    try:
        user = await db["users"].find_one({"_id": ObjectId(user_id)})
    except (InvalidId, TypeError):
        user = None

    enrollment = await db["enrollments"].find_one({"user_id": user_id, "track_id": track_id})
    raw_profile = user.get("profile") if user else {}
    profile = raw_profile if isinstance(raw_profile, dict) else {}

    skill_level = (
        (enrollment or {}).get("skill_level")
        or (user or {}).get("normalized_level")
        or profile.get("normalized_level")
        or (user or {}).get("self_reported_level")
        or profile.get("self_reported_level")
        or "beginner"
    )

    return {
        "skill_level": normalize_level(skill_level),
        "target_role": (user or {}).get("target_role") or profile.get("target_role"),
        "skills": profile.get("skills") if isinstance(profile.get("skills"), list) else [],
        "primary_roles": profile.get("primary_roles") if isinstance(profile.get("primary_roles"), list) else [],
        "profile_confidence": profile.get("confidence"),
    }


def _auto_fill_guidance(phase: str, candidate_profile: dict[str, Any]) -> str:
    skills = ", ".join(str(skill) for skill in candidate_profile.get("skills", [])[:8])
    roles = ", ".join(str(role) for role in candidate_profile.get("primary_roles", [])[:4])
    target_role = candidate_profile.get("target_role")
    level = candidate_profile["skill_level"]

    return (
        f"Auto-fill a reusable question-bank shortage for {level}-level candidates. "
        f"Target role context: {target_role or roles or 'general candidate for this track'}. "
        f"Relevant skills to reflect when useful: {skills or 'use the track topic areas'}. "
        "Do not include candidate names, employers, schools, or any personal identifiers. "
        "Create professional interview questions that can safely be reused for similar candidates. "
        f"Phase needing questions: {phase}."
    )


def _fallback_question_documents(
    track: dict,
    phase: str,
    count: int,
    difficulty: str,
    candidate_profile: dict[str, Any],
) -> list[dict]:
    topics = track.get("topic_areas") or [track.get("name", "the role")]
    track_name = track.get("name", "this track")
    level = candidate_profile["skill_level"]
    target_role = candidate_profile.get("target_role") or f"{track_name} role"

    answer_type = "image" if phase == "coding_logic" else "voice" if phase in {"hr", "behavioral"} else "text"
    criteria_by_phase = {
        "hr": ["communication_clarity", "question_relevance", "structure", "professionalism", "role_alignment"],
        "technical": ["technical_correctness", "depth_of_understanding", "reasoning_quality", "terminology"],
        "coding_logic": ["problem_understanding", "algorithm_correctness", "edge_cases", "complexity_awareness"],
        "behavioral": ["situation_context", "action_ownership", "result_impact", "reflection_learning"],
    }

    hr_questions = [
        f"Walk me through your background and why you are preparing for a {target_role}.",
        f"What makes you interested in {track_name}, and how does it connect to your recent learning or work?",
        "Describe a strength you would bring to a team and a skill you are actively improving.",
        "Tell me about a time you had to explain a complex idea clearly to someone else.",
    ]
    behavioral_questions = [
        "Tell me about a time you handled feedback on your work. What changed afterward?",
        "Describe a situation where you had to collaborate under pressure. What did you do?",
        "Tell me about a mistake or missed expectation and how you recovered from it.",
        "Describe a time you took ownership of a problem without waiting to be asked.",
    ]

    documents: list[dict] = []
    for index in range(count):
        topic = topics[index % len(topics)]
        if phase == "technical":
            question_text = (
                f"Explain {topic} in the context of {track_name}. What tradeoffs, "
                "failure modes, or practical implementation details should an interviewer expect?"
            )
            model_answer = (
                f"A strong {level} answer defines the concept accurately, explains why it matters, "
                "gives a practical example, mentions tradeoffs or edge cases, and uses correct terminology."
            )
        elif phase == "coding_logic":
            question_text = (
                "Handwrite an algorithm to process a list of inputs, detect duplicates, and return the "
                "unique values in stable order. Include time/space complexity and at least two edge cases."
            )
            model_answer = (
                "A strong solution uses a set for seen values, preserves insertion order in the output, "
                "handles empty input and repeated values, and explains O(n) time with O(n) extra space."
            )
        elif phase == "behavioral":
            question_text = behavioral_questions[index % len(behavioral_questions)]
            model_answer = (
                "A strong answer uses STAR structure, makes the candidate's own actions clear, includes "
                "a concrete result, and reflects on what they learned."
            )
        else:
            question_text = hr_questions[index % len(hr_questions)]
            model_answer = (
                "A strong answer is clear, specific, professionally toned, aligned to the target role, "
                "and avoids vague claims without examples."
            )

        documents.append(
            {
                "track_id": track["id"] if phase not in {"hr", "behavioral"} else "all",
                "phase": phase,
                "question_text": question_text,
                "answer_type": answer_type,
                "difficulty": difficulty,
                "scoring_criteria": criteria_by_phase[phase],
                "model_answer": model_answer,
                "tags": ["auto_fill", "fallback", phase, level, track["id"]],
            }
        )
    return documents


async def _auto_fill_missing_questions(
    db: AsyncIOMotorDatabase,
    phase: str,
    track_id: str,
    missing_count: int,
    difficulty: str,
    candidate_profile: dict[str, Any],
) -> list[dict]:
    from app.api.v1.tracks import get_track_or_none

    track = await get_track_or_none(track_id, db)
    if track is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown track_id.")

    generate_count = missing_count if phase == "coding_logic" else max(missing_count, 3)
    guidance = _auto_fill_guidance(phase, candidate_profile)

    try:
        documents = await admin_ai_service.generate_question_documents(
            track,
            phase,
            generate_count,
            difficulty,
            guidance,
        )
        source = "ai_auto_fill"
    except Exception as exc:
        logger.warning(
            "Gemini question auto-fill failed; using local fallback. phase=%s track_id=%s error=%s",
            phase,
            track_id,
            exc,
        )
        documents = _fallback_question_documents(track, phase, missing_count, difficulty, candidate_profile)
        source = "local_auto_fill"

    now = datetime.now(timezone.utc)
    enriched = [
        {
            **document,
            "source": source,
            "skill_level": candidate_profile["skill_level"],
            "created_at": now,
            "updated_at": now,
        }
        for document in documents
    ]

    result = await db["questions"].insert_many(enriched)
    created: list[dict] = []
    for document, inserted_id in zip(enriched, result.inserted_ids):
        created.append({**document, "id": str(inserted_id)})
    return created[:missing_count]


async def _ensure_question_supply(
    db: AsyncIOMotorDatabase,
    phase: str,
    track_id: str,
    count: int,
    candidate_profile: dict[str, Any],
) -> list[dict]:
    difficulty = _difficulty_for_skill_level(candidate_profile["skill_level"])
    sampled = await _sample_questions(db, phase, track_id, count, preferred_difficulty=difficulty)
    if len(sampled) >= count:
        return sampled

    missing = count - len(sampled)
    logger.info(
        "Auto-filling question shortage: phase=%s track_id=%s wanted=%d got=%d level=%s difficulty=%s",
        phase,
        track_id,
        count,
        len(sampled),
        candidate_profile["skill_level"],
        difficulty,
    )
    generated = await _auto_fill_missing_questions(
        db,
        phase,
        track_id,
        missing,
        difficulty,
        candidate_profile,
    )
    combined = [*sampled, *generated]
    if len(combined) >= count:
        return combined[:count]

    resampled = await _sample_questions(db, phase, track_id, count, preferred_difficulty=difficulty)
    if len(resampled) >= count:
        return resampled

    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Not enough interview questions are available right now. Please try again shortly.",
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


def _image_mime_type(image_mime_type: str | None) -> str:
    if image_mime_type in {"image/png", "image/webp", "image/heic", "image/heif"}:
        return image_mime_type
    return "image/jpeg"


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
    candidate_profile = await _candidate_profile_for_interview(user_id, track_id, db)

    for phase in phases:
        count = _QUESTION_COUNT_BY_PHASE[phase]
        questions_by_phase[phase] = await _ensure_question_supply(
            db,
            phase,
            track_id,
            count,
            candidate_profile,
        )

    now = datetime.now(timezone.utc)
    document = {
        "user_id": user_id,
        "track_id": track_id,
        "mode": mode,
        "phases": phases,
        "questions_by_phase": questions_by_phase,
        "candidate_profile_snapshot": {
            "skill_level": candidate_profile["skill_level"],
            "target_role": candidate_profile.get("target_role"),
            "profile_confidence": candidate_profile.get("profile_confidence"),
        },
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


async def score_voice_answer(
    question: dict,
    audio_base64: str,
    audio_format: str | None = None,
    duration_seconds: int | None = None,
) -> dict:
    """Send audio inline to the scoring engine for transcribe+score."""
    try:
        audio_bytes = base64.b64decode(audio_base64)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid audio data.") from exc

    mime_type = _audio_mime_type(audio_format)
    return await score_interview_audio(question, audio_bytes, mime_type, duration_seconds=duration_seconds)


async def score_text_answer(question: dict, text_answer: str) -> dict:
    """Score a typed technical answer through the calibrated scoring engine."""
    return await score_interview_text(question, text_answer)


async def score_text_answers_batch(questions: list[dict], answers_by_id: dict[str, str]) -> list[dict]:
    """Score a full technical text section in one Gemini call."""
    qa_items = [
        {
            "id": question["id"],
            "topic_area": ", ".join(question.get("tags", [])[:2]) or question.get("phase", "technical"),
            "difficulty": question.get("difficulty", "medium"),
            "question": question.get("question_text", ""),
            "model_answer": question.get("model_answer", ""),
            "user_answer": answers_by_id.get(question["id"], ""),
        }
        for question in questions
    ]

    raw_result = await score_assessment_batch(qa_items)
    evaluations_by_id = {evaluation["question_id"]: evaluation for evaluation in raw_result["evaluations"]}

    scored: list[dict] = []
    for question in questions:
        evaluation = evaluations_by_id.get(question["id"], {})
        score_0_to_10 = max(0, min(int(evaluation.get("score", 0)), 10))
        scored.append(
            {
                "question_id": question["id"],
                "overall_score": score_0_to_10 * 10,
                "criteria_scores": evaluation.get("criteria_scores", {}),
                "feedback": evaluation.get("feedback", ""),
                "model_answer": question.get("model_answer", evaluation.get("model_answer", "")),
                "transcription": None,
                "confidence": evaluation.get("confidence"),
                "strengths": evaluation.get("strengths", []),
                "improvements": evaluation.get("improvements", []),
                "review_flags": evaluation.get("review_flags", []),
                "evidence": evaluation.get("evidence", []),
                "score_rationale": evaluation.get("score_rationale"),
                "rubric_version": raw_result.get("rubric_version", RUBRIC_VERSION),
                "scoring_mode": raw_result.get("scoring_mode", "technical_text_batch"),
                "scoring_metadata": evaluation.get("scoring_metadata") or {
                    "rubric_version": raw_result.get("rubric_version", RUBRIC_VERSION),
                    "scoring_mode": raw_result.get("scoring_mode", "technical_text_batch"),
                    "provider": "gemini",
                },
            }
        )
    return scored


async def score_image_answer(question: dict, image_base64: str, image_mime_type: str | None = None) -> dict:
    """Use multimodal scoring to read and score a handwritten coding solution."""
    try:
        image_bytes = base64.b64decode(image_base64)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid image data.") from exc

    mime_type = _image_mime_type(image_mime_type)
    return await score_interview_image(question, image_bytes, mime_type)


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

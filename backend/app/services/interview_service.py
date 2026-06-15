# Phase 5 — mock interview orchestration: question sampling, local AI scoring
# (voice + text), session completion/scoring math, and history. Routers in
# app/api/v1/interview.py stay thin and only handle request validation,
# ownership checks, and persistence orchestration — mirroring the Phase 3/4
# service/router split (assessment_service.py / enrollment_service.py).
import asyncio
import base64
import logging
from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.services import admin_ai_service
from app.services.profile_service import normalize_level
from app.services.role_catalog import (
    effective_difficulty,
    focus_for_role,
    infer_seniority_from_label,
)
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

# Intensity multipliers: "quick" ≈ half, "standard" = 1×, "deep" ≈ 1.5×.
# Coding logic is always 1 regardless (limited by how many problems fit in a session).
_INTENSITY_MULTIPLIERS = {"quick": 0.5, "standard": 1.0, "deep": 1.5}


def _question_count_for_intensity(phase: str, intensity: str) -> int:
    base = _QUESTION_COUNT_BY_PHASE[phase]
    multiplier = _INTENSITY_MULTIPLIERS.get(intensity, 1.0)
    if phase == "coding_logic":
        return 1  # always exactly one coding problem
    return max(1, round(base * multiplier))

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


def _difficulty_for_profile(candidate_profile: dict[str, Any]) -> str:
    """Question difficulty blends the candidate's assessed skill with the
    seniority of the role they're targeting — so a Junior role yields easier
    questions and a Senior role harder ones, even at the same skill level."""
    return effective_difficulty(
        normalize_level(candidate_profile.get("skill_level")),
        candidate_profile.get("role_seniority"),
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

    # Per-track role first: each enrollment carries its own target role + its
    # seniority and focus areas, so interview questions personalize to the role
    # the candidate is actually targeting on this track (and its difficulty).
    target_role = (
        (enrollment or {}).get("target_role")
        or (user or {}).get("target_role")
        or profile.get("target_role")
    )
    role_seniority = (enrollment or {}).get("role_seniority") or infer_seniority_from_label(target_role)
    role_focus = focus_for_role(track_id, (enrollment or {}).get("target_role_id"), target_role)

    return {
        "skill_level": normalize_level(skill_level),
        "target_role": target_role,
        "role_seniority": role_seniority,
        "role_focus": role_focus,
        "skills": profile.get("skills") if isinstance(profile.get("skills"), list) else [],
        "projects": profile.get("projects") if isinstance(profile.get("projects"), list) else [],
        "primary_roles": profile.get("primary_roles") if isinstance(profile.get("primary_roles"), list) else [],
        "years_experience": (user or {}).get("years_experience") or profile.get("years_experience"),
        "summary": (user or {}).get("cv_summary") or profile.get("summary"),
        "profile_confidence": profile.get("confidence"),
    }


def _auto_fill_guidance(phase: str, candidate_profile: dict[str, Any]) -> str:
    skills = ", ".join(str(skill) for skill in candidate_profile.get("skills", [])[:8])
    projects = "; ".join(str(project) for project in candidate_profile.get("projects", [])[:4])
    roles = ", ".join(str(role) for role in candidate_profile.get("primary_roles", [])[:4])
    target_role = candidate_profile.get("target_role")
    seniority = candidate_profile.get("role_seniority") or "mid"
    role_focus = ", ".join(str(area) for area in candidate_profile.get("role_focus", [])[:8])
    years = candidate_profile.get("years_experience")
    level = candidate_profile["skill_level"]

    if seniority == "junior":
        difficulty_note = (
            "This is a JUNIOR/entry-level target role: keep questions fundamental and approachable, "
            "focused on core concepts and practical basics rather than deep system design or advanced edge cases."
        )
    elif seniority == "senior":
        difficulty_note = (
            "This is a SENIOR target role: questions should be challenging and probe depth, tradeoffs, "
            "system design, scalability, and judgment, not just definitions."
        )
    else:
        difficulty_note = (
            "This is a mid-level target role: balance core understanding with practical depth, "
            "reasoning, and realistic tradeoffs."
        )

    return (
        f"Auto-fill a reusable question-bank shortage for the target role "
        f"'{target_role or 'candidate for this track'}' (candidate assessed skill level: {level}). "
        f"{difficulty_note} "
        f"Tailor the questions to this role's focus areas: {role_focus or 'use the track topic areas'}. "
        f"Years of experience signal: {years if years is not None else 'not provided'}. "
        f"Other relevant skills to reflect when useful: {skills or 'use the track topic areas'}. "
        f"Project-style signals to reflect generically when useful: {projects or roles or 'not provided'}. "
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
        f"What makes you interested in {track_name}, and how does it connect to your recent learning, projects, or work?",
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
            "On paper, handwrite an algorithm to process a list of inputs, detect duplicates, and return the "
            "unique values in stable order. Capture a clear photo of your solution, including time/space "
            "complexity and at least two edge cases."
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
            "Local AI question auto-fill failed; using local fallback. phase=%s track_id=%s error=%s",
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
    difficulty = _difficulty_for_profile(candidate_profile)
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
    """Map the client-reported recording format to a MIME type for the AI pipeline.

    Native platforms (iOS/Android) record in m4a by default (HIGH_QUALITY preset).
    React Native web uses the browser MediaRecorder which defaults to audio/webm
    (codec: opus). We must pass the correct MIME type so faster-whisper / ffmpeg
    selects the right decoder.
    """
    if not audio_format:
        return "audio/m4a"
    fmt = audio_format.lower()
    if "wav" in fmt:
        return "audio/wav"
    if "webm" in fmt or "opus" in fmt:
        return "audio/webm"
    if "mp3" in fmt or "mpeg" in fmt:
        return "audio/mpeg"
    if "ogg" in fmt:
        return "audio/ogg"
    if "aac" in fmt or "m4a" in fmt or "mp4" in fmt:
        return "audio/m4a"
    return "audio/m4a"  # safe fallback


def _image_mime_type(image_mime_type: str | None) -> str:
    if image_mime_type in {"image/png", "image/webp", "image/heic", "image/heif"}:
        return image_mime_type
    return "image/jpeg"


# ---------------------------------------------------------------------------
# Public service functions
# ---------------------------------------------------------------------------


async def start_session(
    user_id: str,
    track_id: str,
    mode: str,
    db: AsyncIOMotorDatabase,
    intensity: str = "standard",
) -> dict:
    """Sample questions for every phase the mode requires, persist the full
    session document (including model_answer — Agent Rule #5), and return a
    sanitized SessionStartResponse-shaped dict."""
    if mode not in VALID_MODES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid interview mode.")
    if intensity not in _INTENSITY_MULTIPLIERS:
        intensity = "standard"

    phases = PHASES_BY_MODE[mode]
    questions_by_phase: dict[str, list[dict]] = {}
    candidate_profile = await _candidate_profile_for_interview(user_id, track_id, db)

    for phase in phases:
        count = _question_count_for_intensity(phase, intensity)
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
            "years_experience": candidate_profile.get("years_experience"),
            "skills": candidate_profile.get("skills", [])[:12],
            "projects": candidate_profile.get("projects", [])[:5],
            "summary": candidate_profile.get("summary"),
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
        "intensity": intensity,
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
    """Transcribe and score a voice answer.

    If Ollama scoring fails after retries (503 from the scoring engine), the
    answer is still recorded — transcription is preserved, score is set to 0,
    and the answer is flagged for manual review. This ensures the candidate
    never loses a submitted answer because the local model was slow or briefly
    unavailable.
    """
    try:
        audio_bytes = base64.b64decode(audio_base64)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid audio data.") from exc

    mime_type = _audio_mime_type(audio_format)
    try:
        return await score_interview_audio(question, audio_bytes, mime_type, duration_seconds=duration_seconds)
    except HTTPException as scoring_exc:
        # Scoring engine gives 503 when Ollama is unavailable or times out.
        # Instead of propagating the 503 to the client (which would lose the
        # answer), fall back: record transcription + score=0 + manual-review flag.
        # The candidate still sees their answer saved and gets a clear message.
        if scoring_exc.status_code != status.HTTP_503_SERVICE_UNAVAILABLE:
            raise  # don't swallow 4xx errors

        # Attempt transcription-only (Whisper runs locally, separate from Ollama)
        transcription = ""
        try:
            from app.services.ai_provider import _audio_suffix, _get_or_create_whisper_model  # noqa: PLC0415
            import asyncio as _asyncio, tempfile as _tempfile  # noqa: PLC0415
            from pathlib import Path as _Path  # noqa: PLC0415

            async def _transcribe_only() -> str:
                suffix = _audio_suffix(mime_type)
                model = await _asyncio.to_thread(_get_or_create_whisper_model)
                with _tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                    tmp.write(audio_bytes)
                    tmp_path = _Path(tmp.name)
                try:
                    segments, _ = await _asyncio.to_thread(
                        model.transcribe,
                        str(tmp_path),
                        beam_size=3,
                        vad_filter=True,
                        language="en",
                        word_timestamps=False,
                    )
                    return " ".join(seg.text.strip() for seg in segments if seg.text.strip()).strip()
                finally:
                    tmp_path.unlink(missing_ok=True)

            transcription = await _transcribe_only()
        except Exception as transcribe_exc:
            logger.warning("[score_voice_answer] fallback transcription also failed: %s", transcribe_exc)

        from app.services.scoring_engine import RUBRIC_VERSION, scoring_mode_for_question  # noqa: PLC0415

        mode = scoring_mode_for_question(question)
        if mode not in {"hr_voice", "behavioral_voice"}:
            mode = "hr_voice"
        logger.warning(
            "[score_voice_answer] Ollama scoring unavailable (503). "
            "Recording answer with score=0 + manual_review flag. mode=%s",
            mode,
        )
        return {
            "transcription": transcription,
            "overall_score": 0,
            "criteria_scores": {},
            "confidence": 0.0,
            "strengths": [],
            "improvements": ["AI scoring was temporarily unavailable. Your answer has been saved for manual review."],
            "review_flags": ["ai_scoring_unavailable", "manual_review_recommended"],
            "evidence": [],
            "score_rationale": "AI scoring service was unavailable at submission time.",
            "feedback": (
                "Your answer was received and saved. AI scoring was temporarily unavailable, "
                "so it has been flagged for manual review. Your transcript has been preserved."
            ),
            "model_answer": question.get("model_answer", ""),
            "rubric_version": RUBRIC_VERSION,
            "scoring_mode": f"{mode}_fallback",
            "scoring_metadata": {
                "rubric_version": RUBRIC_VERSION,
                "scoring_mode": f"{mode}_fallback",
                "review_flags": ["ai_scoring_unavailable", "manual_review_recommended"],
                "provider": "ollama_unavailable",
            },
        }


async def score_text_answer(question: dict, text_answer: str) -> dict:
    """Score a typed technical answer through the calibrated scoring engine."""
    return await score_interview_text(question, text_answer)


async def score_text_answers_batch(questions: list[dict], answers_by_id: dict[str, str]) -> list[dict]:
    """Score a full technical text section in one local AI call."""
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
                    "provider": "ollama",
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


async def submit_coding_answer_async(
    session_id: str,
    question_id: str,
    image_base64: str,
    image_mime_type: str | None,
    image_width: int | None,
    image_height: int | None,
    image_size_bytes: int | None,
    db: AsyncIOMotorDatabase,
) -> dict:
    """Accept a coding answer immediately, persist a 'pending' placeholder, and
    return right away.  The caller is responsible for kicking off a BackgroundTask
    to run `_score_coding_answer_background`."""
    from bson import ObjectId
    from bson.errors import InvalidId

    try:
        object_id = ObjectId(session_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interview session not found.")

    session = await db["sessions"].find_one({"_id": object_id})
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interview session not found.")
    if session["status"] != "in_progress":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session already completed.")

    phase_questions = session.get("questions_by_phase", {}).get("coding_logic", [])
    question = next((q for q in phase_questions if q["id"] == question_id), None)
    if question is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found in this session.")
    if question.get("answer_type") != "image":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This question requires an image answer.")

    already_answered = any(a["question_id"] == question_id for a in session.get("answers", []))
    if already_answered:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Answer already submitted for this question.")

    # Persist a placeholder — scored=0 / status=pending so complete_session can proceed.
    review_flags: list[str] = []
    if image_width and image_height and max(image_width, image_height) < 700:
        review_flags.append("low_resolution_image")
    if image_size_bytes and image_size_bytes > 8 * 1024 * 1024:
        review_flags.append("large_image_upload")

    placeholder = {
        "question_id": question_id,
        "question_text": question["question_text"],
        "phase": "coding_logic",
        "answer_type": "image",
        "transcription": None,
        "user_text_answer": None,
        "answer_duration_seconds": None,
        "image_width": image_width,
        "image_height": image_height,
        "image_size_bytes": image_size_bytes,
        "score": 0,
        "criteria_scores": {},
        "feedback": "Scoring in progress — results will appear within 3–5 minutes.",
        "model_answer": question.get("model_answer", ""),
        "confidence": None,
        "strengths": [],
        "improvements": [],
        "review_flags": review_flags,
        "evidence": [],
        "score_rationale": None,
        "rubric_version": None,
        "scoring_mode": "async_coding",
        "scoring_metadata": {"review_flags": review_flags},
        "ai_score": None,
        "ai_criteria_scores": None,
        "ai_feedback": None,
        "ai_confidence": None,
        "ai_review_flags": review_flags,
        "ai_scoring_metadata": None,
        "manual_review_status": "pending",
        "reviewer_notes": None,
        "reviewed_by": None,
        "reviewed_at": None,
        # Async status tracking
        "coding_score_status": "pending",
        # Store base64 for background processing (stripped after scoring)
        "_coding_image_base64": image_base64,
        "_coding_image_mime_type": image_mime_type or "image/jpeg",
    }

    await db["sessions"].update_one({"_id": object_id}, {"$push": {"answers": placeholder}})
    logger.info("Coding answer placeholder stored. session_id=%s question_id=%s", session_id, question_id)

    return {
        "question_id": question_id,
        "status": "pending",
        "message": "Your coding answer has been received. Scoring will complete within 3–5 minutes.",
        "estimated_seconds": 180,
    }


_CODING_RETRY_DELAYS = (0, 8, 30)   # seconds before each attempt (0 = immediate)
_CODING_SCORE_TIMEOUT = 240         # per-attempt timeout — coding model is larger


async def _score_coding_answer_background(
    session_id: str,
    question_id: str,
    db: AsyncIOMotorDatabase,
) -> None:
    """Background task: retrieve stored image, run OCR + qwen2.5-coder scoring.

    Retry strategy (mirrors voice retry):
      Attempt 1 — immediate                     (qwen2.5-coder primary)
      Attempt 2 — 8 s delay                     (falls back to default model inside
      Attempt 3 — 30 s delay                     score_interview_image if primary fails)
    All retry decisions live in score_interview_image / _call_multimodal_json_with_retry
    so this loop only handles transient infrastructure errors at the service level.
    """
    from bson import ObjectId
    from bson.errors import InvalidId
    from app.services.notification_service import send_coding_result_notification

    logger.info("Background coding score started. session_id=%s question_id=%s", session_id, question_id)

    try:
        object_id = ObjectId(session_id)
    except (InvalidId, TypeError):
        logger.error("Background coding score: invalid session_id=%s", session_id)
        return

    # Mark as processing
    await db["sessions"].update_one(
        {"_id": object_id, "answers.question_id": question_id},
        {"$set": {"answers.$.coding_score_status": "processing"}},
    )

    # ── Load the answer + question once (image is stored as base64) ───────────
    session = await db["sessions"].find_one({"_id": object_id})
    if session is None:
        return

    answer = next((a for a in session.get("answers", []) if a["question_id"] == question_id), None)
    if answer is None:
        return

    image_base64 = answer.get("_coding_image_base64")
    image_mime_type = answer.get("_coding_image_mime_type", "image/jpeg")

    if not image_base64:
        logger.error("Background coding: no image data stored. session_id=%s", session_id)
        await db["sessions"].update_one(
            {"_id": object_id, "answers.question_id": question_id},
            {"$set": {
                "answers.$.coding_score_status": "failed",
                "answers.$.feedback": "No image data was stored. Please re-submit your solution.",
                "answers.$.manual_review_status": "pending",
            }},
        )
        return

    phase_questions = session.get("questions_by_phase", {}).get("coding_logic", [])
    question = next((q for q in phase_questions if q["id"] == question_id), None)
    if question is None:
        logger.error("Background coding: question not found. session_id=%s question_id=%s", session_id, question_id)
        return

    # ── Retry loop with exponential backoff ───────────────────────────────────
    last_exc: Exception | None = None
    scored: dict | None = None

    for attempt, delay in enumerate(_CODING_RETRY_DELAYS, start=1):
        if delay > 0:
            logger.info(
                "Background coding: waiting %ds before attempt %d/%d. session_id=%s",
                delay, attempt, len(_CODING_RETRY_DELAYS), session_id,
            )
            await asyncio.sleep(delay)
        try:
            scored = await asyncio.wait_for(
                score_image_answer(question, image_base64, image_mime_type),
                timeout=_CODING_SCORE_TIMEOUT,
            )
            logger.info(
                "Background coding: attempt %d succeeded. session_id=%s score=%s",
                attempt, session_id, scored.get("overall_score"),
            )
            last_exc = None
            break
        except asyncio.TimeoutError as exc:
            last_exc = exc
            logger.warning(
                "Background coding: attempt %d timed out after %ds. session_id=%s",
                attempt, _CODING_SCORE_TIMEOUT, session_id,
            )
        except Exception as exc:
            last_exc = exc
            logger.warning(
                "Background coding: attempt %d failed (%s). session_id=%s",
                attempt, exc, session_id,
            )

    # ── All attempts exhausted — persist failure ──────────────────────────────
    if scored is None:
        logger.error(
            "Background coding score failed after %d attempts. session_id=%s question_id=%s error=%s",
            len(_CODING_RETRY_DELAYS), session_id, question_id, last_exc,
        )
        await db["sessions"].update_one(
            {"_id": object_id, "answers.question_id": question_id},
            {"$set": {
                "answers.$.coding_score_status": "failed",
                "answers.$.feedback": (
                    "Automatic scoring is temporarily unavailable. "
                    "Your submission has been saved and our team will review it manually."
                ),
                "answers.$.manual_review_status": "pending",
            }},
        )
        return

    # ── Persist successful result ─────────────────────────────────────────────
    try:
        review_flags = sorted(set(list(scored.get("review_flags", [])) + answer.get("review_flags", [])))
        scoring_metadata = dict(scored.get("scoring_metadata") or {})
        scoring_metadata["review_flags"] = review_flags
        final_score = max(0, min(int(scored.get("overall_score", 0)), 100))

        update_fields: dict[str, Any] = {
            "answers.$.score": final_score,
            "answers.$.criteria_scores": scored.get("criteria_scores", {}),
            "answers.$.feedback": scored.get("feedback", ""),
            "answers.$.transcription": scored.get("transcription"),
            "answers.$.model_answer": scored.get("model_answer") or question.get("model_answer", ""),
            "answers.$.confidence": scored.get("confidence"),
            "answers.$.strengths": scored.get("strengths", []),
            "answers.$.improvements": scored.get("improvements", []),
            "answers.$.review_flags": review_flags,
            "answers.$.evidence": scored.get("evidence", []),
            "answers.$.score_rationale": scored.get("score_rationale"),
            "answers.$.rubric_version": scored.get("rubric_version"),
            "answers.$.scoring_mode": scored.get("scoring_mode"),
            "answers.$.scoring_metadata": scoring_metadata,
            "answers.$.ai_score": final_score,
            "answers.$.ai_criteria_scores": scored.get("criteria_scores", {}),
            "answers.$.ai_feedback": scored.get("feedback", ""),
            "answers.$.ai_confidence": scored.get("confidence"),
            "answers.$.ai_review_flags": review_flags,
            "answers.$.ai_scoring_metadata": scoring_metadata,
            "answers.$.manual_review_status": "pending" if "manual_review_recommended" in review_flags else "not_required",
            "answers.$.coding_score_status": "complete",
            # Clean up stored image bytes (no longer needed after scoring)
            "answers.$._coding_image_base64": None,
        }
        # Persist code_analysis (algorithm category, Big-O, optimality)
        if scored.get("code_analysis"):
            update_fields["answers.$.code_analysis"] = scored["code_analysis"]

        await db["sessions"].update_one(
            {"_id": object_id, "answers.question_id": question_id},
            {"$set": update_fields},
        )

        logger.info(
            "Background coding score complete. session_id=%s question_id=%s score=%d model=%s",
            session_id, question_id, final_score,
            (scoring_metadata.get("provider") or "unknown"),
        )

        # Send push notification to user (best-effort — include session_id for deep-link)
        try:
            await send_coding_result_notification(session["user_id"], final_score, session_id, db)
        except Exception as notify_exc:
            logger.warning("Coding result notification failed: %s", notify_exc)

    except Exception as persist_exc:
        logger.error(
            "Background coding: failed to persist result. session_id=%s error=%s",
            session_id, persist_exc,
        )
        await db["sessions"].update_one(
            {"_id": object_id, "answers.question_id": question_id},
            {"$set": {
                "answers.$.coding_score_status": "failed",
                "answers.$.feedback": "Automatic scoring failed. Our team will review your submission manually.",
                "answers.$.manual_review_status": "pending",
            }},
        )


async def get_coding_score_status(
    session_id: str,
    user_id: str,
    db: AsyncIOMotorDatabase,
) -> list[dict]:
    """Return async scoring status for every coding_logic answer in the session."""
    from bson import ObjectId
    from bson.errors import InvalidId

    try:
        object_id = ObjectId(session_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")

    session = await db["sessions"].find_one({"_id": object_id})
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")
    if session["user_id"] != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    results = []
    for answer in session.get("answers", []):
        if answer.get("phase") != "coding_logic":
            continue
        status_val = answer.get("coding_score_status", "complete")
        results.append({
            "question_id": answer["question_id"],
            "status": status_val,
            "score": answer.get("score") if status_val == "complete" else None,
            "feedback": answer.get("feedback") if status_val == "complete" else None,
            "transcription": answer.get("transcription"),
            "criteria_scores": answer.get("criteria_scores", {}) if status_val == "complete" else {},
            "estimated_seconds": 0 if status_val == "complete" else 180,
        })
    return results


async def submit_voice_answer_async(
    session_id: str,
    question_id: str,
    phase: str,
    audio_base64: str,
    audio_format: str | None,
    duration_seconds: int | None,
    db: AsyncIOMotorDatabase,
) -> dict:
    """Accept a voice answer immediately, persist a 'pending' placeholder, and
    return right away (202 Accepted).  The caller kicks off a BackgroundTask to
    run `_score_voice_answer_background` — identical pattern to coding async."""
    from bson import ObjectId
    from bson.errors import InvalidId

    try:
        object_id = ObjectId(session_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interview session not found.")

    session = await db["sessions"].find_one({"_id": object_id})
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interview session not found.")
    if session["status"] != "in_progress":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session already completed.")

    phase_questions = session.get("questions_by_phase", {}).get(phase, [])
    question = next((q for q in phase_questions if q["id"] == question_id), None)
    if question is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found in this session.")
    if question.get("answer_type") != "voice":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This question requires a voice answer.")

    already_answered = any(a["question_id"] == question_id for a in session.get("answers", []))
    if already_answered:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Answer already submitted for this question.")

    placeholder = {
        "question_id": question_id,
        "question_text": question["question_text"],
        "phase": phase,
        "answer_type": "voice",
        "transcription": None,
        "user_text_answer": None,
        "answer_duration_seconds": duration_seconds,
        "image_width": None,
        "image_height": None,
        "image_size_bytes": None,
        "score": 0,
        "criteria_scores": {},
        "feedback": "Voice answer received — transcribing and scoring in the background.",
        "model_answer": question.get("model_answer", ""),
        "confidence": None,
        "strengths": [],
        "improvements": [],
        "review_flags": [],
        "evidence": [],
        "score_rationale": None,
        "rubric_version": None,
        "scoring_mode": "async_voice",
        "scoring_metadata": {},
        "ai_score": None,
        "ai_criteria_scores": None,
        "ai_feedback": None,
        "ai_confidence": None,
        "ai_review_flags": [],
        "ai_scoring_metadata": None,
        "manual_review_status": "pending",
        "reviewer_notes": None,
        "reviewed_by": None,
        "reviewed_at": None,
        # Async voice status tracking
        "voice_score_status": "pending",
        # Store raw audio for background processing (cleared after scoring)
        "_voice_audio_base64": audio_base64,
        "_voice_audio_format": audio_format or "",
    }

    await db["sessions"].update_one({"_id": object_id}, {"$push": {"answers": placeholder}})
    logger.info("Voice answer placeholder stored. session_id=%s question_id=%s phase=%s", session_id, question_id, phase)

    return {
        "question_id": question_id,
        "status": "pending",
        "message": "Your voice answer has been received. We're transcribing and scoring it in the background — you'll get a notification when it's ready.",
        "estimated_seconds": 90,
    }


async def _score_voice_answer_background(
    session_id: str,
    question_id: str,
    db: AsyncIOMotorDatabase,
) -> None:
    """Background task: retrieve stored audio, run Whisper transcription +
    Ollama scoring, patch the answer doc, and push a notification.

    Retry strategy (exponential backoff):
      Attempt 1 — immediate
      Attempt 2 — wait 5 s  (transient Ollama glitch)
      Attempt 3 — wait 20 s (longer model warm-up / OOM recovery)
    After 3 failures the answer is marked "failed" and flagged for manual review.
    Each attempt has a 180-second asyncio timeout guard to prevent zombie jobs.
    """
    from bson import ObjectId
    from bson.errors import InvalidId
    from app.services.notification_service import send_voice_result_notification

    logger.info("Background voice score started. session_id=%s question_id=%s", session_id, question_id)

    try:
        object_id = ObjectId(session_id)
    except (InvalidId, TypeError):
        logger.error("Background voice score: invalid session_id=%s", session_id)
        return

    # Mark as processing immediately so the status endpoint reflects reality
    await db["sessions"].update_one(
        {"_id": object_id, "answers.question_id": question_id},
        {"$set": {"answers.$.voice_score_status": "processing"}},
    )

    # -----------------------------------------------------------------------
    # Load session, answer, and audio ONCE before the retry loop.
    #
    # Previously the load was inside every retry iteration, which caused a
    # fatal race condition:
    #   1. User presses "Finish Interview" → complete_session() runs
    #   2. complete_session() clears _voice_audio_base64 via $[] operator
    #   3. Retry attempt #2 re-loads from DB → audio_base64 = None → crash
    #
    # By loading the audio into memory here and immediately clearing the DB
    # copy, we achieve two goals:
    #   • Audio is safe in-memory for every retry attempt.
    #   • The MongoDB document shrinks by ~4 MB per voice answer, so
    #     complete_session()'s $set (which embeds phase_results) cannot push
    #     the document past MongoDB's 16 MB BSON size limit.
    # -----------------------------------------------------------------------
    session = await db["sessions"].find_one({"_id": object_id})
    if session is None:
        return

    answer = next(
        (a for a in session.get("answers", []) if a["question_id"] == question_id),
        None,
    )
    if answer is None:
        return

    audio_base64: str | None = answer.get("_voice_audio_base64")
    audio_format: str | None = answer.get("_voice_audio_format") or None
    phase: str = answer.get("phase", "hr")

    if not audio_base64:
        logger.error(
            "Background voice score: no audio data found — cannot score. "
            "session_id=%s question_id=%s",
            session_id, question_id,
        )
        await db["sessions"].update_one(
            {"_id": object_id, "answers.question_id": question_id},
            {"$set": {
                "answers.$.voice_score_status": "failed",
                "answers.$.feedback": "Automatic scoring failed — no audio data was stored.",
                "answers.$.manual_review_status": "pending",
            }},
        )
        return

    # Retrieve the full question (with model_answer) from questions_by_phase
    phase_questions: list[dict] = session.get("questions_by_phase", {}).get(phase, [])
    question_doc: dict | None = next(
        (q for q in phase_questions if q["id"] == question_id), None
    )
    if question_doc is None:
        logger.error(
            "Background voice score: question %s not found in session %s — cannot score.",
            question_id, session_id,
        )
        await db["sessions"].update_one(
            {"_id": object_id, "answers.question_id": question_id},
            {"$set": {
                "answers.$.voice_score_status": "failed",
                "answers.$.feedback": "Automatic scoring failed — question data not found.",
                "answers.$.manual_review_status": "pending",
            }},
        )
        return

    # Clear the stored audio blob from MongoDB immediately.
    # This shrinks the document *before* complete_session() adds phase_results,
    # preventing the 16 MB BSON limit from being exceeded.
    # The audio remains available in-memory (audio_base64) for all retries.
    await db["sessions"].update_one(
        {"_id": object_id, "answers.question_id": question_id},
        {"$set": {
            "answers.$._voice_audio_base64": None,
            "answers.$._voice_audio_format": None,
        }},
    )
    logger.debug(
        "Background voice score: audio blob cleared from DB. session_id=%s question_id=%s",
        session_id, question_id,
    )

    _RETRY_DELAYS = (0, 5, 20)   # seconds before each attempt (0 = immediate first try)
    _SCORE_TIMEOUT = 180          # per-attempt timeout in seconds

    last_exc: Exception | None = None

    for attempt, delay in enumerate(_RETRY_DELAYS, start=1):
        if delay > 0:
            logger.info(
                "Background voice score retry %d/%d in %ds. session_id=%s question_id=%s",
                attempt, len(_RETRY_DELAYS), delay, session_id, question_id,
            )
            await asyncio.sleep(delay)

        try:
            # Guard against Ollama hang — hard timeout per scoring attempt
            scored = await asyncio.wait_for(
                score_voice_answer(
                    question_doc, audio_base64, audio_format,
                    answer.get("answer_duration_seconds"),
                ),
                timeout=_SCORE_TIMEOUT,
            )

            review_flags = sorted(set(list(scored.get("review_flags", [])) + answer.get("review_flags", [])))
            scoring_metadata = dict(scored.get("scoring_metadata") or {})
            scoring_metadata["review_flags"] = review_flags
            final_score = max(0, min(int(scored.get("overall_score", 0)), 100))

            manual_review = (
                "pending"
                if "manual_review_recommended" in review_flags
                else "not_required"
            )

            await db["sessions"].update_one(
                {"_id": object_id, "answers.question_id": question_id},
                {"$set": {
                    "answers.$.score": final_score,
                    "answers.$.transcription": scored.get("transcription"),
                    "answers.$.criteria_scores": scored.get("criteria_scores", {}),
                    "answers.$.feedback": scored.get("feedback", ""),
                    "answers.$.model_answer": scored.get("model_answer") or question_doc.get("model_answer", ""),
                    "answers.$.confidence": scored.get("confidence"),
                    "answers.$.strengths": scored.get("strengths", []),
                    "answers.$.improvements": scored.get("improvements", []),
                    "answers.$.review_flags": review_flags,
                    "answers.$.evidence": scored.get("evidence", []),
                    "answers.$.score_rationale": scored.get("score_rationale"),
                    "answers.$.rubric_version": scored.get("rubric_version"),
                    "answers.$.scoring_mode": scored.get("scoring_mode"),
                    "answers.$.scoring_metadata": scoring_metadata,
                    "answers.$.star_analysis": scored.get("star_analysis"),
                    "answers.$.ai_score": final_score,
                    "answers.$.ai_criteria_scores": scored.get("criteria_scores", {}),
                    "answers.$.ai_feedback": scored.get("feedback", ""),
                    "answers.$.ai_confidence": scored.get("confidence"),
                    "answers.$.ai_review_flags": review_flags,
                    "answers.$.ai_scoring_metadata": scoring_metadata,
                    "answers.$.manual_review_status": manual_review,
                    "answers.$.voice_score_status": "complete",
                    # Audio blob already cleared from DB before retries began
                }},
            )

            logger.info(
                "Background voice score complete (attempt %d). "
                "session_id=%s question_id=%s phase=%s score=%d",
                attempt, session_id, question_id, phase, final_score,
            )

            # Push notification (best-effort — include session_id for deep-link to results)
            try:
                await send_voice_result_notification(session["user_id"], final_score, phase, session_id, db)
            except Exception as notify_exc:
                logger.warning("Voice result notification failed: %s", notify_exc)

            return  # success — exit retry loop

        except asyncio.TimeoutError as exc:
            last_exc = exc
            logger.warning(
                "Background voice score timed out (attempt %d/%d, timeout=%ds). "
                "session_id=%s question_id=%s",
                attempt, len(_RETRY_DELAYS), _SCORE_TIMEOUT, session_id, question_id,
            )
        except Exception as exc:
            last_exc = exc
            logger.warning(
                "Background voice score failed (attempt %d/%d): %s. "
                "session_id=%s question_id=%s",
                attempt, len(_RETRY_DELAYS), exc, session_id, question_id,
            )

    # All attempts exhausted — persist failure state for manual review
    logger.error(
        "Background voice score permanently failed after %d attempts. "
        "session_id=%s question_id=%s last_error=%s",
        len(_RETRY_DELAYS), session_id, question_id, last_exc,
    )
    try:
        await db["sessions"].update_one(
            {"_id": object_id, "answers.question_id": question_id},
            {"$set": {
                "answers.$.voice_score_status": "failed",
                "answers.$.feedback": "Automatic scoring failed. Our team will review your submission manually.",
                "answers.$.manual_review_status": "pending",
            }},
        )
    except Exception as persist_exc:
        logger.error("Failed to persist voice score failure state: %s", persist_exc)


async def get_voice_score_status(
    session_id: str,
    user_id: str,
    db: AsyncIOMotorDatabase,
) -> list[dict]:
    """Return async scoring status for every voice answer in the session."""
    from bson import ObjectId
    from bson.errors import InvalidId

    try:
        object_id = ObjectId(session_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")

    session = await db["sessions"].find_one({"_id": object_id})
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")
    if session["user_id"] != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    results = []
    for answer in session.get("answers", []):
        if answer.get("answer_type") != "voice":
            continue
        if answer.get("voice_score_status") is None:
            continue  # synchronously scored answers — no status tracking needed
        status_val = answer.get("voice_score_status", "complete")
        results.append({
            "question_id": answer["question_id"],
            "phase": answer.get("phase", "hr"),
            "status": status_val,
            "score": answer.get("score") if status_val == "complete" else None,
            "feedback": answer.get("feedback") if status_val == "complete" else None,
            "transcription": answer.get("transcription"),
            "criteria_scores": answer.get("criteria_scores", {}) if status_val == "complete" else {},
            "estimated_seconds": 0 if status_val == "complete" else 90,
        })
    return results


def _phase_weights(present_phases: list[str]) -> dict[str, float]:
    """Weighted-average rule from the spec: HR 30% / Technical 50% /
    Behavioral 20% — and "if a phase is not in this session, redistribute its
    weight equally among present phases."""
    missing_weight = sum(weight for phase, weight in _BASE_PHASE_WEIGHTS.items() if phase not in present_phases)
    bonus = missing_weight / len(present_phases) if present_phases else 0.0
    return {phase: _BASE_PHASE_WEIGHTS[phase] + bonus for phase in present_phases}


# Fields that are large binary payloads kept in the answers array for scoring
# but must never appear in any API response (or in phase_results stored to DB).
_PRIVATE_ANSWER_FIELDS: frozenset[str] = frozenset({
    "_voice_audio_base64",
    "_voice_audio_format",
    "_coding_image_base64",
    "_coding_image_mime_type",
})


def _sanitize_phase_results(phase_results: list[dict]) -> list[dict]:
    """Return a copy of phase_results with private binary fields stripped from
    every answer.  Guards against old sessions stored before the stripping fix
    and against the admin review path recomputing phase_results from the raw
    answers array."""
    sanitized = []
    for phase in phase_results:
        clean_answers = [
            {k: v for k, v in answer.items() if k not in _PRIVATE_ANSWER_FIELDS}
            for answer in phase.get("answers", [])
        ]
        sanitized.append({**phase, "answers": clean_answers})
    return sanitized


def _merge_live_answers(phase_results: list[dict], live_answers: list[dict]) -> list[dict]:
    """Merge the latest live answer data from the session's answers array into
    the stored phase_results.

    Context: background scoring jobs (voice + coding) update `answers.$.xxx`
    positionally via MongoDB's `$` operator after `complete_session()` has
    already computed and stored `phase_results`. This means `phase_results` can
    hold stale data (score=0, no code_analysis) for any answer that was still
    pending when the session was completed. To avoid showing the user stale
    results we re-merge the current answers array here.

    Only non-None values from live_answers overwrite the phase_results copy so
    that fields genuinely absent from the live document are not silently cleared.
    Private binary fields are still stripped via _PRIVATE_ANSWER_FIELDS.
    """
    if not live_answers:
        return _sanitize_phase_results(phase_results)

    live_by_id = {a["question_id"]: a for a in live_answers}
    merged = []
    for phase in phase_results:
        updated_answers = []
        for stored_answer in phase.get("answers", []):
            qid = stored_answer.get("question_id")
            live = live_by_id.get(qid)
            if live is not None:
                # Build the merged dict: start from the stored answer, overlay
                # every non-None value from the live answer, then strip private fields.
                merged_answer = {
                    **stored_answer,
                    **{k: v for k, v in live.items() if v is not None and k not in _PRIVATE_ANSWER_FIELDS},
                }
                merged_answer = {k: v for k, v in merged_answer.items() if k not in _PRIVATE_ANSWER_FIELDS}
            else:
                merged_answer = {k: v for k, v in stored_answer.items() if k not in _PRIVATE_ANSWER_FIELDS}
            updated_answers.append(merged_answer)
        merged.append({**phase, "answers": updated_answers})
    return merged


def _recompute_phase_and_overall(
    merged_phases: list[dict],
    present_phases: list[str],
) -> tuple[list[dict], int]:
    """Re-derive phase scores and overall score from the already-merged answer
    data so that the client always sees accurate numbers after background
    voice/coding scoring completes.

    Phase scores stored in the session document at complete_session() time are
    stale for any phase that contained pending voice/coding answers (those used
    score=0 placeholders).  Once the background tasks finish and the client
    re-fetches, _merge_live_answers() has already updated the individual answer
    scores — but the phase-level ``score`` field and the top-level
    ``overall_score`` would still reflect the stale computation.

    We skip re-computation for any phase that still has pending answers so the
    displayed phase score doesn't flicker from 0 → partial → final.
    """
    phase_scores: dict[str, int] = {}
    updated: list[dict] = []

    for phase_data in merged_phases:
        answers = phase_data.get("answers", [])
        # A phase is "settled" when no answer is still being scored.
        has_pending = any(
            a.get("voice_score_status") in ("pending", "processing")
            or a.get("coding_score_status") in ("pending", "processing")
            for a in answers
        )
        if not has_pending and answers:
            computed_score = round(
                sum((a.get("score") or 0) for a in answers) / len(answers)
            )
        else:
            # Keep the stored phase score while background scoring is in progress
            computed_score = phase_data.get("score", 0)
        phase_scores[phase_data["phase"]] = computed_score
        updated.append({**phase_data, "score": computed_score})

    # Only recompute overall when all phases are fully settled
    all_settled = all(
        not any(
            a.get("voice_score_status") in ("pending", "processing")
            or a.get("coding_score_status") in ("pending", "processing")
            for a in ph.get("answers", [])
        )
        for ph in updated
    )
    if all_settled and phase_scores:
        weights = _phase_weights(present_phases or list(phase_scores.keys()))
        overall = round(
            sum(phase_scores.get(p, 0) * weights.get(p, 0) for p in weights)
        )
        overall = max(0, min(overall, 100))
    else:
        # Return sentinel so callers know the score is still provisional
        overall = -1  # signals "pending" to to_session_result

    return updated, overall


def to_session_result(session: dict) -> dict:
    """Project a completed session document down to the SessionResult shape
    (also reused by GET /session/{id}, GET /history, and all admin routes).

    Merges live answer data from the session's answers array back into the
    stored phase_results so that background-scored answers (voice/coding) always
    show their final score, code_analysis, star_analysis, etc. rather than the
    placeholder values stored at complete_session() time.

    Also recomputes phase scores and overall_score from the merged answers so
    the displayed totals are accurate once background scoring completes — the
    values stored at session-completion time used score=0 for pending answers."""
    live_answers: list[dict] = session.get("answers", [])
    present_phases: list[str] = session.get("phases", [])
    merged_phases = _merge_live_answers(session.get("phase_results", []), live_answers)
    updated_phases, recomputed_overall = _recompute_phase_and_overall(merged_phases, present_phases)
    # Use stored overall_score while any phase is still pending (recomputed_overall == -1)
    overall_score = session["overall_score"] if recomputed_overall == -1 else recomputed_overall
    return {
        "id": session["id"],
        "user_id": session["user_id"],
        "track_id": session["track_id"],
        "mode": session["mode"],
        "overall_score": overall_score,
        "phase_results": updated_phases,
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
    answered_ids = set(answers_by_id.keys())
    # Coding_logic and voice answers with status "pending"/"processing" count as
    # answered (async scoring is running in background); only truly missing answers block.
    coding_pending_ids = {
        answer["question_id"]
        for answer in answers
        if answer.get("phase") == "coding_logic"
        and answer.get("coding_score_status") in ("pending", "processing")
    }
    voice_pending_ids = {
        answer["question_id"]
        for answer in answers
        if answer.get("answer_type") == "voice"
        and answer.get("voice_score_status") in ("pending", "processing")
    }
    missing_ids = all_question_ids - answered_ids - coding_pending_ids - voice_pending_ids
    if missing_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please answer every question before completing the session.",
        )

    phase_results: list[dict] = []
    phase_scores: dict[str, int] = {}

    def _clean_answer(ans: dict) -> dict:
        """Return a shallow copy of ans with all private storage fields removed."""
        return {k: v for k, v in ans.items() if k not in _PRIVATE_ANSWER_FIELDS}

    for phase in session["phases"]:
        phase_questions = questions_by_phase[phase]
        # Strip private binary blobs before embedding answers in phase_results.
        phase_answers = [_clean_answer(answers_by_id[question["id"]]) for question in phase_questions]
        # Pending voice/coding answers have score=0 or score=None; treat None as 0.
        phase_score = round(sum((answer["score"] or 0) for answer in phase_answers) / len(phase_answers))
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
    # Motor returns timezone-naive datetime objects from MongoDB even when the
    # value was stored as UTC.  Attach UTC so the subtraction is valid.
    if started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=timezone.utc)
    duration_seconds = max(0, int((completed_at - started_at).total_seconds()))

    updates = {
        "status": "completed",
        "completed_at": completed_at,
        "phase_results": phase_results,
        "overall_score": overall_score,
        "duration_seconds": duration_seconds,
    }
    # Safety net: clear any remaining binary blobs atomically with the completion
    # write.  Background voice/coding jobs clear their blobs as soon as they load
    # the data (before scoring begins), but this catches edge cases:
    #   • The background task hasn't been dispatched yet when the user finishes.
    #   • A background task errored before it could clear its blob.
    # Without this, embedding phase_results into a document that still holds
    # 4+ voice recordings (~4 MB each) would exceed MongoDB's 16 MB BSON limit
    # and produce an unhandled BSONDocumentTooLarge error → HTTP 500.
    blob_clear = {
        "answers.$[]._voice_audio_base64": None,
        "answers.$[]._coding_image_base64": None,
    }
    await db["sessions"].update_one({"_id": object_id}, {"$set": {**updates, **blob_clear}})

    # ------------------------------------------------------------------
    # Agent Rule #6 — advance enrollment progress: current_day +1, fold this
    # session's overall score into the running average.
    #
    # We do a direct update_one here instead of calling
    # enrollment_service.update_progress() for two reasons:
    #   1. update_progress() is designed to return an enriched enrollment
    #      document (with track data, plan_exists, etc.) — complete_session()
    #      doesn't use that return value at all, so the extra round-trips
    #      (plan lookup, track lookup) are pure overhead.
    #   2. update_progress() does a second find_one inside itself and can
    #      raise HTTPException(404) if the enrollment disappears in the tiny
    #      window between our check and its check — causing a spurious 500.
    # A single update_one is atomic, fast, and safe.
    # ------------------------------------------------------------------
    enrollment = await db["enrollments"].find_one({"user_id": user_id, "track_id": session["track_id"]})
    if enrollment is not None:
        old_avg = enrollment.get("average_score", 0.0) or 0.0
        total_sessions = enrollment.get("total_sessions", 0) or 0
        new_avg = ((old_avg * total_sessions) + float(overall_score)) / (total_sessions + 1)
        await db["enrollments"].update_one(
            {"_id": enrollment["_id"]},
            {"$set": {
                "current_day": (enrollment.get("current_day", 1) or 1) + 1,
                "average_score": new_avg,
                "total_sessions": total_sessions + 1,
                "updated_at": completed_at,
            }},
        )
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

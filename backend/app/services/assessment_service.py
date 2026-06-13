# Dynamic assessment + plan generation. Routers in app/api/v1/assessment.py
# stay thin and only handle request validation, ownership checks, and
# persistence orchestration.
import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import BackgroundTasks
from fastapi import HTTPException, status

from app.api.v1.tracks import get_track_or_none
from app.core.config import get_settings
from app.core.database import get_db
from app.services.profile_service import normalize_level
from app.services.ai_provider import generate_json
from app.services.scoring_engine import RUBRIC_VERSION, score_assessment_batch

logger = logging.getLogger("vprep.assessment_service")
_settings = get_settings()

_QUESTION_COUNT = 7
_MAX_ASSESSMENT_ANSWER_CHARS = 900
_MAX_RAW_SCORE = _QUESTION_COUNT * 10  # 70 — every answer scored 0-10

# Upper bound on how long the assessment start will wait for the local model to
# generate the full personalized question set before falling back to seed
# templates + background refinement. Keeps "Start" responsive on a slow laptop.
_SYNC_GENERATION_TIMEOUT_SECONDS = 50

# Minimum number of AI-authored questions (out of 7) for the synchronous
# generation to count as "good enough" — the remaining slots are filled with
# the role-personalized seed templates. Below this we fall back entirely and
# let the background refiner retry.
_MIN_AI_QUESTIONS = 3

# Plan length is driven purely by skill level, per the Phase 3 spec — not by
# the track's nominal `total_days` (which is just a display figure on the card).
_PLAN_DAYS_BY_SKILL_LEVEL = {"beginner": 30, "intermediate": 21, "advanced": 14}

# Required tail of every local-AI prompt in this phase. generate_json() also
# appends its own JSON-only instruction; the two are complementary.
_JSON_ONLY_SUFFIX = (
    "\n\nRespond ONLY with valid JSON. No markdown, no backticks, no preamble, "
    "no explanation. Start immediately with `[` or `{`."
)

_RETRY_SUFFIX = (
    "\n\nYour previous response was not valid JSON. Output ONLY raw JSON this time."
)


async def _call_ai_json(
    prompt: str,
    *,
    temperature: float | None = None,
    max_output_tokens: int | None = None,
):
    """Call generate_json through local Ollama, retrying once on parse failure.

    If both the original call and the single retry fail to produce valid JSON,
    raise HTTP 503 so the client can show "AI service temporarily unavailable."
    """
    try:
        return await generate_json(
            prompt,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
        )
    except Exception as first_error:
        logger.warning("Local AI JSON generation failed, retrying once: %s", first_error)
        try:
            return await generate_json(
                prompt + _RETRY_SUFFIX,
                temperature=temperature,
                max_output_tokens=max_output_tokens,
            )
        except Exception as second_error:
            logger.error("Local AI JSON generation failed after retry: %s", second_error)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=getattr(
                    second_error,
                    "user_message",
                    "Local AI service temporarily unavailable. Please try again.",
                ),
            )


# ---------------------------------------------------------------------------
# Prompt builders — kept as plain (non f-string) template pieces wherever the
# text contains literal JSON braces, so nothing needs `{{`/`}}` escaping.
# ---------------------------------------------------------------------------


async def _candidate_profile_context(
    user_id: str,
    db,
    track_id: str | None = None,
    *,
    role_id: str | None = None,
    role_label: str | None = None,
) -> dict[str, Any]:
    from bson import ObjectId
    from bson.errors import InvalidId

    from app.api.v1.tracks import get_track_or_none
    from app.services.role_catalog import find_role, focus_for_role, infer_seniority_from_label

    try:
        user = await db["users"].find_one({"_id": ObjectId(user_id)})
    except (InvalidId, TypeError):
        user = None

    profile = user.get("profile") if user else {}
    profile = profile if isinstance(profile, dict) else {}
    level = (
        (user or {}).get("normalized_level")
        or profile.get("normalized_level")
        or (user or {}).get("self_reported_level")
        or profile.get("self_reported_level")
        or "beginner"
    )

    # Resolve the target role this assessment should personalize to, in order:
    #   1. an explicit role passed with the request (chosen on the tracks screen
    #      BEFORE the assessment starts),
    #   2. this track's enrollment role (set on a prior enroll),
    #   3. the global onboarding role.
    # This is what makes the assessment say "preparing for <the role you picked
    # for THIS track>" instead of one global role reused everywhere.
    track = await get_track_or_none(track_id, db) if track_id else None
    enrollment = (
        await db["enrollments"].find_one({"user_id": user_id, "track_id": track_id}) if track_id else None
    )

    target_role: str | None = None
    target_role_id: str | None = None
    role_seniority: str | None = None

    if role_id and track is not None:
        matched = find_role(track, role_id=role_id)
        if matched:
            target_role, target_role_id, role_seniority = matched["label"], matched["id"], matched["seniority"]
    if not target_role and role_label and role_label.strip():
        clean = role_label.strip()[:120]
        matched = find_role(track, label=clean) if track is not None else None
        if matched:
            target_role, target_role_id, role_seniority = matched["label"], matched["id"], matched["seniority"]
        else:
            target_role, role_seniority = clean, infer_seniority_from_label(clean)
    if not target_role and enrollment is not None:
        target_role = enrollment.get("target_role")
        target_role_id = enrollment.get("target_role_id")
        role_seniority = enrollment.get("role_seniority")
    if not target_role:
        target_role = (user or {}).get("target_role") or profile.get("target_role")
    if not role_seniority:
        role_seniority = infer_seniority_from_label(target_role)
    role_focus = focus_for_role(track_id or "", target_role_id, target_role)

    logger.info(
        "[profile] track=%s role_id_in=%s label_in=%s → resolved role=%r seniority=%s focus=%s",
        track_id, role_id, role_label, target_role, role_seniority, role_focus[:3] if role_focus else [],
    )

    return {
        "level": normalize_level(level),
        "target_role": target_role,
        "role_seniority": role_seniority,
        "role_focus": role_focus,
        "years_experience": (user or {}).get("years_experience") or profile.get("years_experience"),
        "skills": profile.get("skills") if isinstance(profile.get("skills"), list) else [],
        "projects": profile.get("projects") if isinstance(profile.get("projects"), list) else [],
        "primary_roles": profile.get("primary_roles") if isinstance(profile.get("primary_roles"), list) else [],
        "education": profile.get("education") if isinstance(profile.get("education"), list) else [],
        "summary": (user or {}).get("cv_summary") or profile.get("summary"),
    }


def _compact_text(value: Any, *, max_chars: int = 160) -> str:
    text = " ".join(str(value or "").replace("\n", " ").split())
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "."


def _compact_list_text(items: Any, *, limit: int, max_item_chars: int = 90) -> str:
    if not isinstance(items, list):
        return ""
    cleaned = [_compact_text(item, max_chars=max_item_chars) for item in items]
    return ", ".join(item for item in cleaned[:limit] if item)


def _profile_prompt_context(profile: dict[str, Any]) -> str:
    skills = _compact_list_text(profile.get("skills"), limit=10, max_item_chars=70)
    projects = "; ".join(
        _compact_text(project, max_chars=110)
        for project in (profile.get("projects", []) if isinstance(profile.get("projects"), list) else [])[:5]
    )
    roles = _compact_list_text(profile.get("primary_roles"), limit=4, max_item_chars=80)
    education = "; ".join(
        _compact_text(item, max_chars=90)
        for item in (profile.get("education", []) if isinstance(profile.get("education"), list) else [])[:3]
    )
    seniority = str(profile.get("role_seniority") or "mid").lower()
    if seniority == "junior":
        seniority_note = "Target seniority: JUNIOR/entry-level — keep questions fundamental and approachable, not advanced."
    elif seniority == "senior":
        seniority_note = "Target seniority: SENIOR — questions may probe depth, tradeoffs, and judgment."
    else:
        seniority_note = "Target seniority: mid-level — balance core understanding with practical depth."
    role_focus = _compact_list_text(profile.get("role_focus"), limit=8, max_item_chars=40)
    return (
        f"Candidate level: {profile['level']}\n"
        f"Target role: {profile.get('target_role') or 'not provided'}\n"
        f"{seniority_note}\n"
        f"Role focus areas to emphasize: {role_focus or 'use the track topic areas'}\n"
        f"Previous role signals: {roles or 'not provided'}\n"
        f"Years of experience: {profile.get('years_experience') if profile.get('years_experience') is not None else 'not provided'}\n"
        f"CV/profile summary: {profile.get('summary') or 'not provided'}\n"
        f"Relevant skills from CV/onboarding: {skills or 'not provided'}\n"
        f"Relevant projects from CV/onboarding: {projects or 'not provided'}\n"
        f"Education/certification signals: {education or 'not provided'}"
    )


def _build_questions_prompt(track_name: str, topic_areas: list[str], profile: dict[str, Any]) -> str:
    topic_list = ", ".join(topic_areas)
    # Use the resolved target role for the intro framing — this is the single
    # most important signal the 3B model needs to stay on-topic. Using the
    # track name here (e.g. "ML & AI") conflicts with an explicit role like
    # "MLOps Engineer" in the profile context below and reliably causes the
    # model to ignore the role and default to generic questions.
    target_role = profile.get("target_role") or track_name

    intro = (
        f'You are conducting a technical screening interview for a candidate '
        f'targeting the role of "{target_role}" in the {track_name} domain.\n\n'
        f"The key topic areas for this role are: {topic_list}.\n\n"
        "Personalize the assessment using this candidate profile. Do not include "
        "names, employers, schools, or any personal identifiers in the questions.\n"
        f"{_profile_prompt_context(profile)}\n\n"
    )

    body = (
        "Generate exactly 7 short interview-style questions that a real technical "
        "interviewer would ask in a screening call for this role. The questions "
        "should read exactly like a real interviewer speaking out loud — not "
        "textbook definitions, not trivia — and should prompt the candidate to "
        "demonstrate real understanding, not just recall facts.\n\n"
        "Personalization rules:\n"
        "- At least 3 questions must reference the candidate's CV-derived skills, projects, target role, or experience level in a generic professional way\n"
        "- At least 2 questions must be reusable predefined-style fundamentals from the track topic areas, so the assessment has calibration anchors across users\n"
        "- If projects are available, ask at least 1 applied question that connects a project-like scenario to one track topic without revealing personal identifiers\n"
        "- If years of experience are available, calibrate seniority: junior candidates get implementation/debugging questions; senior candidates get tradeoff/architecture/production judgment\n"
        "- Never include names, employers, schools, exact personal dates, phone numbers, or emails\n\n"
        "Question quality rules:\n"
        "- Every question must be fully open-ended: no yes/no answers, no "
        "multiple choice, no options or correct-answer fields of any kind\n"
        "- Questions must be personalized to the candidate's level: beginner "
        "questions should test fundamentals, intermediate questions should probe "
        "practical tradeoffs, and advanced questions should include production "
        "or architecture judgment\n"
        "- Questions must increase in difficulty: questions 1-2 are easy "
        "conceptual questions, questions 3-5 are medium depth-of-understanding "
        "questions, and questions 6-7 are hard applied/situational questions\n"
        "- Spread the 7 questions across at least 4 different topic areas from "
        "the list above\n"
        "- Each question must be answerable in 2-4 precise sentences by a knowledgeable "
        "candidate\n\n"
        "For every question also write a `model_answer`: a concise ideal answer "
        "(2-4 precise sentences) that will be used purely as a server-side scoring "
        "rubric — it must never be shown to the candidate before they answer.\n\n"
        "Assign section metadata exactly as follows: q1-q2 section_id "
        "`fundamentals`, q3-q5 section_id `practical_reasoning`, q6-q7 "
        "section_id `applied_judgment`.\n\n"
        "Respond with a JSON object whose `questions` value is an array of "
        "exactly 7 objects, with ids \"q1\" through \"q7\" in order, using "
        "exactly this schema:\n"
        "{\n"
        '  "questions": [\n'
        "    {\n"
        '      "id": "q1",\n'
        '      "question": "...",\n'
        '      "topic_area": "...",\n'
        '      "section_id": "fundamentals",\n'
        '      "section_title": "Fundamentals",\n'
        '      "difficulty": "easy",\n'
        '      "model_answer": "..."\n'
        "    }\n"
        "  ]\n"
        "}"
    )

    return intro + body + _JSON_ONLY_SUFFIX


def _build_remaining_questions_prompt(
    track_name: str,
    topic_areas: list[str],
    profile: dict[str, Any],
    seed_questions: list[dict],
) -> str:
    topic_list = ", ".join(topic_areas)
    seed_context = "\n".join(
        f"{question['id']}: {question['question']} | topic={question['topic_area']} | difficulty={question['difficulty']}"
        for question in seed_questions
    )
    return (
        "You are improving an in-progress technical screening assessment. "
        "Question q1 is already shown to the candidate and must not be changed. "
        "Generate only q2 through q7.\n\n"
        f"Track: {track_name}\n"
        f"Track topics: {topic_list}\n"
        f"Candidate profile:\n{_profile_prompt_context(profile)}\n\n"
        "Current seed questions for continuity:\n"
        f"{seed_context}\n\n"
        "Quality requirements:\n"
        "- Questions must sound like a real interviewer, not a textbook or quiz app.\n"
        "- Every question must be answerable in 2-4 precise sentences.\n"
        "- q2 must be easy and calibration-friendly.\n"
        "- q3-q5 must be medium practical reasoning questions tied to track topics and CV/project signals when available.\n"
        "- q6-q7 must be hard applied judgment questions calibrated to the candidate level and experience.\n"
        "- At least three questions must use the candidate's skills, projects, target role, or years of experience in a generic professional way.\n"
        "- Prefer realistic interview scenarios over broad prompts like 'explain the importance of X'.\n"
        "- Do not ask the candidate to write long essays, lists of many items, or code in this text assessment.\n"
        "- Never include personal identifiers, names, employers, schools, exact dates, emails, or phone numbers.\n"
        "- Include concise server-side model_answer rubrics.\n\n"
        # Wrap in an object — Ollama's format=json collapses bare top-level
        # arrays into a single object, so always request {"key": [...]} and
        # let _coerce_question_list() extract the array on the way back.
        "Return a JSON object with a `questions` array of exactly 6 objects, "
        "ids q2 through q7, using this schema:\n"
        "{\n"
        '  "questions": [\n'
        "    {\n"
        '      "id": "q2",\n'
        '      "question": "...",\n'
        '      "topic_area": "...",\n'
        '      "section_id": "fundamentals",\n'
        '      "section_title": "Fundamentals",\n'
        '      "difficulty": "easy",\n'
        '      "model_answer": "..."\n'
        "    }\n"
        "  ]\n"
        "}"
        + _JSON_ONLY_SUFFIX
    )


def _build_single_remaining_question_prompt(
    track_name: str,
    topic_areas: list[str],
    profile: dict[str, Any],
    seed_questions: list[dict],
    question_number: int,
) -> str:
    seed = seed_questions[question_number - 1]
    section = _section_for_question(question_number)
    difficulty = "easy" if question_number <= 2 else "medium" if question_number <= 5 else "hard"
    topic_list = ", ".join(topic_areas)
    return (
        "You are improving one question in a progressive technical screening assessment. "
        f"Generate exactly one replacement for q{question_number}.\n\n"
        f"Track: {track_name}\n"
        f"Track topics: {topic_list}\n"
        f"Candidate profile:\n{_profile_prompt_context(profile)}\n\n"
        "Current seed question to improve:\n"
        f"q{question_number}: {seed['question']}\n"
        f"Seed topic: {seed.get('topic_area', 'General')}\n"
        f"Seed rubric: {seed.get('model_answer', '')}\n\n"
        "Rules:\n"
        "- The question must sound like a real interviewer speaking in a screening call.\n"
        "- It must be personalized to the candidate's level, track, CV skills/projects, or target role when useful.\n"
        "- It must be answerable in 2-4 precise sentences.\n"
        "- Do not ask for code, essays, lists of many items, or personal identifiers.\n"
        "- Never include names, employers, schools, exact dates, emails, or phone numbers.\n"
        "- Include a concise server-side model_answer rubric.\n\n"
        "Return one JSON object using exactly this schema:\n"
        "{\n"
        f'  "id": "q{question_number}",\n'
        '  "question": "...",\n'
        f'  "topic_area": "{seed.get("topic_area", "General")}",\n'
        f'  "section_id": "{section["section_id"]}",\n'
        f'  "section_title": "{section["section_title"]}",\n'
        f'  "difficulty": "{difficulty}",\n'
        '  "model_answer": "..."\n'
        "}"
        + _JSON_ONLY_SUFFIX
    )


def _build_scoring_prompt(qa_items: list[dict]) -> str:
    blocks = []
    for item in qa_items:
        blocks.append(
            f"Question {item['id']} — topic: {item['topic_area']}, "
            f"difficulty: {item['difficulty']}\n"
            f"\"{item['question']}\"\n"
            f"Ideal answer (scoring rubric only — not a literal match requirement): "
            f"{item['model_answer']}\n"
            f"Candidate's actual answer: {item['user_answer']}\n"
        )
    qa_text = "\n".join(blocks)

    intro = (
        "You are scoring a candidate's screening-interview answers for a "
        "technical role. Below are 7 questions, each with an ideal \"model "
        "answer\" that exists purely as your scoring rubric, followed "
        "immediately by the candidate's actual typed answer.\n\n"
        f"{qa_text}\n"
    )

    body = (
        "\nScore each answer independently on a scale of 0 to 10 based on:\n"
        "- Accuracy and technical correctness\n"
        "- Depth and clarity of explanation\n"
        "- Use of relevant terminology\n\n"
        "Be fair but honest — a vague or buzzword-heavy answer without real "
        "substance should score 3-4 out of 10, not 7-8. Reserve 9-10 for "
        "genuinely impressive, nuanced answers that go beyond the rubric.\n\n"
        "Candidate answers are expected to be concise. Do not penalize a short "
        "2-4 sentence answer if it is accurate, complete, and uses correct terms. "
        "Keep feedback and rationales brief and directly actionable.\n\n"
        "Respond with a JSON object using exactly this schema — one evaluation "
        "per question, in the same order, each repeating that question's "
        "model_answer unchanged so it can be shown to the candidate afterward:\n"
        "{\n"
        '  "evaluations": [\n'
        "    {\n"
        '      "question_id": "q1",\n'
        '      "score": 8,\n'
        '      "feedback": "Good explanation of overfitting. Could mention '
        'regularization techniques.",\n'
        '      "model_answer": "..."\n'
        "    }\n"
        "  ]\n"
        "}"
    )

    return intro + body + _JSON_ONLY_SUFFIX


def _section_for_question(index: int) -> dict[str, str]:
    if index <= 2:
        return {"section_id": "fundamentals", "section_title": "Fundamentals"}
    if index <= 5:
        return {"section_id": "practical_reasoning", "section_title": "Practical Reasoning"}
    return {"section_id": "applied_judgment", "section_title": "Applied Judgment"}


def _normalize_generated_questions(raw_questions: Any) -> list[dict]:
    if not isinstance(raw_questions, list):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI service returned an unexpected question format.",
        )

    normalized: list[dict] = []
    for index, raw in enumerate(raw_questions[:_QUESTION_COUNT], start=1):
        if not isinstance(raw, dict):
            continue
        section = _section_for_question(index)
        difficulty = str(raw.get("difficulty") or "").strip().lower()
        normalized.append(
            {
                "id": f"q{index}",
                "question": str(raw.get("question") or raw.get("question_text") or "").strip(),
                "topic_area": str(raw.get("topic_area") or raw.get("topic") or "General").strip(),
                "section_id": str(raw.get("section_id") or section["section_id"]).strip(),
                "section_title": str(raw.get("section_title") or section["section_title"]).strip(),
                "difficulty": difficulty if difficulty in {"easy", "medium", "hard"} else (
                    "easy" if index <= 2 else "medium" if index <= 5 else "hard"
                ),
                "model_answer": str(raw.get("model_answer") or "").strip(),
            }
        )

    usable = [question for question in normalized if question["question"] and question["model_answer"]]
    if len(usable) < _QUESTION_COUNT:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI service returned too few usable questions. Please try again.",
        )
    return usable[:_QUESTION_COUNT]


def _normalize_question_candidate(raw: Any, seed: dict, index: int) -> dict | None:
    if isinstance(raw, str):
        raw = {"question": raw}
    if not isinstance(raw, dict):
        return None

    section = _section_for_question(index)
    difficulty = str(raw.get("difficulty") or seed.get("difficulty") or "").strip().lower()
    question = str(raw.get("question") or raw.get("question_text") or "").strip()
    model_answer = str(raw.get("model_answer") or seed.get("model_answer") or "").strip()
    if not question or not model_answer:
        return None

    return {
        "id": f"q{index}",
        "question": question,
        "topic_area": str(raw.get("topic_area") or raw.get("topic") or seed.get("topic_area") or "General").strip(),
        "section_id": str(raw.get("section_id") or seed.get("section_id") or section["section_id"]).strip(),
        "section_title": str(raw.get("section_title") or seed.get("section_title") or section["section_title"]).strip(),
        "difficulty": difficulty if difficulty in {"easy", "medium", "hard"} else (
            "easy" if index <= 2 else "medium" if index <= 5 else "hard"
        ),
        "model_answer": model_answer,
    }


def _merge_ai_over_seeds(raw: Any, seed_questions: list[dict]) -> tuple[list[dict], int]:
    """Overlay whatever usable AI questions the local model returned onto the
    7 role-personalized seed templates, slot by slot.

    The 3B model rarely returns a complete, perfectly-formed set of 7 in one
    call, so an all-or-nothing parse usually throws everything away and the
    candidate sees only templates. Merging keeps every AI question the model
    *did* produce (matched by id `q1..q7`, else by order) and fills the rest
    with the role-aware seeds — guaranteeing 7 questions that are mostly AI and
    always personalized. Returns the merged list and the count of AI slots.
    """
    candidates = _coerce_question_list(raw) or []
    by_id: dict[str, dict] = {}
    ordered: list[dict] = []
    for candidate in candidates:
        if isinstance(candidate, dict):
            ordered.append(candidate)
            cid = str(candidate.get("id", "")).strip().lower()
            if cid:
                by_id[cid] = candidate

    merged: list[dict] = []
    ai_count = 0
    for index in range(1, _QUESTION_COUNT + 1):
        seed = seed_questions[index - 1]
        raw_candidate = by_id.get(f"q{index}")
        if raw_candidate is None and index - 1 < len(ordered):
            raw_candidate = ordered[index - 1]
        normalized = _normalize_question_candidate(raw_candidate, seed, index) if raw_candidate else None
        if normalized:
            merged.append(normalized)
            ai_count += 1
        else:
            merged.append(seed)
    return merged, ai_count


def _coerce_question_list(raw: Any) -> list[dict] | None:
    """Accept common local-model JSON variants for question generation.

    llama3.2:3b often follows the content requirements but wraps arrays inside
    an object or uses q2/q3 keys. Keeping this coercion narrow lets us recover
    good generations without accepting arbitrary malformed content.
    """
    if isinstance(raw, list):
        return raw

    if not isinstance(raw, dict):
        return None

    for key in ("questions", "items", "results", "assessment_questions"):
        value = raw.get(key)
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            nested = _coerce_question_list(value)
            if nested:
                return nested

    keyed_questions = []
    for index in range(2, _QUESTION_COUNT + 1):
        value = raw.get(f"q{index}") or raw.get(str(index))
        if isinstance(value, dict):
            keyed_questions.append(value)
        elif isinstance(value, str) and value.strip():
            keyed_questions.append({"id": f"q{index}", "question": value.strip()})
    if keyed_questions:
        return keyed_questions

    dict_values = [
        value
        for value in raw.values()
        if isinstance(value, dict) and (value.get("question") or value.get("question_text"))
    ]
    return dict_values or None


def _prepare_remaining_question_candidates(
    raw_questions: list[Any],
    seed_questions: list[dict],
) -> list[dict]:
    prepared: list[dict] = []
    for offset, item in enumerate(raw_questions[: _QUESTION_COUNT - 1], start=2):
        if isinstance(item, str):
            raw = {"question": item}
        elif isinstance(item, dict):
            raw = dict(item)
        else:
            continue

        seed = seed_questions[offset - 1] if len(seed_questions) >= offset else {}
        raw.setdefault("id", f"q{offset}")
        raw.setdefault("topic_area", seed.get("topic_area", "General"))
        raw.setdefault("section_id", seed.get("section_id"))
        raw.setdefault("section_title", seed.get("section_title"))
        raw.setdefault("difficulty", seed.get("difficulty"))
        raw.setdefault("model_answer", seed.get("model_answer", ""))
        prepared.append(raw)
    return prepared


def _compact_profile_signal(profile: dict[str, Any], key: str, fallback: str) -> str:
    value = profile.get(key)
    if isinstance(value, list):
        return _compact_text(value[0], max_chars=80) if value else fallback
    text = _compact_text(value, max_chars=80)
    return text or fallback


def _experience_phrase(profile: dict[str, Any]) -> str:
    years = profile.get("years_experience")
    level = profile.get("level", "beginner")
    if years is None:
        return f"{level}-level"
    try:
        number = float(years)
    except (TypeError, ValueError):
        return f"{level}-level"
    if number < 1:
        return "early-career"
    if number < 4:
        return f"{number:g}-year"
    return f"{number:g}-year senior"


async def _load_predefined_assessment_anchors(db, track_id: str, profile: dict[str, Any]) -> list[dict]:
    """Load fast reusable technical anchors from the admin question bank.

    These anchors give the assessment stable calibration questions. They are a
    supplement to the personalized deterministic questions, not a dependency:
    if the admin bank is empty or Mongo sampling fails, the assessment still
    starts immediately from local seed templates.
    """
    preferred = {"beginner": "easy", "intermediate": "medium", "advanced": "hard"}.get(
        profile.get("level", "beginner"),
        "medium",
    )
    anchors: list[dict] = []

    async def sample(extra_match: dict[str, Any] | None, remaining: int) -> None:
        if remaining <= 0:
            return
        match: dict[str, Any] = {"phase": "technical", "track_id": track_id}
        if extra_match:
            match.update(extra_match)
        if anchors:
            seen_texts = [anchor["question_text"] for anchor in anchors]
            match["question_text"] = {"$nin": seen_texts}
        pipeline = [{"$match": match}, {"$sample": {"size": remaining}}]
        async for document in db["questions"].aggregate(pipeline):
            question_text = _compact_text(document.get("question_text"), max_chars=240)
            model_answer = _compact_text(document.get("model_answer"), max_chars=260)
            if question_text and model_answer:
                anchors.append(
                    {
                        "question_text": question_text,
                        "model_answer": model_answer,
                        "difficulty": document.get("difficulty") or preferred,
                        "tags": document.get("tags") or [],
                    }
                )

    try:
        await sample({"difficulty": preferred}, 2)
        await sample(None, 2 - len(anchors))
    except Exception as exc:
        logger.warning("Could not load predefined assessment anchors: %s", exc)
        return []

    return anchors[:2]


def _fallback_questions(
    track: dict,
    profile: dict[str, Any],
    predefined_anchors: list[dict] | None = None,
) -> list[dict]:
    topics = track.get("topic_areas") or [track.get("name", "Interview fundamentals")]
    level = profile["level"]
    target_role = profile.get("target_role") or track.get("name", "the role")
    track_name = track.get("name", target_role)
    skill = _compact_profile_signal(profile, "skills", topics[0])
    experience = _experience_phrase(profile)
    level_article = "an" if level[:1].lower() in {"a", "e", "i", "o", "u"} else "a"
    anchor = (predefined_anchors or [None])[0] or {}
    anchor_question = anchor.get("question_text") or (
        f"Explain {topics[1 % len(topics)]} in {track_name}. What should a strong candidate understand beyond the definition?"
    )
    anchor_answer = anchor.get("model_answer") or (
        "A strong answer defines the concept accurately, explains why it matters, "
        "and gives a practical example with relevant tradeoffs or risks."
    )

    level_instruction = {
        "beginner": "focus on correct fundamentals, simple tradeoffs, and debugging basics.",
        "intermediate": "probe practical tradeoffs, implementation details, testing, and failure modes.",
        "advanced": "probe architecture judgment, production risk, scalability, and stakeholder tradeoffs.",
    }.get(level, "probe practical reasoning.")

    templates = [
        (
            "easy",
            "fundamentals",
            "Fundamentals",
            "You are preparing for a {target_role}. Explain {topic} in the context of {track_name}, then give one realistic mistake {level_article} {level} candidate should avoid.",
            "A strong answer defines the topic accurately, connects it to the role, gives one concrete example, and names a realistic mistake with a prevention strategy.",
        ),
        (
            "easy",
            "fundamentals",
            "Fundamentals",
            "{anchor_question}",
            "{anchor_answer}",
        ),
        (
            "medium",
            "practical_reasoning",
            "Practical Reasoning",
            "Your profile mentions {skill}. In one of your CV projects or practice projects, how would you decide between two approaches for {topic}?",
            "A strong answer compares real tradeoffs such as correctness, maintainability, performance, delivery risk, user impact, and evidence from testing or metrics.",
        ),
        (
            "medium",
            "practical_reasoning",
            "Practical Reasoning",
            "As a {experience} candidate, imagine a {track_name} feature involving {topic} behaves incorrectly but the symptoms are unclear. How would you debug it?",
            "A strong answer describes systematic diagnosis, relevant logs or signals, isolation steps, likely root causes, and a concrete next action before changing code or configuration.",
        ),
        (
            "medium",
            "practical_reasoning",
            "Practical Reasoning",
            "What tests, metrics, or review evidence would convince you that a solution involving {topic} is ready for a real interview-level project?",
            "A strong answer identifies meaningful validation signals, explains why they fit the goal, and notes edge cases, false positives, or limitations.",
        ),
        (
            "hard",
            "applied_judgment",
            "Applied Judgment",
            "Imagine a production {track_name} system involving {topic} starts failing intermittently. What would you investigate first, and how would you reduce user impact while you diagnose it?",
            "A strong answer prioritizes observability, recent changes, failure scope, rollback or mitigation, root-cause isolation, communication, and a plan to verify recovery.",
        ),
        (
            "hard",
            "applied_judgment",
            "Applied Judgment",
            "For your level, interviewers will {level_instruction} How would you explain a difficult tradeoff in {topic} to a non-technical stakeholder without losing technical accuracy?",
            "A strong answer is technically accurate, business-aware, concise, and frames tradeoffs in terms of risk, cost, user value, delivery timing, and reversibility.",
        ),
    ]

    questions = []
    for index, (difficulty, section_id, section_title, template, model_answer) in enumerate(templates, start=1):
        topic = topics[(index - 1) % len(topics)]
        format_args = {
            "topic": topic,
            "target_role": target_role,
            "track_name": track_name,
            "skill": skill,
            "experience": experience,
            "level": level,
            "level_article": level_article,
            "level_instruction": level_instruction,
            "anchor_question": anchor_question,
            "anchor_answer": anchor_answer,
        }
        questions.append(
            {
                "id": f"q{index}",
                "question": template.format(**format_args),
                "topic_area": topic,
                "section_id": section_id,
                "section_title": section_title,
                "difficulty": difficulty,
                "model_answer": model_answer.format(**format_args),
            }
        )
    return questions


def _sanitize_questions(questions: list[dict]) -> list[dict]:
    return [{key: value for key, value in question.items() if key != "model_answer"} for question in questions]


def _question_number(question_id: str) -> int | None:
    if not question_id.startswith("q"):
        return None
    try:
        return int(question_id[1:])
    except ValueError:
        return None


async def _refine_remaining_questions_individually(
    session_id: str,
    track: dict,
    profile: dict[str, Any],
    seed_questions: list[dict],
) -> bool:
    db = get_db()
    topic_areas = track.get("topic_areas") or [track.get("name", "Interview fundamentals")]
    generated_by_id: dict[str, dict] = {}

    for index in range(2, _QUESTION_COUNT + 1):
        latest = await db["assessment_sessions"].find_one({"session_id": session_id})
        if latest is None or latest.get("completed"):
            return False
        served_indexes = set(int(item) for item in latest.get("served_question_indexes", []))
        if index in served_indexes:
            continue

        prompt = _build_single_remaining_question_prompt(
            track["name"],
            topic_areas,
            profile,
            seed_questions,
            index,
        )
        try:
            raw = await asyncio.wait_for(
                _call_ai_json(
                    prompt,
                    temperature=_settings.AI_CREATIVE_TEMPERATURE,
                    max_output_tokens=1024,
                ),
                timeout=18,
            )
            raw_item: Any
            if isinstance(raw, dict) and (raw.get("question") or raw.get("question_text")):
                raw_item = raw
            else:
                raw_items = _coerce_question_list(raw)
                raw_item = raw_items[0] if raw_items else raw
            question = _normalize_question_candidate(raw_item, seed_questions[index - 1], index)
        except Exception as exc:
            logger.warning("Single assessment question refinement failed for q%s: %s", index, exc)
            continue

        if question:
            generated_by_id[question["id"]] = question

    if not generated_by_id:
        return False

    latest = await db["assessment_sessions"].find_one({"session_id": session_id})
    if latest is None or latest.get("completed"):
        return False

    served_indexes = set(int(item) for item in latest.get("served_question_indexes", []))
    current_questions = list(latest.get("questions", seed_questions))
    changed = False
    for index in range(2, _QUESTION_COUNT + 1):
        if index in served_indexes:
            continue
        next_question = generated_by_id.get(f"q{index}")
        if next_question:
            current_questions[index - 1] = next_question
            changed = True

    if not changed:
        return False

    await db["assessment_sessions"].update_one(
        {"session_id": session_id},
        {
            "$set": {
                "questions": current_questions,
                "generation_status": "completed",
                "generation_completed_at": datetime.now(timezone.utc),
                "question_source": "progressive_ollama_individual",
            }
        },
    )
    return True


async def _refine_remaining_questions(session_id: str, track_id: str, profile: dict[str, Any]) -> None:
    db = get_db()
    track = await get_track_or_none(track_id, db)
    if track is None:
        return

    session = await db["assessment_sessions"].find_one({"session_id": session_id})
    if session is None or session.get("completed"):
        return

    seed_questions = session.get("questions", [])
    topic_areas = track.get("topic_areas") or [track.get("name", "Interview fundamentals")]
    prompt = _build_remaining_questions_prompt(track["name"], topic_areas, profile, seed_questions)
    try:
        raw = await _call_ai_json(
            prompt,
            temperature=_settings.AI_CREATIVE_TEMPERATURE,
            max_output_tokens=4096,
        )
        raw_questions = _coerce_question_list(raw)
        if not isinstance(raw_questions, list):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="AI service returned an unexpected question format.",
            )
        prepared_questions = _prepare_remaining_question_candidates(raw_questions, seed_questions)
        generated = _normalize_generated_questions([seed_questions[0], *prepared_questions])[1:]
    except Exception as exc:
        logger.warning("Batch assessment refinement failed; trying single-question refinement: %s", exc)
        if await _refine_remaining_questions_individually(session_id, track, profile, seed_questions):
            return
        logger.warning("Progressive assessment refinement failed; keeping seed questions: %s", exc)
        await db["assessment_sessions"].update_one(
            {"session_id": session_id},
            {"$set": {"generation_status": "fallback", "generation_error": str(exc)[:240]}},
        )
        return

    latest = await db["assessment_sessions"].find_one({"session_id": session_id})
    if latest is None or latest.get("completed"):
        return

    served_indexes = set(int(index) for index in latest.get("served_question_indexes", []))
    current_questions = list(latest.get("questions", seed_questions))
    by_id = {question["id"]: question for question in generated}
    changed = False

    for index in range(2, _QUESTION_COUNT + 1):
        if index in served_indexes:
            continue
        next_question = by_id.get(f"q{index}")
        if next_question:
            current_questions[index - 1] = next_question
            changed = True

    update: dict[str, Any] = {
        "generation_status": "completed" if changed else "completed_no_changes",
        "generation_completed_at": datetime.now(timezone.utc),
        "question_source": "progressive_ollama",
    }
    if changed:
        update["questions"] = current_questions

    await db["assessment_sessions"].update_one({"session_id": session_id}, {"$set": update})


def _build_plan_prompt(track_name: str, topic_areas: list[str], skill_level: str, total_days: int) -> str:
    topic_list = ", ".join(topic_areas)

    intro = (
        f"The candidate is a {skill_level}-level candidate preparing for "
        f'"{track_name}" technical interviews. Relevant topic areas: {topic_list}.\n\n'
    )

    body = (
        f"Generate a complete day-by-day interview preparation plan spanning "
        f"exactly {total_days} days, organized into weeks, each with a clear "
        "weekly focus theme. Rules:\n"
        "- Day 1 must be light: orientation and setting expectations, not deep "
        "technical content\n"
        "- Difficulty must increase gradually, week over week\n"
        "- The final 3 days of the entire plan must focus on mock interview "
        "practice and review\n"
        "- Each day must specify exactly one topic, 2-4 subtopics, an estimated "
        "study time in minutes between 30 and 90, and a number of practice "
        "questions between 2 and 10\n"
        f"- The \"days\" arrays across all weeks together must contain exactly "
        f"{total_days} day objects total, numbered consecutively from 1 to "
        f"{total_days} with no gaps or repeats\n\n"
        "Respond with a JSON object using exactly this schema:\n"
        "{\n"
        f'  "total_days": {total_days},\n'
        '  "weeks": [\n'
        "    {\n"
        '      "week_number": 1,\n'
        '      "title": "...",\n'
        '      "focus": "...",\n'
        '      "days": [\n'
        "        {\n"
        '          "day_number": 1,\n'
        '          "topic": "...",\n'
        '          "subtopics": ["...", "..."],\n'
        '          "estimated_minutes": 45,\n'
        '          "practice_questions": 5\n'
        "        }\n"
        "      ]\n"
        "    }\n"
        "  ]\n"
        "}"
    )

    return intro + body + _JSON_ONLY_SUFFIX


def _fallback_plan_data(track: dict, skill_level: str, total_days: int) -> dict:
    topics = track.get("topic_areas") or [track.get("name", "Interview fundamentals")]
    minutes_by_level = {"beginner": 45, "intermediate": 60, "advanced": 75}
    practice_by_level = {"beginner": 3, "intermediate": 5, "advanced": 7}
    estimated_minutes = minutes_by_level.get(skill_level, 45)
    practice_questions = practice_by_level.get(skill_level, 4)

    days = []
    for day_number in range(1, total_days + 1):
        if day_number == 1:
            topic = "Orientation and baseline review"
            subtopics = ["Review target role", "Set weekly goals", "Identify weak areas"]
            day_minutes = 30
            day_questions = 2
        elif day_number > total_days - 3:
            topic = "Mock interview practice"
            subtopics = ["Timed answers", "Review feedback", "Refine weak topics"]
            day_minutes = min(90, estimated_minutes + 15)
            day_questions = max(practice_questions, 6)
        else:
            topic = topics[(day_number - 2) % len(topics)]
            subtopics = [
                f"{topic} fundamentals",
                f"{topic} interview examples",
                "Common tradeoffs and mistakes",
            ]
            day_minutes = estimated_minutes
            day_questions = practice_questions

        days.append(
            {
                "day_number": day_number,
                "topic": topic,
                "subtopics": subtopics,
                "estimated_minutes": day_minutes,
                "practice_questions": day_questions,
            }
        )

    weeks = []
    for start in range(0, total_days, 7):
        week_days = days[start : start + 7]
        week_number = len(weeks) + 1
        weeks.append(
            {
                "week_number": week_number,
                "title": f"Week {week_number}: {'Foundation' if week_number == 1 else 'Practice and depth'}",
                "focus": (
                    "Build accurate fundamentals and concise answers."
                    if week_number == 1
                    else "Apply concepts through practical interview scenarios."
                ),
                "days": week_days,
            }
        )

    return {"total_days": total_days, "weeks": weeks}


# ---------------------------------------------------------------------------
# Public service functions
# ---------------------------------------------------------------------------


async def generate_questions(
    track_id: str,
    user_id: str,
    background_tasks: BackgroundTasks | None = None,
    *,
    target_role_id: str | None = None,
    target_role: str | None = None,
) -> tuple[str, list[dict]]:
    """Start a 7-question assessment session for `track_id`, personalized to
    the candidate's track, target role, seniority, and skill level.

    The full set is generated by the local AI up front so even the first
    question is intelligent and role-specific. If the local model is slow or
    unavailable, we fall back to deterministic seed templates immediately and
    refine the rest in the background — so the assessment never blocks.
    """
    db = get_db()
    track = await get_track_or_none(track_id, db)
    if track is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown track_id.")

    profile = await _candidate_profile_context(
        user_id, db, track_id, role_id=target_role_id, role_label=target_role
    )
    predefined_anchors = await _load_predefined_assessment_anchors(db, track_id, profile)
    topic_areas = track.get("topic_areas") or [track.get("name", "Interview fundamentals")]

    # Primary path: generate all 7 questions with local AI, personalized to the
    # track + target role + seniority + skill level. Bounded so a slow model
    # can't hang the assessment start.
    seed_questions = _fallback_questions(track, profile, predefined_anchors)
    questions = seed_questions
    question_source = "progressive_seed"
    generation_status = "pending"
    try:
        prompt = _build_questions_prompt(track["name"], topic_areas, profile)
        raw = await asyncio.wait_for(
            _call_ai_json(prompt, temperature=_settings.AI_CREATIVE_TEMPERATURE, max_output_tokens=4096),
            timeout=_SYNC_GENERATION_TIMEOUT_SECONDS,
        )
        merged, ai_count = _merge_ai_over_seeds(raw, seed_questions)
        # Accept the AI set as long as it meaningfully personalized the
        # assessment (most slots are AI). Below that, treat it as a failed
        # generation and let the background refiner try again.
        if ai_count >= _MIN_AI_QUESTIONS:
            questions = merged
            question_source = "ai_full" if ai_count >= _QUESTION_COUNT else "ai_partial"
            generation_status = "completed" if ai_count >= _QUESTION_COUNT else "completed_partial"
        else:
            raise ValueError(f"only {ai_count} usable AI questions")
    except Exception as exc:
        logger.warning(
            "Synchronous AI assessment generation incomplete for track=%s; using seeds + background refine: %s",
            track_id,
            exc,
        )

    session_id = str(uuid.uuid4())
    await db["assessment_sessions"].insert_one(
        {
            "session_id": session_id,
            "user_id": user_id,
            "track_id": track_id,
            "questions": questions,
            "candidate_profile_snapshot": profile,
            "predefined_anchor_count": len(predefined_anchors),
            "question_source": question_source,
            "generation_status": generation_status,
            "served_question_indexes": [1],
            "completed": False,
            "created_at": datetime.now(timezone.utc),
        }
    )

    logger.info(
        "[assessment] track=%s role=%r seniority=%s source=%s status=%s session=%s",
        track_id,
        profile.get("target_role"),
        profile.get("role_seniority"),
        question_source,
        generation_status,
        session_id,
    )

    # Only schedule background refinement when we fully fell back to seed
    # templates. A partial AI set is already personalized, and re-refining would
    # overwrite the good AI questions the model did produce.
    if generation_status == "pending" and background_tasks is not None:
        background_tasks.add_task(_refine_remaining_questions, session_id, track_id, profile)

    return session_id, _sanitize_questions(questions[:1])


async def get_session_question(session_id: str, user_id: str, question_number: int) -> dict:
    if question_number < 1 or question_number > _QUESTION_COUNT:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found.")

    db = get_db()
    session = await db["assessment_sessions"].find_one({"session_id": session_id})
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment session not found.")
    if session["user_id"] != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This assessment session does not belong to you.")
    if session.get("completed"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This assessment has already been submitted.")

    questions = session.get("questions", [])
    question = questions[question_number - 1] if len(questions) >= question_number else None
    if not question:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found.")

    await db["assessment_sessions"].update_one(
        {"session_id": session_id},
        {"$addToSet": {"served_question_indexes": question_number}},
    )

    return {
        "question": _sanitize_questions([question])[0],
        "question_number": question_number,
        "total": _QUESTION_COUNT,
        "generation_status": session.get("generation_status", "pending"),
    }


async def score_answers(session_id: str, answers: dict[str, str]) -> dict:
    """Score all 7 answers in one local AI call and derive skill level + breakdown."""
    db = get_db()
    session = await db["assessment_sessions"].find_one({"session_id": session_id})
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assessment session not found.",
        )

    questions = session["questions"]
    questions_by_id = {question["id"]: question for question in questions}
    normalized_answers = {
        question_id: str(answer or "").strip()
        for question_id, answer in answers.items()
    }

    too_long = [
        question_id
        for question_id, answer in normalized_answers.items()
        if len(answer) > _MAX_ASSESSMENT_ANSWER_CHARS
    ]
    if too_long:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Please keep assessment answers concise "
                f"({_MAX_ASSESSMENT_ANSWER_CHARS} characters max each)."
            ),
        )

    qa_items = [
        {
            "id": question["id"],
            "topic_area": question["topic_area"],
            "difficulty": question["difficulty"],
            "question": question["question"],
            "model_answer": question["model_answer"],
            "user_answer": normalized_answers.get(question["id"], ""),
        }
        for question in questions
    ]

    raw_result = await score_assessment_batch(qa_items)
    evaluations = raw_result["evaluations"]

    raw_total = 0
    breakdown_scores: dict[str, list[int]] = {}
    per_question_feedback: list[dict] = []

    for evaluation in evaluations:
        question_id = evaluation["question_id"]
        question = questions_by_id.get(question_id, {})
        score = max(0, min(int(evaluation["score"]), 10))
        raw_total += score

        topic_area = question.get("topic_area", "general")
        breakdown_scores.setdefault(topic_area, []).append(score)

        per_question_feedback.append(
            {
                "question_id": question_id,
                "question": question.get("question", ""),
                "user_answer": normalized_answers.get(question_id, ""),
                "score": score,
                "criteria_scores": evaluation.get("criteria_scores", {}),
                "confidence": evaluation.get("confidence"),
                "strengths": evaluation.get("strengths", []),
                "improvements": evaluation.get("improvements", []),
                "review_flags": evaluation.get("review_flags", []),
                "evidence": evaluation.get("evidence", []),
                "score_rationale": evaluation.get("score_rationale"),
                "feedback": evaluation.get("feedback", ""),
                "model_answer": question.get("model_answer", evaluation.get("model_answer", "")),
                "scoring_metadata": evaluation.get("scoring_metadata"),
            }
        )

    overall_score = min(round(raw_total * (100 / _MAX_RAW_SCORE)), 100)

    breakdown = {
        topic_area: round((sum(scores) / len(scores)) * 10)
        for topic_area, scores in breakdown_scores.items()
    }

    if overall_score <= 39:
        skill_level = "beginner"
    elif overall_score <= 69:
        skill_level = "intermediate"
    else:
        skill_level = "advanced"

    return {
        "skill_level": skill_level,
        "score": overall_score,
        "breakdown": breakdown,
        "answers": normalized_answers,
        "per_question_feedback": per_question_feedback,
        "scoring_version": raw_result.get("rubric_version", RUBRIC_VERSION),
    }


async def generate_plan(user_id: str, track_id: str, skill_level: str) -> dict:
    """Generate and persist a personalized day-by-day plan, returning it with id."""
    db = get_db()
    track = await get_track_or_none(track_id, db)
    if track is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown track_id.")
    total_days = _PLAN_DAYS_BY_SKILL_LEVEL[skill_level]

    prompt = _build_plan_prompt(track["name"], track["topic_areas"], skill_level, total_days)
    plan_source = "ollama"
    try:
        plan_data = await _call_ai_json(prompt, temperature=_settings.AI_CREATIVE_TEMPERATURE)
    except HTTPException as exc:
        logger.warning("Local AI plan generation failed; using deterministic fallback plan: %s", exc.detail)
        plan_data = _fallback_plan_data(track, skill_level, total_days)
        plan_source = "fallback"

    document = {
        "user_id": user_id,
        "track_id": track_id,
        "skill_level": skill_level,
        "total_days": plan_data.get("total_days", total_days),
        "weeks": plan_data["weeks"],
        "source": plan_source,
        "created_at": datetime.now(timezone.utc),
    }

    insert_result = await db["plans"].insert_one(dict(document))
    document["id"] = str(insert_result.inserted_id)
    return document


async def get_existing_result(user_id: str, track_id: str) -> tuple[dict | None, dict | None]:
    """Return the most recent (assessment_result, plan) for this user+track, or Nones."""
    db = get_db()

    assessment = await db["assessments"].find_one(
        {"user_id": user_id, "track_id": track_id},
        sort=[("created_at", -1)],
    )
    if assessment is not None:
        assessment["id"] = str(assessment.pop("_id"))

    plan = await db["plans"].find_one(
        {"user_id": user_id, "track_id": track_id},
        sort=[("created_at", -1)],
    )
    if plan is not None:
        plan["id"] = str(plan.pop("_id"))

    return assessment, plan

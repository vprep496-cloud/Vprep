# Phase 3 — all Gemini interactions for the dynamic assessment + plan feature
# live here. Routers in app/api/v1/assessment.py stay thin and only handle
# request validation, ownership checks, and persistence orchestration.
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status

from app.api.v1.tracks import get_track_or_none
from app.core.config import get_settings
from app.core.database import get_db
from app.services.profile_service import normalize_level
from app.services.gemini import generate_json
from app.services.scoring_engine import RUBRIC_VERSION, score_assessment_batch

logger = logging.getLogger("vprep.assessment_service")
_settings = get_settings()

_QUESTION_COUNT = 7
_MAX_ASSESSMENT_ANSWER_CHARS = 900
_MAX_RAW_SCORE = _QUESTION_COUNT * 10  # 70 — every answer scored 0-10

# Plan length is driven purely by skill level, per the Phase 3 spec — not by
# the track's nominal `total_days` (which is just a display figure on the card).
_PLAN_DAYS_BY_SKILL_LEVEL = {"beginner": 30, "intermediate": 21, "advanced": 14}

# Required tail of every Gemini prompt in this phase (Gemini Prompt Rule #1).
# generate_json() in gemini.py also appends its own JSON-only instruction —
# the two are complementary, not conflicting; extra emphasis only helps.
_JSON_ONLY_SUFFIX = (
    "\n\nRespond ONLY with valid JSON. No markdown, no backticks, no preamble, "
    "no explanation. Start immediately with `[` or `{`."
)

_RETRY_SUFFIX = (
    "\n\nYour previous response was not valid JSON. Output ONLY raw JSON this time."
)


async def _call_gemini_json(prompt: str, *, temperature: float | None = None):
    """Call generate_json, retrying once on parse failure (Gemini Prompt Rule #5).

    If both the original call and the single retry fail to produce valid JSON,
    raise HTTP 503 so the client can show "AI service temporarily unavailable."
    """
    try:
        return await generate_json(prompt, temperature=temperature)
    except Exception as first_error:
        logger.warning("Gemini JSON generation failed, retrying once: %s", first_error)
        try:
            return await generate_json(prompt + _RETRY_SUFFIX, temperature=temperature)
        except Exception as second_error:
            logger.error("Gemini JSON generation failed after retry: %s", second_error)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="AI service temporarily unavailable. Please try again.",
            )


# ---------------------------------------------------------------------------
# Prompt builders — kept as plain (non f-string) template pieces wherever the
# text contains literal JSON braces, so nothing needs `{{`/`}}` escaping.
# ---------------------------------------------------------------------------


async def _candidate_profile_context(user_id: str, db) -> dict[str, Any]:
    from bson import ObjectId
    from bson.errors import InvalidId

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

    return {
        "level": normalize_level(level),
        "target_role": (user or {}).get("target_role") or profile.get("target_role"),
        "years_experience": (user or {}).get("years_experience") or profile.get("years_experience"),
        "skills": profile.get("skills") if isinstance(profile.get("skills"), list) else [],
        "projects": profile.get("projects") if isinstance(profile.get("projects"), list) else [],
        "summary": (user or {}).get("cv_summary") or profile.get("summary"),
    }


def _profile_prompt_context(profile: dict[str, Any]) -> str:
    skills = ", ".join(str(skill) for skill in profile.get("skills", [])[:10])
    projects = "; ".join(str(project) for project in profile.get("projects", [])[:3])
    return (
        f"Candidate level: {profile['level']}\n"
        f"Target role: {profile.get('target_role') or 'not provided'}\n"
        f"Years of experience: {profile.get('years_experience') if profile.get('years_experience') is not None else 'not provided'}\n"
        f"CV/profile summary: {profile.get('summary') or 'not provided'}\n"
        f"Relevant skills from CV/onboarding: {skills or 'not provided'}\n"
        f"Relevant projects from CV/onboarding: {projects or 'not provided'}"
    )


def _build_questions_prompt(track_name: str, topic_areas: list[str], profile: dict[str, Any]) -> str:
    topic_list = ", ".join(topic_areas)

    intro = (
        f'You are designing a screening interview assessment for a candidate '
        f'applying to a "{track_name}" role.\n\n'
        f"The relevant topic areas for this role are: {topic_list}.\n\n"
        "Personalize the assessment using this candidate profile. Do not include "
        "names, employers, schools, or any personal identifiers in the questions.\n"
        f"{_profile_prompt_context(profile)}\n\n"
    )

    body = (
        "Generate exactly 7 short interview-style questions that a real technical "
        "interviewer would ask in a screening call for this role. The questions "
        "should read exactly like a real interviewer speaking out loud — not "
        "textbook definitions, not trivia — and should prompt the candidate to "
        "demonstrate real understanding, not just recall facts. Specifically:\n"
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
        "Respond with a JSON array of exactly 7 objects, with ids \"q1\" through "
        "\"q7\" in order, using exactly this schema:\n"
        "[\n"
        "  {\n"
        '    "id": "q1",\n'
        '    "question": "...",\n'
        '    "topic_area": "...",\n'
        '    "section_id": "fundamentals",\n'
        '    "section_title": "Fundamentals",\n'
        '    "difficulty": "easy",\n'
        '    "model_answer": "..."\n'
        "  }\n"
        "]"
    )

    return intro + body + _JSON_ONLY_SUFFIX


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


def _fallback_questions(track: dict, profile: dict[str, Any]) -> list[dict]:
    topics = track.get("topic_areas") or [track.get("name", "Interview fundamentals")]
    level = profile["level"]
    target_role = profile.get("target_role") or track.get("name", "the role")

    templates = [
        (
            "easy",
            "fundamentals",
            "Fundamentals",
            "Explain {topic} in simple terms and why it matters for a {target_role}.",
            "A strong answer defines the concept accurately, states why it matters, and gives one practical example.",
        ),
        (
            "easy",
            "fundamentals",
            "Fundamentals",
            "What is one common mistake candidates make with {topic}, and how would you avoid it?",
            "A strong answer names a realistic mistake, explains the risk, and gives a clear prevention strategy.",
        ),
        (
            "medium",
            "practical_reasoning",
            "Practical Reasoning",
            "How would you decide between two approaches for {topic} in a real project?",
            "A strong answer compares tradeoffs such as complexity, reliability, cost, data, or maintainability.",
        ),
        (
            "medium",
            "practical_reasoning",
            "Practical Reasoning",
            "Describe how your {level}-level experience would help you debug a problem involving {topic}.",
            "A strong answer describes a systematic debugging process, relevant signals, and a concrete next step.",
        ),
        (
            "medium",
            "practical_reasoning",
            "Practical Reasoning",
            "What metrics or evidence would you use to know whether work on {topic} is successful?",
            "A strong answer identifies meaningful metrics, explains why they fit the goal, and notes a limitation.",
        ),
        (
            "hard",
            "applied_judgment",
            "Applied Judgment",
            "Imagine a production system using {topic} starts failing intermittently. What would you investigate first?",
            "A strong answer prioritizes diagnosis, observability, recent changes, failure scope, and safe mitigation.",
        ),
        (
            "hard",
            "applied_judgment",
            "Applied Judgment",
            "How would you explain a tradeoff in {topic} to a non-technical stakeholder?",
            "A strong answer is accurate, concise, business-aware, and avoids unnecessary jargon.",
        ),
    ]

    questions = []
    for index, (difficulty, section_id, section_title, template, model_answer) in enumerate(templates, start=1):
        topic = topics[(index - 1) % len(topics)]
        questions.append(
            {
                "id": f"q{index}",
                "question": template.format(topic=topic, target_role=target_role, level=level),
                "topic_area": topic,
                "section_id": section_id,
                "section_title": section_title,
                "difficulty": difficulty,
                "model_answer": model_answer,
            }
        )
    return questions


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


async def generate_questions(track_id: str, user_id: str) -> tuple[str, list[dict]]:
    """Generate 7 fresh interview-style questions for `track_id`.

    Persists the full question set (including model_answer) to
    `assessment_sessions`, then returns (session_id, sanitized_questions) where
    sanitized_questions has model_answer stripped from every item.
    """
    db = get_db()
    track = await get_track_or_none(track_id, db)
    if track is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown track_id.")

    profile = await _candidate_profile_context(user_id, db)
    prompt = _build_questions_prompt(track["name"], track["topic_areas"], profile)
    try:
        questions = _normalize_generated_questions(
            await _call_gemini_json(prompt, temperature=_settings.AI_CREATIVE_TEMPERATURE)
        )
        question_source = "gemini"
    except HTTPException as exc:
        logger.warning("Gemini assessment question generation failed; using fallback questions: %s", exc.detail)
        questions = _fallback_questions(track, profile)
        question_source = "fallback"

    session_id = str(uuid.uuid4())
    await db["assessment_sessions"].insert_one(
        {
            "session_id": session_id,
            "user_id": user_id,
            "track_id": track_id,
            "questions": questions,
            "candidate_profile_snapshot": profile,
            "question_source": question_source,
            "completed": False,
            "created_at": datetime.now(timezone.utc),
        }
    )

    sanitized_questions = [
        {key: value for key, value in question.items() if key != "model_answer"}
        for question in questions
    ]

    return session_id, sanitized_questions


async def score_answers(session_id: str, answers: dict[str, str]) -> dict:
    """Score all 7 answers in ONE Gemini call and derive skill level + breakdown."""
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
    plan_source = "gemini"
    try:
        plan_data = await _call_gemini_json(prompt, temperature=_settings.AI_CREATIVE_TEMPERATURE)
    except HTTPException as exc:
        logger.warning("Gemini plan generation failed; using local fallback plan: %s", exc.detail)
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

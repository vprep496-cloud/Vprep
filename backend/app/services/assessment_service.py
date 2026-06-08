# Phase 3 — all Gemini interactions for the dynamic assessment + plan feature
# live here. Routers in app/api/v1/assessment.py stay thin and only handle
# request validation, ownership checks, and persistence orchestration.
import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.api.v1.tracks import TRACKS_BY_ID
from app.core.database import get_db
from app.services.gemini import generate_json

logger = logging.getLogger("vprep.assessment_service")

_QUESTION_COUNT = 7
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


async def _call_gemini_json(prompt: str):
    """Call generate_json, retrying once on parse failure (Gemini Prompt Rule #5).

    If both the original call and the single retry fail to produce valid JSON,
    raise HTTP 503 so the client can show "AI service temporarily unavailable."
    """
    try:
        return await generate_json(prompt)
    except Exception as first_error:
        logger.warning("Gemini JSON generation failed, retrying once: %s", first_error)
        try:
            return await generate_json(prompt + _RETRY_SUFFIX)
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


def _build_questions_prompt(track_name: str, topic_areas: list[str]) -> str:
    topic_list = ", ".join(topic_areas)

    intro = (
        f'You are designing a screening interview assessment for a candidate '
        f'applying to a "{track_name}" role.\n\n'
        f"The relevant topic areas for this role are: {topic_list}.\n\n"
    )

    body = (
        "Generate exactly 7 short interview-style questions that a real technical "
        "interviewer would ask in a screening call for this role. The questions "
        "should read exactly like a real interviewer speaking out loud — not "
        "textbook definitions, not trivia — and should prompt the candidate to "
        "demonstrate real understanding, not just recall facts. Specifically:\n"
        "- Every question must be fully open-ended: no yes/no answers, no "
        "multiple choice, no options or correct-answer fields of any kind\n"
        "- Questions must increase in difficulty: questions 1-2 are easy "
        "conceptual questions, questions 3-5 are medium depth-of-understanding "
        "questions, and questions 6-7 are hard applied/situational questions "
        "that require real experience or deep knowledge\n"
        "- Spread the 7 questions across at least 4 different topic areas from "
        "the list above\n"
        "- Each question must be answerable in 2-5 sentences by a knowledgeable "
        "candidate\n\n"
        "For every question also write a `model_answer`: a concise ideal answer "
        "(3-6 sentences) that will be used purely as a server-side scoring "
        "rubric — it must never be shown to the candidate before they answer.\n\n"
        "Respond with a JSON array of exactly 7 objects, with ids \"q1\" through "
        "\"q7\" in order, using exactly this schema:\n"
        "[\n"
        "  {\n"
        '    "id": "q1",\n'
        '    "question": "...",\n'
        '    "topic_area": "...",\n'
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


# ---------------------------------------------------------------------------
# Public service functions
# ---------------------------------------------------------------------------


async def generate_questions(track_id: str, user_id: str) -> tuple[str, list[dict]]:
    """Generate 7 fresh interview-style questions for `track_id`.

    Persists the full question set (including model_answer) to
    `assessment_sessions`, then returns (session_id, sanitized_questions) where
    sanitized_questions has model_answer stripped from every item.
    """
    track = TRACKS_BY_ID[track_id]

    prompt = _build_questions_prompt(track["name"], track["topic_areas"])
    questions = await _call_gemini_json(prompt)

    session_id = str(uuid.uuid4())
    db = get_db()
    await db["assessment_sessions"].insert_one(
        {
            "session_id": session_id,
            "user_id": user_id,
            "track_id": track_id,
            "questions": questions,
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

    qa_items = [
        {
            "id": question["id"],
            "topic_area": question["topic_area"],
            "difficulty": question["difficulty"],
            "question": question["question"],
            "model_answer": question["model_answer"],
            "user_answer": answers.get(question["id"], ""),
        }
        for question in questions
    ]

    prompt = _build_scoring_prompt(qa_items)
    raw_result = await _call_gemini_json(prompt)
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
                "user_answer": answers.get(question_id, ""),
                "score": score,
                "feedback": evaluation.get("feedback", ""),
                "model_answer": question.get("model_answer", evaluation.get("model_answer", "")),
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
        "per_question_feedback": per_question_feedback,
    }


async def generate_plan(user_id: str, track_id: str, skill_level: str) -> dict:
    """Generate and persist a personalized day-by-day plan, returning it with id."""
    track = TRACKS_BY_ID[track_id]
    total_days = _PLAN_DAYS_BY_SKILL_LEVEL[skill_level]

    prompt = _build_plan_prompt(track["name"], track["topic_areas"], skill_level, total_days)
    plan_data = await _call_gemini_json(prompt)

    db = get_db()
    document = {
        "user_id": user_id,
        "track_id": track_id,
        "skill_level": skill_level,
        "total_days": plan_data.get("total_days", total_days),
        "weeks": plan_data["weeks"],
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

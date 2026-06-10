import logging

from fastapi import HTTPException, status

from app.core.config import get_settings
from app.services.gemini import generate_json

logger = logging.getLogger("vprep.admin_ai_service")
_settings = get_settings()

_JSON_ONLY_SUFFIX = (
    "\n\nRespond ONLY with valid JSON. No markdown, no backticks, no preamble, "
    "no explanation. Start immediately with `[`."
)
_RETRY_SUFFIX = "\n\nYour previous response was not valid JSON. Output ONLY raw JSON this time."

_DEFAULT_CRITERIA = {
    "hr": ["clarity", "relevance", "fluency", "confidence"],
    "technical": ["accuracy", "depth", "practical_knowledge"],
    "coding_logic": ["logic_correctness", "edge_cases", "complexity_awareness", "clarity"],
    "behavioral": ["structure", "example_quality", "self_awareness", "impact"],
}


async def _call_gemini_json(prompt: str):
    try:
        return await generate_json(prompt, temperature=_settings.AI_CREATIVE_TEMPERATURE)
    except Exception as first_error:
        logger.warning("Gemini admin generation failed, retrying once: %s", first_error)
        try:
            return await generate_json(prompt + _RETRY_SUFFIX, temperature=_settings.AI_CREATIVE_TEMPERATURE)
        except Exception as second_error:
            logger.error("Gemini admin generation failed after retry: %s", second_error)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="AI generation service temporarily unavailable. Please try again.",
            )


def _build_question_prompt(
    track: dict,
    phase: str,
    count: int,
    difficulty: str | None,
    guidance: str | None,
) -> str:
    topic_list = ", ".join(track.get("topic_areas") or ["general interview readiness"])
    criteria = _DEFAULT_CRITERIA[phase]
    difficulty_line = (
        f"All questions should be {difficulty} difficulty."
        if difficulty
        else "Use a healthy mix of easy, medium, and hard difficulty."
    )
    guidance_line = f"\nAdditional admin guidance: {guidance}\n" if guidance else ""

    phase_instructions = {
        "hr": (
            "Generate HR voice-interview questions that assess communication, "
            "clarity, motivation, self-awareness, and relevance to the role."
        ),
        "technical": (
            "Generate conceptual technical short-answer questions. They should "
            "not require code, but they should reveal real understanding."
        ),
        "coding_logic": (
            "Generate handwritten coding-logic prompts. Each prompt should ask "
            "the candidate to solve or outline an algorithm on paper and upload "
            "an image of their solution."
        ),
        "behavioral": (
            "Generate behavioral/culture-fit questions suitable for STAR-style "
            "answers, with room for automated NLP scoring and manual review."
        ),
    }[phase]

    return (
        "You are building a professional interview question bank for V-Prep.\n\n"
        f"Track: {track['name']}\n"
        f"Track description: {track.get('description', '')}\n"
        f"Relevant topic areas: {topic_list}\n"
        f"Phase: {phase}\n"
        f"{phase_instructions}\n"
        f"{difficulty_line}\n"
        f"{guidance_line}\n"
        f"Generate exactly {count} questions. For every question provide:\n"
        "- question_text: one realistic interviewer question or coding prompt\n"
        "- difficulty: easy, medium, or hard\n"
        "- scoring_criteria: the exact criteria list to score, usually "
        f"{criteria}\n"
        "- model_answer: a concise ideal answer/rubric used only after submission\n"
        "- tags: 2-5 lowercase tags\n\n"
        "Respond with a JSON array using exactly this schema:\n"
        "[\n"
        "  {\n"
        '    "question_text": "...",\n'
        '    "difficulty": "medium",\n'
        '    "scoring_criteria": ["accuracy", "depth"],\n'
        '    "model_answer": "...",\n'
        '    "tags": ["technical", "api-design"]\n'
        "  }\n"
        "]" + _JSON_ONLY_SUFFIX
    )


async def generate_question_documents(
    track: dict,
    phase: str,
    count: int,
    difficulty: str | None,
    guidance: str | None,
) -> list[dict]:
    prompt = _build_question_prompt(track, phase, count, difficulty, guidance)
    raw_questions = await _call_gemini_json(prompt)
    if not isinstance(raw_questions, list):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI generation service returned an unexpected response.",
        )

    answer_type = "image" if phase == "coding_logic" else "voice" if phase in {"hr", "behavioral"} else "text"
    normalized: list[dict] = []
    for raw in raw_questions[:count]:
        if not isinstance(raw, dict):
            continue
        question_text = str(raw.get("question_text", "")).strip()
        model_answer = str(raw.get("model_answer", "")).strip()
        if not question_text or not model_answer:
            continue

        raw_criteria = raw.get("scoring_criteria")
        scoring_criteria = (
            [str(item).strip() for item in raw_criteria if str(item).strip()]
            if isinstance(raw_criteria, list)
            else _DEFAULT_CRITERIA[phase]
        )
        raw_tags = raw.get("tags")
        tags = [str(item).strip().lower() for item in raw_tags if str(item).strip()] if isinstance(raw_tags, list) else []

        raw_difficulty = str(raw.get("difficulty", difficulty or "medium")).lower()
        normalized.append(
            {
                "track_id": track["id"] if phase not in {"hr", "behavioral"} else "all",
                "phase": phase,
                "question_text": question_text,
                "answer_type": answer_type,
                "difficulty": raw_difficulty if raw_difficulty in {"easy", "medium", "hard"} else "medium",
                "scoring_criteria": scoring_criteria or _DEFAULT_CRITERIA[phase],
                "model_answer": model_answer,
                "tags": tags or [phase, track["id"]],
            }
        )

    if len(normalized) < count:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI generation returned too few usable questions. Please try again.",
        )
    return normalized

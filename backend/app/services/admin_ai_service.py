import logging

from fastapi import HTTPException, status

from app.core.config import get_settings
from app.services.ai_provider import generate_json

logger = logging.getLogger("vprep.admin_ai_service")
_settings = get_settings()

_JSON_ONLY_SUFFIX = (
    "\n\nRespond ONLY with valid JSON. No markdown, no backticks, no preamble, "
    "no explanation. Start immediately with `{`."
)
_RETRY_SUFFIX = "\n\nYour previous response was not valid JSON. Output ONLY raw JSON this time."

_DEFAULT_CRITERIA = {
    "hr": ["clarity", "relevance", "fluency", "confidence"],
    "technical": ["accuracy", "depth", "practical_knowledge"],
    "coding_logic": [
        "problem_understanding",
        "algorithm_correctness",
        "implementation_quality",
        "edge_cases",
        "complexity_awareness",
        "code_clarity",
    ],
    "behavioral": ["structure", "example_quality", "self_awareness", "impact"],
}

# Algorithm categories used to diversify generated coding questions
_CODING_ALGORITHM_CATEGORIES = [
    "array manipulation",
    "string processing",
    "hash map / frequency counting",
    "two-pointer / sliding window",
    "binary search",
    "stack / queue",
    "linked list",
    "tree traversal (BFS / DFS)",
    "graph traversal",
    "dynamic programming",
    "recursion / divide-and-conquer",
    "sorting and searching",
    "greedy algorithms",
    "bit manipulation",
]


async def _call_ai_json(prompt: str, *, model_name: str | None = None, num_ctx: int | None = None):
    """Call generate_json with optional model routing, retry on failure."""
    try:
        return await generate_json(
            prompt,
            temperature=_settings.AI_CREATIVE_TEMPERATURE,
            model_name=model_name,
            num_ctx=num_ctx,
        )
    except Exception as first_error:
        logger.warning("Local AI admin generation failed, retrying once: %s", first_error)
        try:
            return await generate_json(
                prompt + _RETRY_SUFFIX,
                temperature=_settings.AI_CREATIVE_TEMPERATURE,
                model_name=model_name,
                num_ctx=num_ctx,
            )
        except Exception as second_error:
            # If the coding model failed twice, fall back to the default model
            if model_name and model_name != _settings.OLLAMA_MODEL:
                logger.warning(
                    "Coding model %r unavailable for question generation, falling back to %r: %s",
                    model_name, _settings.OLLAMA_MODEL, second_error,
                )
                try:
                    return await generate_json(
                        prompt + _RETRY_SUFFIX,
                        temperature=_settings.AI_CREATIVE_TEMPERATURE,
                    )
                except Exception as fallback_error:
                    second_error = fallback_error

            logger.error("Local AI admin generation failed after retry: %s", second_error)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=getattr(
                    second_error,
                    "user_message",
                    "Local AI generation service temporarily unavailable. Please try again.",
                ),
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

    if phase == "coding_logic":
        return _build_coding_question_prompt(
            track=track,
            topic_list=topic_list,
            count=count,
            difficulty=difficulty,
            difficulty_line=difficulty_line,
            guidance_line=guidance_line,
            criteria=criteria,
        )

    phase_instructions = {
        "hr": (
            "Generate HR voice-interview questions that assess communication, "
            "clarity, motivation, self-awareness, and relevance to the role."
        ),
        "technical": (
            "Generate conceptual technical short-answer questions. They should "
            "not require code, but they should reveal real understanding."
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
        "Respond with a JSON object whose `questions` value is an array of "
        f"exactly {count} question objects, using exactly this schema:\n"
        "{\n"
        '  "questions": [\n'
        "    {\n"
        '      "question_text": "...",\n'
        '      "difficulty": "medium",\n'
        '      "scoring_criteria": ["accuracy", "depth"],\n'
        '      "model_answer": "...",\n'
        '      "tags": ["technical", "api-design"]\n'
        "    }\n"
        "  ]\n"
        "}" + _JSON_ONLY_SUFFIX
    )


def _build_coding_question_prompt(
    *,
    track: dict,
    topic_list: str,
    count: int,
    difficulty: str | None,
    difficulty_line: str,
    guidance_line: str,
    criteria: list[str],
) -> str:
    """Coding-specific question generation prompt — optimised for qwen2.5-coder.

    Produces questions that are:
      • Self-contained (no external libraries required)
      • Solvable on paper in 15–30 minutes at the stated difficulty
      • Accompanied by a model_answer that includes Big-O analysis
      • Tagged with the algorithm category for the admin portal filter
    """
    categories_sample = ", ".join(_CODING_ALGORITHM_CATEGORIES[:8])
    return (
        "You are a senior software engineer building a professional coding assessment "
        "question bank for V-Prep, a mock interview platform.\n\n"

        "═══ CONTEXT ═══\n"
        f"Track: {track['name']}\n"
        f"Description: {track.get('description', '')}\n"
        f"Relevant topics: {topic_list}\n"
        f"{difficulty_line}\n"
        f"{guidance_line}\n"

        "═══ QUESTION REQUIREMENTS ═══\n"
        "Each coding question MUST:\n"
        "1. Be solvable with pen-and-paper in 15–30 minutes at the stated difficulty.\n"
        "2. Specify clear input/output format and at least one concrete example.\n"
        "3. Avoid requiring external libraries — standard language constructs only.\n"
        "4. Cover one primary algorithm category per question for variety.\n"
        "5. Be appropriate for the track's domain (e.g. a web-dev track should prefer "
        "   string/array problems over graph algorithms).\n\n"

        "Difficulty guide:\n"
        "  easy   — basic array/string manipulation, linear scan, O(n) solutions.\n"
        "           Example: 'reverse a string', 'find max in array'.\n"
        "  medium — two-pointer, sliding window, hash map, binary search, simple recursion.\n"
        "           Example: 'two sum', 'valid parentheses', 'longest substring without repeats'.\n"
        "  hard   — DP, graph BFS/DFS, divide and conquer, multiple nested optimisations.\n"
        "           Example: 'LCS', 'word break', 'number of islands'.\n\n"

        "Algorithm categories to rotate across questions:\n"
        f"  {categories_sample}, etc.\n\n"

        "═══ MODEL ANSWER FORMAT ═══\n"
        "model_answer must contain (in order):\n"
        "  1. Approach: one sentence describing the algorithm strategy.\n"
        "  2. Code: clean Python or pseudocode solution (≤ 20 lines).\n"
        "  3. Complexity: 'Time: O(...) | Space: O(...)'\n"
        "  4. Edge cases: 2–3 bullet points of boundary conditions to check.\n\n"

        "═══ OUTPUT ═══\n"
        f"Generate exactly {count} distinct coding questions. "
        "Use varied algorithm categories across the set.\n\n"
        "Respond with a JSON object using this exact schema:\n"
        "{\n"
        '  "questions": [\n'
        "    {\n"
        '      "question_text": "Given an array of integers...",\n'
        '      "difficulty": "medium",\n'
        f'      "scoring_criteria": {criteria},\n'
        '      "model_answer": "Approach: sliding window...\\nCode:\\n  def fn(...):\\n    ...\\nTime: O(n) | Space: O(k)\\nEdge cases:\\n  - empty array: return 0",\n'
        '      "tags": ["array", "sliding-window", "medium"]\n'
        "    }\n"
        "  ]\n"
        "}" + _JSON_ONLY_SUFFIX
    )


def _coerce_question_list(raw) -> list | None:
    """Normalize the local model's response into a list of question dicts.

    Ollama's JSON mode (`format=json`) reliably emits a single JSON *object*,
    not a top-level array, so we ask for `{"questions": [...]}`. Be tolerant of
    the small model's variations: a raw list, the wrapped list under a few
    likely keys, or a single bare question object."""
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict):
        for key in ("questions", "items", "data", "results"):
            value = raw.get(key)
            if isinstance(value, list):
                return value
        # A single bare question object (model ignored the array wrapper).
        if "question_text" in raw:
            return [raw]
    return None


async def generate_question_documents(
    track: dict,
    phase: str,
    count: int,
    difficulty: str | None,
    guidance: str | None,
) -> list[dict]:
    # Use the code-specialised model for coding_logic questions —
    # it produces significantly better algorithm variety, Big-O annotations,
    # and more realistic hand-solvable problem statements.
    coding_model = (_settings.OLLAMA_CODING_MODEL or "").strip() or None
    is_coding = phase == "coding_logic"
    model_name = coding_model if is_coding else None
    num_ctx    = _settings.OLLAMA_CODING_NUM_CTX if is_coding and coding_model else None
    if is_coding and coding_model:
        logger.info("Generating coding questions with model %r", coding_model)

    prompt = _build_question_prompt(track, phase, count, difficulty, guidance)
    raw = await _call_ai_json(prompt, model_name=model_name, num_ctx=num_ctx)
    raw_questions = _coerce_question_list(raw)
    if raw_questions is None:
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

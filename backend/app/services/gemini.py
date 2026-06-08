import json
import logging

import google.generativeai as genai
from google.generativeai.types import HarmBlockThreshold, HarmCategory

from app.core.config import get_settings

logger = logging.getLogger("vprep.gemini")

_settings = get_settings()
genai.configure(api_key=_settings.GEMINI_API_KEY)

_GENERATION_CONFIG = {
    "temperature": 0.7,
    "top_p": 0.95,
    "max_output_tokens": 8192,
}

# Standard safety settings — block medium-and-above content across all categories.
_SAFETY_SETTINGS = {
    HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
}

model = genai.GenerativeModel(
    model_name="gemini-1.5-flash",
    generation_config=_GENERATION_CONFIG,
    safety_settings=_SAFETY_SETTINGS,
)


def _strip_code_fences(text: str) -> str:
    """Remove ```json / ``` markdown fences that Gemini sometimes wraps JSON in."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned.rsplit("```", 1)[0]
    return cleaned.strip()


async def generate_text(prompt: str) -> str:
    """Generate plain text from a prompt using Gemini 1.5 Flash."""
    response = await model.generate_content_async(prompt)
    return response.text


async def generate_json(prompt: str):
    """Generate a JSON value (dict or list) from a prompt using Gemini 1.5 Flash.

    A strict JSON-only instruction is appended to the prompt, any markdown
    code fences are stripped from the response, and the remaining text is
    parsed as JSON. Raises ValueError (including a snippet of the raw
    response) if the output cannot be parsed.
    """
    json_prompt = (
        f"{prompt}\n\n"
        "Respond with strict JSON only. Do not include markdown code fences, "
        "explanations, or any text outside the JSON value. The response must "
        "be directly parseable by a JSON parser."
    )

    response = await model.generate_content_async(json_prompt)
    raw_text = response.text
    cleaned = _strip_code_fences(raw_text)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        snippet = raw_text.strip()[:300]
        logger.error("Gemini returned non-JSON output: %s", snippet)
        raise ValueError(f"Gemini did not return valid JSON. Raw response: {snippet!r}") from exc

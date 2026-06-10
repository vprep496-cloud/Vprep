import hashlib
import json
import logging
from typing import Literal

from google import genai
from google.genai import types

from app.core.config import get_settings

logger = logging.getLogger("vprep.gemini")

AIUseCase = Literal["text", "json", "scoring", "multimodal", "health"]

_settings = get_settings()
_client: genai.Client | None = None

_SAFETY_SETTINGS = [
    {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_MEDIUM_AND_ABOVE"},
    {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_MEDIUM_AND_ABOVE"},
    {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_MEDIUM_AND_ABOVE"},
    {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_MEDIUM_AND_ABOVE"},
]


class AIConfigurationError(RuntimeError):
    """Raised when the backend has no usable AI provider configuration."""


def _get_client() -> genai.Client:
    global _client
    if _settings.AI_PROVIDER != "gemini":
        raise AIConfigurationError(f"Unsupported AI_PROVIDER={_settings.AI_PROVIDER!r}.")
    if not _settings.gemini_api_key:
        raise AIConfigurationError("GEMINI_API_KEY is not configured.")
    if _client is None:
        _client = genai.Client(api_key=_settings.gemini_api_key)
    return _client


def _model_for(use_case: AIUseCase) -> str:
    if use_case == "json":
        return _settings.GEMINI_JSON_MODEL
    if use_case == "scoring":
        return _settings.GEMINI_SCORING_MODEL
    if use_case == "multimodal":
        return _settings.GEMINI_MULTIMODAL_MODEL
    if use_case == "health":
        return _settings.GEMINI_HEALTH_MODEL
    return _settings.GEMINI_TEXT_MODEL


def _generation_config(
    *,
    response_mime_type: str | None = None,
    response_json_schema: dict | None = None,
    max_output_tokens: int | None = None,
    temperature: float | None = None,
) -> types.GenerateContentConfig:
    config: dict = {
        "temperature": _settings.AI_TEMPERATURE if temperature is None else temperature,
        "top_p": _settings.AI_TOP_P,
        "max_output_tokens": max_output_tokens or _settings.AI_MAX_OUTPUT_TOKENS,
        "safety_settings": _SAFETY_SETTINGS,
    }
    if response_mime_type is not None:
        config["response_mime_type"] = response_mime_type
    if response_json_schema is not None:
        config["response_json_schema"] = response_json_schema
    return types.GenerateContentConfig(**config)


def _strip_code_fences(text: str) -> str:
    """Remove ```json / ``` markdown fences that models sometimes wrap JSON in."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned.rsplit("```", 1)[0]
    return cleaned.strip()


def _parse_json_response(raw_text: str):
    cleaned = _strip_code_fences(raw_text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        snippet = raw_text.strip()[:300]
        logger.error("Gemini returned non-JSON output: %s", snippet)
        raise ValueError(f"Gemini did not return valid JSON. Raw response: {snippet!r}") from exc


def _key_fingerprint(raw_key: str) -> str | None:
    if not raw_key:
        return None
    digest = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()[:12]
    return f"sha256:{digest}"


def get_ai_status() -> dict:
    """Safe configuration status for health/admin screens. Never returns keys."""
    return {
        "provider": _settings.AI_PROVIDER,
        "configured": _settings.ai_configured,
        "sdk": "google-genai",
        "key_fingerprint": _key_fingerprint(_settings.gemini_api_key),
        "models": {
            "text": _settings.GEMINI_TEXT_MODEL,
            "json": _settings.GEMINI_JSON_MODEL,
            "scoring": _settings.GEMINI_SCORING_MODEL,
            "multimodal": _settings.GEMINI_MULTIMODAL_MODEL,
            "health": _settings.GEMINI_HEALTH_MODEL,
        },
        "generation": {
            "temperature": _settings.AI_TEMPERATURE,
            "creative_temperature": _settings.AI_CREATIVE_TEMPERATURE,
            "top_p": _settings.AI_TOP_P,
            "max_output_tokens": _settings.AI_MAX_OUTPUT_TOKENS,
        },
    }


async def live_health_check() -> dict:
    """Small paid live check, intended for admins during setup/debugging."""
    status = get_ai_status()
    if not status["configured"]:
        return {**status, "live": {"ok": False, "message": "Gemini API key is not configured."}}

    try:
        text = await generate_text(
            "Return exactly the word OK.",
            use_case="health",
            max_output_tokens=8,
            temperature=0.0,
        )
        ok = "OK" in text.upper()
        return {**status, "live": {"ok": ok, "message": text.strip()[:80]}}
    except Exception as exc:
        logger.warning("Gemini live health check failed: %s", exc)
        return {**status, "live": {"ok": False, "message": str(exc)[:160]}}


async def generate_text(
    prompt: str,
    *,
    model_name: str | None = None,
    use_case: AIUseCase = "text",
    max_output_tokens: int | None = None,
    temperature: float | None = None,
) -> str:
    """Generate plain text through the configured Gemini model."""
    client = _get_client()
    response = await client.aio.models.generate_content(
        model=model_name or _model_for(use_case),
        contents=prompt,
        config=_generation_config(max_output_tokens=max_output_tokens, temperature=temperature),
    )
    return response.text or ""


async def generate_json(
    prompt: str,
    *,
    model_name: str | None = None,
    use_case: AIUseCase = "json",
    response_json_schema: dict | None = None,
    max_output_tokens: int | None = None,
    temperature: float | None = None,
):
    """Generate a JSON value using Gemini's JSON response mode plus fallback parsing."""
    json_prompt = (
        f"{prompt}\n\n"
        "Respond with strict JSON only. Do not include markdown code fences, "
        "explanations, or any text outside the JSON value. The response must "
        "be directly parseable by a JSON parser."
    )

    client = _get_client()
    response = await client.aio.models.generate_content(
        model=model_name or _model_for(use_case),
        contents=json_prompt,
        config=_generation_config(
            response_mime_type="application/json",
            response_json_schema=response_json_schema,
            max_output_tokens=max_output_tokens,
            temperature=temperature,
        ),
    )
    return _parse_json_response(response.text or "")


async def generate_multimodal_json(
    prompt: str,
    *,
    media_bytes: bytes,
    mime_type: str,
    model_name: str | None = None,
    response_json_schema: dict | None = None,
    max_output_tokens: int | None = None,
    temperature: float | None = None,
):
    """Generate JSON from a prompt plus one audio/image/document part."""
    client = _get_client()
    media_part = types.Part.from_bytes(data=media_bytes, mime_type=mime_type)
    response = await client.aio.models.generate_content(
        model=model_name or _model_for("multimodal"),
        contents=[media_part, prompt],
        config=_generation_config(
            response_mime_type="application/json",
            response_json_schema=response_json_schema,
            max_output_tokens=max_output_tokens,
            temperature=temperature,
        ),
    )
    return _parse_json_response(response.text or "")

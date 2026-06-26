from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration, populated from environment variables / .env."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # MongoDB
    MONGODB_URL: str
    MONGODB_DB_NAME: str = "vprep"

    # Firebase
    FIREBASE_SERVICE_ACCOUNT_PATH: str = "./firebase-service-account.json"

    # Runtime mode. Development returns/logs safe auth diagnostics; production
    # keeps auth failures generic.
    ENVIRONMENT: str = "development"

    # Local AI provider. Mobile/admin clients call this FastAPI backend only;
    # the backend then talks to Ollama on the laptop through LangChain.
    AI_PROVIDER: str = "ollama"
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "llama3.2:3b"
    OLLAMA_REQUEST_TIMEOUT_SECONDS: int = 120
    OLLAMA_HEALTH_TIMEOUT_SECONDS: int = 5
    # Context window passed to Ollama. The llama3.2:3b default is only 2048
    # tokens — our voice scoring prompts (prompt + transcript + JSON schema) can
    # easily exceed that, causing silent truncation and garbled output. 8192 is
    # plenty for all use cases while keeping memory usage low on consumer hardware.
    OLLAMA_NUM_CTX: int = 8192

    # ── Coding-specific model ────────────────────────────────────────────────
    # A code-specialized model gives significantly better algorithm analysis,
    # Big-O reasoning, and edge-case detection than a general-purpose model.
    #
    # Recommended options (pull with `ollama pull <name>`):
    #   qwen2.5-coder:7b     — best accuracy/speed balance; recommended default
    #   deepseek-coder:6.7b  — strong on algorithmic reasoning
    #   codellama:7b         — Meta's Code Llama, well-established
    #   deepseek-coder-v2:16b— highest quality, needs more RAM (requires ~10 GB)
    #
    # Set OLLAMA_CODING_MODEL="" in .env to fall back to OLLAMA_MODEL for all
    # scoring (useful on low-RAM machines that can only run one model at a time).
    OLLAMA_CODING_MODEL: str = "qwen2.5-coder:7b"
    # Code evaluation prompts are longer (problem + OCR text + rubric).
    # 12288 tokens gives comfortable headroom for complex multi-function solutions.
    OLLAMA_CODING_NUM_CTX: int = 12288
    # Coding model may take longer on first inference (cold start / larger model)
    OLLAMA_CODING_TIMEOUT_SECONDS: int = 180

    # Whisper model size for voice transcription and delivery analytics.
    # "base"    — 74M params, fast, lower accuracy. Good for low-end hardware.
    # "small"   — 244M params, better accuracy, fast.
    # "medium"  — 769M params, recommended for professional scoring quality.
    # "large-v3"— 1.5B params, best accuracy, slower on CPU (~30–60 s per clip).
    # Upgrade from "base" → "medium" adds word timestamps with higher accuracy,
    # enabling WPM analysis, filler word detection, and pause analytics.
    WHISPER_MODEL_SIZE: str = "medium"
    AI_TEMPERATURE: float = 0.2
    AI_CREATIVE_TEMPERATURE: float = 0.7
    AI_TOP_P: float = 0.95
    AI_MAX_OUTPUT_TOKENS: int = 8192

    # CORS
    ALLOWED_ORIGINS: str = ""

    # JWT / general secret
    SECRET_KEY: str

    @property
    def origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",") if origin.strip()]

    @property
    def is_development(self) -> bool:
        return self.ENVIRONMENT.lower() in {"dev", "development", "local"}

    @property
    def ai_configured(self) -> bool:
        return self.AI_PROVIDER == "ollama" and bool(self.OLLAMA_BASE_URL and self.OLLAMA_MODEL)


@lru_cache()
def get_settings() -> Settings:
    return Settings()

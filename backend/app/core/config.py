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

    # Local AI provider. Mobile/admin clients call this FastAPI backend only;
    # the backend then talks to Ollama on the laptop through LangChain.
    AI_PROVIDER: str = "ollama"
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "llama3.2:3b"
    OLLAMA_REQUEST_TIMEOUT_SECONDS: int = 120
    OLLAMA_HEALTH_TIMEOUT_SECONDS: int = 5
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
    def ai_configured(self) -> bool:
        return self.AI_PROVIDER == "ollama" and bool(self.OLLAMA_BASE_URL and self.OLLAMA_MODEL)


@lru_cache()
def get_settings() -> Settings:
    return Settings()

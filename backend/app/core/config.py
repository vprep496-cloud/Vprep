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

    # AI provider / Gemini. Keep keys server-side only; mobile/admin clients
    # should call backend endpoints and never receive the raw API key.
    AI_PROVIDER: str = "gemini"
    GEMINI_API_KEY: str = ""
    GOOGLE_API_KEY: str = ""
    GEMINI_TEXT_MODEL: str = "gemini-3.5-flash"
    GEMINI_JSON_MODEL: str = "gemini-3.5-flash"
    GEMINI_SCORING_MODEL: str = "gemini-3.5-flash"
    GEMINI_MULTIMODAL_MODEL: str = "gemini-3.5-flash"
    GEMINI_HEALTH_MODEL: str = "gemini-3.1-flash-lite"
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
    def gemini_api_key(self) -> str:
        return self.GEMINI_API_KEY or self.GOOGLE_API_KEY

    @property
    def ai_configured(self) -> bool:
        return self.AI_PROVIDER == "gemini" and bool(self.gemini_api_key)


@lru_cache()
def get_settings() -> Settings:
    return Settings()

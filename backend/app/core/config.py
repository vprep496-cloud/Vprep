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

    # Gemini
    GEMINI_API_KEY: str

    # CORS
    ALLOWED_ORIGINS: str = ""

    # JWT / general secret
    SECRET_KEY: str

    @property
    def origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",") if origin.strip()]


@lru_cache()
def get_settings() -> Settings:
    return Settings()

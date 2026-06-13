import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import admin, assessment, auth, interview, notifications, tracks, users
from app.core.config import get_settings
from app.core.database import close_db, connect_db
from app.core.security import init_firebase
from app.services.ai_provider import get_ai_status

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("vprep.main")

settings = get_settings()


async def _warm_up_whisper() -> None:
    """Pre-load the Whisper model in a background thread at startup.

    Loading WhisperModel("base") takes 5–30 s and downloads ~150 MB on first
    run. Doing it at startup means the first voice submission responds quickly
    instead of timing out while the model loads on-demand.
    """
    try:
        from app.services.ai_provider import _get_or_create_whisper_model  # noqa: PLC0415
        await asyncio.to_thread(_get_or_create_whisper_model)
        logger.info("[startup] Whisper model ready")
    except Exception as exc:
        # Non-fatal — voice scoring will attempt to load the model on first use
        logger.warning("[startup] Whisper model warm-up skipped: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_firebase()
    await connect_db()
    # Warm up Whisper in background — don't block API startup if model is large
    asyncio.create_task(_warm_up_whisper())
    logger.info("V-Prep API startup complete")
    yield
    await close_db()
    logger.info("V-Prep API shutdown complete")


app = FastAPI(title="V-Prep API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(users.router, prefix="/api/v1/users", tags=["users"])
app.include_router(tracks.router, prefix="/api/v1/tracks", tags=["tracks"])
app.include_router(assessment.router, prefix="/api/v1/assessment", tags=["assessment"])
app.include_router(interview.router, prefix="/api/v1/interview", tags=["interview"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["admin"])
app.include_router(notifications.router, prefix="/api/v1/notifications", tags=["notifications"])


@app.get("/health")
async def health_check():
    ai = get_ai_status()
    return {
        "status": "ok",
        "version": "1.0.0",
        "ai": {
            "provider": ai["provider"],
            "configured": ai["configured"],
            "models": ai["models"],
        },
    }

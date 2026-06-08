import logging

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.core.config import get_settings

logger = logging.getLogger("vprep.database")

_client: AsyncIOMotorClient | None = None
_db: AsyncIOMotorDatabase | None = None


async def connect_db() -> None:
    """Open the Motor client, select the database, and ensure all indexes exist."""
    global _client, _db

    settings = get_settings()
    _client = AsyncIOMotorClient(settings.MONGODB_URL)
    _db = _client[settings.MONGODB_DB_NAME]

    await _db["users"].create_index("email", unique=True)
    await _db["users"].create_index("firebase_uid", unique=True)

    await _db["enrollments"].create_index([("user_id", 1), ("track_id", 1)], unique=True)
    # Phase 4: supports `GET /tracks/enrolled` (list-all-for-user, sorted by updated_at)
    await _db["enrollments"].create_index("user_id")

    await _db["sessions"].create_index("user_id")
    await _db["sessions"].create_index("track_id")

    await _db["questions"].create_index("track_id")
    await _db["questions"].create_index("phase")

    # --- Phase 5: mock-interview indexes. `sessions.user_id`/`track_id` and
    # `questions.track_id`/`phase` already existed from the Phase 1 stub above
    # — only the genuinely new compound/status/sort indexes are added here. ---
    await _db["sessions"].create_index([("user_id", 1), ("track_id", 1)])
    await _db["sessions"].create_index("status")
    await _db["sessions"].create_index([("completed_at", -1)])
    await _db["questions"].create_index([("phase", 1), ("track_id", 1)])
    # --- end Phase 5 indexes ---

    # --- Phase 3: assessment + personalized plan indexes ---
    await _db["assessment_sessions"].create_index("session_id", unique=True)
    await _db["assessment_sessions"].create_index("user_id")
    await _db["assessments"].create_index([("user_id", 1), ("track_id", 1)])
    await _db["assessments"].create_index([("created_at", -1)])
    await _db["plans"].create_index([("user_id", 1), ("track_id", 1)])
    await _db["plans"].create_index([("created_at", -1)])
    # --- end Phase 3 indexes ---

    logger.info("MongoDB connected and indexes ensured (db=%s)", settings.MONGODB_DB_NAME)


async def close_db() -> None:
    """Close the Motor client connection."""
    global _client, _db

    if _client is not None:
        _client.close()
        _client = None
        _db = None
        logger.info("MongoDB connection closed")


def get_db() -> AsyncIOMotorDatabase:
    """Return the active database instance. Requires connect_db() to have run."""
    if _db is None:
        raise RuntimeError("Database has not been initialized — call connect_db() first.")
    return _db

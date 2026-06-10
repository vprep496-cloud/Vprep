from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel
from pymongo import ReturnDocument

from app.core.database import get_db
from app.core.dependencies import bearer_scheme, get_current_user, require_role
from app.core.security import create_demo_token, verify_firebase_token
from app.models.user import RoleUpdate, UserResponse

router = APIRouter()

# ---------------------------------------------------------------------------
# Demo account registry — these users are created on-demand in MongoDB the
# first time `/auth/demo-login` is called for each key, then reused.
# Matches the names in `scripts/seed_demo_data.py` so that seeded candidates
# have a matching demo-login entry.
# ---------------------------------------------------------------------------
_DEMO_ACCOUNTS: dict[str, dict[str, Any]] = {
    "superadmin": {
        "email": "superadmin@demo.vprep",
        "display_name": "Demo Superadmin",
        "role": "superadmin",
        "photo_url": None,
    },
    "admin": {
        "email": "admin@demo.vprep",
        "display_name": "Demo Admin",
        "role": "admin",
        "photo_url": None,
    },
    "candidate1": {
        "email": "ahmad.raza@demo.vprep",
        "display_name": "Ahmad Raza",
        "role": "candidate",
        "photo_url": None,
        "profile_complete": True,
        "normalized_level": "intermediate",
        "target_role": "ML/AI Engineer",
        "preferred_track_id": "ml_ai",
    },
    "candidate2": {
        "email": "fatima.malik@demo.vprep",
        "display_name": "Fatima Malik",
        "role": "candidate",
        "photo_url": None,
        "profile_complete": True,
        "normalized_level": "beginner",
        "target_role": "Frontend Developer",
        "preferred_track_id": "web_dev",
    },
    "candidate3": {
        "email": "usman.khan@demo.vprep",
        "display_name": "Usman Khan",
        "role": "candidate",
        "photo_url": None,
        "profile_complete": True,
        "normalized_level": "advanced",
        "target_role": "DevOps Engineer",
        "preferred_track_id": "devops",
    },
}


class DemoLoginRequest(BaseModel):
    account_key: str


class DemoLoginResponse(BaseModel):
    token: str
    user: UserResponse


def _serialize_user(user: dict) -> dict:
    """Convert a Mongo user document into an API-shaped dict (_id -> id)."""
    serialized = dict(user)
    serialized["id"] = str(serialized.pop("_id"))
    return serialized


@router.post("/sync", response_model=UserResponse)
async def sync_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Verify the caller's Firebase token and upsert their user document.

    New users are created with role="candidate"; existing users have their
    profile fields refreshed from the latest Firebase claims.
    """
    decoded_token = verify_firebase_token(credentials.credentials)

    firebase_uid = decoded_token["uid"]
    email = decoded_token.get("email", "")
    display_name = decoded_token.get("name") or email.split("@")[0]
    photo_url = decoded_token.get("picture")

    now = datetime.now(timezone.utc)

    user = await db["users"].find_one_and_update(
        {"firebase_uid": firebase_uid},
        {
            "$setOnInsert": {
                "firebase_uid": firebase_uid,
                "role": "candidate",
                "profile_complete": False,
                "created_at": now,
            },
            "$set": {
                "email": email,
                "display_name": display_name,
                "photo_url": photo_url,
                "updated_at": now,
            },
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )

    return _serialize_user(user)


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: dict = Depends(get_current_user)):
    """Return the currently authenticated user."""
    return current_user


@router.post("/promote", response_model=UserResponse)
async def promote_user(
    payload: RoleUpdate,
    current_user: dict = Depends(require_role("superadmin")),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Change another user's role. Superadmin-only; cannot target yourself."""
    if payload.target_user_id == current_user["id"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot change your own role.",
        )

    try:
        target_object_id = ObjectId(payload.target_user_id)
    except InvalidId:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Target user not found.",
        )

    now = datetime.now(timezone.utc)

    user = await db["users"].find_one_and_update(
        {"_id": target_object_id},
        {"$set": {"role": payload.role.value, "updated_at": now}},
        return_document=ReturnDocument.AFTER,
    )

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Target user not found.",
        )

    return _serialize_user(user)


# ---------------------------------------------------------------------------
# Demo login — no Firebase, no Google, testing only
# ---------------------------------------------------------------------------

@router.post("/demo-login", response_model=DemoLoginResponse)
async def demo_login(
    payload: DemoLoginRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Create or retrieve a demo user and return a locally-signed JWT.

    Idempotent: calling this twice for the same `account_key` returns the same
    MongoDB document (looked up by email) with a fresh token.  The endpoint is
    intentionally unauthenticated — it exists solely to make switching between
    test personas quick during development; it should be removed or disabled
    before a production deployment.
    """
    account = _DEMO_ACCOUNTS.get(payload.account_key)
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown demo account key '{payload.account_key}'. "
                   f"Valid keys: {', '.join(_DEMO_ACCOUNTS)}",
        )

    now = datetime.now(timezone.utc)
    firebase_uid = f"demo_{payload.account_key}"

    # Upsert — so the endpoint works even before seed_demo_data.py has been run.
    user = await db["users"].find_one_and_update(
        {"email": account["email"]},
        {
            "$setOnInsert": {
                "firebase_uid": firebase_uid,
                "role": account["role"],
                "created_at": now,
            },
            "$set": {
                "email": account["email"],
                "display_name": account["display_name"],
                "photo_url": account["photo_url"],
                "profile_complete": account.get("profile_complete", account["role"] != "candidate"),
                "normalized_level": account.get("normalized_level"),
                "target_role": account.get("target_role"),
                "preferred_track_id": account.get("preferred_track_id"),
                "updated_at": now,
            },
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )

    user_id = str(user["_id"])
    token = create_demo_token(user_id)
    serialized = _serialize_user(user)

    return DemoLoginResponse(token=token, user=UserResponse(**serialized))

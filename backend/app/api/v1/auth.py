from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ReturnDocument

from app.core.database import get_db
from app.core.dependencies import bearer_scheme, get_current_user, require_role
from app.core.security import verify_firebase_token
from app.models.user import RoleUpdate, UserResponse

router = APIRouter()


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

import math
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ReturnDocument

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_role
from app.models.user import UserResponse, UserRole, UserUpdate

router = APIRouter()


def _serialize_user(user: dict) -> dict:
    """Convert a Mongo user document into an API-shaped dict (_id -> id)."""
    serialized = dict(user)
    serialized["id"] = str(serialized.pop("_id"))
    return serialized


@router.get("/")
async def list_users(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=50),
    role: UserRole | None = Query(None),
    search: str | None = Query(None),
    _current_user: dict = Depends(require_role("admin", "superadmin")),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """List users with optional role filter and name/email search. Admin+."""
    query: dict = {}
    if role is not None:
        query["role"] = role.value
    if search:
        pattern = {"$regex": search, "$options": "i"}
        query["$or"] = [{"email": pattern}, {"display_name": pattern}]

    total = await db["users"].count_documents(query)
    pages = max(math.ceil(total / limit), 1)

    cursor = (
        db["users"]
        .find(query)
        .sort("created_at", -1)
        .skip((page - 1) * limit)
        .limit(limit)
    )
    users = [_serialize_user(user) async for user in cursor]

    return {"users": users, "total": total, "page": page, "pages": pages}


@router.get("/me", response_model=UserResponse)
async def get_my_profile(current_user: dict = Depends(get_current_user)):
    """Return the current user's own profile."""
    return current_user


@router.put("/me", response_model=UserResponse)
async def update_my_profile(
    payload: UserUpdate,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Update the current user's display name and/or photo URL."""
    updates = payload.model_dump(exclude_none=True)
    if not updates:
        return current_user

    updates["updated_at"] = datetime.now(timezone.utc)

    user = await db["users"].find_one_and_update(
        {"_id": ObjectId(current_user["id"])},
        {"$set": updates},
        return_document=ReturnDocument.AFTER,
    )

    return _serialize_user(user)


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: str,
    _current_user: dict = Depends(require_role("admin", "superadmin")),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Look up a specific user by ID. Admin+."""
    try:
        object_id = ObjectId(user_id)
    except InvalidId:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    user = await db["users"].find_one({"_id": object_id})
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    return _serialize_user(user)


@router.delete("/{user_id}")
async def delete_user(
    user_id: str,
    current_user: dict = Depends(require_role("superadmin")),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Permanently delete a user. Superadmin-only; cannot delete yourself."""
    if user_id == current_user["id"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot delete your own account.",
        )

    try:
        object_id = ObjectId(user_id)
    except InvalidId:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    result = await db["users"].delete_one({"_id": object_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    return {"message": "User deleted"}

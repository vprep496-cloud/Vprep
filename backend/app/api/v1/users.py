import math
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ReturnDocument

from app.api.v1.tracks import get_track_catalog, get_track_or_none
from app.core.database import get_db
from app.core.dependencies import get_current_user, require_role
from app.models.enrollment import SkillLevel
from app.models.user import UserResponse, UserRole, UserUpdate
from app.services import profile_service

router = APIRouter()
MAX_CV_BYTES = 8 * 1024 * 1024


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


@router.post("/me/onboarding", response_model=UserResponse)
async def complete_my_onboarding(
    self_reported_level: SkillLevel = Form(...),
    target_role: str | None = Form(None),
    preferred_track_id: str | None = Form(None),
    cv: UploadFile | None = File(None),
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Complete candidate setup with a self-level and optional AI CV extraction."""
    if preferred_track_id and await get_track_or_none(preferred_track_id, db) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown preferred_track_id.")

    cv_bytes: bytes | None = None
    cv_filename: str | None = None
    cv_mime_type: str | None = None

    if cv is not None and cv.filename:
        cv_filename = cv.filename
        cv_mime_type = profile_service.infer_cv_mime_type(cv.filename, cv.content_type)
        if cv_mime_type not in profile_service.SUPPORTED_CV_MIME_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="CV upload must be a PDF, TXT, JPG, PNG, or WEBP file.",
            )

        cv_bytes = await cv.read()
        if len(cv_bytes) > MAX_CV_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="CV file is too large. Please upload a file under 8 MB.",
            )
        if len(cv_bytes) == 0:
            cv_bytes = None

    tracks = await get_track_catalog(db)
    profile = await profile_service.build_candidate_profile(
        self_reported_level=self_reported_level.value,
        target_role=target_role,
        preferred_track_id=preferred_track_id,
        tracks=tracks,
        cv_bytes=cv_bytes,
        cv_mime_type=cv_mime_type,
        cv_filename=cv_filename,
    )

    now = datetime.now(timezone.utc)
    updates = {
        "profile_complete": True,
        "self_reported_level": self_reported_level.value,
        "normalized_level": profile["normalized_level"],
        "years_experience": profile.get("years_experience"),
        "target_role": profile.get("target_role"),
        "preferred_track_id": profile.get("preferred_track_id"),
        "cv_filename": cv_filename,
        "cv_mime_type": cv_mime_type,
        "cv_summary": profile.get("summary"),
        "profile": profile,
        "updated_at": now,
    }

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

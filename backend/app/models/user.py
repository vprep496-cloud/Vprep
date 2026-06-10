from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, EmailStr

from app.models.enrollment import SkillLevel


class UserRole(str, Enum):
    candidate = "candidate"
    admin = "admin"
    superadmin = "superadmin"


class UserCreate(BaseModel):
    firebase_uid: str
    email: EmailStr
    display_name: str
    photo_url: str | None = None


class UserResponse(BaseModel):
    id: str
    firebase_uid: str
    email: EmailStr
    display_name: str
    photo_url: str | None = None
    role: UserRole
    profile_complete: bool = False
    self_reported_level: SkillLevel | None = None
    normalized_level: SkillLevel | None = None
    years_experience: float | None = None
    target_role: str | None = None
    preferred_track_id: str | None = None
    cv_filename: str | None = None
    cv_mime_type: str | None = None
    cv_summary: str | None = None
    profile: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime


class UserUpdate(BaseModel):
    display_name: str | None = None
    photo_url: str | None = None


class RoleUpdate(BaseModel):
    target_user_id: str
    role: UserRole

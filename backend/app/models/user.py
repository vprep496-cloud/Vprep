from datetime import datetime
from enum import Enum

from pydantic import BaseModel, EmailStr


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
    created_at: datetime
    updated_at: datetime


class UserUpdate(BaseModel):
    display_name: str | None = None
    photo_url: str | None = None


class RoleUpdate(BaseModel):
    target_user_id: str
    role: UserRole

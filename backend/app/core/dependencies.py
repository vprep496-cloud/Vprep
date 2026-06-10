from bson import ObjectId
from bson.errors import InvalidId
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.database import get_db
from app.core.security import decode_demo_token, verify_firebase_token

bearer_scheme = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    """Resolve the authenticated user from either a Firebase OR demo Bearer token.

    Resolution order:
      1. Try to decode as a demo token (fast, local, no network).
         If it decodes and carries `vprep_demo=True`, look the user up by `sub` (_id).
      2. Otherwise verify with Firebase Admin SDK and look up by `firebase_uid`.

    This lets demo accounts work without any Firebase involvement while real
    production tokens continue to work exactly as before.
    """
    raw_token = credentials.credentials

    # --- demo token path ---------------------------------------------------
    demo_payload = decode_demo_token(raw_token)
    if demo_payload is not None:
        user_id = demo_payload.get("sub", "")
        try:
            obj_id = ObjectId(user_id)
        except (InvalidId, TypeError):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid demo token subject.",
            )
        user = await db["users"].find_one({"_id": obj_id})
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Demo user not found. Re-run seed_demo_data.py.",
            )
        user["id"] = str(user.pop("_id"))
        return user

    # --- Firebase token path (unchanged) -----------------------------------
    decoded_token = verify_firebase_token(raw_token)
    firebase_uid = decoded_token["uid"]

    user = await db["users"].find_one({"firebase_uid": firebase_uid})
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No account found for this user. Please sync your account first.",
        )

    user["id"] = str(user.pop("_id"))
    return user


def require_role(*roles: str):
    """Dependency factory enforcing that the current user has one of `roles`.

    Usage: Depends(require_role("admin", "superadmin"))
    """

    async def _require_role(current_user: dict = Depends(get_current_user)) -> dict:
        if current_user.get("role") not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action.",
            )
        return current_user

    return _require_role

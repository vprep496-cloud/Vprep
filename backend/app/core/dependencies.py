from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.database import get_db
from app.core.security import verify_firebase_token

bearer_scheme = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    """Resolve the authenticated user from a Firebase Bearer token.

    Verifies the token, looks the user up by firebase_uid, converts the Mongo
    ObjectId to a string "id" field, and returns the user document as a dict.
    """
    decoded_token = verify_firebase_token(credentials.credentials)
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

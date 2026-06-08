import logging

import firebase_admin
from fastapi import HTTPException, status
from firebase_admin import auth as firebase_auth
from firebase_admin import credentials
from firebase_admin.auth import ExpiredIdTokenError, InvalidIdTokenError

from app.core.config import get_settings

logger = logging.getLogger("vprep.security")


def init_firebase() -> None:
    """Initialize the Firebase Admin SDK from the configured service account file."""
    if not firebase_admin._apps:
        settings = get_settings()
        cred = credentials.Certificate(settings.FIREBASE_SERVICE_ACCOUNT_PATH)
        firebase_admin.initialize_app(cred)
        logger.info("Firebase Admin SDK initialized")


def verify_firebase_token(token: str) -> dict:
    """Verify a Firebase ID token and return its decoded claims.

    Raises HTTP 401 with a descriptive message for invalid/expired tokens or
    any other verification failure.
    """
    try:
        return firebase_auth.verify_id_token(token)
    except ExpiredIdTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Your session has expired. Please sign in again.",
        )
    except InvalidIdTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
        )
    except Exception:
        logger.exception("Unexpected error while verifying Firebase token")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not verify authentication token.",
        )

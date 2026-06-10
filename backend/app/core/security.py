import logging
from datetime import datetime, timedelta, timezone

import firebase_admin
from fastapi import HTTPException, status
from firebase_admin import auth as firebase_auth
from firebase_admin import credentials
from firebase_admin.auth import ExpiredIdTokenError, InvalidIdTokenError
from jose import JWTError, jwt

from app.core.config import get_settings

logger = logging.getLogger("vprep.security")

# ---------------------------------------------------------------------------
# Demo token helpers (local JWT — no Firebase, no Google, testing only)
# ---------------------------------------------------------------------------
_DEMO_ALGORITHM = "HS256"
_DEMO_EXPIRY_DAYS = 30  # long-lived so testers aren't interrupted
_DEMO_CLAIM = "vprep_demo"  # presence of this claim identifies a demo token


def create_demo_token(user_id: str) -> str:
    """Sign a short-lived demo JWT with SECRET_KEY.

    The token carries `vprep_demo=True` so `get_current_user` can distinguish
    it from a real Firebase token without hitting Firebase's verify endpoint.
    """
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        _DEMO_CLAIM: True,
        "iat": now,
        "exp": now + timedelta(days=_DEMO_EXPIRY_DAYS),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=_DEMO_ALGORITHM)


def decode_demo_token(token: str) -> dict | None:
    """Try to decode `token` as a demo JWT.

    Returns the decoded payload if it is a valid, unexpired demo token;
    returns None if decoding fails or the `vprep_demo` claim is absent
    (i.e. it is not a demo token — the caller should fall back to Firebase).
    """
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[_DEMO_ALGORITHM])
        if payload.get(_DEMO_CLAIM):
            return payload
        return None  # valid JWT but not a demo token
    except JWTError:
        return None


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

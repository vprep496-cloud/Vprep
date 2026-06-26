import base64
import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

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


def _safe_json_from_jwt_segment(segment: str) -> dict[str, Any] | None:
    try:
        padded = segment + ("=" * (-len(segment) % 4))
        decoded = base64.urlsafe_b64decode(padded.encode("utf-8"))
        data = json.loads(decoded.decode("utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _service_account_project_id() -> str | None:
    settings = get_settings()
    try:
        path = Path(settings.FIREBASE_SERVICE_ACCOUNT_PATH)
        with path.open("r", encoding="utf-8") as file:
            data = json.load(file)
        project_id = data.get("project_id")
        return project_id if isinstance(project_id, str) else None
    except Exception:
        return None


def _token_debug_metadata(token: str) -> dict[str, Any]:
    parts = token.split(".")
    metadata: dict[str, Any] = {
        "authorization_token_length": len(token),
        "token_looks_like_jwt": len(parts) == 3,
        "backend_firebase_project_id": _service_account_project_id(),
    }

    if len(parts) != 3:
        return metadata

    header = _safe_json_from_jwt_segment(parts[0])
    payload = _safe_json_from_jwt_segment(parts[1])

    if header:
        metadata["jwt_header_alg"] = header.get("alg")
        metadata["jwt_header_kid"] = header.get("kid")

    if payload:
        aud = payload.get("aud")
        iss = payload.get("iss")
        metadata["jwt_payload_aud"] = aud
        metadata["jwt_payload_iss"] = iss
        backend_project_id = metadata.get("backend_firebase_project_id")
        metadata["firebase_project_mismatch"] = bool(
            isinstance(aud, str)
            and isinstance(backend_project_id, str)
            and aud != backend_project_id
        )

    return metadata


def _auth_detail(reason: str) -> str:
    settings = get_settings()
    return reason if settings.is_development else "Invalid authentication token."


def _log_firebase_verification_failure(reason: str, token: str, exc: Exception) -> None:
    settings = get_settings()
    if not settings.is_development:
        return

    logger.warning(
        "[AuthDebug] Firebase token verification failed: %s",
        {
            "reason": reason,
            "exception_class": exc.__class__.__name__,
            "exception_message": str(exc),
            **_token_debug_metadata(token),
        },
    )


def verify_firebase_token(token: str) -> dict:
    """Verify a Firebase ID token and return its decoded claims.

    Raises HTTP 401 with a descriptive message for invalid/expired tokens or
    any other verification failure.
    
    Uses clock_skew_seconds=10 to tolerate up to 10 seconds of clock drift
    between the mobile device, Firebase, and backend server.
    """
    settings = get_settings()
    if settings.is_development:
        logger.info("[AuthDebug] Verifying Firebase token: %s", _token_debug_metadata(token))

    try:
        # Allow up to 10 seconds clock skew (common on mobile devices with unsynced clocks)
        decoded = firebase_auth.verify_id_token(token, clock_skew_seconds=10)
        if settings.is_development:
            logger.info(
                "[AuthDebug] Firebase token verification succeeded (clock_skew_seconds=10): %s",
                {
                    "uid_present": bool(decoded.get("uid")),
                    "aud": decoded.get("aud"),
                    "iss": decoded.get("iss"),
                    "backend_firebase_project_id": _service_account_project_id(),
                },
            )
        return decoded
    except ExpiredIdTokenError as exc:
        _log_firebase_verification_failure("expired_firebase_token", token, exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_auth_detail("expired_firebase_token"),
        )
    except InvalidIdTokenError as exc:
        metadata = _token_debug_metadata(token)
        reason = "firebase_project_mismatch" if metadata.get("firebase_project_mismatch") else "invalid_firebase_token"
        _log_firebase_verification_failure(reason, token, exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_auth_detail(reason),
        )
    except Exception as exc:
        _log_firebase_verification_failure("firebase_verification_error", token, exc)
        logger.exception("Unexpected error while verifying Firebase token")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_auth_detail("firebase_verification_error"),
        )

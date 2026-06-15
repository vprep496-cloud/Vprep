# Notification service — wraps the Expo Push Notifications API.
#
# The Expo Push API is a simple HTTPS endpoint that accepts a JSON array of
# push-notification payloads and fans them out to the device's native push
# service (APNs or FCM).  No Firebase Admin SDK / APNS certificate is required
# on the server side.
#
# Flow:
#   1. Mobile app calls `POST /api/v1/notifications/register` with the
#      Expo push token obtained from `expo-notifications`.
#   2. Backend stores the token on the user document.
#   3. Any backend service calls `send_push` (or a higher-level helper below)
#      to deliver notifications.
#
# Reference: https://docs.expo.dev/push-notifications/sending-notifications/
import logging
from typing import Any

import httpx
from motor.motor_asyncio import AsyncIOMotorDatabase

logger = logging.getLogger("vprep.notification_service")

EXPO_PUSH_API = "https://exp.host/--/api/v2/push/send"

# ---------------------------------------------------------------------------
# Low-level push delivery
# ---------------------------------------------------------------------------


async def send_push(
    tokens: list[str],
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
    sound: str = "default",
    badge: int | None = None,
    channel_id: str = "default",
) -> dict:
    """Send a push notification to one or more Expo push tokens.

    Returns the raw Expo API response dict.  Does NOT raise on individual
    token delivery failures — callers should check `.data[].status == "ok"`.
    """
    if not tokens:
        return {"data": []}

    messages = [
        {
            "to": token,
            "title": title,
            "body": body,
            "data": data or {},
            "sound": sound,
            "channelId": channel_id,
            **({"badge": badge} if badge is not None else {}),
        }
        for token in tokens
        if token and token.startswith("ExponentPushToken[")
    ]

    if not messages:
        logger.debug("send_push: no valid ExponentPushToken in token list")
        return {"data": []}

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                EXPO_PUSH_API,
                json=messages,
                headers={
                    "Accept": "application/json",
                    "Accept-Encoding": "gzip, deflate",
                    "Content-Type": "application/json",
                },
            )
        result = response.json()
        logger.info("Expo push sent to %d token(s). status=%d", len(messages), response.status_code)
        return result
    except Exception as exc:
        logger.error("Expo push API call failed: %s", exc)
        return {"data": [], "error": str(exc)}


# ---------------------------------------------------------------------------
# Token management
# ---------------------------------------------------------------------------


async def register_push_token(user_id: str, expo_push_token: str, platform: str, db: AsyncIOMotorDatabase) -> None:
    """Upsert the user's Expo push token in their user document."""
    from bson import ObjectId
    from bson.errors import InvalidId

    try:
        object_id = ObjectId(user_id)
    except (InvalidId, TypeError):
        logger.warning("register_push_token: invalid user_id=%s", user_id)
        return

    await db["users"].update_one(
        {"_id": object_id},
        {"$set": {
            "expo_push_token": expo_push_token,
            "push_platform": platform,
            "push_token_updated_at": __import__("datetime").datetime.utcnow(),
        }},
    )
    logger.info("Registered push token for user_id=%s platform=%s", user_id, platform)


async def _get_user_push_token(user_id: str, db: AsyncIOMotorDatabase) -> str | None:
    from bson import ObjectId
    from bson.errors import InvalidId

    try:
        user = await db["users"].find_one({"_id": ObjectId(user_id)}, {"expo_push_token": 1})
    except (InvalidId, TypeError):
        return None
    return (user or {}).get("expo_push_token")


# ---------------------------------------------------------------------------
# High-level notification helpers
# ---------------------------------------------------------------------------


async def send_coding_result_notification(
    user_id: str, score: int, session_id: str, db: AsyncIOMotorDatabase
) -> None:
    """Notify the user that their async coding score is ready.

    ``session_id`` is embedded in the data payload so the mobile app can
    deep-link directly to the results screen when the notification is tapped.
    """
    token = await _get_user_push_token(user_id, db)
    if not token:
        return

    if score >= 80:
        emoji = "🎉"
        sub = f"Excellent work — you scored {score}/100!"
    elif score >= 60:
        emoji = "✅"
        sub = f"Good effort — you scored {score}/100."
    else:
        emoji = "📝"
        sub = f"Your coding score is in: {score}/100. Keep practising!"

    await send_push(
        [token],
        title=f"{emoji} Coding Score Ready",
        body=sub,
        data={"type": "coding_result", "score": score, "session_id": session_id},
        channel_id="results",
    )


async def send_voice_result_notification(
    user_id: str, score: int, phase: str, session_id: str, db: AsyncIOMotorDatabase
) -> None:
    """Notify the user that their async voice answer score is ready.

    ``session_id`` is embedded in the data payload so the mobile app can
    deep-link directly to the results screen when the notification is tapped.
    """
    token = await _get_user_push_token(user_id, db)
    if not token:
        return

    phase_label = {"hr": "HR", "behavioral": "Behavioral"}.get(phase, phase.replace("_", " ").capitalize())

    if score >= 80:
        emoji = "🎉"
        sub = f"Great delivery — you scored {score}/100 on your {phase_label} answer!"
    elif score >= 60:
        emoji = "✅"
        sub = f"Good job — {phase_label} answer scored {score}/100."
    else:
        emoji = "📝"
        sub = f"Your {phase_label} answer is scored: {score}/100. Keep practising!"

    await send_push(
        [token],
        title=f"{emoji} {phase_label} Score Ready",
        body=sub,
        data={"type": "voice_result", "score": score, "phase": phase, "session_id": session_id},
        channel_id="results",
    )


async def send_daily_reminder(user_id: str, streak_days: int, db: AsyncIOMotorDatabase) -> None:
    """Daily practice reminder — called by a scheduled job."""
    token = await _get_user_push_token(user_id, db)
    if not token:
        return

    if streak_days > 0:
        title = f"🔥 {streak_days}-day streak — keep it going!"
        body = "Your next interview prep session is waiting. Tap to continue."
    else:
        title = "📅 Time for your daily prep!"
        body = "Stay sharp — practice a few interview questions today."

    await send_push(
        [token],
        title=title,
        body=body,
        data={"type": "daily_reminder", "streak_days": streak_days},
        channel_id="reminders",
    )


async def send_session_complete_notification(user_id: str, overall_score: int, mode: str, db: AsyncIOMotorDatabase) -> None:
    """Notify the user when their full session result is available."""
    token = await _get_user_push_token(user_id, db)
    if not token:
        return

    mode_label = {"hr": "HR", "technical": "Technical", "behavioral": "Behavioral", "full_mock": "Full Mock"}.get(mode, mode.capitalize())

    await send_push(
        [token],
        title=f"📊 {mode_label} Session Complete",
        body=f"Your overall score: {overall_score}/100. Tap to view detailed feedback.",
        data={"type": "session_complete", "overall_score": overall_score, "mode": mode},
        channel_id="results",
    )


async def send_milestone_notification(user_id: str, milestone: str, db: AsyncIOMotorDatabase) -> None:
    """Send a milestone achievement notification."""
    token = await _get_user_push_token(user_id, db)
    if not token:
        return

    milestones = {
        "first_session": ("🚀 First Session Complete!", "You've completed your first mock interview. Keep going!"),
        "week_streak": ("🔥 7-Day Streak!", "You've been practising every day for a week. Amazing!"),
        "perfect_score": ("⭐ Perfect Score!", "You scored 100 on a question. Outstanding!"),
        "track_complete": ("🏆 Track Complete!", "You've finished all sessions in a track. View your results!"),
    }

    title, body = milestones.get(milestone, ("🎯 Achievement Unlocked!", f"You've reached a new milestone: {milestone}"))
    await send_push(
        [token],
        title=title,
        body=body,
        data={"type": "milestone", "milestone": milestone},
        channel_id="achievements",
    )

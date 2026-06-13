# Notifications API — push token registration + preferences.
from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.session import NotificationTokenRegister
from app.services import notification_service

router = APIRouter()


@router.post("/register", status_code=status.HTTP_204_NO_CONTENT)
async def register_token(
    payload: NotificationTokenRegister,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Register (or update) the authenticated user's Expo push token.

    Called from the mobile app on app launch after the user grants
    notification permission.  Safe to call repeatedly — idempotent upsert.
    """
    if not payload.expo_push_token.startswith("ExponentPushToken["):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Expo push token format.  Expected 'ExponentPushToken[...]'.",
        )
    await notification_service.register_push_token(
        current_user["id"],
        payload.expo_push_token,
        payload.platform,
        db,
    )


@router.delete("/unregister", status_code=status.HTTP_204_NO_CONTENT)
async def unregister_token(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Remove the user's push token (e.g. on logout)."""
    from bson import ObjectId

    await db["users"].update_one(
        {"_id": ObjectId(current_user["id"])},
        {"$unset": {"expo_push_token": "", "push_platform": ""}},
    )


@router.get("/preferences")
async def get_preferences(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Fetch the user's notification preference settings."""
    from bson import ObjectId

    user = await db["users"].find_one(
        {"_id": ObjectId(current_user["id"])},
        {"notification_prefs": 1},
    )
    prefs = (user or {}).get("notification_prefs") or {}
    return {
        "daily_reminder": prefs.get("daily_reminder", True),
        "daily_reminder_hour": prefs.get("daily_reminder_hour", 18),  # 6 PM default
        "results_notifications": prefs.get("results_notifications", True),
        "milestone_notifications": prefs.get("milestone_notifications", True),
        "streak_alerts": prefs.get("streak_alerts", True),
    }


@router.put("/preferences", status_code=status.HTTP_204_NO_CONTENT)
async def update_preferences(
    daily_reminder: bool = True,
    daily_reminder_hour: int = 18,
    results_notifications: bool = True,
    milestone_notifications: bool = True,
    streak_alerts: bool = True,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Update the user's notification preferences."""
    from bson import ObjectId

    if not (0 <= daily_reminder_hour <= 23):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="daily_reminder_hour must be 0–23.")

    await db["users"].update_one(
        {"_id": ObjectId(current_user["id"])},
        {"$set": {
            "notification_prefs": {
                "daily_reminder": daily_reminder,
                "daily_reminder_hour": daily_reminder_hour,
                "results_notifications": results_notifications,
                "milestone_notifications": milestone_notifications,
                "streak_alerts": streak_alerts,
            }
        }},
    )

/**
 * Notification service — wraps Expo Push Notifications token registration
 * and sends the device token to the V-Prep backend.
 *
 * KEY: The backend speaks snake_case; all conversion happens here at the
 * service boundary so the rest of the app uses consistent camelCase.
 */
import api from "./api";

export interface NotificationPreferences {
  dailyReminder: boolean;
  dailyReminderHour: number;
  resultsNotifications: boolean;
  milestoneNotifications: boolean;
  streakAlerts: boolean;
}

/** Raw shape the backend returns from GET /notifications/preferences. */
interface BackendPreferences {
  daily_reminder: boolean;
  daily_reminder_hour: number;
  results_notifications: boolean;
  milestone_notifications: boolean;
  streak_alerts: boolean;
}

/** snake_case → camelCase */
function fromBackend(raw: BackendPreferences): NotificationPreferences {
  return {
    dailyReminder: raw.daily_reminder,
    dailyReminderHour: raw.daily_reminder_hour,
    resultsNotifications: raw.results_notifications,
    milestoneNotifications: raw.milestone_notifications,
    streakAlerts: raw.streak_alerts,
  };
}

/** camelCase → snake_case query params expected by the PUT endpoint. */
function toBackendParams(prefs: Partial<NotificationPreferences>): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (prefs.dailyReminder !== undefined) params.daily_reminder = prefs.dailyReminder;
  if (prefs.dailyReminderHour !== undefined) params.daily_reminder_hour = prefs.dailyReminderHour;
  if (prefs.resultsNotifications !== undefined) params.results_notifications = prefs.resultsNotifications;
  if (prefs.milestoneNotifications !== undefined) params.milestone_notifications = prefs.milestoneNotifications;
  if (prefs.streakAlerts !== undefined) params.streak_alerts = prefs.streakAlerts;
  return params;
}

/**
 * Register an Expo push token with the backend.  Safe to call multiple times
 * (idempotent server-side upsert).
 */
export async function registerPushToken(
  expoPushToken: string,
  platform: "ios" | "android" | "web"
): Promise<void> {
  await api.post("/api/v1/notifications/register", {
    expo_push_token: expoPushToken,
    platform,
  });
}

/** Remove the push token on logout. */
export async function unregisterPushToken(): Promise<void> {
  await api.delete("/api/v1/notifications/unregister");
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const { data } = await api.get<BackendPreferences>("/api/v1/notifications/preferences");
  return fromBackend(data);
}

export async function updateNotificationPreferences(
  prefs: Partial<NotificationPreferences>
): Promise<void> {
  await api.put("/api/v1/notifications/preferences", null, {
    params: toBackendParams(prefs),
  });
}

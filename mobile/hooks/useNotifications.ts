/**
 * useNotifications — request permissions, obtain Expo push token, register
 * with backend, schedule local daily-reminder notifications, and handle
 * notification taps with deep-links into the app.
 *
 * Usage: call this hook once near the app root (e.g. inside _layout.tsx) after
 * the user is authenticated.
 */
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import * as registerService from "../services/notification.service";

// expo-notifications removed remote push support from Expo Go in SDK 53.
// Detect Expo Go so we can skip the getExpoPushTokenAsync call that would
// log a noisy ERROR to the console even though the app still works.
const isExpoGo = Constants.appOwnership === "expo";

// Configure how notifications are handled while the app is in the foreground.
// SDK 53 renamed shouldShowAlert → shouldShowBanner + shouldShowList.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Android notification channels — set up once; safe to call repeatedly.
async function ensureAndroidChannels() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", {
    name: "General",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  await Notifications.setNotificationChannelAsync("reminders", {
    name: "Daily Reminders",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#60164B",
  });
  await Notifications.setNotificationChannelAsync("results", {
    name: "Interview Results",
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: "#60164B",
  });
  await Notifications.setNotificationChannelAsync("achievements", {
    name: "Achievements",
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: "#F59E0B",
  });
}

/** Schedule (or re-schedule) a daily local reminder at `hour:00`.
 *  Cancels any previous "daily_prep" trigger first to avoid duplicates. */
async function scheduleDailyReminder(hour: number = 18) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const notif of scheduled) {
    if ((notif.content.data as Record<string, unknown>)?.type === "daily_reminder") {
      await Notifications.cancelScheduledNotificationAsync(notif.identifier);
    }
  }

  // SDK 53+ requires an explicit `type` field on every trigger.
  // DailyTriggerInput fires once per day at the given hour:minute.
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "📅 Daily Interview Prep",
      body: "Keep your streak alive — practice a few questions today!",
      data: { type: "daily_reminder" },
      sound: "default",
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute: 0,
    } satisfies Notifications.DailyTriggerInput,
  });
}

export function useNotifications() {
  const router = useRouter();
  const listenerRef = useRef<Notifications.EventSubscription | null>(null);
  const responseListenerRef = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        // Android channels must exist before any notification fires.
        await ensureAndroidChannels();

        // Request permission.
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== "granted") {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== "granted" || !isMounted) return;

        // Obtain Expo push token (works on physical devices in production builds).
        // Skip in Expo Go — SDK 53 removed Android remote push support there and
        // calling getExpoPushTokenAsync would log a noisy ERROR.
        if (Platform.OS !== "web" && !isExpoGo) {
          const tokenData = await Notifications.getExpoPushTokenAsync({
            projectId: "c685ee8c-cb64-425a-bc94-f026fa70af9d",
          });
          const platform = Platform.OS as "ios" | "android";
          await registerService.registerPushToken(tokenData.data, platform);
        }

        // Schedule daily reminder at 6 PM (default; user can adjust in preferences).
        await scheduleDailyReminder(18);
      } catch (err) {
        // Non-fatal: notifications are a convenience feature; don't crash the app.
        if (__DEV__) console.warn("[useNotifications]", err);
      }
    })();

    // Foreground notification — show an in-app alert so it's visible even when
    // the user is actively using the app (iOS suppresses banners by default).
    listenerRef.current = Notifications.addNotificationReceivedListener((notification) => {
      if (__DEV__) console.log("[useNotifications] received:", notification.request.content.title);
    });

    // Tap handler — deep-link to the relevant screen.
    // The backend embeds `session_id` in every result notification payload so we
    // can navigate directly to the results screen without any extra lookup.
    responseListenerRef.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      if (__DEV__) console.log("[useNotifications] tapped:", data?.type, data?.session_id);

      const type = data?.type as string | undefined;
      const sessionId = data?.session_id as string | undefined;

      if (
        (type === "voice_result" || type === "coding_result") &&
        typeof sessionId === "string" &&
        sessionId.length > 0
      ) {
        // Navigate to the results screen for this session. `push` (not replace)
        // so the user can go back if they arrived from elsewhere in the app.
        router.push(`/(app)/interview/results/${sessionId}`);
      }
    });

    return () => {
      isMounted = false;
      listenerRef.current?.remove();
      responseListenerRef.current?.remove();
    };
  // router is stable (Expo Router never changes it), but including it in deps
  // satisfies the exhaustive-deps lint rule without causing extra re-runs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

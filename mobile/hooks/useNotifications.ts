import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import type * as ExpoNotifications from "expo-notifications";

// expo-notifications logs a hard ERROR at module-init time when imported in
// Expo Go (SDK 53+). A runtime guard on the import is not enough — the error
// fires before any JS runs. Using dynamic require() inside the effect ensures
// the module is never executed in Expo Go at all.
const isExpoGo = Constants.appOwnership === "expo";

export function useNotifications() {
  const router = useRouter();
  const listenerRef = useRef<{ remove(): void } | null>(null);
  const responseListenerRef = useRef<{ remove(): void } | null>(null);

  useEffect(() => {
    // Notifications are not supported in Expo Go (SDK 53+). Skip entirely so
    // expo-notifications is never required and no error appears in the console.
    if (isExpoGo) return;

    // Dynamically require so Metro never executes the module in Expo Go.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require("expo-notifications") as typeof import("expo-notifications");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const registerService = require("../services/notification.service") as typeof import("../services/notification.service");

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

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

    async function scheduleDailyReminder(hour: number = 18) {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      for (const notif of scheduled) {
        if ((notif.content.data as Record<string, unknown>)?.type === "daily_reminder") {
          await Notifications.cancelScheduledNotificationAsync(notif.identifier);
        }
      }
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Daily Interview Prep",
          body: "Keep your streak alive — practice a few questions today!",
          data: { type: "daily_reminder" },
          sound: "default",
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour,
          minute: 0,
        } satisfies ExpoNotifications.DailyTriggerInput,
      });
    }

    let isMounted = true;

    (async () => {
      try {
        await ensureAndroidChannels();

        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== "granted") {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== "granted" || !isMounted) return;

        if (Platform.OS !== "web") {
          const tokenData = await Notifications.getExpoPushTokenAsync({
            projectId: "c685ee8c-cb64-425a-bc94-f026fa70af9d",
          });
          const platform = Platform.OS as "ios" | "android";
          await registerService.registerPushToken(tokenData.data, platform);
        }

        await scheduleDailyReminder(18);
      } catch (err) {
        if (__DEV__) console.warn("[useNotifications]", err);
      }
    })();

    listenerRef.current = Notifications.addNotificationReceivedListener((notification) => {
      if (__DEV__) console.log("[useNotifications] received:", notification.request.content.title);
    });

    responseListenerRef.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      if (__DEV__) console.log("[useNotifications] tapped:", data?.type, data?.session_id);

      const type = data?.type as string | undefined;
      const sessionId = data?.session_id as string | undefined;

      if (
        (type === "voice_result" || type === "coding_result" || type === "technical_result") &&
        typeof sessionId === "string" &&
        sessionId.length > 0
      ) {
        router.push(`/(app)/interview/results/${sessionId}`);
      }
    });

    return () => {
      isMounted = false;
      listenerRef.current?.remove();
      responseListenerRef.current?.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

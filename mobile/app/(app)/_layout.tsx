import { Platform, StyleSheet, View } from "react-native";
import { Tabs } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors } from "../../constants/theme";
import { useTokenRefresh } from "../../hooks/useTokenRefresh";
import { useNotifications } from "../../hooks/useNotifications";

type IoniconName = keyof typeof Ionicons.glyphMap;

// ─── Tab icon with a soft pill highlight behind the active icon ───────────────
function TabIcon({
  outline,
  filled,
  focused,
  color,
  size,
}: {
  outline: IoniconName;
  filled: IoniconName;
  focused: boolean;
  color: string;
  size: number;
}) {
  return (
    <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
      <Ionicons name={focused ? filled : outline} size={size} color={color} />
    </View>
  );
}

function tabIcon(outline: IoniconName, filled: IoniconName) {
  return ({ focused, color, size }: { focused: boolean; color: string; size: number }) => (
    <TabIcon outline={outline} filled={filled} focused={focused} color={color} size={size} />
  );
}

export default function AppLayout() {
  // Keep the Firebase ID token fresh for the lifetime of the authenticated shell.
  useTokenRefresh();
  // Register push token + schedule daily reminders (non-blocking, permission-gated).
  useNotifications();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary[500],
        tabBarInactiveTintColor: "#9B8B94",
        tabBarLabelStyle: {
          fontFamily: "Montserrat_600SemiBold",
          fontSize: 10,
          marginTop: 2,
        },
        tabBarStyle: styles.tabBar,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: tabIcon("home-outline", "home"),
        }}
      />
      <Tabs.Screen
        name="tracks"
        options={{
          title: "Tracks",
          tabBarIcon: tabIcon("grid-outline", "grid"),
        }}
      />
      <Tabs.Screen
        name="interview/index"
        options={{
          title: "Interview",
          tabBarIcon: tabIcon("mic-outline", "mic"),
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: "Results",
          tabBarIcon: tabIcon("stats-chart-outline", "stats-chart"),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: tabIcon("person-outline", "person"),
        }}
      />

      {/* ── Non-tab screens — hidden from the tab bar ─────────── */}
      <Tabs.Screen
        name="notifications"
        options={{
          href: null,
          headerShown: false,
          tabBarStyle: { display: "none" },
        }}
      />
      <Tabs.Screen
        name="plan/[trackId]"
        options={{
          href: null,
          headerShown: false,
          tabBarStyle: { display: "none" },
        }}
      />
      <Tabs.Screen
        name="interview/session"
        options={{
          href: null,
          headerShown: true,
          headerTitle: "Interview",
          headerTitleStyle: {
            color: colors.text.inverse,
            fontFamily: "Montserrat_700Bold",
          },
          headerStyle: { backgroundColor: colors.primary[500] },
          headerTintColor: colors.text.inverse,
          headerShadowVisible: false,
          tabBarStyle: { display: "none" },
        }}
      />
      <Tabs.Screen
        name="interview/results/[sessionId]"
        options={{
          href: null,
          headerShown: false,
          tabBarStyle: { display: "none" },
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: "#FFFFFF",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E8D8E0",
    height: Platform.OS === "ios" ? 82 : 68,
    paddingTop: 6,
    paddingBottom: Platform.OS === "ios" ? 22 : 8,
    // Upward shadow so the bar feels elevated above content
    shadowColor: colors.primary[500],
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 12,
  },
  iconWrap: {
    width: 44,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
  },
  // Soft primary-tinted pill behind the active icon
  iconWrapActive: {
    backgroundColor: `${colors.primary[500]}18`,
  },
});

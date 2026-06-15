import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Toast from "react-native-toast-message";
import AnimatedView from "../../components/ui/AnimatedView";
import { colors, shadows } from "../../constants/theme";
import { tapHaptic } from "../../lib/haptics";
import * as notificationService from "../../services/notification.service";
import type { NotificationPreferences } from "../../services/notification.service";

// ─── Hour picker (simple +/– control) ────────────────────────────────────────
function HourPicker({ value, onChange }: { value: number; onChange: (h: number) => void }) {
  const label = `${value === 0 ? 12 : value > 12 ? value - 12 : value}:00 ${value < 12 ? "AM" : "PM"}`;
  return (
    <View style={hpStyles.row}>
      <TouchableOpacity
        style={hpStyles.btn}
        onPress={() => { tapHaptic(); onChange(value === 0 ? 23 : value - 1); }}
        hitSlop={8}
      >
        <Ionicons name="remove" size={18} color={colors.primary[500]} />
      </TouchableOpacity>
      <Text style={hpStyles.label}>{label}</Text>
      <TouchableOpacity
        style={hpStyles.btn}
        onPress={() => { tapHaptic(); onChange(value === 23 ? 0 : value + 1); }}
        hitSlop={8}
      >
        <Ionicons name="add" size={18} color={colors.primary[500]} />
      </TouchableOpacity>
    </View>
  );
}

const hpStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 0 },
  btn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: `${colors.primary[500]}12`,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontSize: 14, fontWeight: "700", color: colors.text.primary, minWidth: 80, textAlign: "center" },
});

// ─── Notification preview card ────────────────────────────────────────────────
function NotifPreview({
  icon,
  title,
  body,
  tint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  tint: string;
}) {
  return (
    <View style={[npStyles.card, { borderLeftColor: tint }]}>
      <View style={[npStyles.iconWrap, { backgroundColor: `${tint}18` }]}>
        <Ionicons name={icon} size={16} color={tint} />
      </View>
      <View style={npStyles.text}>
        <Text style={npStyles.title}>{title}</Text>
        <Text style={npStyles.body}>{body}</Text>
      </View>
    </View>
  );
}

const npStyles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FAFAFA",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#EDE4E9",
    borderLeftWidth: 3,
    padding: 10,
    marginBottom: 8,
  },
  iconWrap: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  text: { flex: 1 },
  title: { fontSize: 12, fontWeight: "700", color: colors.text.primary },
  body: { fontSize: 11, color: colors.text.muted, marginTop: 1, lineHeight: 15 },
});

// ─── Toggle row ────────────────────────────────────────────────────────────────
function ToggleRow({
  icon,
  tint,
  label,
  description,
  value,
  onToggle,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  label: string;
  description: string;
  value: boolean;
  onToggle: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={trStyles.row}>
      <View style={[trStyles.iconWrap, { backgroundColor: `${tint}15` }]}>
        <Ionicons name={icon} size={18} color={tint} />
      </View>
      <View style={trStyles.text}>
        <Text style={trStyles.label}>{label}</Text>
        <Text style={trStyles.desc}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={(v) => { tapHaptic(); onToggle(v); }}
        disabled={disabled}
        trackColor={{ false: "#D1D5DB", true: `${colors.primary[500]}66` }}
        thumbColor={value ? colors.primary[500] : "#9CA3AF"}
        ios_backgroundColor="#D1D5DB"
      />
    </View>
  );
}

const trStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#EDE4E9",
  },
  iconWrap: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  text: { flex: 1 },
  label: { fontSize: 14, fontWeight: "600", color: colors.text.primary },
  desc: { fontSize: 12, color: colors.text.muted, marginTop: 1, lineHeight: 17 },
});

const DEFAULT_PREFS: NotificationPreferences = {
  dailyReminder: true,
  dailyReminderHour: 18,
  resultsNotifications: true,
  milestoneNotifications: true,
  streakAlerts: true,
};

// ─── Main screen ───────────────────────────────────────────────────────────────
export default function NotificationsScreen() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_PREFS);
  const [hasChanges, setHasChanges] = useState(false);
  // Track original prefs so we can detect "no actual change" and offer reset
  const originalPrefs = useRef<NotificationPreferences>(DEFAULT_PREFS);

  // ── Load preferences ─────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const serverPrefs = await notificationService.getNotificationPreferences();
        if (mounted) {
          setPrefs(serverPrefs);
          originalPrefs.current = serverPrefs;
        }
      } catch {
        // Use defaults silently — backend may not have prefs yet
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const updatePref = useCallback(<K extends keyof NotificationPreferences>(
    key: K,
    value: NotificationPreferences[K]
  ) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    setHasChanges(true);
  }, []);

  // ── Save preferences ─────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      await notificationService.updateNotificationPreferences(prefs);
      originalPrefs.current = prefs;
      setHasChanges(false);
      tapHaptic();
      Toast.show({ type: "success", text1: "Saved", text2: "Your notification preferences have been updated." });
    } catch {
      Toast.show({ type: "error", text1: "Couldn't save", text2: "Please check your connection and try again." });
    } finally {
      setSaving(false);
    }
  };

  // ── Discard changes ───────────────────────────────────────────────────────
  const handleDiscard = () => {
    setPrefs(originalPrefs.current);
    setHasChanges(false);
    tapHaptic();
    Toast.show({ type: "info", text1: "Changes discarded", text2: "Preferences reset to last saved state." });
  };

  // ── Reset to defaults ─────────────────────────────────────────────────────
  const handleResetDefaults = () => {
    Alert.alert(
      "Reset to Defaults",
      "This will restore all notification settings to their default values. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            setPrefs(DEFAULT_PREFS);
            setHasChanges(true);
            tapHaptic();
          },
        },
      ]
    );
  };

  // ── Three-dots options menu ───────────────────────────────────────────────
  const handleOptionsMenu = () => {
    tapHaptic();
    const options: { text: string; style?: "cancel" | "destructive"; onPress?: () => void }[] = [
      {
        text: "Discard Changes",
        onPress: handleDiscard,
      },
      {
        text: "Reset to Defaults",
        style: "destructive",
        onPress: handleResetDefaults,
      },
      { text: "Cancel", style: "cancel" },
    ];
    Alert.alert("Options", undefined, options);
  };

  return (
    <View style={styles.flex}>
      {/* Header */}
      <LinearGradient
        colors={[colors.primary[600], colors.primary[500]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <SafeAreaView edges={["top"]}>
          <View style={styles.headerBar}>
            {/* Exit / back */}
            <TouchableOpacity
              onPress={() => { tapHaptic(); router.back(); }}
              style={styles.iconBtn}
              hitSlop={10}
            >
              <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
            </TouchableOpacity>

            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle}>Notifications</Text>
              <Text style={styles.headerSub}>Stay on top of your prep</Text>
            </View>

            {/* Right actions */}
            <View style={styles.headerRight}>
              {hasChanges ? (
                <TouchableOpacity
                  onPress={handleSave}
                  style={styles.saveBtn}
                  disabled={saving}
                  hitSlop={8}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.saveBtnText}>Save</Text>
                  )}
                </TouchableOpacity>
              ) : null}
              {/* Three-dots menu */}
              <TouchableOpacity
                onPress={handleOptionsMenu}
                style={styles.iconBtn}
                hitSlop={10}
              >
                <Ionicons name="ellipsis-vertical" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <SafeAreaView style={styles.flex} edges={["bottom", "left", "right"]}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={colors.primary[500]} />
              <Text style={styles.loadingText}>Loading preferences…</Text>
            </View>
          ) : (
            <>
              {/* ── Permission status banner ─────────────────────────── */}
              <AnimatedView
                from={{ opacity: 0, translateY: -8 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: "timing", duration: 300 }}
                style={[
                  styles.permissionBanner,
                  Platform.OS === "web" && styles.permissionBannerInfo,
                ]}
              >
                <View style={styles.permissionIconWrap}>
                  <Ionicons
                    name={Platform.OS === "web" ? "globe-outline" : "notifications"}
                    size={22}
                    color={Platform.OS === "web" ? colors.secondary : colors.primary[500]}
                  />
                </View>
                <View style={styles.permissionText}>
                  <Text style={styles.permissionTitle}>
                    {Platform.OS === "web" ? "Mobile Push Available" : "Push Notifications Active"}
                  </Text>
                  <Text style={styles.permissionDesc}>
                    {Platform.OS === "web"
                      ? "Download the V-Prep app to get instant push alerts on your device."
                      : "V-Prep can send you alerts on your device. Manage below."}
                  </Text>
                </View>
                {Platform.OS !== "web" ? (
                  <View style={styles.permissionDot} />
                ) : (
                  <Ionicons name="phone-portrait-outline" size={18} color={colors.secondary} />
                )}
              </AnimatedView>

              {/* ── Daily Reminder ───────────────────────────────────── */}
              <AnimatedView
                from={{ opacity: 0, translateY: 10 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: "timing", duration: 300, delay: 50 }}
                style={styles.section}
              >
                <View style={styles.sectionHeader}>
                  <Ionicons name="calendar-outline" size={15} color={colors.primary[500]} />
                  <Text style={styles.sectionTitle}>Daily Practice Reminder</Text>
                </View>

                <ToggleRow
                  icon="alarm-outline"
                  tint={colors.primary[500]}
                  label="Daily Reminder"
                  description="Get reminded to practise every day to build a streak"
                  value={prefs.dailyReminder}
                  onToggle={(v) => updatePref("dailyReminder", v)}
                />

                {prefs.dailyReminder && (
                  <View style={styles.subRow}>
                    <View style={styles.subRowLeft}>
                      <Ionicons name="time-outline" size={16} color={colors.text.muted} />
                      <View>
                        <Text style={styles.subRowLabel}>Reminder Time</Text>
                        <Text style={styles.subRowDesc}>Daily notification at this time</Text>
                      </View>
                    </View>
                    <HourPicker
                      value={prefs.dailyReminderHour}
                      onChange={(h) => updatePref("dailyReminderHour", h)}
                    />
                  </View>
                )}

                {/* What it looks like */}
                <View style={styles.previewBlock}>
                  <Text style={styles.previewLabel}>Preview</Text>
                  <NotifPreview
                    icon="calendar-outline"
                    tint={colors.primary[500]}
                    title="📅 Daily Interview Prep"
                    body="Keep your streak alive — practice a few questions today!"
                  />
                  <NotifPreview
                    icon="flame-outline"
                    tint="#F59E0B"
                    title="🔥 7-Day Streak — keep it going!"
                    body="You've been practising every day for a week. Amazing!"
                  />
                </View>
              </AnimatedView>

              {/* ── Results & Scoring ────────────────────────────────── */}
              <AnimatedView
                from={{ opacity: 0, translateY: 10 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: "timing", duration: 300, delay: 100 }}
                style={styles.section}
              >
                <View style={styles.sectionHeader}>
                  <Ionicons name="bar-chart-outline" size={15} color={colors.success} />
                  <Text style={styles.sectionTitle}>Results &amp; Scoring</Text>
                </View>

                <ToggleRow
                  icon="checkmark-circle-outline"
                  tint={colors.success}
                  label="Interview Results"
                  description="Notified when your session results and AI feedback are ready"
                  value={prefs.resultsNotifications}
                  onToggle={(v) => updatePref("resultsNotifications", v)}
                />

                <ToggleRow
                  icon="code-slash-outline"
                  tint={colors.primary[500]}
                  label="Coding Score Ready"
                  description="Alert when async OCR scoring completes for your handwritten code"
                  value={prefs.resultsNotifications}
                  onToggle={(v) => updatePref("resultsNotifications", v)}
                />

                <View style={styles.previewBlock}>
                  <Text style={styles.previewLabel}>Preview</Text>
                  <NotifPreview
                    icon="trophy-outline"
                    tint={colors.success}
                    title="📊 Full Mock Session Complete"
                    body="Your overall score: 82/100. Tap to view detailed feedback."
                  />
                  <NotifPreview
                    icon="code-slash-outline"
                    tint={colors.primary[500]}
                    title="🎉 Coding Score Ready"
                    body="Excellent work — you scored 88/100!"
                  />
                </View>
              </AnimatedView>

              {/* ── Achievements & Streaks ───────────────────────────── */}
              <AnimatedView
                from={{ opacity: 0, translateY: 10 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: "timing", duration: 300, delay: 150 }}
                style={styles.section}
              >
                <View style={styles.sectionHeader}>
                  <Ionicons name="star-outline" size={15} color="#F59E0B" />
                  <Text style={styles.sectionTitle}>Achievements &amp; Streaks</Text>
                </View>

                <ToggleRow
                  icon="trophy-outline"
                  tint="#F59E0B"
                  label="Milestone Achievements"
                  description="First session, perfect score, track completion and more"
                  value={prefs.milestoneNotifications}
                  onToggle={(v) => updatePref("milestoneNotifications", v)}
                />

                <ToggleRow
                  icon="flame-outline"
                  tint="#EF4444"
                  label="Streak Alerts"
                  description="Warnings when your daily streak is at risk"
                  value={prefs.streakAlerts}
                  onToggle={(v) => updatePref("streakAlerts", v)}
                />

                <View style={styles.previewBlock}>
                  <Text style={styles.previewLabel}>Preview</Text>
                  <NotifPreview
                    icon="rocket-outline"
                    tint="#F59E0B"
                    title="🚀 First Session Complete!"
                    body="You've completed your first mock interview. Keep going!"
                  />
                  <NotifPreview
                    icon="star-outline"
                    tint="#F59E0B"
                    title="⭐ Perfect Score!"
                    body="You scored 100 on a question. Outstanding!"
                  />
                </View>
              </AnimatedView>

              {/* ── Save button (also in header) ─────────────────────── */}
              {hasChanges && (
                <AnimatedView
                  from={{ opacity: 0, translateY: 8 }}
                  animate={{ opacity: 1, translateY: 0 }}
                  transition={{ type: "timing", duration: 220 }}
                  style={styles.saveBanner}
                >
                  <View style={styles.saveBannerInner}>
                    <Ionicons name="save-outline" size={16} color={colors.primary[500]} />
                    <Text style={styles.saveBannerText}>You have unsaved changes</Text>
                    <TouchableOpacity
                      onPress={handleSave}
                      disabled={saving}
                      style={styles.saveBannerBtn}
                      activeOpacity={0.85}
                    >
                      {saving ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={styles.saveBannerBtnText}>Save</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </AnimatedView>
              )}

              {/* ── Info footer ──────────────────────────────────────── */}
              <View style={styles.footer}>
                <Ionicons name="information-circle-outline" size={14} color={colors.text.muted} />
                <Text style={styles.footerText}>
                  V-Prep uses Expo Push Notifications to deliver alerts.{"\n"}
                  Notifications are always opt-in and you can disable them here or in your device settings at any time.
                </Text>
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#F7F2F5" },
  // Header
  headerBar: {
    height: 64,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 12,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 18, fontWeight: "800", color: "#FFFFFF" },
  headerSub: { fontSize: 11, color: "rgba(255,255,255,0.72)", marginTop: 1 },
  saveBtn: {
    width: 48,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: { fontSize: 13, fontWeight: "700", color: "#FFFFFF" },
  // Loading
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80 },
  loadingText: { marginTop: 12, fontSize: 14, color: colors.text.muted },
  // Scroll
  scrollContent: { padding: 16, paddingBottom: 40, gap: 12 },
  // Permission banner
  permissionBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: `${colors.primary[500]}10`,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: `${colors.primary[500]}30`,
    padding: 14,
  },
  // Web variant — uses secondary/indigo tint
  permissionBannerInfo: {
    backgroundColor: `${colors.secondary}10`,
    borderColor: `${colors.secondary}30`,
  },
  permissionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: `${colors.primary[500]}18`,
    alignItems: "center",
    justifyContent: "center",
  },
  permissionText: { flex: 1 },
  permissionTitle: { fontSize: 14, fontWeight: "700", color: colors.primary[500] },
  permissionDesc: { fontSize: 12, color: colors.text.muted, marginTop: 2, lineHeight: 17 },
  permissionDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.success,
  },
  // Section
  section: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#EDE4E9",
    padding: 16,
    ...shadows.card,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 4,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#EDE4E9",
  },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: colors.text.secondary, textTransform: "uppercase", letterSpacing: 0.5 },
  // Sub-row (time picker)
  subRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#EDE4E9",
  },
  subRowLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  subRowLabel: { fontSize: 14, fontWeight: "600", color: colors.text.primary },
  subRowDesc: { fontSize: 11, color: colors.text.muted, marginTop: 1 },
  // Preview
  previewBlock: {
    marginTop: 14,
    backgroundColor: "#F9F5F7",
    borderRadius: 10,
    padding: 12,
  },
  previewLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.text.muted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  // Save banner (bottom sticky)
  saveBanner: {
    borderRadius: 14,
    overflow: "hidden",
  },
  saveBannerInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: `${colors.primary[500]}10`,
    borderWidth: 1.5,
    borderColor: `${colors.primary[500]}40`,
    borderRadius: 14,
    padding: 14,
  },
  saveBannerText: { flex: 1, fontSize: 13, fontWeight: "600", color: colors.primary[500] },
  saveBannerBtn: {
    backgroundColor: colors.primary[500],
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minWidth: 60,
    alignItems: "center",
  },
  saveBannerBtnText: { fontSize: 13, fontWeight: "700", color: "#FFFFFF" },
  // Footer
  footer: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  footerText: { flex: 1, fontSize: 11, color: colors.text.muted, lineHeight: 17 },
});

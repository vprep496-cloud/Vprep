import { useCallback, useMemo, useState } from "react";
import {
  Dimensions,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

import AnimatedView from "../../components/ui/AnimatedView";
import VPrepLogo from "../../components/ui/VPrepLogo";
import { useAuthStore } from "../../stores/auth.store";
import { useAppStore } from "../../stores/app.store";
import { getEnrollments } from "../../services/enrollment.service";
import type { Enrollment, InterviewMode } from "../../types";
import { colors, shadows, trackColors } from "../../constants/theme";
import { tapHaptic } from "../../lib/haptics";

// On web the window can be desktop-width; cap cards at a sensible mobile size.
const SCREEN_WIDTH = Math.min(Dimensions.get("window").width, 480);
const CARD_WIDTH = (SCREEN_WIDTH - 48) / 2; // 16px side padding × 2 + 16px gap

type IoniconName = keyof typeof Ionicons.glyphMap;

// ─── Track icon catalogue ─────────────────────────────────────────────────────
const TRACK_META: Record<string, { icon: IoniconName }> = {
  ml_ai:        { icon: "sparkles-outline"      },
  web_dev:      { icon: "code-slash-outline"    },
  devops:       { icon: "git-network-outline"   },
  data_science: { icon: "analytics-outline"     },
  cloud:        { icon: "cloud-outline"         },
  mobile_dev:   { icon: "phone-portrait-outline"},
};

// ─── Practice modes (2 × 2 grid) ─────────────────────────────────────────────
const PRACTICE_MODES: Array<{
  mode: InterviewMode;
  label: string;
  sublabel: string;
  icon: IoniconName;
  tint: string;
}> = [
  { mode: "hr",         label: "HR Interview", sublabel: "Voice & tone",    icon: "mic-outline",             tint: colors.cranberry    },
  { mode: "technical",  label: "Technical",    sublabel: "Code & concepts", icon: "code-slash-outline",      tint: colors.primary[500] },
  { mode: "behavioral", label: "Behavioral",   sublabel: "STAR method",     icon: "chatbox-ellipses-outline", tint: colors.success     },
  { mode: "full_mock",  label: "Full Mock",    sublabel: "All phases",      icon: "trophy-outline",           tint: "#7A6A9E"          },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function completionPct(e: Enrollment): number {
  return Math.min(100, Math.round((e.currentDay / e.track.totalDays) * 100));
}

// ─── Practice mode tile (2-column grid) ──────────────────────────────────────
function ModeTile({
  item,
  onPress,
}: {
  item: (typeof PRACTICE_MODES)[number];
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.82}
      onPress={onPress}
      style={[styles.modeTile, { width: CARD_WIDTH }]}
    >
      {/* Icon badge */}
      <View style={[styles.modeIcon, { backgroundColor: `${item.tint}22` }]}>
        <Ionicons name={item.icon} size={20} color={item.tint} />
      </View>
      <Text style={styles.modeLabel}>{item.label}</Text>
      <Text style={styles.modeSub}>{item.sublabel}</Text>
      {/* "Start →" link */}
      <View style={styles.modeStart}>
        <Text style={[styles.modeStartText, { color: item.tint }]}>Start</Text>
        <Ionicons name="arrow-forward" size={11} color={item.tint} />
      </View>
    </TouchableOpacity>
  );
}

// ─── Enrolled track card (horizontal scroll) ──────────────────────────────────
function TrackCard({ enrollment }: { enrollment: Enrollment }) {
  const router = useRouter();
  const pct  = completionPct(enrollment);
  const tint = trackColors[enrollment.trackId] ?? colors.primary[500];
  const icon = TRACK_META[enrollment.trackId]?.icon ?? ("sparkles-outline" as IoniconName);

  return (
    <TouchableOpacity
      activeOpacity={0.84}
      onPress={() => { tapHaptic(); router.push(`/(app)/plan/${enrollment.trackId}`); }}
      style={styles.trackCard}
    >
      <View style={styles.trackCardHeader}>
        <View style={[styles.trackIcon, { backgroundColor: `${tint}22` }]}>
          <Ionicons name={icon} size={15} color={tint} />
        </View>
        <Text style={styles.trackName} numberOfLines={1}>{enrollment.track.name}</Text>
      </View>

      {/* Progress bar */}
      <View style={styles.progressBg}>
        <View style={[styles.progressFill, { width: `${pct}%` as `${number}%`, backgroundColor: tint }]} />
      </View>
      <Text style={styles.progressLabel}>
        {pct}% · Day {enrollment.currentDay}/{enrollment.track.totalDays}
      </Text>

      {enrollment.targetRole ? (
        <View style={[styles.roleBadge, { backgroundColor: `${tint}18` }]}>
          <Text style={[styles.roleText, { color: tint }]} numberOfLines={1}>
            {enrollment.targetRole}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const router       = useRouter();
  const user         = useAuthStore((s) => s.user);
  const enrollments  = useAppStore((s) => s.enrollments);
  const setEnrollments = useAppStore((s) => s.setEnrollments);
  const [refreshing, setRefreshing] = useState(false);

  const firstName = user?.displayName?.split(" ")[0] ?? "Candidate";

  const sortedEnrollments = useMemo(
    () => [...enrollments].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    ),
    [enrollments]
  );

  const mostRecentEnrollment = sortedEnrollments[0] ?? null;
  const mostRecentTrackId    = mostRecentEnrollment?.trackId;

  // Hero stats
  const totalSessions = enrollments.reduce((s, e) => s + e.totalSessions, 0);
  const avgScore = enrollments.length > 0
    ? Math.round(enrollments.reduce((s, e) => s + e.averageScore, 0) / enrollments.length)
    : 0;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { setEnrollments(await getEnrollments()); }
    catch { /* network toast handled globally in api.ts */ }
    finally { setRefreshing(false); }
  }, [setEnrollments]);

  const startMode = (mode: InterviewMode) => {
    tapHaptic();
    router.push({
      pathname: "/(app)/interview",
      params: { mode, ...(mostRecentTrackId ? { trackId: mostRecentTrackId } : {}) },
    });
  };

  return (
    <View style={styles.root}>

      {/* ══════════════════════════════════════════════════════════
          HERO — gradient header with greeting + stats chips
      ══════════════════════════════════════════════════════════ */}
      <LinearGradient
        colors={[colors.primary[600], colors.primary[500]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <SafeAreaView edges={["top", "left", "right"]}>
          <View style={styles.heroInner}>

            {/* Top bar: logo · notification bell · avatar */}
            <View style={styles.heroTopBar}>
              <View style={styles.logoRow}>
                <VPrepLogo size={32} />
                <Text style={styles.logoText}>V-PREP</Text>
              </View>
              <View style={styles.heroActions}>
                <TouchableOpacity
                  style={styles.heroBtn}
                  onPress={() => { tapHaptic(); router.push("/(app)/notifications"); }}
                  hitSlop={8}
                >
                  <Ionicons name="notifications-outline" size={18} color="rgba(255,255,255,0.85)" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.heroBtn}
                  onPress={() => { tapHaptic(); router.push("/(app)/profile"); }}
                  hitSlop={8}
                >
                  <Ionicons name="person-circle-outline" size={20} color="rgba(255,255,255,0.85)" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Greeting */}
            <Text style={styles.greetingSub}>{getGreeting()}</Text>
            <Text style={styles.greetingName}>{firstName} 👋</Text>
            <Text style={styles.greetingTagline}>
              {enrollments.length > 0
                ? "Keep up the momentum — you're doing great."
                : "Start your interview prep journey today."}
            </Text>

            {/* Stats strip */}
            <View style={styles.statsRow}>
              {([
                { label: "Sessions",  value: String(totalSessions),              icon: "mic-outline"    as IoniconName },
                { label: "Avg Score", value: avgScore > 0 ? `${avgScore}%` : "—", icon: "star-outline"  as IoniconName },
                { label: "Tracks",    value: String(enrollments.length),          icon: "grid-outline"  as IoniconName },
              ] as const).map((stat) => (
                <View key={stat.label} style={styles.statChip}>
                  <Ionicons name={stat.icon} size={13} color={colors.cranberry} />
                  <View>
                    <Text style={styles.statValue}>{stat.value}</Text>
                    <Text style={styles.statLabel}>{stat.label}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* ══════════════════════════════════════════════════════════
          BODY — scrollable content
      ══════════════════════════════════════════════════════════ */}
      <SafeAreaView style={styles.body} edges={["left", "right"]}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary[500]}
              colors={[colors.primary[500]]}
            />
          }
        >

          {/* ── Jump back in / Get started card ─────────────── */}
          <AnimatedView
            from={{ opacity: 0, translateY: 14 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: "timing", duration: 320 }}
          >
            {mostRecentEnrollment ? (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => { tapHaptic(); router.push(`/(app)/plan/${mostRecentEnrollment.trackId}`); }}
                style={[styles.ctaCard, shadows.lift]}
              >
                <LinearGradient
                  colors={[
                    trackColors[mostRecentEnrollment.trackId] ?? colors.primary[500],
                    `${trackColors[mostRecentEnrollment.trackId] ?? colors.primary[500]}CC`,
                  ]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.ctaGradient}
                >
                  <View style={styles.ctaContent}>
                    <Text style={styles.ctaEyebrow}>Continue where you left off</Text>
                    <Text style={styles.ctaTitle} numberOfLines={1}>
                      {mostRecentEnrollment.track.name}
                    </Text>
                    <Text style={styles.ctaSub}>
                      Day {mostRecentEnrollment.currentDay} of {mostRecentEnrollment.track.totalDays}
                      {mostRecentEnrollment.targetRole ? `  ·  ${mostRecentEnrollment.targetRole}` : ""}
                    </Text>
                    {/* Progress bar */}
                    <View style={styles.ctaProgressBg}>
                      <View style={[styles.ctaProgressFill, { width: `${completionPct(mostRecentEnrollment)}%` as `${number}%` }]} />
                    </View>
                    <Text style={styles.ctaProgressLabel}>
                      {completionPct(mostRecentEnrollment)}% complete
                    </Text>
                  </View>
                  <View style={styles.ctaIconWrap}>
                    <Ionicons
                      name={TRACK_META[mostRecentEnrollment.trackId]?.icon ?? "sparkles-outline"}
                      size={22}
                      color="#fff"
                    />
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => { tapHaptic(); router.push("/(app)/tracks"); }}
                style={[styles.ctaCard, shadows.lift]}
              >
                <LinearGradient
                  colors={[colors.primary[500], colors.secondary]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.ctaGradient, styles.ctaGradientRow]}
                >
                  <View style={styles.ctaContent}>
                    <Text style={styles.ctaEyebrow}>Get started</Text>
                    <Text style={styles.ctaTitle}>Pick Your Track</Text>
                    <Text style={styles.ctaSub}>
                      Take an assessment and build your personalized plan.
                    </Text>
                  </View>
                  <View style={styles.ctaIconWrap}>
                    <Ionicons name="arrow-forward" size={22} color="#fff" />
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            )}
          </AnimatedView>

          {/* ── Practice modes: 2 × 2 grid ──────────────────── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Practice Modes</Text>
              <TouchableOpacity onPress={() => { tapHaptic(); router.push("/(app)/interview"); }} hitSlop={10}>
                <Text style={styles.sectionLink}>See all</Text>
              </TouchableOpacity>
            </View>

            {/* Row 1 */}
            <View style={styles.modeRow}>
              {PRACTICE_MODES.slice(0, 2).map((item, i) => (
                <AnimatedView
                  key={item.mode}
                  from={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "timing", duration: 280, delay: i * 55 }}
                >
                  <ModeTile item={item} onPress={() => startMode(item.mode)} />
                </AnimatedView>
              ))}
            </View>
            {/* Row 2 */}
            <View style={[styles.modeRow, { marginTop: 12 }]}>
              {PRACTICE_MODES.slice(2, 4).map((item, i) => (
                <AnimatedView
                  key={item.mode}
                  from={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "timing", duration: 280, delay: (i + 2) * 55 }}
                >
                  <ModeTile item={item} onPress={() => startMode(item.mode)} />
                </AnimatedView>
              ))}
            </View>
          </View>

          {/* ── Quick access shortcuts ───────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Quick Access</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.shortcutsScroll}
            >
              {([
                { label: "Assessment", icon: "checkmark-circle-outline" as IoniconName, route: "/(app)/tracks",   tint: colors.primary[500] },
                { label: "My Tracks",  icon: "grid-outline"              as IoniconName, route: "/(app)/tracks",   tint: colors.success      },
                { label: "Progress",   icon: "stats-chart-outline"       as IoniconName, route: "/(app)/progress", tint: "#7A6A9E"            },
                { label: "Profile",    icon: "person-outline"            as IoniconName, route: "/(app)/profile",  tint: colors.cranberry    },
              ] as const).map((item) => (
                <TouchableOpacity
                  key={item.label}
                  activeOpacity={0.8}
                  onPress={() => { tapHaptic(); router.push(item.route as Parameters<typeof router.push>[0]); }}
                  style={[styles.shortcut, shadows.card]}
                >
                  <View style={[styles.shortcutIcon, { backgroundColor: `${item.tint}18` }]}>
                    <Ionicons name={item.icon} size={19} color={item.tint} />
                  </View>
                  <Text style={styles.shortcutLabel}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* ── Enrolled tracks (horizontal scroll) ─────────── */}
          {sortedEnrollments.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>My Tracks</Text>
                <TouchableOpacity onPress={() => { tapHaptic(); router.push("/(app)/tracks"); }} hitSlop={10}>
                  <Text style={styles.sectionLink}>Manage</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tracksScroll}
              >
                {sortedEnrollments.map((enrollment, index) => (
                  <AnimatedView
                    key={enrollment.id}
                    from={{ opacity: 0, translateX: 20 }}
                    animate={{ opacity: 1, translateX: 0 }}
                    transition={{ type: "timing", duration: 300, delay: index * 60 }}
                  >
                    <TrackCard enrollment={enrollment} />
                  </AnimatedView>
                ))}

                {/* "Add track" chip */}
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => { tapHaptic(); router.push("/(app)/tracks"); }}
                  style={styles.addTrackChip}
                >
                  <View style={styles.addTrackIcon}>
                    <Ionicons name="add" size={18} color={colors.primary[500]} />
                  </View>
                  <Text style={styles.addTrackLabel}>Add{"\n"}Track</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          )}

          {/* ── Daily Tip ────────────────────────────────────── */}
          <AnimatedView
            from={{ opacity: 0, translateY: 16 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: "timing", duration: 360, delay: 220 }}
          >
            <View style={[styles.tipCard, shadows.card]}>
              <LinearGradient
                colors={["#FFF8F2", "#FAF0E4"]}
                style={styles.tipGradient}
              >
                <View style={styles.tipIconWrap}>
                  <Ionicons name="bulb-outline" size={19} color={colors.cranberry} />
                </View>
                <View style={styles.tipBody}>
                  <Text style={styles.tipEyebrow}>Daily Tip</Text>
                  <Text style={styles.tipText}>
                    Use the STAR method for behavioral questions: Situation, Task, Action, Result.
                  </Text>
                  <Text style={styles.tipSub}>
                    This structure keeps your answers clear and memorable for interviewers.
                  </Text>
                </View>
              </LinearGradient>
            </View>
          </AnimatedView>

          {/* ── "Build Your Prep Path" CTA (only when no enrollments) ── */}
          {enrollments.length === 0 && (
            <AnimatedView
              from={{ opacity: 0, translateY: 16 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: "timing", duration: 320, delay: 280 }}
            >
              <View style={[styles.buildCard, shadows.lift]}>
                <Text style={styles.buildTitle}>Build Your Prep Path</Text>
                <Text style={styles.buildBody}>
                  Start with a personalized assessment, enroll in a track, then practice with
                  questions matched to your level and target role.
                </Text>
                <TouchableOpacity
                  onPress={() => { tapHaptic(); router.push("/(app)/tracks"); }}
                  activeOpacity={0.86}
                  style={styles.buildBtn}
                >
                  <Text style={styles.buildBtnText}>Browse Tracks</Text>
                </TouchableOpacity>
              </View>
            </AnimatedView>
          )}

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#FFF8F2" },

  // Hero
  heroInner:    { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20 },
  heroTopBar:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  logoRow:      { flexDirection: "row", alignItems: "center", gap: 8 },
  logoText:     { color: "rgba(255,255,255,0.9)", fontSize: 13, fontFamily: "Montserrat_700Bold", letterSpacing: 2 },
  heroActions:  { flexDirection: "row", alignItems: "center", gap: 8 },
  heroBtn:      { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" },
  greetingSub:  { color: "rgba(255,255,255,0.65)", fontSize: 13, fontFamily: "Montserrat_500Medium" },
  greetingName: { color: "#FFFFFF", fontSize: 28, fontFamily: "Montserrat_700Bold", marginTop: 2 },
  greetingTagline: { color: "rgba(255,255,255,0.65)", fontSize: 13, fontFamily: "Montserrat_400Regular", marginTop: 4 },
  statsRow:     { flexDirection: "row", marginTop: 16, gap: 8 },
  statChip:     { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  statValue:    { color: "#FFFFFF", fontSize: 16, fontFamily: "Montserrat_700Bold", lineHeight: 18 },
  statLabel:    { color: "rgba(255,255,255,0.6)", fontSize: 10, fontFamily: "Montserrat_400Regular", marginTop: 1 },

  // Body
  body:         { flex: 1 },
  scroll:       { flex: 1 },
  scrollContent: { paddingBottom: 40 },

  // CTA card (continue / get started)
  ctaCard:      { marginHorizontal: 16, marginTop: 16, borderRadius: 20, overflow: "hidden" },
  ctaGradient:  { padding: 20 },
  ctaGradientRow: { flexDirection: "row", alignItems: "center" },
  ctaContent:   { flex: 1, paddingRight: 12 },
  ctaEyebrow:   { color: "rgba(255,255,255,0.65)", fontSize: 10, fontFamily: "Montserrat_700Bold", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4 },
  ctaTitle:     { color: "#FFFFFF", fontSize: 20, fontFamily: "Montserrat_700Bold" },
  ctaSub:       { color: "rgba(255,255,255,0.75)", fontSize: 13, fontFamily: "Montserrat_400Regular", marginTop: 2 },
  ctaProgressBg:   { height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.22)", marginTop: 12, overflow: "hidden" },
  ctaProgressFill: { height: "100%", borderRadius: 3, backgroundColor: "#FFFFFF" },
  ctaProgressLabel: { color: "rgba(255,255,255,0.55)", fontSize: 10, fontFamily: "Montserrat_400Regular", marginTop: 4 },
  ctaIconWrap:  { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.18)" },

  // Section
  section:      { marginTop: 24, paddingHorizontal: 16 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sectionTitle: { fontSize: 17, fontFamily: "Montserrat_700Bold", color: "#1E1B17" },
  sectionLink:  { fontSize: 13, fontFamily: "Montserrat_600SemiBold", color: colors.primary[500] },

  // Mode tiles
  modeRow:      { flexDirection: "row", gap: 12 },
  modeTile:     {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E8D8E0",
    backgroundColor: "#FFFFFF",
    padding: 16,
    ...(Platform.OS !== "web" ? shadows.card : undefined),
  },
  modeIcon:     { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  modeLabel:    { fontSize: 15, fontFamily: "Montserrat_700Bold", color: "#1E1B17" },
  modeSub:      { fontSize: 11, fontFamily: "Montserrat_400Regular", color: "#84727B", marginTop: 2 },
  modeStart:    { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 12 },
  modeStartText: { fontSize: 12, fontFamily: "Montserrat_600SemiBold" },

  // Quick-access shortcuts
  shortcutsScroll: { gap: 10, paddingRight: 4 },
  shortcut:     { alignItems: "center", borderRadius: 16, borderWidth: 1, borderColor: "#E8D8E0", backgroundColor: "#FFFFFF", paddingHorizontal: 16, paddingVertical: 12, minWidth: 80 },
  shortcutIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  shortcutLabel: { fontSize: 11, fontFamily: "Montserrat_600SemiBold", color: "#51434A", textAlign: "center" },

  // Track cards
  tracksScroll: { paddingRight: 4, gap: 0 },
  trackCard:    { width: 160, marginRight: 12, borderRadius: 16, borderWidth: 1, borderColor: "#E8D8E0", backgroundColor: "#FFFFFF", padding: 16, ...(Platform.OS !== "web" ? shadows.card : undefined) },
  trackCardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  trackIcon:    { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  trackName:    { flex: 1, fontSize: 13, fontFamily: "Montserrat_700Bold", color: "#1E1B17" },
  progressBg:   { height: 6, borderRadius: 3, backgroundColor: "#F4EDE5", overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3 },
  progressLabel: { fontSize: 10, fontFamily: "Montserrat_400Regular", color: "#84727B", marginTop: 4 },
  roleBadge:    { marginTop: 8, alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  roleText:     { fontSize: 10, fontFamily: "Montserrat_600SemiBold" },

  // Add track chip
  addTrackChip: { width: 100, marginRight: 12, borderRadius: 16, borderWidth: 1.5, borderColor: `${colors.primary[500]}40`, backgroundColor: `${colors.primary[500]}08`, alignItems: "center", justifyContent: "center", padding: 16 },
  addTrackIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: `${colors.primary[500]}18`, marginBottom: 8 },
  addTrackLabel: { fontSize: 12, fontFamily: "Montserrat_600SemiBold", color: colors.primary[500], textAlign: "center" },

  // Daily tip
  tipCard:      { marginHorizontal: 16, marginTop: 24, borderRadius: 20, overflow: "hidden" },
  tipGradient:  { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 16 },
  tipIconWrap:  { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: `${colors.cranberry}22` },
  tipBody:      { flex: 1 },
  tipEyebrow:   { fontSize: 10, fontFamily: "Montserrat_700Bold", color: "#84727B", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4 },
  tipText:      { fontSize: 13, fontFamily: "Montserrat_600SemiBold", color: "#1E1B17" },
  tipSub:       { fontSize: 12, fontFamily: "Montserrat_400Regular", color: "#84727B", marginTop: 4 },

  // Build your path CTA
  buildCard:    { marginHorizontal: 16, marginTop: 16, borderRadius: 20, backgroundColor: colors.primary[500], padding: 24 },
  buildTitle:   { fontSize: 22, fontFamily: "Montserrat_700Bold", color: "#FFFFFF" },
  buildBody:    { fontSize: 13, fontFamily: "Montserrat_400Regular", color: "rgba(255,255,255,0.75)", marginTop: 8, lineHeight: 20 },
  buildBtn:     { marginTop: 20, alignSelf: "flex-start", borderRadius: 999, backgroundColor: colors.cranberry, paddingHorizontal: 28, paddingVertical: 12 },
  buildBtnText: { fontSize: 14, fontFamily: "Montserrat_700Bold", color: colors.primary[700] },
});

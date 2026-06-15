import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import AnimatedView from "../../../components/ui/AnimatedView";
import BrandedHeader from "../../../components/ui/BrandedHeader";

import EmptyState from "../../../components/ui/EmptyState";
import Skeleton from "../../../components/ui/Skeleton";
import * as enrollmentService from "../../../services/enrollment.service";
import type { Enrollment, InterviewMode, SessionIntensity, TrackId } from "../../../types";
import { colors, radius, trackColors } from "../../../constants/theme";
import { tapHaptic } from "../../../lib/haptics";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MODES: Array<{
  id: InterviewMode;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}> = [
  {
    id: "hr",
    label: "HR Screening",
    description: "Warm-up soft-skills & motivation questions",
    icon: "people-outline",
    color: colors.cranberry,
  },
  {
    id: "technical",
    label: "Technical + Coding",
    description: "Concepts, problem-solving & handwritten logic",
    icon: "code-slash-outline",
    color: colors.primary[500],
  },
  {
    id: "behavioral",
    label: "Behavioral",
    description: "STAR-method situational scenarios",
    icon: "git-branch-outline",
    color: colors.success,
  },
  {
    id: "full_mock",
    label: "Full Mock",
    description: "Complete HR → Technical → Coding → Behavioral",
    icon: "rocket-outline",
    color: colors.secondary,
  },
];

interface IntensityOption {
  id: SessionIntensity;
  label: string;
  tagline: string;
  timeRange: string;
  icon: keyof typeof Ionicons.glyphMap;
  multiplier: string;
}

const INTENSITIES: IntensityOption[] = [
  {
    id: "quick",
    label: "Quick",
    tagline: "Half the questions — focused warmup",
    timeRange: "~10 min",
    icon: "flash-outline",
    multiplier: "50%",
  },
  {
    id: "standard",
    label: "Standard",
    tagline: "Balanced depth — the recommended way to prep",
    timeRange: "~25 min",
    icon: "speedometer-outline",
    multiplier: "100%",
  },
  {
    id: "deep",
    label: "Deep",
    tagline: "Extra questions — push your limits",
    timeRange: "~45 min",
    icon: "barbell-outline",
    multiplier: "150%",
  },
];

const ENROLLED_QUERY_KEY = ["tracks", "enrolled"];

export default function InterviewLauncherScreen() {
  const router = useRouter();
  const { trackId: presetTrackId, mode: presetMode } = useLocalSearchParams<{
    trackId?: TrackId;
    mode?: InterviewMode;
  }>();

  const enrolledQuery = useQuery<Enrollment[]>({
    queryKey: ENROLLED_QUERY_KEY,
    queryFn: enrollmentService.getEnrollments,
  });
  const enrollments = (enrolledQuery.data ?? []) as Enrollment[];

  const [selectedTrackId, setSelectedTrackId] = useState<TrackId | null>(presetTrackId ?? null);
  const [selectedMode, setSelectedMode] = useState<InterviewMode>(presetMode ?? "full_mock");
  const [selectedIntensity, setSelectedIntensity] = useState<SessionIntensity>("standard");

  useEffect(() => {
    if (enrollments.length === 0) return;
    setSelectedTrackId((current) => {
      if (current && enrollments.some((e) => e.trackId === current)) return current;
      return enrollments[0].trackId;
    });
  }, [enrollments]);

  const selectedEnrollment = useMemo(
    () => enrollments.find((e) => e.trackId === selectedTrackId) ?? null,
    [enrollments, selectedTrackId]
  );

  const handleSelectTrack = (id: TrackId) => {
    tapHaptic();
    setSelectedTrackId(id);
  };
  const handleSelectMode = (id: InterviewMode) => {
    tapHaptic();
    setSelectedMode(id);
  };
  const handleSelectIntensity = (id: SessionIntensity) => {
    tapHaptic();
    setSelectedIntensity(id);
  };
  const handleStart = () => {
    if (!selectedTrackId) return;
    tapHaptic();
    router.push({
      pathname: "/(app)/interview/session",
      params: { trackId: selectedTrackId, mode: selectedMode, intensity: selectedIntensity },
    });
  };

  if (enrolledQuery.isLoading) {
    return (
      <SafeAreaView style={styles.flex} edges={["bottom", "left", "right"]}>
        <View style={styles.skeletonPad}>
          <Skeleton width="60%" height={26} />
          <Skeleton width="85%" height={14} style={{ marginTop: 10 }} />
          <Skeleton width={120} height={12} style={{ marginTop: 28, marginBottom: 12 }} />
          <View style={styles.skeletonRow}>
            <Skeleton width={110} height={40} borderRadius={radius.full} />
            <Skeleton width={110} height={40} borderRadius={radius.full} />
          </View>
          <Skeleton width={120} height={12} style={{ marginTop: 28, marginBottom: 12 }} />
          <View style={styles.skeletonGrid}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} width="48%" height={144} borderRadius={radius.lg} />
            ))}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (enrollments.length === 0) {
    return (
      <View style={styles.flex}>
        <BrandedHeader
          title="Interview"
          subtitle="Choose a track first"
          rightIcon2="notifications-outline"
          onRightPress2={() => router.push("/(app)/notifications")}
        />
        <SafeAreaView style={styles.flex} edges={["bottom", "left", "right"]}>
          <EmptyState
            icon="mic-off-outline"
            title="Enroll in a track first"
            message="Mock interviews are tailored to your enrolled tracks — complete an assessment and enroll to unlock them."
            actionLabel="Browse Tracks"
            onAction={() => router.push("/(app)/tracks")}
          />
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <BrandedHeader
        title="Interview"
        subtitle="AI-scored practice rounds"
        rightIcon2="notifications-outline"
        onRightPress2={() => router.push("/(app)/notifications")}
      />
      <SafeAreaView style={styles.flex} edges={["bottom", "left", "right"]}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <AnimatedView
            from={{ opacity: 0, translateY: -10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: "timing", duration: 350 }}
          >
            <Text style={styles.heading}>Build your interview set</Text>
            <Text style={styles.subheading}>
              Pick a track, mode, and intensity. Local AI scores your responses by section.
            </Text>
          </AnimatedView>

          {/* ── Track selector ──────────────────────────────────────────── */}
          <Text style={styles.sectionLabel}>Choose a track</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pillRow}
          >
            {enrollments.map((enrollment) => {
              const isSelected = enrollment.trackId === selectedTrackId;
              const accent = trackColors[enrollment.trackId] ?? enrollment.track.color ?? colors.primary[500];
              return (
                <TouchableOpacity
                  key={enrollment.trackId}
                  onPress={() => handleSelectTrack(enrollment.trackId)}
                  activeOpacity={0.85}
                  style={[
                    styles.trackPill,
                    {
                      backgroundColor: isSelected ? `${accent}18` : colors.background.card,
                      borderColor: isSelected ? accent : colors.borderSoft,
                    },
                  ]}
                >
                  <View style={[styles.trackDot, { backgroundColor: accent }]} />
                  <Text style={[styles.trackPillText, { color: isSelected ? accent : colors.text.secondary }]}>
                    {enrollment.track.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {selectedEnrollment ? (
            <Text style={styles.trackMeta}>
              Day {selectedEnrollment.currentDay} · {selectedEnrollment.totalSessions} session
              {selectedEnrollment.totalSessions === 1 ? "" : "s"} completed
            </Text>
          ) : null}

          {/* ── Mode grid ──────────────────────────────────────────────── */}
          <Text style={styles.sectionLabel}>Choose a mode</Text>
          <View style={styles.modeGrid}>
            {MODES.map((mode, index) => {
              const isSelected = mode.id === selectedMode;
              return (
                <AnimatedView
                  key={mode.id}
                  from={{ opacity: 0, translateY: 12 }}
                  animate={{ opacity: 1, translateY: 0 }}
                  transition={{ type: "timing", duration: 280, delay: index * 50 }}
                  style={styles.modeCardWrap}
                >
                  <TouchableOpacity
                    onPress={() => handleSelectMode(mode.id)}
                    activeOpacity={0.85}
                    style={[
                      styles.modeCard,
                      {
                        backgroundColor: isSelected ? `${mode.color}14` : colors.background.card,
                        borderColor: isSelected ? mode.color : colors.borderSoft,
                      },
                    ]}
                  >
                    {isSelected && (
                      <View style={[styles.modeSelectedDot, { backgroundColor: mode.color }]} />
                    )}
                    <View style={[styles.modeIconWrap, { backgroundColor: `${mode.color}20` }]}>
                      <Ionicons name={mode.icon} size={20} color={mode.color} />
                    </View>
                    <Text style={styles.modeLabel}>{mode.label}</Text>
                    <Text style={styles.modeDesc}>{mode.description}</Text>
                  </TouchableOpacity>
                </AnimatedView>
              );
            })}
          </View>

          {/* ── Intensity selector ─────────────────────────────────────── */}
          <Text style={styles.sectionLabel}>Choose an intensity</Text>
          <View style={styles.intensityList}>
            {INTENSITIES.map((opt) => {
              const isSelected = opt.id === selectedIntensity;
              return (
                <TouchableOpacity
                  key={opt.id}
                  onPress={() => handleSelectIntensity(opt.id)}
                  activeOpacity={0.85}
                  style={[
                    styles.intensityCard,
                    {
                      backgroundColor: isSelected ? `${colors.primary[500]}10` : colors.background.card,
                      borderColor: isSelected ? colors.primary[500] : colors.borderSoft,
                    },
                  ]}
                >
                  <View style={[styles.intensityIconWrap, { backgroundColor: isSelected ? `${colors.primary[500]}20` : "#F3EDF0" }]}>
                    <Ionicons name={opt.icon} size={18} color={isSelected ? colors.primary[500] : colors.text.muted} />
                  </View>
                  <View style={styles.intensityText}>
                    <View style={styles.intensityTitleRow}>
                      <Text style={[styles.intensityLabel, isSelected && { color: colors.primary[500] }]}>
                        {opt.label}
                      </Text>
                      <View style={[
                        styles.intensityTimeBadge,
                        { backgroundColor: isSelected ? `${colors.primary[500]}18` : "#EDE4E9" },
                      ]}>
                        <Text style={[styles.intensityTimeText, isSelected && { color: colors.primary[500] }]}>
                          {opt.timeRange}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.intensityTagline}>{opt.tagline}</Text>
                  </View>
                  {isSelected ? (
                    <Ionicons name="checkmark-circle" size={20} color={colors.primary[500]} />
                  ) : (
                    <Ionicons name="chevron-forward" size={16} color={colors.text.muted} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>

        {/* ── Start button ──────────────────────────────────────────────── */}
        <View style={styles.footer}>
          <TouchableOpacity
            onPress={handleStart}
            disabled={!selectedTrackId}
            activeOpacity={0.85}
            style={[styles.startBtn, !selectedTrackId && styles.startBtnDisabled]}
          >
            <Ionicons name="play" size={18} color="#FFFFFF" />
            <Text style={styles.startBtnText}>Start Interview</Text>
            <View style={styles.startBtnBadge}>
              <Text style={styles.startBtnBadgeText}>
                {INTENSITIES.find((i) => i.id === selectedIntensity)?.timeRange ?? ""}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background.DEFAULT },
  skeletonPad: { paddingHorizontal: 20, paddingTop: 16 },
  skeletonRow: { flexDirection: "row", gap: 8 },
  skeletonGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24 },
  heading: { fontSize: 26, fontWeight: "800", color: colors.text.primary, marginBottom: 6 },
  subheading: { fontSize: 14, color: colors.text.secondary, lineHeight: 21, marginBottom: 4 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.text.muted,
    textTransform: "uppercase",
    letterSpacing: 0.7,
    marginTop: 24,
    marginBottom: 12,
  },
  // Track pills
  pillRow: { gap: 8 },
  trackPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 100,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1.5,
  },
  trackDot: { width: 8, height: 8, borderRadius: 4 },
  trackPillText: { fontSize: 13, fontWeight: "600" },
  trackMeta: { fontSize: 12, color: colors.text.muted, marginTop: 8 },
  // Mode grid
  modeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  modeCardWrap: { width: "48%" },
  modeCard: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 14,
    minHeight: 140,
    position: "relative",
  },
  modeSelectedDot: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  modeIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  modeLabel: { fontSize: 14, fontWeight: "700", color: colors.text.primary, marginBottom: 4 },
  modeDesc: { fontSize: 11, color: colors.text.muted, lineHeight: 16 },
  // Intensity
  intensityList: { gap: 10 },
  intensityCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
  },
  intensityIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  intensityText: { flex: 1 },
  intensityTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 3 },
  intensityLabel: { fontSize: 15, fontWeight: "700", color: colors.text.primary },
  intensityTimeBadge: {
    borderRadius: 100,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  intensityTimeText: { fontSize: 11, fontWeight: "600", color: colors.text.muted },
  intensityTagline: { fontSize: 12, color: colors.text.muted, lineHeight: 17 },
  // Footer
  footer: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSoft,
    backgroundColor: colors.background.DEFAULT,
  },
  startBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 100,
    paddingVertical: 15,
    backgroundColor: colors.primary[500],
  },
  startBtnDisabled: { opacity: 0.5 },
  startBtnText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  startBtnBadge: {
    backgroundColor: "rgba(255,255,255,0.22)",
    borderRadius: 100,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 4,
  },
  startBtnBadgeText: { color: "#FFFFFF", fontSize: 11, fontWeight: "600" },
});

/**
 * TrackManagementSheet
 *
 * Professional bottom-sheet modal for per-track management actions.
 * Replaces the bare `Alert.alert` menu that previously lived on the plan screen.
 *
 * Sections:
 *  1. Stats bar  — Day / Avg Score / Sessions / Days Enrolled (from live enrollment data)
 *  2. Settings   — Change Target Role · Change Skill Level · View Assessment
 *  3. Maintenance — Reset Progress (keeps enrollment + history)
 *  4. Danger zone — Unenroll from Track (destructive)
 *
 * Design contract:
 *  - All spacing via StyleSheet.create (no `gap` on Views with .map children)
 *  - Colors from `constants/theme`
 *  - Haptic feedback on every tap
 *  - Alert.alert for destructive confirmations; Toast for success/error
 */

import { useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Toast from "react-native-toast-message";

import * as enrollmentService from "../../services/enrollment.service";
import type { Enrollment, SkillLevel, TrackId } from "../../types";
import { colors } from "../../constants/theme";
import { errorHaptic, successHaptic, tapHaptic } from "../../lib/haptics";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKILL_LEVELS: { value: SkillLevel; label: string; description: string; color: string }[] = [
  {
    value: "beginner",
    label: "Beginner",
    description: "Foundational concepts & guided questions",
    color: "#34D399",
  },
  {
    value: "intermediate",
    label: "Intermediate",
    description: "Applied knowledge & system design",
    color: "#FBBF24",
  },
  {
    value: "advanced",
    label: "Advanced",
    description: "Expert depth & open-ended problems",
    color: "#F87171",
  },
];

const SKILL_COLOR: Record<SkillLevel, string> = {
  beginner: "#34D399",
  intermediate: "#FBBF24",
  advanced: "#F87171",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TrackManagementSheetProps {
  visible: boolean;
  onClose: () => void;
  trackId: TrackId;
  trackName: string;
  enrollment: Enrollment | undefined;
  onEnrollmentUpdated: (updated: Enrollment) => void;
  onUnenrolled: () => void;
  onOpenRolePicker: () => void;
  onViewAssessment: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatScore(score: number): string {
  if (!score || score === 0) return "–";
  return `${Math.round(score)}%`;
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

function daysSince(isoDate: string | undefined): number {
  if (!isoDate) return 0;
  const ms = Date.now() - new Date(isoDate).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface StatPillProps {
  icon: string;
  label: string;
  value: string;
}

function StatPill({ icon, label, value }: StatPillProps) {
  return (
    <View style={s.statPill}>
      <Ionicons name={icon as any} size={16} color={colors.primary[400]} />
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

interface ActionRowProps {
  icon: string;
  iconColor?: string;
  label: string;
  sublabel?: string;
  rightText?: string;
  rightColor?: string;
  onPress: () => void;
  loading?: boolean;
  destructive?: boolean;
  isLast?: boolean;
}

function ActionRow({
  icon,
  iconColor,
  label,
  sublabel,
  rightText,
  rightColor,
  onPress,
  loading,
  destructive,
  isLast,
}: ActionRowProps) {
  const rowColor = destructive ? "#F87171" : iconColor ?? colors.primary[400];
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[s.actionRow, !isLast && s.actionRowBorder]}
    >
      <View style={[s.actionIcon, { backgroundColor: `${rowColor}1A` }]}>
        <Ionicons name={icon as any} size={18} color={rowColor} />
      </View>
      <View style={s.actionText}>
        <Text style={[s.actionLabel, destructive && { color: "#F87171" }]}>{label}</Text>
        {sublabel ? <Text style={s.actionSublabel}>{sublabel}</Text> : null}
      </View>
      {loading ? (
        <Ionicons name="sync-outline" size={16} color={colors.text.muted} />
      ) : rightText ? (
        <Text style={[s.actionRight, { color: rightColor ?? colors.text.muted }]}>{rightText}</Text>
      ) : (
        <Ionicons
          name={destructive ? "chevron-forward" : "chevron-forward"}
          size={14}
          color={destructive ? "#F87171" : colors.text.muted}
        />
      )}
    </TouchableOpacity>
  );
}

interface SectionHeaderProps {
  title: string;
}

function SectionHeader({ title }: SectionHeaderProps) {
  return <Text style={s.sectionHeader}>{title}</Text>;
}

// ---------------------------------------------------------------------------
// Skill-level picker (inline sub-sheet)
// ---------------------------------------------------------------------------

interface SkillPickerProps {
  current: SkillLevel;
  onSelect: (level: SkillLevel) => void;
  onCancel: () => void;
  saving: boolean;
}

function SkillPicker({ current, onSelect, onCancel, saving }: SkillPickerProps) {
  return (
    <View style={s.skillPicker}>
      <View style={s.skillPickerHeader}>
        <Text style={s.skillPickerTitle}>Adjust Skill Level</Text>
        <TouchableOpacity onPress={onCancel} hitSlop={10}>
          <Ionicons name="close" size={20} color={colors.text.muted} />
        </TouchableOpacity>
      </View>
      <Text style={s.skillPickerSubtitle}>
        This changes question difficulty immediately. Your assessment history is preserved.
      </Text>
      {SKILL_LEVELS.map((level) => {
        const isSelected = level.value === current;
        return (
          <TouchableOpacity
            key={level.value}
            onPress={() => {
              if (!saving) {
                tapHaptic();
                onSelect(level.value);
              }
            }}
            activeOpacity={0.7}
            style={[
              s.skillOption,
              isSelected && { borderColor: level.color, backgroundColor: `${level.color}14` },
            ]}
          >
            <View style={[s.skillDot, { backgroundColor: level.color }]} />
            <View style={s.skillOptionText}>
              <Text style={[s.skillOptionLabel, isSelected && { color: level.color }]}>
                {level.label}
              </Text>
              <Text style={s.skillOptionDesc}>{level.description}</Text>
            </View>
            {isSelected ? (
              <Ionicons name="checkmark-circle" size={20} color={level.color} />
            ) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main sheet
// ---------------------------------------------------------------------------

export default function TrackManagementSheet({
  visible,
  onClose,
  trackId,
  trackName,
  enrollment,
  onEnrollmentUpdated,
  onUnenrolled,
  onOpenRolePicker,
  onViewAssessment,
}: TrackManagementSheetProps) {
  const [showSkillPicker, setShowSkillPicker] = useState(false);
  const [savingSkill, setSavingSkill] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [unenrolling, setUnenrolling] = useState(false);

  // ---- stats from live enrollment (no extra API call needed) ----
  const currentDay = enrollment?.currentDay ?? 1;
  const avgScore = enrollment?.averageScore ?? 0;
  const totalSessions = enrollment?.totalSessions ?? 0;
  const daysEnrolled = daysSince(enrollment?.startDate);
  const skillLevel: SkillLevel = enrollment?.skillLevel ?? "beginner";
  const completedTopics = enrollment?.completedTopics?.length ?? 0;
  const targetRole = enrollment?.targetRole ?? "Not set";

  // ---- skill level change ----
  const handleSelectSkillLevel = async (level: SkillLevel) => {
    if (level === skillLevel) {
      setShowSkillPicker(false);
      return;
    }
    setSavingSkill(true);
    try {
      const updated = await enrollmentService.updateSkillLevel(trackId, level);
      onEnrollmentUpdated(updated);
      setShowSkillPicker(false);
      successHaptic();
      Toast.show({
        type: "success",
        text1: "Skill level updated",
        text2: `Questions will now target ${level} difficulty.`,
      });
    } catch (err) {
      console.error("[TrackManagementSheet] updateSkillLevel failed:", err);
      errorHaptic();
      Toast.show({ type: "error", text1: "Couldn't update skill level", text2: "Please try again." });
    } finally {
      setSavingSkill(false);
    }
  };

  // ---- reset progress ----
  const handleResetProgress = () => {
    tapHaptic();
    Alert.alert(
      "Reset Progress?",
      `This will restart Day 1 and clear your score history for ${trackName}.\n\nYour completed sessions will remain visible in the Progress tab.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            setResetting(true);
            try {
              const updated = await enrollmentService.resetProgress(trackId);
              onEnrollmentUpdated(updated);
              successHaptic();
              Toast.show({
                type: "success",
                text1: "Progress reset",
                text2: `${trackName} restarted from Day 1.`,
              });
            } catch (err) {
              console.error("[TrackManagementSheet] resetProgress failed:", err);
              errorHaptic();
              Toast.show({
                type: "error",
                text1: "Reset failed",
                text2: "Please try again.",
              });
            } finally {
              setResetting(false);
            }
          },
        },
      ]
    );
  };

  // ---- unenroll ----
  const handleUnenroll = () => {
    tapHaptic();
    Alert.alert(
      "Unenroll from Track?",
      `You'll be removed from ${trackName}. Your progress and plan will be deleted, but your session history is preserved.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unenroll",
          style: "destructive",
          onPress: async () => {
            setUnenrolling(true);
            try {
              await enrollmentService.unenroll(trackId);
              onClose();
              onUnenrolled();
            } catch (err) {
              console.error("[TrackManagementSheet] unenroll failed:", err);
              errorHaptic();
              Toast.show({
                type: "error",
                text1: "Couldn't unenroll",
                text2: "Please try again.",
              });
            } finally {
              setUnenrolling(false);
            }
          },
        },
      ]
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent={Platform.OS === "android"}
    >
      {/* Backdrop */}
      <Pressable style={s.backdrop} onPress={onClose} />

      {/* Sheet */}
      <View style={s.sheet}>
        {/* Drag handle */}
        <View style={s.handleBar} />

        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.headerTitle}>Manage Track</Text>
            <Text style={s.headerSub} numberOfLines={1}>{trackName}</Text>
          </View>
          <TouchableOpacity
            onPress={() => { tapHaptic(); onClose(); }}
            hitSlop={12}
            style={s.closeBtn}
          >
            <Ionicons name="close" size={18} color={colors.text.muted} />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
          {/* ── Stats row ── */}
          <View style={s.statsRow}>
            <StatPill icon="calendar-outline" label="Day" value={String(currentDay)} />
            <View style={s.statDivider} />
            <StatPill icon="star-outline" label="Avg Score" value={formatScore(avgScore)} />
            <View style={s.statDivider} />
            <StatPill icon="trophy-outline" label="Sessions" value={String(totalSessions)} />
            <View style={s.statDivider} />
            <StatPill icon="time-outline" label="Enrolled" value={`${daysEnrolled}d`} />
          </View>

          {/* ── Skill level badge ── */}
          <View style={s.skillBadgeRow}>
            <View style={[s.skillBadge, { backgroundColor: `${SKILL_COLOR[skillLevel]}22` }]}>
              <View style={[s.skillBadgeDot, { backgroundColor: SKILL_COLOR[skillLevel] }]} />
              <Text style={[s.skillBadgeText, { color: SKILL_COLOR[skillLevel] }]}>
                {skillLevel.charAt(0).toUpperCase() + skillLevel.slice(1)}
              </Text>
            </View>
            <Text style={s.topicsText}>
              {completedTopics} topic{completedTopics !== 1 ? "s" : ""} completed
            </Text>
          </View>

          {/* ── Skill picker (inline) ── */}
          {showSkillPicker ? (
            <SkillPicker
              current={skillLevel}
              onSelect={handleSelectSkillLevel}
              onCancel={() => setShowSkillPicker(false)}
              saving={savingSkill}
            />
          ) : null}

          {/* ── Track Settings ── */}
          <SectionHeader title="TRACK SETTINGS" />
          <View style={s.card}>
            <ActionRow
              icon="briefcase-outline"
              label="Target Role"
              sublabel="Tune questions to your goal"
              rightText={targetRole.length > 22 ? targetRole.slice(0, 22) + "…" : targetRole}
              rightColor={enrollment?.roleConfirmed ? colors.text.muted : colors.primary[400]}
              onPress={() => {
                tapHaptic();
                onClose();
                setTimeout(onOpenRolePicker, 300);
              }}
            />
            <ActionRow
              icon="bar-chart-outline"
              label="Skill Level"
              sublabel="Adjust question difficulty"
              rightText={skillLevel.charAt(0).toUpperCase() + skillLevel.slice(1)}
              rightColor={SKILL_COLOR[skillLevel]}
              onPress={() => {
                tapHaptic();
                setShowSkillPicker((v) => !v);
              }}
              loading={savingSkill}
            />
            <ActionRow
              icon="clipboard-outline"
              label="View Assessment Results"
              sublabel="See your diagnostic scores"
              onPress={() => {
                tapHaptic();
                onClose();
                setTimeout(onViewAssessment, 300);
              }}
              isLast
            />
          </View>

          {/* ── Maintenance ── */}
          <SectionHeader title="MAINTENANCE" />
          <View style={s.card}>
            <ActionRow
              icon="refresh-outline"
              iconColor="#FBBF24"
              label="Reset Progress"
              sublabel="Restart from Day 1 · history kept"
              onPress={handleResetProgress}
              loading={resetting}
              isLast
            />
          </View>

          {/* ── Danger zone ── */}
          <SectionHeader title="DANGER ZONE" />
          <View style={[s.card, s.cardDanger]}>
            <ActionRow
              icon="exit-outline"
              label="Unenroll from Track"
              sublabel="Removes enrollment and plan"
              onPress={handleUnenroll}
              loading={unenrolling}
              destructive
              isLast
            />
          </View>

          <View style={s.bottomPad} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const SHEET_RADIUS = 24;
const BG = colors.background.card;
const BORDER = colors.border;

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: BG,
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
    maxHeight: "90%",
    // Shadow
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 24,
  },
  handleBar: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: BORDER,
    marginTop: 10,
    marginBottom: 2,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.text.primary,
  },
  headerSub: {
    fontSize: 13,
    color: colors.text.muted,
    marginTop: 1,
  },
  closeBtn: {
    height: 32,
    width: 32,
    borderRadius: 16,
    backgroundColor: `${colors.text.muted}18`,
    alignItems: "center",
    justifyContent: "center",
  },
  // ── Stats ──
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: `${colors.primary[500]}0D`,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${colors.primary[500]}30`,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  statPill: {
    flex: 1,
    alignItems: "center",
  },
  statValue: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text.primary,
    marginTop: 4,
  },
  statLabel: {
    fontSize: 10,
    color: colors.text.muted,
    marginTop: 1,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: 32,
    backgroundColor: BORDER,
  },
  // ── Skill badge ──
  skillBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 4,
  },
  skillBadge: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 10,
  },
  skillBadgeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 5,
  },
  skillBadgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  topicsText: {
    fontSize: 12,
    color: colors.text.muted,
  },
  // ── Sections ──
  sectionHeader: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: colors.text.muted,
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 6,
  },
  card: {
    marginHorizontal: 16,
    backgroundColor: colors.background.DEFAULT,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    overflow: "hidden",
  },
  cardDanger: {
    borderColor: "#F8717140",
  },
  // ── Action rows ──
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  actionRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  actionText: {
    flex: 1,
    marginRight: 8,
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text.primary,
  },
  actionSublabel: {
    fontSize: 11,
    color: colors.text.muted,
    marginTop: 1,
  },
  actionRight: {
    fontSize: 12,
    fontWeight: "600",
    marginRight: 4,
  },
  // ── Inline skill picker ──
  skillPicker: {
    marginHorizontal: 16,
    marginTop: 10,
    backgroundColor: colors.background.DEFAULT,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    padding: 14,
  },
  skillPickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  skillPickerTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text.primary,
  },
  skillPickerSubtitle: {
    fontSize: 11,
    color: colors.text.muted,
    marginBottom: 12,
    lineHeight: 16,
  },
  skillOption: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 11,
    marginBottom: 8,
  },
  skillDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  skillOptionText: {
    flex: 1,
  },
  skillOptionLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text.primary,
  },
  skillOptionDesc: {
    fontSize: 11,
    color: colors.text.muted,
    marginTop: 1,
  },
  // ── Bottom padding ──
  bottomPad: {
    height: 32,
  },
});

import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import AnimatedView from "../../../components/ui/AnimatedView";
import Toast from "react-native-toast-message";

import Badge, { type BadgeVariant } from "../../../components/ui/Badge";
import Button from "../../../components/ui/Button";
import EmptyState from "../../../components/ui/EmptyState";
import Skeleton from "../../../components/ui/Skeleton";
import PlanDayCard from "../../../components/assessment/PlanDayCard";
import RolePickerModal, { type RoleSelectionResult } from "../../../components/tracks/RolePickerModal";
import TrackManagementSheet from "../../../components/tracks/TrackManagementSheet";
import { useAppStore } from "../../../stores/app.store";
import { getPlan } from "../../../services/assessment.service";
import * as enrollmentService from "../../../services/enrollment.service";
import type { PersonalizedPlan, PlanWeek, SkillLevel, TargetRole, TrackId } from "../../../types";
import { colors, radius, shadows } from "../../../constants/theme";
import { errorHaptic, successHaptic, tapHaptic } from "../../../lib/haptics";

// Mirrors the placeholder display names used on the track-selection screen
// (`(app)/tracks.tsx`). A dedicated `track.service.ts` fetch felt like
// overkill for a single label — the backend's `/api/v1/tracks` list is the
// source of truth and these strings match it exactly.
const TRACK_NAMES: Record<TrackId, string> = {
  ml_ai: "ML & AI",
  web_dev: "Web Dev",
  devops: "DevOps",
  data_science: "Data Science",
  cloud: "Cloud",
  mobile_dev: "Mobile Dev",
};

const SKILL_BADGE_VARIANT: Record<SkillLevel, BadgeVariant> = {
  beginner: "beginner",
  intermediate: "intermediate",
  advanced: "advanced",
};

const SKILL_LABEL: Record<SkillLevel, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

interface WeekAccordionProps {
  week: PlanWeek;
  expanded: boolean;
  onToggle: () => void;
  currentDay: number;
}

function WeekAccordion({ week, expanded, onToggle, currentDay }: WeekAccordionProps) {
  // Chevron rotation via plain style — no Reanimated needed on web.
  const chevronStyle = { transform: [{ rotate: expanded ? "180deg" : "0deg" }] };

  // Phase 7 polish: raw `TouchableOpacity` (the shared `Card`'s pressable
  // variant doesn't support this accordion's chevron-rotation + collapsible
  // body shape), so it gets its own haptic tap to match every other tappable
  // surface in the app.
  const handleToggle = () => {
    tapHaptic();
    onToggle();
  };

  return (
    <View className="bg-background-card border border-border rounded-2xl mb-3 overflow-hidden">
      <TouchableOpacity
        onPress={handleToggle}
        activeOpacity={0.8}
        className="flex-row items-center justify-between px-4 py-4"
      >
        <Text className="text-text-primary text-base font-semibold flex-1 pr-3">
          Week {week.weekNumber} · {week.title}
        </Text>
        <Text className="text-text-muted text-xs mr-3">{week.days.length} days</Text>
        <View style={chevronStyle}>
          <Ionicons name="chevron-down" size={18} color={colors.text.muted} />
        </View>
      </TouchableOpacity>

      {/* Conditionally MOUNT the body when expanded — animating height to
          "auto" never worked (web AnimatedView ignores `animate`, so it was
          always open; native Moti can't tween to "auto", so it never opened).
          A mount + fade works identically on web and native. */}
      {expanded ? (
        <AnimatedView
          from={{ opacity: 0, translateY: -6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: "timing", duration: 200 }}
        >
          <View className="px-4 pb-4">
            <Text className="text-text-secondary text-sm leading-6 mb-4">{week.focus}</Text>
            {week.days.map((day) => (
              <PlanDayCard
                key={day.dayNumber}
                day={day}
                isCompleted={day.dayNumber < currentDay}
                isToday={day.dayNumber === currentDay}
              />
            ))}
          </View>
        </AnimatedView>
      ) : null}
    </View>
  );
}

export default function PlanScreen() {
  const { trackId } = useLocalSearchParams<{ trackId: TrackId }>();
  const router = useRouter();

  const enrolledTrackIds = useAppStore((s) => s.enrolledTrackIds);
  const isEnrolled = enrolledTrackIds.includes(trackId);
  // Phase 4 addition — needed by the unenroll flow in the header menu below.
  const removeEnrollment = useAppStore((s) => s.removeEnrollment);
  // Per-track target role: read this track's enrollment and keep it editable.
  const enrollment = useAppStore((s) => s.enrollments.find((item) => item.trackId === trackId));
  const updateEnrollment = useAppStore((s) => s.updateEnrollment);
  const targetRole = enrollment?.targetRole ?? null;
  const roleConfirmed = enrollment?.roleConfirmed ?? false;

  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [savingRole, setSavingRole] = useState(false);
  const [mgmtSheetOpen, setMgmtSheetOpen] = useState(false);

  // Curated roles for this track — fetched lazily (and cached) for the picker.
  const rolesQuery = useQuery<TargetRole[]>({
    queryKey: ["trackRoles", trackId],
    queryFn: () => enrollmentService.getTrackRoles(trackId),
    staleTime: Infinity,
    enabled: isEnrolled,
  });

  // Honour "ask for the target role when you start a track": if this track's
  // role is still the system default (not yet user-confirmed), open the picker
  // once when the plan opens. After they choose, it won't reappear.
  const [autoPrompted, setAutoPrompted] = useState(false);
  useEffect(() => {
    if (isEnrolled && enrollment && !roleConfirmed && !autoPrompted) {
      setAutoPrompted(true);
      setRoleModalOpen(true);
    }
  }, [isEnrolled, enrollment, roleConfirmed, autoPrompted]);

  const openRoleEditor = () => {
    tapHaptic();
    setRoleModalOpen(true);
  };

  const saveRole = async (selection: RoleSelectionResult) => {
    setSavingRole(true);
    try {
      const updated = await enrollmentService.updateTargetRole(trackId, selection);
      updateEnrollment(updated);
      setRoleModalOpen(false);
      successHaptic();
      Toast.show({
        type: "success",
        text1: "Target role set",
        text2: `Questions will adapt to ${updated.targetRole}.`,
      });
    } catch (error) {
      console.error("[PlanScreen] update target role failed:", error);
      errorHaptic();
      Toast.show({ type: "error", text1: "Couldn't update role", text2: "Please try again." });
    } finally {
      setSavingRole(false);
    }
  };
  // currentDay comes from the live enrollment record (kept in sync by the
  // store). Falls back to 1 (not 0) so "Day 1" always shows as the starting
  // point before any sessions have been completed.
  const currentDay = enrollment?.currentDay ?? 1;

  const [expandedWeek, setExpandedWeek] = useState<number | null>(1);

  const planQuery = useQuery<PersonalizedPlan>({
    queryKey: ["plan", trackId],
    queryFn: () => getPlan(trackId),
    retry: false,
  });

  const trackName = TRACK_NAMES[trackId] ?? "Track";

  const toggleWeek = (weekNumber: number) => {
    setExpandedWeek((current) => (current === weekNumber ? null : weekNumber));
  };

  // pull-to-refresh
  const refreshing = planQuery.isRefetching;
  const onRefresh = useCallback(() => {
    planQuery.refetch();
  }, [planQuery]);

  // Opens the professional Track Management bottom sheet
  const handleOpenTrackMenu = () => {
    tapHaptic();
    setMgmtSheetOpen(true);
  };

  // Called by the management sheet after unenrolling
  const handleUnenrolled = useCallback(() => {
    removeEnrollment(trackId);
    router.replace("/(app)/tracks");
  }, [removeEnrollment, trackId, router]);

  if (planQuery.isLoading) {
    // Phase 7 polish: skeleton shaped like this screen's real layout (summary
    // bar + accordion rows) instead of a blocking full-screen spinner — gives
    // an immediate sense of where content will land while the plan generates.
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom", "left", "right"]}>
        <View className="px-4 pt-4 pb-3 border-b border-border flex-row items-center gap-3">
          <TouchableOpacity
            onPress={() => { tapHaptic(); router.back(); }}
            hitSlop={10}
            className="h-9 w-9 items-center justify-center rounded-full"
            style={{ backgroundColor: `${colors.primary[500]}12` }}
          >
            <Ionicons name="arrow-back" size={20} color={colors.primary[500]} />
          </TouchableOpacity>
          <View className="flex-1">
            <Skeleton width="50%" height={18} />
            <View className="flex-row items-center mt-2 gap-2">
              <Skeleton width={72} height={20} borderRadius={radius.full} />
              <Skeleton width={80} height={12} />
            </View>
          </View>
        </View>
        <View className="px-5 pt-4 gap-3">
          {[0, 1, 2].map((i) => (
            <View key={i} className="bg-background-card border border-border rounded-2xl px-4 py-4">
              <View className="flex-row items-center justify-between">
                <Skeleton width="55%" height={16} />
                <Skeleton width={18} height={18} borderRadius={radius.sm} />
              </View>
            </View>
          ))}
        </View>
      </SafeAreaView>
    );
  }

  if (planQuery.isError || !planQuery.data) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <View className="px-4 pt-4 pb-3 border-b border-border flex-row items-center gap-3">
          <TouchableOpacity
            onPress={() => { tapHaptic(); router.back(); }}
            hitSlop={10}
            className="h-9 w-9 items-center justify-center rounded-full"
            style={{ backgroundColor: `${colors.primary[500]}12` }}
          >
            <Ionicons name="arrow-back" size={20} color={colors.primary[500]} />
          </TouchableOpacity>
          <Text className="text-text-primary text-lg font-bold flex-1">Prep Plan</Text>
        </View>
        <EmptyState
          icon="map-outline"
          title="No plan yet"
          message="Take the assessment first to generate your personalized prep plan."
          actionLabel="Start Assessment"
          onAction={() => router.push(`/assessment/${trackId}`)}
        />
      </SafeAreaView>
    );
  }

  // Pre-existing dependency mismatch (not introduced here, and not a Phase 3
  // file): @tanstack/react-query@5.101 types its `data` via the built-in
  // `NoInfer<T>` utility, which only exists in TypeScript >= 5.4 — this repo
  // pins `typescript: ~5.3.3`. With `skipLibCheck` the unresolvable type
  // collapses to `any`, so `planQuery.data` infers as `any` regardless of the
  // explicit `useQuery<PersonalizedPlan>` generic. This is the first screen in
  // the app to call `useQuery`, which is why the issue surfaces only here. An
  // explicit assertion (rather than bumping `typescript` — a Phase 1 file —
  // and re-running install) keeps this fix local and minimal.
  const plan = planQuery.data as PersonalizedPlan;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom", "left", "right"]}>
      {/* Top summary bar — non-scrollable. Doubles as this screen's "header"
          (the (app) tab layout hides the native one for this route — see
          (app)/_layout.tsx) — so the back button + menu button live here. */}
      <View className="px-4 pt-4 pb-3 border-b border-border flex-row items-center gap-3">
        {/* Back */}
        <TouchableOpacity
          onPress={() => { tapHaptic(); router.back(); }}
          hitSlop={10}
          className="h-9 w-9 items-center justify-center rounded-full"
          style={{ backgroundColor: `${colors.primary[500]}12` }}
        >
          <Ionicons name="arrow-back" size={20} color={colors.primary[500]} />
        </TouchableOpacity>

        {/* Title block */}
        <View className="flex-1">
          <Text className="text-text-primary text-lg font-bold" numberOfLines={1}>{trackName}</Text>
          <View className="flex-row items-center mt-1 gap-2">
            <Badge label={SKILL_LABEL[plan.skillLevel]} variant={SKILL_BADGE_VARIANT[plan.skillLevel]} />
            <Text className="text-text-muted text-xs">{plan.totalDays}-Day Plan</Text>
          </View>
        </View>

        {/* Notifications shortcut */}
        <TouchableOpacity
          onPress={() => { tapHaptic(); router.push("/(app)/notifications"); }}
          hitSlop={10}
          className="h-9 w-9 items-center justify-center rounded-full"
          style={{ backgroundColor: `${colors.primary[500]}12` }}
        >
          <Ionicons name="notifications-outline" size={18} color={colors.primary[500]} />
        </TouchableOpacity>

        {/* "View Assessment / Unenroll" menu */}
        <TouchableOpacity onPress={handleOpenTrackMenu} hitSlop={10}
          className="h-9 w-9 items-center justify-center rounded-full"
          style={{ backgroundColor: `${colors.primary[500]}12` }}
        >
          <Ionicons name="ellipsis-vertical" size={18} color={colors.primary[500]} />
        </TouchableOpacity>
      </View>

      {/* Per-track target role — each track keeps its own. Editing it retunes
          this track's interview questions + difficulty to that role. */}
      {isEnrolled ? (
        <TouchableOpacity
          onPress={openRoleEditor}
          activeOpacity={0.85}
          className="mx-5 mt-3 flex-row items-center justify-between rounded-2xl border px-4 py-3"
          style={{
            borderColor: roleConfirmed ? colors.border : colors.primary[500],
            backgroundColor: roleConfirmed ? colors.background.card : `${colors.primary[500]}0D`,
          }}
        >
          <View className="flex-1 flex-row items-center gap-3 pr-3">
            <View className="h-9 w-9 items-center justify-center rounded-full bg-primary-500/12">
              <Ionicons name="briefcase-outline" size={17} color={colors.primary[500]} />
            </View>
            <View className="flex-1">
              <Text className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Target role</Text>
              <Text numberOfLines={1} className="mt-0.5 text-sm font-semibold text-text-primary">
                {targetRole || "Choose a role for this track"}
              </Text>
            </View>
          </View>
          <View className="flex-row items-center gap-1">
            <Ionicons name={roleConfirmed ? "create-outline" : "arrow-forward-circle"} size={16} color={colors.primary[500]} />
            <Text className="text-xs font-semibold text-primary-600">{roleConfirmed ? "Edit" : "Choose"}</Text>
          </View>
        </TouchableOpacity>
      ) : null}

      <ScrollView
        className="flex-1 px-5"
        contentContainerStyle={{ paddingTop: 16, paddingBottom: isEnrolled ? 12 : 32 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[500]} colors={[colors.primary[500]]} />
        }
      >
        {plan.weeks.map((week, index) => (
          <AnimatedView
            key={week.weekNumber}
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: "timing", duration: 300, delay: Math.min(index, 6) * 70 }}
          >
            <WeekAccordion
              week={week}
              expanded={expandedWeek === week.weekNumber}
              onToggle={() => toggleWeek(week.weekNumber)}
              currentDay={currentDay}
            />
          </AnimatedView>
        ))}
      </ScrollView>

      {isEnrolled ? (
        <View className="px-5 pb-4 pt-3 border-t border-border bg-background">
          {/* Phase 5 MODIFY: this previously pushed to the bare `/(app)/interview`
              stub route. Per the Phase 5 spec's "Plan Screen Integration" section,
              it now opens the mock-interview launcher with this track
              pre-selected (Full Mock remains the launcher's default mode —
              see app/(app)/interview/index.tsx). */}
          <Button
            label={`Continue · Day ${currentDay}`}
            onPress={() => router.push({ pathname: "/(app)/interview", params: { trackId } })}
            fullWidth
          />
        </View>
      ) : null}

      {/* Track Management bottom sheet — replaces the bare Alert.alert menu */}
      {isEnrolled ? (
        <TrackManagementSheet
          visible={mgmtSheetOpen}
          onClose={() => setMgmtSheetOpen(false)}
          trackId={trackId}
          trackName={trackName}
          enrollment={enrollment}
          onEnrollmentUpdated={updateEnrollment}
          onUnenrolled={handleUnenrolled}
          onOpenRolePicker={() => setRoleModalOpen(true)}
          onViewAssessment={() => router.push(`/assessment/${trackId}`)}
        />
      ) : null}

      <RolePickerModal
        visible={roleModalOpen}
        trackName={trackName}
        roles={rolesQuery.data ?? []}
        loading={rolesQuery.isLoading}
        saving={savingRole}
        currentRoleId={enrollment?.targetRoleId ?? null}
        currentLabel={targetRole}
        onClose={() => setRoleModalOpen(false)}
        onSubmit={saveRole}
      />
    </SafeAreaView>
  );
}

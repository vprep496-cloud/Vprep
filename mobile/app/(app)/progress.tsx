import { useCallback, useMemo, useState } from "react";
import { RefreshControl, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import AnimatedView from "../../components/ui/AnimatedView";
import BrandedHeader from "../../components/ui/BrandedHeader";

import EmptyState from "../../components/ui/EmptyState";
import Skeleton from "../../components/ui/Skeleton";
import * as enrollmentService from "../../services/enrollment.service";
import * as interviewService from "../../services/interview.service";
import type { Enrollment, InterviewSessionResult, TrackId } from "../../types";
import { colors, radius, shadows, trackColors } from "../../constants/theme";
import { tapHaptic } from "../../lib/haptics";

// ---------------------------------------------------------------------------
// Phase 5 MODIFY: replaces the empty "No progress yet" placeholder with real
// mock-interview session history — filter pills (by enrolled track) + a list
// of completed-session cards, color-coded by score. Tapping a card re-opens
// that session's results screen (the same one shown right after completion).
// ---------------------------------------------------------------------------
const TRACK_NAMES: Record<string, string> = {
  ml_ai: "ML & AI",
  web_dev: "Web Dev",
  devops: "DevOps",
  data_science: "Data Science",
  cloud: "Cloud",
  mobile_dev: "Mobile Dev",
};

const MODE_LABELS: Record<string, string> = {
  hr: "HR Only",
  technical: "Technical + Coding",
  behavioral: "Behavioral Only",
  full_mock: "Full Mock",
};

const ENROLLED_QUERY_KEY = ["tracks", "enrolled"];
const ALL_FILTER = "all" as const;

function scoreMeta(score: number): { color: string; label: string } {
  if (score >= 75) return { color: colors.success, label: "Strong" };
  if (score >= 50) return { color: colors.warning, label: "Improving" };
  return { color: colors.danger, label: "Needs work" };
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

interface SessionCardProps {
  session: InterviewSessionResult;
  onPress: () => void;
}

function SessionCard({ session, onPress }: SessionCardProps) {
  const meta = scoreMeta(session.overallScore);
  const accent = trackColors[session.trackId] ?? colors.primary[500];
  const trackName = TRACK_NAMES[session.trackId] ?? session.trackId;

  // Phase 7 polish: raw `TouchableOpacity` card — its own haptic tap.
  const handlePress = () => {
    tapHaptic();
    onPress();
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.85}
      // Phase 7 spec: "color-code the left border by score" — meta.color maps
      // to success/warning/danger based on the same thresholds used throughout
      // the app (≥75 strong, ≥50 improving, <50 needs work).
      className="flex-row items-center bg-background-card border border-border-soft rounded-2xl p-4 mb-3"
      style={{ ...shadows.card, borderLeftWidth: 4, borderLeftColor: meta.color }}
    >
      <View
        className="w-12 h-12 rounded-full items-center justify-center mr-3"
        style={{ backgroundColor: `${meta.color}26` }}
      >
        <Text className="text-base font-bold" style={{ color: meta.color }}>
          {session.overallScore}
        </Text>
      </View>

      <View className="flex-1">
        <View className="flex-row items-center gap-1.5">
          <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: accent }} />
          <Text className="text-text-primary text-sm font-bold">{trackName}</Text>
          <Text className="text-text-muted text-xs">· {MODE_LABELS[session.mode] ?? session.mode}</Text>
        </View>
        <Text className="text-text-muted text-xs mt-1">
          {new Date(session.completedAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}{" "}
          · {formatDuration(session.durationSeconds)} · {session.phaseResults.length} round
          {session.phaseResults.length === 1 ? "" : "s"}
        </Text>
      </View>

      <View className="items-end">
        <Text className="text-xs font-semibold" style={{ color: meta.color }}>
          {meta.label}
        </Text>
        <Ionicons name="chevron-forward" size={16} color={colors.text.muted} style={{ marginTop: 6 }} />
      </View>
    </TouchableOpacity>
  );
}

export default function ProgressScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [trackFilter, setTrackFilter] = useState<TrackId | typeof ALL_FILTER>(ALL_FILTER);

  const enrolledQuery = useQuery<Enrollment[]>({
    queryKey: ENROLLED_QUERY_KEY,
    queryFn: enrollmentService.getEnrollments,
  });
  const enrollments = (enrolledQuery.data ?? []) as Enrollment[];

  const historyQuery = useQuery<InterviewSessionResult[]>({
    queryKey: ["interview", "history"],
    queryFn: () => interviewService.getHistory(),
  });
  const sessions = (historyQuery.data ?? []) as InterviewSessionResult[];

  // Phase 7 polish: pull-to-refresh invalidates both queries.
  const refreshing = enrolledQuery.isRefetching || historyQuery.isRefetching;
  const onRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ENROLLED_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: ["interview", "history"] });
  }, [queryClient]);

  const filteredSessions = useMemo(
    () => (trackFilter === ALL_FILTER ? sessions : sessions.filter((s) => s.trackId === trackFilter)),
    [sessions, trackFilter]
  );

  const isLoading = enrolledQuery.isLoading || historyQuery.isLoading;

  if (isLoading) {
    // Phase 7 polish: skeleton shaped like filter pills + session cards.
    return (
      <View className="flex-1 bg-background">
      <BrandedHeader
        title="Results"
        subtitle="Your interview history"
        rightIcon2="notifications-outline"
        onRightPress2={() => router.push("/(app)/notifications")}
      />
      <SafeAreaView className="flex-1" edges={["bottom", "left", "right"]}>
        <View className="px-5 pt-4">
          <Skeleton width="55%" height={26} />
          <Skeleton width="80%" height={14} style={{ marginTop: 8 }} />
          <View className="flex-row gap-2 mt-5">
            {[90, 100, 80].map((w, i) => (
              <Skeleton key={i} width={w} height={34} borderRadius={radius.full} />
            ))}
          </View>
          <View className="mt-6 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <View key={i} className="bg-background-card border border-border-soft rounded-2xl p-4 flex-row items-center gap-3">
                <Skeleton width={48} height={48} borderRadius={24} />
                <View className="flex-1 gap-2">
                  <Skeleton width="55%" height={14} />
                  <Skeleton width="75%" height={12} />
                </View>
              </View>
            ))}
          </View>
        </View>
      </SafeAreaView>
      </View>
    );
  }

  if (sessions.length === 0) {
    return (
      <View className="flex-1 bg-background">
      <BrandedHeader
        title="Results"
        subtitle="Your interview history"
        rightIcon2="notifications-outline"
        onRightPress2={() => router.push("/(app)/notifications")}
      />
      <SafeAreaView className="flex-1">
        <EmptyState
          icon="trending-up-outline"
          title="No progress yet"
          message="Complete your first mock interview to see your progress here."
          actionLabel="Start a Mock Interview"
          onAction={() => router.push("/(app)/interview")}
        />
      </SafeAreaView>
      </View>
    );
  }

  const filterOptions: Array<{ id: TrackId | typeof ALL_FILTER; label: string; color: string }> = [
    { id: ALL_FILTER, label: "All", color: colors.primary[500] },
    ...enrollments.map((enrollment) => ({
      id: enrollment.trackId,
      label: enrollment.track.name,
      color: trackColors[enrollment.trackId] ?? enrollment.track.color ?? colors.primary[500],
    })),
  ];

  return (
    <View className="flex-1 bg-background">
      <BrandedHeader
        title="Results"
        subtitle="Your interview history"
        rightIcon2="notifications-outline"
        onRightPress2={() => router.push("/(app)/notifications")}
      />
      <SafeAreaView className="flex-1" edges={["bottom", "left", "right"]}>
      <ScrollView
        className="flex-1 px-5"
        contentContainerStyle={{ paddingTop: 24, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[500]} colors={[colors.primary[500]]} />
        }
      >
        <AnimatedView
          from={{ opacity: 0, translateY: -10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: "timing", duration: 350 }}
        >
          <Text className="text-text-primary text-3xl font-bold">Your Results</Text>
          <Text className="text-text-secondary text-base mt-2 leading-6">
            Every completed mock interview, scored by your local AI backend.
          </Text>
        </AnimatedView>

        {filterOptions.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
            className="mt-5"
          >
            {filterOptions.map((option) => {
              const isSelected = option.id === trackFilter;
              return (
                <TouchableOpacity
                  key={option.id}
                  onPress={() => {
                    tapHaptic();
                    setTrackFilter(option.id);
                  }}
                  activeOpacity={0.85}
                  className="flex-row items-center gap-2 rounded-full px-4 py-2 border"
                  style={{
                    backgroundColor: isSelected ? `${option.color}18` : colors.background.card,
                    borderColor: isSelected ? option.color : colors.borderSoft,
                  }}
                >
                  {option.id !== ALL_FILTER ? (
                    <View className="w-2 h-2 rounded-full" style={{ backgroundColor: option.color }} />
                  ) : null}
                  <Text
                    className="text-sm font-semibold"
                    style={{ color: isSelected ? option.color : colors.text.secondary }}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : null}

        <View className="mt-6">
          {filteredSessions.length === 0 ? (
            <EmptyState
              icon="mic-off-outline"
              title="No sessions yet"
              message="No completed sessions for this track yet."
            />
          ) : (
            filteredSessions.map((session, index) => (
              <AnimatedView
                key={session.id}
                from={{ opacity: 0, translateY: 10 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: "timing", duration: 240, delay: index * 50 }}
              >
                <SessionCard
                  session={session}
                  onPress={() => router.push(`/(app)/interview/results/${session.id}`)}
                />
              </AnimatedView>
            ))
          )}
        </View>
      </ScrollView>
      </SafeAreaView>
    </View>
  );
}

import { useCallback, useState } from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AnimatedView from "../../components/ui/AnimatedView";

import TrackCard from "../../components/tracks/TrackCard";
import BrandedHeader from "../../components/ui/BrandedHeader";
import ErrorState from "../../components/ui/ErrorState";
import Skeleton from "../../components/ui/Skeleton";
import RolePickerModal, { type RoleSelectionResult } from "../../components/tracks/RolePickerModal";
import * as enrollmentService from "../../services/enrollment.service";
import { useAppStore } from "../../stores/app.store";
import type { Enrollment, TargetRole, Track, TrackId } from "../../types";
import { colors, radius } from "../../constants/theme";

const TRACKS_QUERY_KEY = ["tracks"];
const ENROLLED_QUERY_KEY = ["tracks", "enrolled"];

export default function TracksScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  // Static catalog data — never changes at runtime, cache indefinitely.
  const tracksQuery = useQuery<Track[]>({
    queryKey: TRACKS_QUERY_KEY,
    queryFn: enrollmentService.getTracks,
    staleTime: Infinity,
  });

  const enrolledQuery = useQuery<Enrollment[]>({
    queryKey: ENROLLED_QUERY_KEY,
    queryFn: enrollmentService.getEnrollments,
  });

  // Track id currently mid-flight for the lazy "check assessment → enroll or
  // navigate" sequence below — drives that one card's button spinner.
  const [busyTrackId, setBusyTrackId] = useState<TrackId | null>(null);

  // The track whose target-role picker is open. Starting a new track asks for
  // the role FIRST so the assessment + plan personalize to it from the start.
  const [roleTrack, setRoleTrack] = useState<Track | null>(null);

  const trackRolesQuery = useQuery<TargetRole[]>({
    queryKey: ["trackRoles", roleTrack?.id],
    queryFn: () => enrollmentService.getTrackRoles(roleTrack!.id),
    enabled: !!roleTrack,
    staleTime: Infinity,
  });

  // Same TanStack Query / TypeScript `NoInfer` mismatch documented at length
  // in `(app)/plan/[trackId].tsx` — `data` infers as `any` under this repo's
  // `typescript ~5.3.3`. Same minimal fix: an explicit assertion.
  const tracks = (tracksQuery.data ?? []) as Track[];
  const enrollments = (enrolledQuery.data ?? []) as Enrollment[];
  const enrollmentByTrackId = new Map(enrollments.map((enrollment) => [enrollment.trackId, enrollment]));

  // -------------------------------------------------------------------------
  // Tap logic.
  //
  // Enrolled tracks: go straight to the plan.
  // New (unenrolled) tracks: open the role picker first so every assessment
  // session is personalized to the chosen role from question 1.
  // -------------------------------------------------------------------------
  const handleTrackPress = (track: Track, enrollment: Enrollment | null) => {
    if (enrollment) {
      router.push(`/plan/${track.id}`);
      return;
    }
    if (busyTrackId) return; // one start sequence at a time
    // New track → ask which role they're preparing for before anything else.
    setRoleTrack(track);
  };

  // After the role is chosen: always navigate to the assessment with the role
  // passed as route params so questions are personalized from the very first
  // one. The assessment screen's bootstrap skips any stale cached result when
  // an explicit roleId/role param is present, ensuring the user always gets
  // a fresh role-personalized session even if they took an older assessment
  // under a different (or no) target role.
  //
  // We no longer check for an existing result here — that check previously
  // sent users with old results straight to the plan, bypassing the assessment
  // entirely and leaving them looking at "frontend developer" questions from a
  // prior session instead of the newly chosen role.
  const handleRoleSubmit = (selection: RoleSelectionResult) => {
    const track = roleTrack;
    if (!track) return;
    setRoleTrack(null);
    router.push({
      pathname: "/assessment/[trackId]",
      params: {
        trackId: track.id,
        ...(selection.targetRoleId ? { roleId: selection.targetRoleId } : {}),
        ...(selection.targetRole ? { role: selection.targetRole } : {}),
      },
    });
  };

  // Phase 7 polish: pull-to-refresh re-runs both queries that feed this
  // screen via the existing React Query cache (`invalidateQueries` — the
  // exact mechanism `handleTrackPress` already uses after enrolling, so this
  // introduces no new data-flow). `isRefetching` (not `isFetching`, which is
  // also true during the very first load) drives the spinner so it doesn't
  // double up with the skeleton below.
  const refreshing = tracksQuery.isRefetching || enrolledQuery.isRefetching;
  const onRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: TRACKS_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: ENROLLED_QUERY_KEY });
  }, [queryClient]);

  if (tracksQuery.isLoading || enrolledQuery.isLoading) {
    // Phase 7 polish: skeleton rows shaped like `TrackCard` (icon chip +
    // title/description lines + pill) instead of a blocking full-screen
    // spinner — gives the user an immediate sense of the page's layout
    // while the catalog + enrollment queries resolve.
    return (
      <View className="flex-1 bg-background">
        <BrandedHeader
        title="Tracks"
        subtitle="Assess, enroll, and practice"
        rightIcon2="notifications-outline"
        onRightPress2={() => router.push("/(app)/notifications")}
      />
        <SafeAreaView className="flex-1" edges={["bottom", "left", "right"]}>
          <View className="px-5 pt-4 pb-4">
            <Text className="text-text-primary text-2xl font-bold">Explore Tracks</Text>
            <Text className="text-text-secondary text-sm mt-1">
              Enroll in multiple tracks at once. Each path starts with a personalized assessment.
            </Text>
          </View>
          <View className="px-5 gap-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <View key={i} className="bg-background-card border border-border rounded-2xl p-4">
                <View className="flex-row items-start">
                  <Skeleton width={48} height={48} borderRadius={radius.md} />
                  <View className="flex-1 ml-3 gap-2">
                    <Skeleton width="60%" height={16} />
                    <Skeleton width="90%" height={12} />
                  </View>
                </View>
                <View className="flex-row items-center justify-between mt-4">
                  <Skeleton width={80} height={24} borderRadius={radius.full} />
                  <Skeleton width={72} height={32} borderRadius={radius.lg} />
                </View>
              </View>
            ))}
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (tracksQuery.isError) {
    return (
      <View className="flex-1 bg-background">
        <BrandedHeader
        title="Tracks"
        subtitle="Assess, enroll, and practice"
        rightIcon2="notifications-outline"
        onRightPress2={() => router.push("/(app)/notifications")}
      />
        <SafeAreaView className="flex-1" edges={["bottom", "left", "right"]}>
          <ErrorState
            title="Couldn't load tracks"
            message="Check your connection and try again."
            onRetry={() => tracksQuery.refetch()}
          />
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <BrandedHeader
        title="Tracks"
        subtitle="Assess, enroll, and practice"
        rightIcon2="notifications-outline"
        onRightPress2={() => router.push("/(app)/notifications")}
      />
      <SafeAreaView className="flex-1" edges={["bottom", "left", "right"]}>
        <FlatList
          data={tracks}
          keyExtractor={(track) => track.id}
          numColumns={1}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[500]} colors={[colors.primary[500]]} />
          }
          ListHeaderComponent={
            <View className="pb-4">
              <Text className="text-text-primary text-2xl font-bold">Explore Tracks</Text>
              <Text className="text-text-secondary text-sm mt-1">
                Enroll in multiple tracks at once. Each path starts with a personalized assessment.
              </Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const enrollment = enrollmentByTrackId.get(item.id) ?? null;
            return (
              <AnimatedView
                from={{ opacity: 0, translateY: 16 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: "timing", duration: 300, delay: Math.min(index, 6) * 60 }}
              >
                <TrackCard
                  track={item}
                  enrollment={enrollment}
                  onPress={() => handleTrackPress(item, enrollment)}
                  enrolling={busyTrackId === item.id}
                />
              </AnimatedView>
            );
          }}
        />
      </SafeAreaView>

      <RolePickerModal
        visible={!!roleTrack}
        trackName={roleTrack?.name ?? "this track"}
        roles={trackRolesQuery.data ?? []}
        loading={trackRolesQuery.isLoading}
        saving={false}
        currentRoleId={null}
        currentLabel={null}
        onClose={() => setRoleTrack(null)}
        onSubmit={handleRoleSubmit}
      />
    </View>
  );
}

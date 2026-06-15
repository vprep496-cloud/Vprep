import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AnimatedView from "../ui/AnimatedView";

import Badge, { type BadgeVariant } from "../ui/Badge";
import Button from "../ui/Button";
import type { Enrollment, SkillLevel, Track } from "../../types";
import { colors } from "../../constants/theme";
import { tapHaptic } from "../../lib/haptics";

type IoniconName = keyof typeof Ionicons.glyphMap;

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

interface TrackCardProps {
  track: Track;
  enrollment: Enrollment | null;
  onPress: () => void;
  enrolling: boolean;
}

export default function TrackCard({ track, enrollment, onPress, enrolling }: TrackCardProps) {
  const isEnrolled = enrollment !== null;
  const progressPercent = isEnrolled
    ? Math.max(0, Math.min(100, Math.round((enrollment.currentDay / track.totalDays) * 100)))
    : 0;

  // Phase 7 polish: this is a raw `TouchableOpacity` (not the shared `Card`/
  // `Button` — see the comment on the container below for why), so it needs
  // its own haptic tap to match every other tappable surface in the app.
  const handlePress = () => {
    tapHaptic();
    onPress();
  };

  return (
    // `components/ui/Card` doesn't forward a `style` prop, and this card needs
    // a per-track accent border (the spec's "accent color as a left border or
    // background tint") — so it's built directly here, mirroring Card's own
    // container classes, rather than modifying that shared Phase 1 component
    // just to support one dynamic inline style.
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.85}
      disabled={enrolling}
      className="bg-background-card border border-border rounded-2xl p-4 mb-3"
      style={{ borderLeftWidth: 4, borderLeftColor: track.color }}
    >
      <View className="flex-row items-start">
        <View
          className="w-12 h-12 rounded-xl items-center justify-center mr-3"
          style={{ backgroundColor: `${track.color}26` }}
        >
          <Ionicons name={track.icon as IoniconName} size={24} color={track.color} />
        </View>

        <View className="flex-1 pr-2">
          <Text className="text-text-primary text-base font-semibold">{track.name}</Text>
          <Text className="text-text-muted text-xs mt-1 leading-5" numberOfLines={2}>
            {track.description}
          </Text>
        </View>
      </View>

      {isEnrolled ? (
        <View className="mt-4">
          <View className="flex-row items-center justify-between mb-1.5">
            <Text className="text-text-secondary text-xs font-medium">
              Day {enrollment.currentDay} of {track.totalDays}
            </Text>
            <Text className="text-text-muted text-xs">{progressPercent}%</Text>
          </View>
          <View className="h-1.5 rounded-full bg-background-surface border border-border overflow-hidden">
            {/* Phase 7 polish: animate the fill growing in from 0 → its real
                width on mount, instead of snapping straight to its final
                value — a small "the app is alive" touch on a number the user
                glances at constantly while browsing tracks. */}
            <AnimatedView
              from={{ width: "0%" }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ type: "timing", duration: 600 }}
              className="h-full rounded-full"
              style={{ backgroundColor: track.color }}
            />
          </View>
        </View>
      ) : null}

      <View className="flex-row items-center justify-between mt-4">
        {isEnrolled ? (
          <Badge
            label={SKILL_LABEL[enrollment.skillLevel]}
            variant={SKILL_BADGE_VARIANT[enrollment.skillLevel]}
          />
        ) : (
          // Empty spacer keeps the action button right-aligned regardless of
          // whether a badge is present, per the spec's "bottom right" layout.
          <View />
        )}

        {enrolling ? (
          <View className="px-5 py-2.5">
            <ActivityIndicator size="small" color={colors.primary[500]} />
          </View>
        ) : (
          <Button
            label={isEnrolled ? "Continue" : "Start"}
            size="sm"
            variant={isEnrolled ? "secondary" : "primary"}
            onPress={onPress}
          />
        )}
      </View>
    </TouchableOpacity>
  );
}

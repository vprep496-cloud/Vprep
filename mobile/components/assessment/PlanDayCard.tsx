import { View, Text } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import AnimatedView from "../ui/AnimatedView";
import type { PlanDay } from "../../types";
import { colors } from "../../constants/theme";

interface PlanDayCardProps {
  day: PlanDay;
  isCompleted: boolean;
  isToday: boolean;
}

export default function PlanDayCard({ day, isCompleted, isToday }: PlanDayCardProps) {
  const badgeBackground = isCompleted
    ? colors.success
    : isToday
      ? colors.primary[500]
      : colors.background.surface;
  const badgeTextColor = isCompleted || isToday ? "#FFFFFF" : colors.text.muted;

  return (
    <View
      className={`flex-row rounded-2xl border p-4 mb-3 ${
        isToday ? "border-border bg-background-surface" : "border-border bg-background-card"
      }`}
      style={[
        isToday ? { borderLeftWidth: 4, borderLeftColor: colors.primary[500] } : null,
        isCompleted ? { opacity: 0.55 } : null,
      ]}
    >
      <View className="mr-4">
        {/* Phase 7 polish: a slow breathing-glow loop on TODAY's badge only —
            a small "this is where you are" cue that draws the eye to the
            current day without animating every row (which would be noisy on
            a 5-week plan). Completed/upcoming badges render statically. */}
        {isToday ? (
          <AnimatedView
            from={{ opacity: 0.7, scale: 1 }}
            animate={{ opacity: 1, scale: 1.08 }}
            transition={{ type: "timing", duration: 1000, loop: true }}
            className="w-10 h-10 rounded-full items-center justify-center"
            style={{ backgroundColor: badgeBackground }}
          >
            <Text className="font-bold text-sm" style={{ color: badgeTextColor }}>
              {day.dayNumber}
            </Text>
          </AnimatedView>
        ) : (
          <View
            className="w-10 h-10 rounded-full items-center justify-center"
            style={{ backgroundColor: badgeBackground }}
          >
            {isCompleted ? (
              <Ionicons name="checkmark" size={18} color="#FFFFFF" />
            ) : (
              <Text className="font-bold text-sm" style={{ color: badgeTextColor }}>
                {day.dayNumber}
              </Text>
            )}
          </View>
        )}
      </View>

      <View className="flex-1">
        <Text className="text-text-primary font-bold text-base mb-1">{day.topic}</Text>

        <View className="mb-3">
          {day.subtopics.map((subtopic) => (
            <Text key={subtopic} className="text-text-muted text-xs leading-5">
              •  {subtopic}
            </Text>
          ))}
        </View>

        <View className="flex-row items-center gap-4">
          <View className="flex-row items-center gap-1.5">
            <Ionicons name="time-outline" size={14} color={colors.text.muted} />
            <Text className="text-text-muted text-xs">{day.estimatedMinutes} min</Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <Ionicons name="book-outline" size={14} color={colors.text.muted} />
            <Text className="text-text-muted text-xs">{day.practiceQuestions} practice Qs</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

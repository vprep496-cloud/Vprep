import { View, Text } from "react-native";
import AnimatedView from "../ui/AnimatedView";
import type { SkillLevel } from "../../types";
import { colors } from "../../constants/theme";
import ScoreRing from "../ui/ScoreRing";

const LEVEL_META: Record<SkillLevel, { label: string; color: string; message: string }> = {
  beginner: {
    label: "Beginner",
    color: colors.success,
    message: "Great start — your plan will build you up from the ground.",
  },
  intermediate: {
    label: "Intermediate",
    color: colors.warning,
    message: "Solid base — your plan targets the gaps holding you back.",
  },
  advanced: {
    label: "Advanced",
    color: "#A78BFA",
    message: "Strong knowledge — your plan sharpens the edges.",
  },
};

interface SkillResultCardProps {
  skillLevel: SkillLevel;
  score: number;
  breakdown: Record<string, number>;
}

export default function SkillResultCard({ skillLevel, score, breakdown }: SkillResultCardProps) {
  const meta = LEVEL_META[skillLevel];
  const breakdownEntries = Object.entries(breakdown);

  return (
    <View className="items-center">
      {/* Animation extracted to the shared ScoreRing (Agent Rule #7 — Phase 5
          reuses this exact same ring in ScoreBreakdown). Sizing/colors below
          reproduce the original 160px ring with the level color on the arc
          and the score number in text-primary, unchanged from before. */}
      <ScoreRing score={score} color={meta.color} />

      <Text className="text-2xl font-bold mt-4" style={{ color: meta.color }}>
        {meta.label}
      </Text>
      <Text className="text-text-secondary text-sm text-center mt-1 px-6">{meta.message}</Text>

      {breakdownEntries.length > 0 ? (
        <View className="w-full mt-6 gap-3">
          <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide px-1">
            Topic Breakdown
          </Text>
          {breakdownEntries.map(([topic, value], index) => (
            <View key={topic} className="gap-1.5">
              <View className="flex-row items-center justify-between">
                <Text className="text-text-secondary text-sm">{topic}</Text>
                <Text className="text-text-muted text-xs">{value}/100</Text>
              </View>
              <View className="h-2 rounded-full bg-background-surface overflow-hidden">
                <AnimatedView
                  from={{ width: "0%" }}
                  animate={{ width: `${value}%` }}
                  transition={{ type: "timing", duration: 700, delay: index * 100 }}
                  style={{ height: "100%", borderRadius: 9999, backgroundColor: meta.color }}
                />
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

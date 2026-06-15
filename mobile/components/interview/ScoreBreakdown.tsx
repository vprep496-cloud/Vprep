import { Text, View, type DimensionValue } from "react-native";

import type { InterviewPhase, InterviewPhaseResult } from "../../types";
import { colors, shadows } from "../../constants/theme";
import ScoreRing from "../ui/ScoreRing";

const PHASE_META: Record<InterviewPhase, { label: string; color: string }> = {
  hr: { label: "HR Fit", color: colors.cranberry },
  technical: { label: "Technical", color: colors.primary[500] },
  coding_logic: { label: "Coding Logic", color: colors.secondary },
  behavioral: { label: "Behavioral", color: colors.success },
};

function overallMessage(score: number): { label: string; body: string; tone: string } {
  if (score >= 85) {
    return {
      label: "Interview ready",
      body: "You are showing strong structure, clarity, and role alignment. Keep polishing the small details.",
      tone: colors.success,
    };
  }
  if (score >= 70) {
    return {
      label: "Good effort!",
      body: "You demonstrated solid foundations. Focus on the improvement areas to reach elite levels.",
      tone: colors.success,
    };
  }
  if (score >= 50) {
    return {
      label: "Building momentum",
      body: "Your basics are in place. Use the feedback below to tighten structure and confidence.",
      tone: colors.secondary,
    };
  }
  return {
    label: "Practice recommended",
    body: "Review each answer, then retake the interview with tighter examples and clearer reasoning.",
    tone: colors.danger,
  };
}

interface ScoreBreakdownProps {
  overallScore: number;
  phaseResults: InterviewPhaseResult[];
}

export default function ScoreBreakdown({ overallScore, phaseResults }: ScoreBreakdownProps) {
  const message = overallMessage(overallScore);

  return (
    <View>
      <View
        className="items-center rounded-2xl border border-border-soft bg-background-card p-6"
        style={shadows.card}
      >
        <Text className="mb-4 text-center text-2xl font-bold text-primary-600">Overall Proficiency</Text>
        <ScoreRing
          score={overallScore}
          color={colors.primary[500]}
          trackColor={colors.background.surface}
          valueColor={colors.primary[700]}
        />
        <View className="mt-4 rounded-full px-5 py-2" style={{ backgroundColor: `${message.tone}33` }}>
          <Text className="text-sm font-bold" style={{ color: message.tone }}>
            {message.label}
          </Text>
        </View>
        <Text className="mt-3 text-center text-sm leading-6 text-text-secondary">{message.body}</Text>
      </View>

      {phaseResults.length > 0 ? (
        <View className="mt-4 gap-3">
          {phaseResults.map((phaseResult) => {
            const meta = PHASE_META[phaseResult.phase];
            const width = `${Math.max(4, Math.min(100, phaseResult.score))}%` as DimensionValue;
            return (
              <View
                key={phaseResult.phase}
                className="rounded-2xl border border-border-soft bg-background-card p-4"
                style={shadows.card}
              >
                <View className="mb-2 flex-row items-center justify-between">
                  <Text className="text-sm font-semibold text-text-secondary">{meta.label}</Text>
                  <Text className="text-2xl font-bold text-primary-700">{phaseResult.score}</Text>
                </View>
                <View className="h-2 overflow-hidden rounded-full bg-background-surface">
                  <View className="h-full rounded-full" style={{ width, backgroundColor: meta.color }} />
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

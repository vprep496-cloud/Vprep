import { Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import AnimatedView from "../ui/AnimatedView";

import type { InterviewPhase, InterviewQuestion } from "../../types";
import { colors } from "../../constants/theme";

// Renders the current question — phase badge, "Question X of Y" progress,
// the question text itself, and a small hint about how to answer it (voice,
// typed, or handwritten image). `model_answer` never reaches this component (Rule #3 — the
// question objects the session screen holds mid-interview are sanitized).
const PHASE_META: Record<InterviewPhase, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  hr: { label: "HR Round", color: colors.cranberry, icon: "people-outline" },
  technical: { label: "Technical Round", color: colors.primary[500], icon: "code-slash-outline" },
  coding_logic: { label: "Coding Logic", color: colors.secondary, icon: "image-outline" },
  behavioral: { label: "Behavioral Round", color: colors.success, icon: "git-branch-outline" },
};

interface QuestionDisplayProps {
  question: InterviewQuestion;
  questionNumber: number;
  totalInPhase: number;
}

export default function QuestionDisplay({ question, questionNumber, totalInPhase }: QuestionDisplayProps) {
  const meta = PHASE_META[question.phase];
  const percent = Math.round((questionNumber / totalInPhase) * 100);

  return (
    <AnimatedView
      key={question.id}
      from={{ opacity: 0, translateX: 30 }}
      animate={{ opacity: 1, translateX: 0 }}
      transition={{ type: "timing", duration: 320 }}
      className="bg-background-card border border-border-soft rounded-2xl p-5"
    >
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center gap-2">
          <View
            className="w-7 h-7 rounded-full items-center justify-center"
            style={{ backgroundColor: `${meta.color}26` }}
          >
            <Ionicons name={meta.icon} size={15} color={meta.color} />
          </View>
          <Text className="text-xs font-semibold uppercase tracking-wide" style={{ color: meta.color }}>
            {meta.label}
          </Text>
        </View>
        <Text className="text-secondary text-sm font-bold">{percent}% Complete</Text>
      </View>

      <View className="mb-5 h-3 overflow-hidden rounded-full bg-background-surface">
        <View
          className="h-full rounded-full bg-secondary"
          style={{ width: `${percent}%` }}
        />
      </View>

      <Text className="text-text-primary text-lg font-bold leading-7">{question.questionText}</Text>

      <View className="flex-row items-center gap-1.5 mt-4 px-3 py-2 rounded-full bg-background-surface self-start">
        <Ionicons
          name={
            question.answerType === "voice"
              ? "mic-outline"
              : question.answerType === "image"
                ? "image-outline"
                : "create-outline"
          }
          size={14}
          color={colors.text.muted}
        />
        <Text className="text-text-muted text-xs">
          {question.answerType === "voice"
            ? "Record your spoken answer"
            : question.answerType === "image"
              ? "Capture a clear photo; backend OCR will read and score it"
              : "Type your answer like you would explain it out loud"}
        </Text>
      </View>
    </AnimatedView>
  );
}

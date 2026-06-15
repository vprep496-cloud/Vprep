import { View, Text, TextInput } from "react-native";
import AnimatedView from "../ui/AnimatedView";
import type { AssessmentQuestion } from "../../types";
import { colors } from "../../constants/theme";

interface QuestionCardProps {
  question: AssessmentQuestion;
  value: string;
  onChangeText: (text: string) => void;
  minChars: number;
  maxChars: number;
}

const DIFFICULTY_META: Record<
  AssessmentQuestion["difficulty"],
  { container: string; label: string; text: string }
> = {
  easy: { container: "bg-success/15", label: "text-success", text: "Easy" },
  medium: { container: "bg-warning/15", label: "text-warning", text: "Medium" },
  hard: { container: "bg-danger/15", label: "text-danger", text: "Hard" },
};

const MIN_INPUT_LINES = 4;
const MAX_INPUT_LINES = 8;
const LINE_HEIGHT = 22;

export default function QuestionCard({
  question,
  value,
  onChangeText,
  minChars,
  maxChars,
}: QuestionCardProps) {
  const difficulty = DIFFICULTY_META[question.difficulty];
  const trimmedLength = value.trim().length;
  const meetsMin = trimmedLength >= minChars;
  const nearLimit = value.length > maxChars * 0.85;

  return (
    // `key` forces a remount (and therefore a replay of the entrance
    // animation) every time the question changes, even though the parent
    // renders the same <QuestionCard /> element across question transitions.
    <AnimatedView
      key={question.id}
      from={{ opacity: 0, translateX: 30 }}
      animate={{ opacity: 1, translateX: 0 }}
      transition={{ type: "timing", duration: 320 }}
      className="bg-background-card border border-border rounded-2xl p-5"
    >
      <View className="flex-row items-start justify-between mb-3">
        <Text className="text-text-muted text-xs uppercase tracking-wide flex-1 pr-3">
          {question.sectionTitle ? `${question.sectionTitle} · ` : ""}
          {question.topicArea}
        </Text>
        <View className={`rounded-full px-3 py-1 ${difficulty.container}`}>
          <Text className={`text-xs font-semibold ${difficulty.label}`}>{difficulty.text}</Text>
        </View>
      </View>

      <Text className="text-text-primary text-lg font-bold leading-7 mb-4">
        {question.question}
      </Text>

      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="Answer in 2-4 precise sentences..."
        placeholderTextColor={colors.text.muted}
        multiline
        maxLength={maxChars}
        textAlignVertical="top"
        style={{
          minHeight: MIN_INPUT_LINES * LINE_HEIGHT,
          maxHeight: MAX_INPUT_LINES * LINE_HEIGHT,
        }}
        className="bg-background-surface border border-border rounded-lg px-4 py-3 text-text-primary text-base"
      />

      <Text
        className={`text-xs mt-2 ${
          nearLimit ? "text-warning" : meetsMin ? "text-success" : "text-text-muted"
        }`}
      >
        {trimmedLength}/{maxChars} characters
      </Text>
      <Text className="text-text-muted text-xs mt-1">
        Keep it precise: 2-4 accurate interview-style sentences.
      </Text>
    </AnimatedView>
  );
}

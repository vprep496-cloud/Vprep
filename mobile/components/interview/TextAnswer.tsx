import { Text, TextInput, View } from "react-native";
import { colors } from "../../constants/theme";

// Typed-answer input for the Technical phase (voice phases use VoiceRecorder
// instead). Mirrors the styling/affordances of assessment/QuestionCard's
// TextInput — character counter that turns success-green once the minimum is
// met — but lives standalone since this phase has no difficulty badge/topic
// header (QuestionDisplay renders the question itself above this).
interface TextAnswerProps {
  value: string;
  onChangeText: (text: string) => void;
  minChars?: number;
  disabled?: boolean;
}

const MIN_INPUT_LINES = 5;
const MAX_INPUT_LINES = 10;
const LINE_HEIGHT = 22;
const DEFAULT_MIN_CHARS = 20;

export default function TextAnswer({
  value,
  onChangeText,
  minChars = DEFAULT_MIN_CHARS,
  disabled = false,
}: TextAnswerProps) {
  const meetsMin = value.trim().length >= minChars;

  return (
    <View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        editable={!disabled}
        placeholder="Type your answer here — be as specific and technical as you would in a real interview..."
        placeholderTextColor={colors.text.muted}
        multiline
        textAlignVertical="top"
        style={{
          minHeight: MIN_INPUT_LINES * LINE_HEIGHT,
          maxHeight: MAX_INPUT_LINES * LINE_HEIGHT,
        }}
        className="bg-background-surface border border-border rounded-lg px-4 py-3 text-text-primary text-base"
      />

      <View className="flex-row items-center justify-between mt-2">
        <Text className={`text-xs ${meetsMin ? "text-success" : "text-text-muted"}`}>
          {value.trim().length} characters
        </Text>
        <Text className="text-text-muted text-xs">Aim for a few sentences of real explanation</Text>
      </View>
    </View>
  );
}

import { View, Text, TextInput } from "react-native";
import { colors } from "../../constants/theme";

interface InputProps {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  error?: string;
  secureText?: boolean;
  multiline?: boolean;
}

export default function Input({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  secureText = false,
  multiline = false,
}: InputProps) {
  return (
    <View className="mb-4">
      {label ? (
        <Text className="text-text-secondary text-sm font-medium mb-2">{label}</Text>
      ) : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        // Phase 7: was a standalone "#7A7A85" hex literal (the old placeholder
        // text-muted) — `placeholderTextColor` is a native prop NativeWind
        // can't resolve from a className, so it must stay a literal value;
        // sourcing it from the theme keeps it tracking the Stitch-derived
        // palette instead of drifting from `text.muted` silently.
        placeholderTextColor={colors.text.muted}
        secureTextEntry={secureText}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        className={`bg-background-surface border rounded-xl px-4 py-3 text-text-primary text-base ${
          multiline ? "min-h-[100px]" : ""
        } ${error ? "border-danger" : "border-border"}`}
      />
      {error ? <Text className="text-danger text-xs mt-1">{error}</Text> : null}
    </View>
  );
}

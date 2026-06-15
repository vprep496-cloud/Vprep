import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants/theme";
import Button from "./Button";

interface EmptyStateProps {
  /** Ionicons glyph shown inside the circular badge. Defaults to a generic "empty tray". */
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
  /** Optional call-to-action rendered as a primary Button below the message. */
  actionLabel?: string;
  onAction?: () => void;
}

// Phase 7 shared component: generalizes the "icon badge + title + subtitle (+
// optional CTA)" empty-state pattern that Phase 5's progress.tsx hand-rolled
// inline (see its `sessions.length === 0` branch). Centralizing it here means
// every "no candidates yet" / "no questions match your filters" / "no tracks
// enrolled" empty state across the app now looks and animates identically —
// and a future visual tweak only needs to touch one file.
export default function EmptyState({ icon = "file-tray-outline", title, message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View className="flex-1 items-center justify-center px-10 py-12">
      <View className="w-20 h-20 rounded-full bg-background-surface items-center justify-center mb-5">
        <Ionicons name={icon} size={36} color={colors.text.muted} />
      </View>
      <Text className="text-text-primary text-xl font-bold text-center">{title}</Text>
      {message ? (
        <Text className="text-text-secondary text-sm text-center mt-2">{message}</Text>
      ) : null}
      {actionLabel && onAction ? (
        <View className="mt-6">
          <Button label={actionLabel} onPress={onAction} variant="primary" />
        </View>
      ) : null}
    </View>
  );
}

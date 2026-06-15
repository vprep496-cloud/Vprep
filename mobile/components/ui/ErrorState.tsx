import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants/theme";
import Button from "./Button";

interface ErrorStateProps {
  title?: string;
  message?: string;
  /** Shown as a secondary "Try Again" button when provided (e.g. `() => query.refetch()`). */
  onRetry?: () => void;
  retryLabel?: string;
}

// Phase 7 shared component: the error-state counterpart to `EmptyState` —
// same icon-badge/title/subtitle layout, but tinted with the `danger` token
// and wired for a retry action (typically `refetch` from the screen's React
// Query hook) rather than a navigation CTA. Used wherever a query's `isError`
// branch previously fell through to a bare `LoadingSpinner` or blank screen.
export default function ErrorState({
  title = "Something went wrong",
  message = "We couldn't load this right now. Please try again.",
  onRetry,
  retryLabel = "Try Again",
}: ErrorStateProps) {
  return (
    <View className="flex-1 items-center justify-center px-10 py-12">
      <View className="w-20 h-20 rounded-full bg-danger/10 items-center justify-center mb-5">
        <Ionicons name="alert-circle-outline" size={36} color={colors.danger} />
      </View>
      <Text className="text-text-primary text-xl font-bold text-center">{title}</Text>
      <Text className="text-text-secondary text-sm text-center mt-2">{message}</Text>
      {onRetry ? (
        <View className="mt-6">
          <Button label={retryLabel} onPress={onRetry} variant="secondary" icon="refresh" />
        </View>
      ) : null}
    </View>
  );
}

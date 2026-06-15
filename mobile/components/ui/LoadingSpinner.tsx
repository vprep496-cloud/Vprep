import { View, ActivityIndicator } from "react-native";
import { colors } from "../../constants/theme";

interface LoadingSpinnerProps {
  size?: "small" | "large";
  color?: string;
  fullScreen?: boolean;
}

export default function LoadingSpinner({
  size = "large",
  // Phase 7: was a standalone "#6366F1" hex literal (the old placeholder
  // primary-500) — now sourced from the theme so it tracks the Stitch-derived
  // brand color automatically.
  color = colors.primary[500],
  fullScreen = false,
}: LoadingSpinnerProps) {
  if (fullScreen) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size={size} color={color} />
      </View>
    );
  }

  return <ActivityIndicator size={size} color={color} />;
}

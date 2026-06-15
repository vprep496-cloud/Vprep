import { TouchableOpacity, Text, ActivityIndicator, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, shadows } from "../../constants/theme";
import { tapHaptic } from "../../lib/haptics";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  fullWidth?: boolean;
}

const containerClasses: Record<ButtonVariant, string> = {
  primary: "bg-primary-500",
  secondary: "bg-background-card border border-border",
  ghost: "bg-transparent",
  danger: "bg-danger",
};

const labelClasses: Record<ButtonVariant, string> = {
  primary: "text-white",
  secondary: "text-text-primary",
  ghost: "text-primary-500",
  danger: "text-white",
};

const sizeContainerClasses: Record<ButtonSize, string> = {
  sm: "px-4 py-2 rounded-full",
  md: "px-5 py-3 rounded-full",
  lg: "px-6 py-4 rounded-full",
};

const sizeLabelClasses: Record<ButtonSize, string> = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-lg",
};

const iconSizeBySize: Record<ButtonSize, number> = { sm: 16, md: 18, lg: 20 };

// Phase 7: sourced from `constants/theme.ts` (the single source of truth for
// the Stitch-derived palette) instead of standalone hex literals — keeps
// these in lockstep with tailwind.config.js's `colors` block automatically,
// rather than needing a second manual update every time the brand tone shifts.
const iconAndSpinnerColor: Record<ButtonVariant, string> = {
  primary: "#FFFFFF",
  secondary: colors.text.primary,
  ghost: colors.primary[500],
  danger: "#FFFFFF",
};

export default function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  icon,
  fullWidth = false,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const tint = iconAndSpinnerColor[variant];

  // Phase 7 global polish: every button press gets a light haptic tap —
  // centralizing it here (rather than at each of the dozens of `onPress`
  // call sites across ten screens) means it's automatically applied
  // everywhere `Button` is used, mirroring how `tailwind.config.js` token
  // changes propagate to every screen without per-screen edits.
  const handlePress = () => {
    tapHaptic();
    onPress();
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={isDisabled}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={variant === "primary" || variant === "danger" ? shadows.card : undefined}
      className={[
        "flex-row items-center justify-center",
        containerClasses[variant],
        sizeContainerClasses[size],
        fullWidth ? "w-full" : "",
        isDisabled ? "opacity-50" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {loading ? (
        <ActivityIndicator color={tint} />
      ) : (
        <View className="flex-row items-center">
          {icon ? (
            <Ionicons
              name={icon}
              size={iconSizeBySize[size]}
              color={tint}
              style={{ marginRight: 8 }}
            />
          ) : null}
          <Text className={`font-semibold ${labelClasses[variant]} ${sizeLabelClasses[size]}`}>
            {label}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

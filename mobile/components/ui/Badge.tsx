import { View, Text } from "react-native";

export type BadgeVariant =
  | "beginner"
  | "intermediate"
  | "advanced"
  | "success"
  | "warning"
  | "danger";

interface BadgeProps {
  label: string;
  variant: BadgeVariant;
}

// Maps each variant to a background/text color pair. Beginner/intermediate/
// advanced reuse the semantic palette where possible (green/amber) and add a
// purple accent for "advanced" since the design tokens don't define one.
const badgeStyles: Record<BadgeVariant, { container: string; label: string }> = {
  beginner: { container: "bg-success/15", label: "text-success" },
  intermediate: { container: "bg-warning/15", label: "text-warning" },
  advanced: { container: "bg-[#A78BFA]/15", label: "text-[#A78BFA]" },
  success: { container: "bg-success/15", label: "text-success" },
  warning: { container: "bg-warning/15", label: "text-warning" },
  danger: { container: "bg-danger/15", label: "text-danger" },
};

export default function Badge({ label, variant }: BadgeProps) {
  const styles = badgeStyles[variant];

  return (
    <View className={`self-start rounded-full px-3 py-1 ${styles.container}`}>
      <Text className={`text-xs font-semibold ${styles.label}`}>{label}</Text>
    </View>
  );
}

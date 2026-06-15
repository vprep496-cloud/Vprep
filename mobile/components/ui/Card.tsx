import { View, TouchableOpacity } from "react-native";
import type { ReactNode } from "react";
import { tapHaptic } from "../../lib/haptics";
import { shadows } from "../../constants/theme";

interface CardProps {
  children: ReactNode;
  className?: string;
  onPress?: () => void;
}

export default function Card({ children, className = "", onPress }: CardProps) {
  const baseClasses = `bg-background-card border border-border-soft rounded-2xl p-4 ${className}`;

  if (onPress) {
    // Phase 7 global polish: tappable cards (track cards, session rows, etc.)
    // act as buttons in this app's navigation flow — give them the same
    // light haptic tap as `Button` so the whole app feels consistent,
    // without needing to touch every screen that renders one.
    const handlePress = () => {
      tapHaptic();
      onPress();
    };
    return (
      <TouchableOpacity onPress={handlePress} activeOpacity={0.84} style={shadows.card} className={baseClasses}>
        {children}
      </TouchableOpacity>
    );
  }

  return <View style={shadows.card} className={baseClasses}>{children}</View>;
}

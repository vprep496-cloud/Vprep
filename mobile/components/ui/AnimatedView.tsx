/**
 * AnimatedView — web fallback (no animation).
 *
 * Metro resolves `.native.tsx` on iOS/Android and this `.tsx` file on web.
 * This file never imports moti or Reanimated, so the animation loop that
 * freezes React Native Web at opacity:0 is never registered.
 *
 * Props: accepts the same shape as MotiView so call sites are identical.
 * Animation-specific props (from/animate/transition) are accepted but ignored.
 */
import { View, type ViewProps } from "react-native";
import type { ReactNode } from "react";

export type AnimatedViewProps = ViewProps & {
  /** Ignored on web — content is always visible. */
  from?: Record<string, unknown>;
  animate?: Record<string, unknown>;
  transition?: Record<string, unknown>;
  className?: string;
  children?: ReactNode;
};

export default function AnimatedView({
  from: _from,
  animate: _animate,
  transition: _transition,
  children,
  ...rest
}: AnimatedViewProps) {
  return <View {...rest}>{children}</View>;
}

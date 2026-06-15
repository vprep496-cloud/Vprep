import AnimatedView from "./AnimatedView";
import type { ViewStyle } from "react-native";
import { colors, radius } from "../../constants/theme";

interface SkeletonProps {
  /** Width of the placeholder block. Accepts a number (px) or percentage string. */
  width?: number | `${number}%`;
  /** Height of the placeholder block in px. */
  height?: number;
  /** Corner radius in px. Defaults to the shared `radius.sm` token. */
  borderRadius?: number;
  /** Extra style overrides (merged after the computed placeholder style). */
  style?: ViewStyle;
}

// Phase 7 shared component: a pulsing placeholder block used by every
// skeleton-loading state across the app (Candidates-style "5 rows", chart
// card heights, list rows, etc. — see the per-screen polish tasks). Built on
// Moti (already a Phase 1 dependency) rather than a bespoke Reanimated loop —
// `loop: true` on the transition makes Moti repeat the from→animate tween
// forever, alternating directions, which is exactly the soft pulse skeletons
// use everywhere (Stitch's own loading patterns use the same breathing-opacity
// effect on `surface-container` blocks).
export default function Skeleton({ width = "100%", height = 16, borderRadius = radius.sm, style }: SkeletonProps) {
  return (
    <AnimatedView
      from={{ opacity: 0.35 }}
      animate={{ opacity: 0.85 }}
      transition={{
        type: "timing",
        duration: 800,
        loop: true,
      }}
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: colors.background.surface,
        },
        style,
      ]}
    />
  );
}

import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import Svg, { Circle } from "react-native-svg";
import Animated, { useAnimatedProps, useSharedValue, withTiming } from "react-native-reanimated";
import { colors } from "../../constants/theme";

// Shared animated circular score ring — extracted from Phase 3's
// SkillResultCard so Phase 5 (ScoreBreakdown) can reuse the exact same
// animation logic instead of duplicating it (Agent Rule #7). The ring fills
// via Reanimated while a plain-JS interval drives a synced count-up number
// in the center; both SkillResultCard and ScoreBreakdown now consume this.
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const DEFAULT_SIZE = 160;
const DEFAULT_STROKE_WIDTH = 14;
const COUNT_UP_DURATION_MS = 1500;

interface ScoreRingProps {
  /** 0-100 score to animate up to and fill the ring toward. */
  score: number;
  /** Color of the filled arc (and, by default, the center score text). */
  color: string;
  /** Ring diameter in px. Defaults to the original SkillResultCard size (160). */
  size?: number;
  /** Stroke thickness in px. Defaults to the original SkillResultCard width (14). */
  strokeWidth?: number;
  /** Color of the unfilled track circle. Defaults to the surface background. */
  trackColor?: string;
  /** Small caption under the number, e.g. "/ 100". Pass null to omit it. */
  label?: string | null;
  /**
   * Color of the center score number. Defaults to `colors.text.primary`,
   * matching the original SkillResultCard look exactly (the ring's `color`
   * is only used for the arc + level label there, not the number itself).
   * ScoreBreakdown may opt into coloring the number to match its ring/phase.
   */
  valueColor?: string;
}

export default function ScoreRing({
  score,
  color,
  size = DEFAULT_SIZE,
  strokeWidth = DEFAULT_STROKE_WIDTH,
  trackColor,
  label = "/ 100",
  valueColor,
}: ScoreRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const progress = useSharedValue(0);
  const [displayScore, setDisplayScore] = useState(0);

  // Animate the ring fill with Reanimated, and drive a plain JS counter on the
  // same timeline so the number inside visibly "counts up" alongside the arc.
  useEffect(() => {
    progress.value = withTiming(score, { duration: COUNT_UP_DURATION_MS });

    const startedAt = Date.now();
    const intervalId = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const ratio = Math.min(elapsed / COUNT_UP_DURATION_MS, 1);
      setDisplayScore(Math.round(score * ratio));
      if (ratio >= 1) clearInterval(intervalId);
    }, 16);

    return () => clearInterval(intervalId);
  }, [score, progress]);

  const animatedRingProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - progress.value / 100),
  }));

  // Scale the center text relative to the ring size so smaller rings (e.g.
  // per-phase rings in ScoreBreakdown) don't overflow their circle — these
  // ratios reproduce the original 160px → 30px/12px SkillResultCard sizing.
  const valueFontSize = Math.round(size * 0.1875);
  const labelFontSize = Math.round(size * 0.075);

  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor ?? colors.background.surface}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          animatedProps={animatedRingProps}
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View className="absolute items-center">
        <Text style={{ fontSize: valueFontSize, color: valueColor ?? colors.text.primary }} className="font-bold">
          {displayScore}
        </Text>
        {label ? (
          <Text style={{ fontSize: labelFontSize }} className="text-text-muted">
            {label}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * ScoreRing — web version (no react-native-reanimated).
 *
 * On web Reanimated's worklet runtime never initialises, so
 * Animated.createAnimatedComponent throws at module-load time and leaves the
 * JS thread in an unstable state.  This web variant drives the count-up and
 * arc fill with a plain setInterval + computed strokeDashoffset — identical
 * visual result, zero Reanimated dependency.
 *
 * Metro loads ScoreRing.native.tsx on iOS/Android (Reanimated version) and
 * this file on web.
 */
import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { colors } from "../../constants/theme";

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

  // Plain JS count-up — no Reanimated shared values needed on web.
  const [displayScore, setDisplayScore] = useState(0);

  useEffect(() => {
    setDisplayScore(0);
    const startedAt = Date.now();
    const intervalId = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const ratio = Math.min(elapsed / COUNT_UP_DURATION_MS, 1);
      const next = Math.round(score * ratio);
      setDisplayScore(next);
      if (ratio >= 1) clearInterval(intervalId);
    }, 16);
    return () => clearInterval(intervalId);
  }, [score]);

  const strokeDashoffset = circumference * (1 - displayScore / 100);

  // Scale the center text relative to the ring size so smaller rings (e.g.
  // per-phase rings in ScoreBreakdown) don't overflow their circle.
  const valueFontSize = Math.round(size * 0.1875);
  const labelFontSize = Math.round(size * 0.075);

  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      <Svg width={size} height={size}>
        {/* Track circle */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor ?? colors.background.surface}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Fill arc — driven by displayScore state, no Reanimated animatedProps */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View className="absolute items-center">
        <Text
          style={{ fontSize: valueFontSize, color: valueColor ?? colors.text.primary }}
          className="font-bold"
        >
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

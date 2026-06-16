import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import AnimatedView from "../ui/AnimatedView";

import type { InterviewPhase } from "../../types";
import { colors } from "../../constants/theme";

// Full-bleed "moving on to the next round" interstitial — shown for ~3
// seconds between phases (and once before the very first phase, when
// `fromPhase` is null) before `onComplete` fires and the session screen
// advances to the next question.
const PHASE_META: Record<InterviewPhase, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  hr: { label: "HR Round", color: colors.cranberry, icon: "people-outline" },
  technical: { label: "Technical Round", color: colors.primary[500], icon: "code-slash-outline" },
  coding_logic: { label: "Coding Logic", color: colors.secondary, icon: "image-outline" },
  behavioral: { label: "Behavioral Round", color: colors.success, icon: "git-branch-outline" },
};

const COUNTDOWN_SECONDS = 3;

interface PhaseTransitionProps {
  /** The phase that was just completed — null when this is the session's intro. */
  fromPhase: InterviewPhase | null;
  toPhase: InterviewPhase;
  onComplete: () => void;
}

export default function PhaseTransition({ fromPhase, toPhase, onComplete }: PhaseTransitionProps) {
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  const meta = PHASE_META[toPhase];

  useEffect(() => {
    setSecondsLeft(COUNTDOWN_SECONDS);
    const intervalId = setInterval(() => {
      setSecondsLeft((seconds) => {
        if (seconds <= 1) {
          clearInterval(intervalId);
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);

    const timeoutId = setTimeout(onComplete, COUNTDOWN_SECONDS * 1000);

    return () => {
      clearInterval(intervalId);
      clearTimeout(timeoutId);
    };
    // Re-run whenever the destination phase changes (each transition mounts fresh).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toPhase]);

  return (
    <View className="flex-1 items-center justify-center px-10 bg-background">
      {fromPhase ? (
        <AnimatedView
          from={{ opacity: 0, translateY: -8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: "timing", duration: 280 }}
          className="flex-row items-center gap-2 mb-3"
        >
          <Ionicons name="checkmark-circle" size={18} color={colors.success} />
          <Text className="text-success text-sm font-semibold">
            {PHASE_META[fromPhase].label} complete
          </Text>
        </AnimatedView>
      ) : (
        <Text className="text-text-secondary text-sm font-semibold mb-3">Get ready</Text>
      )}

      <AnimatedView
        from={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "timing", duration: 350 }}
        className="w-20 h-20 rounded-full items-center justify-center mb-5"
        style={{ backgroundColor: `${meta.color}26` }}
      >
        <Ionicons name={meta.icon} size={36} color={meta.color} />
      </AnimatedView>

      <Text className="text-text-primary text-2xl font-bold text-center">
        {fromPhase ? "Up next:" : "Starting with:"}
      </Text>
      <Text className="text-2xl font-bold text-center mt-1" style={{ color: meta.color }}>
        {meta.label}
      </Text>

      <AnimatedView
        key={secondsLeft}
        from={{ opacity: 0.4, scale: 1.15 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "timing", duration: 220 }}
        className="w-12 h-12 rounded-full border-2 items-center justify-center mt-8"
        style={{ borderColor: meta.color }}
      >
        <Text className="text-lg font-bold" style={{ color: meta.color }}>
          {secondsLeft}
        </Text>
      </AnimatedView>

      <Text className="text-text-muted text-xs text-center mt-6">
        {toPhase === "technical"
          ? "You'll type your answers for this round."
          : toPhase === "coding_logic"
            ? "You'll upload a handwritten solution image for this round."
          : "You'll record spoken answers for this round."}
      </Text>
    </View>
  );
}

/**
 * AssessmentProgress — web version (no react-native-reanimated).
 *
 * On web, useSharedValue / useAnimatedStyle from Reanimated don't work
 * reliably and can freeze the JS thread.  This web variant uses plain React
 * state + View widths to render the filled/current/upcoming segment states.
 *
 * Metro loads AssessmentProgress.native.tsx on iOS/Android and this file
 * on web.
 */
import { View, Text } from "react-native";
import AnimatedView from "../ui/AnimatedView";
import { colors } from "../../constants/theme";

interface AssessmentProgressProps {
  current: number; // 1-indexed
  total: number;
}

type SegmentState = "completed" | "current" | "upcoming";

function Segment({ state }: { state: SegmentState }) {
  const fillFraction = state === "upcoming" ? 0 : 1;

  return (
    <View className="flex-1 h-1.5 rounded-full overflow-hidden bg-background-surface border border-border">
      {/* Static fill — no Reanimated needed on web */}
      <View
        style={{
          width: `${fillFraction * 100}%`,
          height: "100%",
          borderRadius: 9999,
          backgroundColor: colors.primary[500],
        }}
      />
      {state === "current" ? (
        <AnimatedView
          className="absolute inset-0"
          style={{ borderRadius: 9999, backgroundColor: colors.primary[300] }}
          from={{ opacity: 0.2 }}
          animate={{ opacity: 0.5 }}
          transition={{ type: "timing", duration: 700, loop: true }}
        />
      ) : null}
    </View>
  );
}

export default function AssessmentProgress({ current, total }: AssessmentProgressProps) {
  return (
    <View className="px-1">
      <View className="flex-row gap-1.5">
        {Array.from({ length: total }).map((_, index) => {
          const state: SegmentState =
            index < current - 1 ? "completed" : index === current - 1 ? "current" : "upcoming";
          return <Segment key={index} state={state} />;
        })}
      </View>
      <Text className="text-text-muted text-xs mt-2">
        Question {current} of {total}
      </Text>
    </View>
  );
}

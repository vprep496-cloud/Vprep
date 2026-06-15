import { useEffect } from "react";
import { View, Text } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import AnimatedView from "../ui/AnimatedView";
import { colors } from "../../constants/theme";

interface AssessmentProgressProps {
  current: number; // 1-indexed
  total: number;
}

type SegmentState = "completed" | "current" | "upcoming";

function Segment({ state }: { state: SegmentState }) {
  const fill = useSharedValue(state === "upcoming" ? 0 : 1);

  useEffect(() => {
    fill.value = withTiming(state === "upcoming" ? 0 : 1, { duration: 350 });
  }, [state, fill]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${fill.value * 100}%`,
  }));

  return (
    <View className="flex-1 h-1.5 rounded-full overflow-hidden bg-background-surface border border-border">
      <Animated.View
        style={[
          { height: "100%", borderRadius: 9999, backgroundColor: colors.primary[500] },
          fillStyle,
        ]}
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

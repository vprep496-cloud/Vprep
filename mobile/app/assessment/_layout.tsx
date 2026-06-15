import { Stack } from "expo-router";
import { colors } from "../../constants/theme";

// Phase 3 judgment call: `app/assessment/[trackId].tsx` lives outside the
// `(app)` tab group (per the spec's file tree) and the root layout renders
// via `<Slot />` (no navigator). The screen needs a real navigation header so
// it can call `useNavigation().setOptions` to hide the back button and render
// a custom "Exit" action while answering/evaluating (Agent Rule #4) — so this
// Stack provides that header chrome, styled to match the app's dark theme.
export default function AssessmentLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background.surface },
        headerTintColor: colors.text.primary,
        headerTitleStyle: { color: colors.text.primary, fontWeight: "600" },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background.DEFAULT },
        // Phase 7 global polish: slide transitions (250ms) for push/pop.
        animation: "slide_from_right",
        animationDuration: 250,
      }}
    >
      <Stack.Screen name="[trackId]" options={{ title: "Skill Assessment" }} />
    </Stack>
  );
}

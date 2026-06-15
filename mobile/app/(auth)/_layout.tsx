import { Stack } from "expo-router";

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // Phase 7 global polish: slide transitions (250ms) for every push/pop
        // in this stack — `animation` + `animationDuration` are forwarded to
        // the underlying native-stack navigator by Expo Router.
        animation: "slide_from_right",
        animationDuration: 250,
      }}
    >
      <Stack.Screen name="login" />
    </Stack>
  );
}

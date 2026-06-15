import * as Haptics from "expo-haptics";

// Phase 7 global polish: thin wrappers around `expo-haptics` so every call
// site shares one entry point. Two reasons to centralize rather than call
// `Haptics.*` directly everywhere:
//   1. Haptics throw on platforms/devices without a vibration motor (web,
//      some Android emulators) — wrapping in try/catch here means callers
//      (Button, Card, and the per-screen "milestone" triggers added during
//      screen polish) don't each need their own guard.
//   2. If the feedback "feel" ever needs tuning (e.g. swap Light → Medium for
//      primary actions), it's a one-line change here instead of a grep-and-
//      replace across a dozen files.
//
// `tap` is wired into the shared `Button`/`Card` components so every button
// press in the app gets feedback "for free" (mirrors Agent Rule #2's
// token-inheritance philosophy — change the shared component once). The
// `success`/`warning`/`error` notification-style variants are for the
// specific "key milestones" the spec calls out per screen (assessment
// complete, interview submitted, plan generated, etc.) and are triggered
// explicitly at those call sites.

async function safeHaptic(run: () => Promise<void>) {
  try {
    await run();
  } catch {
    // no-op — haptics unsupported on this device/platform
  }
}

/** Light tap feedback — fired on every button/card press across the app. */
export function tapHaptic() {
  void safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** Success notification — fired on key milestones (e.g. assessment/interview completed). */
export function successHaptic() {
  void safeHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** Warning notification — fired for soft-blocking states the user should notice. */
export function warningHaptic() {
  void safeHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}

/** Error notification — fired alongside error toasts for failed key actions. */
export function errorHaptic() {
  void safeHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}

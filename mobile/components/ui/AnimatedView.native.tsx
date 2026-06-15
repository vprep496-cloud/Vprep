/**
 * AnimatedView — native version (iOS / Android).
 *
 * Metro picks this `.native.tsx` file on native platforms, so moti and
 * Reanimated are only bundled for native builds — never for web.
 *
 * Re-exports MotiView directly so animations work exactly as intended
 * on iOS and Android.
 */
export { MotiView as default } from "moti";

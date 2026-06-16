/**
 * VoiceRecorder — professional voice capture component for behavioral/HR phases.
 *
 * Platform differences handled here (critical — DO NOT simplify without testing):
 *
 * Native (iOS/Android):
 *   - expo-av records to a temp file (m4a on iOS, 3gpp on Android, typically m4a)
 *   - getURI() returns a file:// path
 *   - We read it with expo-file-system FileSystem.readAsStringAsync (base64)
 *
 * Web (React Native web / browser):
 *   - expo-av uses the browser MediaRecorder API
 *   - MediaRecorder defaults to audio/webm (codec: opus)
 *   - getURI() returns a blob: URL (e.g. "blob:http://localhost:8081/…")
 *   - FileSystem.readAsStringAsync CANNOT read blob: URLs — they are in-memory
 *   - We must use fetch(blobUri) → blob.arrayBuffer() → FileReader.readAsDataURL
 *   - The resulting MIME type (audio/webm) is passed as audioFormat to the backend
 *     so faster-whisper writes the correct .webm extension before transcription.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Audio, type AVPlaybackStatus } from "expo-av";
// expo-file-system v19+ moved readAsStringAsync/EncodingType to the legacy
// sub-path. Importing from the main path gives stub functions that throw.
import * as FileSystem from "expo-file-system/legacy";
import { Ionicons } from "@expo/vector-icons";

import { colors, shadows } from "../../constants/theme";
import { errorHaptic, successHaptic, tapHaptic } from "../../lib/haptics";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface VoiceRecordingValue {
  base64: string;
  durationSeconds: number;
  audioFormat: string;   // "m4a" | "webm" | "wav" — passed to backend MIME mapper
}

interface VoiceRecorderProps {
  onRecordingChange: (recording: VoiceRecordingValue | null) => void;
  minSeconds?: number;
  maxSeconds?: number;
  disabled?: boolean;
}

type RecorderState = "idle" | "recording" | "preparing" | "recorded";

// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_MIN_SEC = 8;
const DEFAULT_MAX_SEC = 180;
const ACCENT = colors.secondary;        // cranberry red — "live" colour
const SUCCESS_COL = colors.success;
const MUTED = colors.text.muted;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Read audio from a blob: URL (React Native web only).
 *
 * Steps:
 *  1. fetch(blobUri)         — loads the in-memory blob into a Response
 *  2. response.blob()        — gives us the Blob with its real MIME type
 *  3. FileReader.readAsDataURL — converts binary → "data:<mime>;base64,<data>"
 *  4. Extract base64 portion and derive the audio format string.
 */
async function readBlobUriAsBase64(blobUri: string): Promise<{ base64: string; format: string }> {
  const response = await fetch(blobUri);
  const blob = await response.blob();
  const mime = blob.type || "audio/webm";   // e.g. "audio/webm;codecs=opus"

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const commaIdx = dataUrl.indexOf(",");
      if (commaIdx === -1) {
        reject(new Error("FileReader produced invalid data URL"));
        return;
      }
      const base64 = dataUrl.substring(commaIdx + 1);
      // Derive a simple format key from the MIME type
      const format = mime.includes("webm") ? "webm"
                   : mime.includes("ogg")  ? "ogg"
                   : mime.includes("wav")  ? "wav"
                   : mime.includes("mp4")  ? "m4a"
                   : "webm";              // safest web default
      resolve({ base64, format });
    };
    reader.onerror = () => reject(new Error("FileReader failed: " + reader.error?.message));
    reader.readAsDataURL(blob);
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Animated waveform bars — static on idle, animated on recording. */
function WaveformBars({ active, color }: { active: boolean; color: string }) {
  const heights = active ? [20, 32, 48, 28, 40, 24, 36] : [10, 16, 24, 14, 20, 12, 18];
  return (
    <View style={waveStyles.row}>
      {heights.map((h, i) => (
        <View
          key={i}
          style={[
            waveStyles.bar,
            { height: h, backgroundColor: color, opacity: active ? 1 : 0.4 },
          ]}
        />
      ))}
    </View>
  );
}
const waveStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  bar: { width: 5, borderRadius: 3, marginHorizontal: 3 },
});

/** Circular timer badge. */
function TimerBadge({ seconds, color }: { seconds: number; color: string }) {
  return (
    <Text style={[timerStyles.text, { color }]}>{formatDuration(seconds)}</Text>
  );
}
const timerStyles = StyleSheet.create({
  text: { fontSize: 52, fontWeight: "800", letterSpacing: -1, fontVariant: ["tabular-nums"] },
});

// ─── Main component ───────────────────────────────────────────────────────────
export default function VoiceRecorder({
  onRecordingChange,
  minSeconds = DEFAULT_MIN_SEC,
  maxSeconds = DEFAULT_MAX_SEC,
  disabled = false,
}: VoiceRecorderProps) {
  const [recState, setRecState] = useState<RecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [capturedDuration, setCapturedDuration] = useState(0);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const recordingRef   = useRef<Audio.Recording | null>(null);
  const soundRef       = useRef<Audio.Sound | null>(null);
  const timerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef     = useRef(0);
  const stopRef        = useRef<(() => Promise<void>) | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimer();
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, [clearTimer]);

  // ── Start recording ─────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        errorHaptic();
        setError("Microphone access is required. Please grant permission in your browser or device settings.");
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      await soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
      setIsPlaying(false);

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setElapsed(0);
      elapsedRef.current = 0;
      setRecState("recording");

      timerRef.current = setInterval(() => {
        setElapsed(prev => {
          const next = prev + 1;
          elapsedRef.current = next;
          if (next >= maxSeconds) {
            clearTimer();
            setTimeout(() => stopRef.current?.(), 0);
          }
          return next;
        });
      }, 1000);
    } catch (err) {
      console.error("[VoiceRecorder] start failed:", err);
      errorHaptic();
      setError("Couldn't start the microphone. Please refresh the page and try again.");
    }
  }, [clearTimer, maxSeconds]);

  // ── Stop recording ───────────────────────────────────────────────────────────
  const stopRecording = useCallback(async () => {
    const recording = recordingRef.current;
    if (!recording) return;

    clearTimer();
    setRecState("preparing");

    try {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      const uri = recording.getURI();
      recordingRef.current = null;
      if (!uri) throw new Error("Recording produced no URI");

      const finalDuration = Math.max(1, elapsedRef.current || elapsed);

      if (finalDuration < minSeconds) {
        errorHaptic();
        setError(`Please record at least ${minSeconds} seconds. You recorded ${finalDuration}s.`);
        setElapsed(0);
        elapsedRef.current = 0;
        setRecState("idle");
        onRecordingChange(null);
        return;
      }

      // ── Platform-specific audio reading ─────────────────────────────────
      let base64: string;
      let audioFormat: string;

      if (Platform.OS === "web") {
        // On web, expo-av returns a blob: URL — FileSystem cannot read these.
        // Use fetch + FileReader to convert the in-memory blob to base64.
        const { base64: b64, format } = await readBlobUriAsBase64(uri);
        base64 = b64;
        audioFormat = format;
      } else {
        // Native: getURI() returns a file:// path — FileSystem works fine.
        base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        audioFormat = uri.toLowerCase().endsWith(".wav") ? "wav" : "m4a";
      }

      if (!base64 || base64.length < 100) {
        throw new Error("Audio data too short or empty after encoding");
      }

      setCapturedDuration(finalDuration);
      setCapturedUri(uri);
      setRecState("recorded");
      successHaptic();
      onRecordingChange({ base64, durationSeconds: finalDuration, audioFormat });
    } catch (err) {
      console.error("[VoiceRecorder] stop/process failed:", err);
      errorHaptic();
      setError("Couldn't process your recording. Please try again.");
      setElapsed(0);
      elapsedRef.current = 0;
      setRecState("idle");
      onRecordingChange(null);
    }
  }, [clearTimer, elapsed, minSeconds, onRecordingChange]);

  useEffect(() => { stopRef.current = stopRecording; }, [stopRecording]);

  // ── Discard ─────────────────────────────────────────────────────────────────
  const discardRecording = useCallback(async () => {
    await soundRef.current?.unloadAsync().catch(() => {});
    soundRef.current = null;
    setIsPlaying(false);
    setElapsed(0);
    elapsedRef.current = 0;
    setCapturedDuration(0);
    setCapturedUri(null);
    setRecState("idle");
    onRecordingChange(null);
  }, [onRecordingChange]);

  // ── Playback ─────────────────────────────────────────────────────────────────
  const onPlaybackStatus = useCallback((status: AVPlaybackStatus) => {
    if (status.isLoaded && status.didJustFinish) setIsPlaying(false);
  }, []);

  const togglePlayback = useCallback(async () => {
    try {
      if (!soundRef.current) {
        if (!capturedUri) return;
        const { sound } = await Audio.Sound.createAsync({ uri: capturedUri }, { shouldPlay: true });
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate(onPlaybackStatus);
        setIsPlaying(true);
        return;
      }
      const status = await soundRef.current.getStatusAsync();
      if (!status.isLoaded) return;
      if (status.isPlaying) {
        await soundRef.current.pauseAsync();
        setIsPlaying(false);
      } else {
        if ((status as { didJustFinish?: boolean }).didJustFinish ||
            status.positionMillis >= ((status as { durationMillis?: number }).durationMillis ?? 0)) {
          await (soundRef.current as unknown as { replayAsync: () => Promise<void> }).replayAsync();
        } else {
          await soundRef.current.playAsync();
        }
        setIsPlaying(true);
      }
    } catch (err) {
      console.error("[VoiceRecorder] playback error:", err);
    }
  }, [capturedUri, onPlaybackStatus]);

  // ── Render ─────────────────────────────────────────────────────────────────

  // ── RECORDED state ──────────────────────────────────────────────────────────
  if (recState === "recorded") {
    return (
      <View style={s.card}>
        {/* Top status bar */}
        <View style={s.recordedHeader}>
          <View style={s.statusDot} />
          <Text style={s.recordedHeaderText}>Answer captured</Text>
          <Text style={s.durationBadge}>{formatDuration(capturedDuration)}</Text>
        </View>

        {/* Waveform preview */}
        <View style={s.waveformArea}>
          <WaveformBars active={isPlaying} color={SUCCESS_COL} />
          <Text style={s.waveformHint}>
            {isPlaying ? "Playing back…" : "Tap play to review your answer"}
          </Text>
        </View>

        {/* Controls */}
        <View style={s.recordedControls}>
          <TouchableOpacity
            onPress={() => { tapHaptic(); togglePlayback(); }}
            disabled={disabled}
            style={[s.playBtn, { backgroundColor: SUCCESS_COL }]}
            activeOpacity={0.8}
          >
            <Ionicons name={isPlaying ? "pause" : "play"} size={22} color="#FFF" />
          </TouchableOpacity>

          <View style={s.recordedInfo}>
            <Text style={s.readyLabel}>Ready to submit</Text>
            <Text style={s.readyHint}>Review your answer or re-record below</Text>
          </View>

          <TouchableOpacity
            onPress={() => { tapHaptic(); discardRecording(); }}
            disabled={disabled}
            style={s.rerecordBtn}
            activeOpacity={0.8}
          >
            <Ionicons name="refresh" size={14} color={MUTED} />
            <Text style={s.rerecordText}>Re-record</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── PREPARING state (processing audio after stop) ───────────────────────────
  if (recState === "preparing") {
    return (
      <View style={[s.card, s.centerCard]}>
        <View style={[s.preparingIcon, { backgroundColor: `${ACCENT}14` }]}>
          <Ionicons name="cloud-upload-outline" size={28} color={ACCENT} />
        </View>
        <Text style={s.preparingTitle}>Processing your recording…</Text>
        <Text style={s.preparingSubtitle}>
          Encoding audio for AI transcription. This takes a few seconds.
        </Text>
      </View>
    );
  }

  // ── RECORDING state ─────────────────────────────────────────────────────────
  if (recState === "recording") {
    const stopReady = elapsed >= minSeconds;
    const progress = Math.min(elapsed / maxSeconds, 1);
    const remaining = maxSeconds - elapsed;

    return (
      <View style={s.card}>
        {/* Live indicator */}
        <View style={s.liveRow}>
          <View style={s.liveDot} />
          <Text style={s.liveText}>RECORDING LIVE</Text>
          <Text style={s.remainingText}>
            {remaining < 30 ? `${remaining}s left` : `Max ${formatDuration(maxSeconds)}`}
          </Text>
        </View>

        {/* Timer */}
        <View style={s.timerArea}>
          <TimerBadge seconds={elapsed} color={ACCENT} />
        </View>

        {/* Waveform */}
        <View style={s.waveformArea}>
          <WaveformBars active color={ACCENT} />
        </View>

        {/* Progress bar */}
        <View style={s.progressTrack}>
          <View style={[s.progressFill, { width: `${progress * 100}%` as unknown as number }]} />
        </View>

        {/* Stop button */}
        <View style={s.recordingFooter}>
          {!stopReady && (
            <Text style={s.minimumHint}>
              Speak for at least {minSeconds - elapsed}s more
            </Text>
          )}
          <TouchableOpacity
            onPress={() => { tapHaptic(); stopRecording(); }}
            disabled={!stopReady}
            style={[s.stopBtn, !stopReady && s.stopBtnDisabled]}
            activeOpacity={0.85}
          >
            <Ionicons
              name="stop-circle"
              size={20}
              color={stopReady ? colors.danger : MUTED}
            />
            <Text style={[s.stopBtnText, !stopReady && { color: MUTED }]}>
              {stopReady ? "Stop Recording" : `${minSeconds - elapsed}s remaining`}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── IDLE state ──────────────────────────────────────────────────────────────
  return (
    <View style={[s.card, s.centerCard]}>
      {/* Tips */}
      <View style={s.tipsRow}>
        {[
          { icon: "mic-outline" as const, text: "Speak clearly" },
          { icon: "time-outline" as const, text: `${minSeconds}s min` },
          { icon: "bulb-outline" as const, text: "STAR method" },
        ].map(({ icon, text }) => (
          <View key={text} style={s.tipChip}>
            <Ionicons name={icon} size={13} color={MUTED} />
            <Text style={s.tipText}>{text}</Text>
          </View>
        ))}
      </View>

      {/* Waveform preview (static) */}
      <View style={s.waveformArea}>
        <WaveformBars active={false} color={ACCENT} />
      </View>

      {/* Mic button */}
      <TouchableOpacity
        onPress={() => { tapHaptic(); startRecording(); }}
        disabled={disabled}
        style={[s.micBtn, disabled && { opacity: 0.45 }]}
        activeOpacity={0.85}
      >
        <Ionicons name="mic" size={36} color="#FFF" />
      </TouchableOpacity>

      <Text style={s.idleTitle}>Tap to start recording</Text>
      <Text style={s.idleHint}>
        Answer as if you're in a real interview — structured, specific, confident.{"\n"}
        Use the STAR method for behavioral questions.
      </Text>

      {error ? (
        <View style={s.errorBanner}>
          <Ionicons name="alert-circle-outline" size={15} color={colors.danger} />
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    overflow: "hidden",
    ...shadows.card,
  },
  centerCard: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 32,
  },

  // ── Live recording ──────────────────────────────────────────────────────────
  liveRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSoft,
  },
  liveDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: colors.danger,
    marginRight: 7,
  },
  liveText: {
    flex: 1,
    fontSize: 11,
    fontWeight: "800",
    color: colors.danger,
    letterSpacing: 1,
  },
  remainingText: { fontSize: 11, color: MUTED },

  timerArea: {
    alignItems: "center",
    paddingVertical: 20,
  },

  progressTrack: {
    height: 3,
    backgroundColor: `${colors.danger}20`,
    marginHorizontal: 0,
  },
  progressFill: {
    height: 3,
    backgroundColor: colors.danger,
    borderRadius: 2,
  },

  recordingFooter: {
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  minimumHint: {
    fontSize: 12,
    color: MUTED,
    marginBottom: 10,
  },
  stopBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 11,
    paddingHorizontal: 24,
    borderRadius: 100,
    borderWidth: 1.5,
    borderColor: colors.danger,
    backgroundColor: `${colors.danger}08`,
  },
  stopBtnDisabled: {
    borderColor: colors.borderSoft,
    backgroundColor: "transparent",
  },
  stopBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.danger,
    marginLeft: 8,
  },

  // ── Waveform shared ─────────────────────────────────────────────────────────
  waveformArea: {
    alignItems: "center",
    paddingVertical: 16,
  },
  waveformHint: {
    fontSize: 12,
    color: MUTED,
    marginTop: 8,
  },

  // ── Recorded ────────────────────────────────────────────────────────────────
  recordedHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: `${SUCCESS_COL}0C`,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: `${SUCCESS_COL}30`,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: SUCCESS_COL,
    marginRight: 8,
  },
  recordedHeaderText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: SUCCESS_COL,
  },
  durationBadge: {
    fontSize: 13,
    fontWeight: "700",
    color: SUCCESS_COL,
    backgroundColor: `${SUCCESS_COL}18`,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 100,
  },
  recordedControls: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  playBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  recordedInfo: { flex: 1, paddingHorizontal: 14 },
  readyLabel: { fontSize: 14, fontWeight: "700", color: colors.text.primary },
  readyHint: { fontSize: 12, color: MUTED, marginTop: 2 },
  rerecordBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.background.surface,
  },
  rerecordText: { fontSize: 12, fontWeight: "600", color: MUTED, marginLeft: 5 },

  // ── Preparing ────────────────────────────────────────────────────────────────
  preparingIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  preparingTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text.primary,
    marginBottom: 6,
  },
  preparingSubtitle: {
    fontSize: 13,
    color: MUTED,
    textAlign: "center",
    lineHeight: 20,
  },

  // ── Idle ────────────────────────────────────────────────────────────────────
  tipsRow: {
    flexDirection: "row",
    marginBottom: 8,
  },
  tipChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.background.surface,
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginHorizontal: 3,
  },
  tipText: { fontSize: 11, color: MUTED, fontWeight: "600", marginLeft: 4 },
  micBtn: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: ACCENT,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    marginBottom: 20,
    ...shadows.lift,
  },
  idleTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.text.primary,
    textAlign: "center",
    marginBottom: 8,
  },
  idleHint: {
    fontSize: 13,
    color: MUTED,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: `${colors.danger}0C`,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: `${colors.danger}25`,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 16,
  },
  errorText: { flex: 1, fontSize: 12.5, color: colors.danger, lineHeight: 19, marginLeft: 7 },
});

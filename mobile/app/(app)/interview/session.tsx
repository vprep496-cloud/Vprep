import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Tabs, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import AnimatedView from "../../../components/ui/AnimatedView";
import Toast from "react-native-toast-message";

import Button from "../../../components/ui/Button";
import LoadingSpinner from "../../../components/ui/LoadingSpinner";
import QuestionDisplay from "../../../components/interview/QuestionDisplay";
import CodingQuestionCard from "../../../components/interview/CodingQuestionCard";
import VoiceRecorder, { type VoiceRecordingValue } from "../../../components/interview/VoiceRecorder";
import TextAnswer from "../../../components/interview/TextAnswer";
import ImageAnswer, { type ImageAnswerValue } from "../../../components/interview/ImageAnswer";
import PhaseTransition from "../../../components/interview/PhaseTransition";
import * as interviewService from "../../../services/interview.service";
import type {
  AnswerResult,
  CodingSubmitAck,
  InterviewMode,
  InterviewPhase,
  InterviewQuestion,
  SessionIntensity,
  SessionStartResult,
  TrackId,
} from "../../../types";
import { colors } from "../../../constants/theme";
import { errorHaptic, successHaptic, tapHaptic } from "../../../lib/haptics";

// ─── State machine ──────────────────────────────────────────────────────────
type ScreenState = "loading" | "phase_intro" | "answering" | "phase_transition" | "completing";
type UploadProgress = { current: number; total: number; kind: "coding" | "voice" };

const MIN_TEXT_ANSWER_CHARS = 20;

function backendErrorMessage(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: string } } } | undefined)
    ?.response?.data?.detail;
  if (typeof detail === "string" && detail.length > 0) return detail;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

// ─── Progress dots ──────────────────────────────────────────────────────────
type QuestionStatus = "unanswered" | "skipped" | "answered" | "current";

function ProgressDots({
  questions,
  currentIndex,
  answeredIds,
  skippedIds,
  onPress,
}: {
  questions: InterviewQuestion[];
  currentIndex: number;
  answeredIds: Set<string>;
  skippedIds: Set<string>;
  onPress: (index: number) => void;
}) {
  if (questions.length <= 1) return null;

  const getStatus = (q: InterviewQuestion, idx: number): QuestionStatus => {
    if (idx === currentIndex) return "current";
    if (answeredIds.has(q.id)) return "answered";
    if (skippedIds.has(q.id)) return "skipped";
    return "unanswered";
  };

  return (
    <View style={dotStyles.row}>
      {questions.map((q, idx) => {
        const status = getStatus(q, idx);
        return (
          <TouchableOpacity
            key={q.id}
            onPress={() => { tapHaptic(); onPress(idx); }}
            hitSlop={8}
            style={[
              dotStyles.dot,
              status === "current" && dotStyles.dotCurrent,
              status === "answered" && dotStyles.dotAnswered,
              status === "skipped" && dotStyles.dotSkipped,
            ]}
          />
        );
      })}
    </View>
  );
}

const dotStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", columnGap: 6, marginBottom: 14 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#E8D8E0" },
  dotCurrent: { width: 22, borderRadius: 4, backgroundColor: colors.primary[500] },
  dotAnswered: { backgroundColor: colors.success },
  dotSkipped: { backgroundColor: "#F59E0B" },
});

// ─── Coding async confirmation banner ────────────────────────────────────────
function CodingProcessingBanner({
  ack,
  onContinue,
  isFinal,
}: {
  ack: CodingSubmitAck;
  onContinue: () => void;
  isFinal: boolean;
}) {
  return (
    <AnimatedView
      from={{ opacity: 0, translateY: 16 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: "timing", duration: 320 }}
      style={bannerStyles.card}
    >
      <View style={bannerStyles.iconWrap}>
        <Ionicons name="hourglass-outline" size={28} color={colors.primary[500]} />
      </View>
      <Text style={bannerStyles.title}>Coding answer submitted!</Text>
      <Text style={bannerStyles.body}>{ack.message}</Text>

      <View style={bannerStyles.timeline}>
        {[
          { icon: "checkmark-circle", label: "Answer received", done: true },
          { icon: "sync-outline", label: "OCR + AI scoring in progress", done: false },
          { icon: "notifications-outline", label: "Notification when complete", done: false },
        ].map((step) => (
          <View key={step.label} style={bannerStyles.step}>
            <Ionicons
              name={step.icon as any}
              size={16}
              color={step.done ? colors.success : colors.text.muted}
            />
            <Text style={[bannerStyles.stepText, step.done && bannerStyles.stepDone]}>
              {step.label}
            </Text>
          </View>
        ))}
      </View>

      <TouchableOpacity onPress={onContinue} activeOpacity={0.85} style={bannerStyles.btn}>
        <Text style={bannerStyles.btnText}>
          {isFinal ? "Finish Interview →" : "Continue to Next Section →"}
        </Text>
        <Ionicons name="arrow-forward" size={16} color={colors.primary[500]} />
      </TouchableOpacity>
    </AnimatedView>
  );
}

function CodingUploadStatusCard({
  uploading,
  failed,
}: {
  uploading: boolean;
  failed: boolean;
}) {
  const tone = failed ? colors.danger : uploading ? colors.secondary : colors.success;
  const icon = failed ? "alert-circle-outline" : uploading ? "cloud-upload-outline" : "checkmark-circle";
  const title = failed ? "Upload needs retry" : uploading ? "Uploading in background" : "Coding answer queued";
  const body = failed
    ? "The image upload did not finish. Retake or re-submit the solution before completing the interview."
    : uploading
      ? "You can keep using the app. We will start AI scoring as soon as the image reaches the server."
      : "The server has received your answer and AI scoring is running in the background.";

  return (
    <AnimatedView
      from={{ opacity: 0, translateY: 8 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: "timing", duration: 260 }}
      style={[sStyles.codingStatusCard, { borderColor: `${tone}30`, backgroundColor: `${tone}10` }]}
    >
      <Ionicons name={icon as any} size={20} color={tone} />
      <View style={sStyles.codingStatusText}>
        <Text style={[sStyles.codingStatusTitle, { color: tone }]}>{title}</Text>
        <Text style={sStyles.codingStatusBody}>{body}</Text>
      </View>
    </AnimatedView>
  );
}

const bannerStyles = StyleSheet.create({
  card: {
    backgroundColor: "#F9F5FF",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: `${colors.primary[500]}30`,
    padding: 20,
    marginTop: 12,
    alignItems: "center",
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: `${colors.primary[500]}15`,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  title: { fontSize: 17, fontWeight: "800", color: colors.text.primary, marginBottom: 6, textAlign: "center" },
  body: { fontSize: 13, color: colors.text.secondary, textAlign: "center", lineHeight: 20, marginBottom: 16 },
  timeline: { alignSelf: "stretch", gap: 10, marginBottom: 20 },
  step: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepText: { fontSize: 13, color: colors.text.muted },
  stepDone: { color: colors.success, fontWeight: "600" },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 20,
    borderWidth: 1.5,
    borderColor: colors.primary[500],
    backgroundColor: `${colors.primary[500]}10`,
  },
  btnText: { fontSize: 14, fontWeight: "700", color: colors.primary[500] },
});

// ─── Phase display meta ──────────────────────────────────────────────────────
const PHASE_META_TAB: Record<InterviewPhase, { short: string; icon: keyof typeof Ionicons.glyphMap }> = {
  hr:            { short: "HR",         icon: "people-outline" },
  technical:     { short: "Technical",  icon: "code-slash-outline" },
  coding_logic:  { short: "Coding",     icon: "terminal-outline" },
  behavioral:    { short: "Behavioral", icon: "git-branch-outline" },
};

// ─── Phase tab bar ────────────────────────────────────────────────────────────
function PhaseTabBar({
  phases,
  currentPhaseIndex,
  session,
  phaseAnswered,
  onPress,
}: {
  phases: InterviewPhase[];
  currentPhaseIndex: number;
  session: SessionStartResult | null;
  phaseAnswered: Record<string, Set<string>>;
  onPress: (index: number) => void;
}) {
  if (phases.length <= 1) return null;
  return (
    <View style={tabStyles.bar}>
      {phases.map((phase, idx) => {
        const isActive = idx === currentPhaseIndex;
        const meta = PHASE_META_TAB[phase] ?? { short: phase, icon: "ellipse-outline" };
        const total = session?.questions[phase as InterviewPhase]?.length ?? 0;
        const done  = phaseAnswered[phase]?.size ?? 0;
        const isComplete = total > 0 && done >= total;
        return (
          <TouchableOpacity
            key={phase}
            onPress={() => onPress(idx)}
            activeOpacity={0.75}
            style={[tabStyles.tab, isActive && tabStyles.tabActive]}
          >
            <View style={tabStyles.tabInner}>
              <Ionicons
                name={isComplete ? "checkmark-circle" : meta.icon}
                size={13}
                color={isActive ? colors.primary[500] : isComplete ? colors.success : colors.text.muted}
              />
              <Text style={[tabStyles.tabLabel, isActive && tabStyles.tabLabelActive, isComplete && !isActive && tabStyles.tabLabelDone]}>
                {meta.short}
              </Text>
            </View>
            {total > 0 && (
              <Text style={[tabStyles.tabCount, isActive && tabStyles.tabCountActive]}>
                {done}/{total}
              </Text>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const tabStyles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSoft,
    backgroundColor: colors.background.DEFAULT,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 7,
    paddingHorizontal: 4,
    borderRadius: 10,
    marginHorizontal: 3,
  },
  tabActive: {
    backgroundColor: `${colors.primary[500]}10`,
    borderWidth: 1,
    borderColor: `${colors.primary[500]}30`,
  },
  tabInner: { flexDirection: "row", alignItems: "center" },
  tabLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.text.muted,
    marginLeft: 4,
  },
  tabLabelActive: { color: colors.primary[500], fontWeight: "700" },
  tabLabelDone:   { color: colors.success },
  tabCount: {
    fontSize: 10,
    color: colors.text.muted,
    marginTop: 2,
  },
  tabCountActive: { color: colors.primary[500], fontWeight: "600" },
});

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function InterviewSessionScreen() {
  const { trackId, mode, intensity } = useLocalSearchParams<{
    trackId: TrackId;
    mode: InterviewMode;
    intensity?: SessionIntensity;
  }>();
  const navigation = useNavigation();
  const router = useRouter();

  const [screenState, setScreenState] = useState<ScreenState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [completeError, setCompleteError] = useState<string | null>(null);

  const [session, setSession] = useState<SessionStartResult | null>(null);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [questionIndex, setQuestionIndex] = useState(0);

  const [voiceRecording, setVoiceRecording] = useState<VoiceRecordingValue | null>(null);
  const [imageAnswer, setImageAnswer] = useState<ImageAnswerValue | null>(null);
  const [textAnswer, setTextAnswer] = useState("");
  const [pendingTextAnswers, setPendingTextAnswers] = useState<Record<string, string>>({});

  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<AnswerResult | null>(null);
  const [codingAck, setCodingAck] = useState<CodingSubmitAck | null>(null);

  // Voice recordings are stored locally during the interview and uploaded in
  // batch when the user presses "Finish Interview". This prevents 30-second
  // WiFi timeouts from interrupting the interview flow.
  const [pendingVoiceAnswers, setPendingVoiceAnswers] = useState<Record<string, VoiceRecordingValue>>({});
  // Tracks which voice answers were already uploaded — survives "Try Again" retries.
  const uploadedVoiceIds = useRef<Set<string>>(new Set());
  // Coding images upload in the background as soon as the candidate submits
  // them. If the user finishes immediately, completion waits for these uploads.
  const pendingCodingUploads = useRef<Map<string, Promise<boolean>>>(new Map());
  const uploadedCodingIds = useRef<Set<string>>(new Set());
  const failedCodingUploadIds = useRef<Set<string>>(new Set());
  const [pendingCodingUploadIds, setPendingCodingUploadIds] = useState<Set<string>>(new Set());
  const [failedCodingUploadIdState, setFailedCodingUploadIdState] = useState<Set<string>>(new Set());
  // Upload progress shown on the "completing" screen while uploads finish.
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

  // Skip / answer tracking — per phase
  // Per-phase answered/skipped tracking — keyed by phase string so users can
  // freely jump between phases without losing progress on other phases.
  const [phaseAnswered, setPhaseAnswered] = useState<Record<string, Set<string>>>({});
  const [phaseSkipped, setPhaseSkipped] = useState<Record<string, Set<string>>>({});

  // ─── Begin session ───────────────────────────────────────────────────────
  const beginSession = useCallback(async () => {
    setScreenState("loading");
    setLoadError(null);
    try {
      const started = await interviewService.startSession(
        trackId,
        mode,
        (intensity as SessionIntensity) ?? "standard"
      );
      setSession(started);
      setPhaseIndex(0);
      setQuestionIndex(0);
      setFeedback(null);
      setCodingAck(null);
      setPendingVoiceAnswers({});
      uploadedVoiceIds.current = new Set();
      pendingCodingUploads.current = new Map();
      uploadedCodingIds.current = new Set();
      failedCodingUploadIds.current = new Set();
      setPendingCodingUploadIds(new Set());
      setFailedCodingUploadIdState(new Set());
      setUploadProgress(null);
      setVoiceRecording(null);
      setImageAnswer(null);
      setTextAnswer("");
      setPendingTextAnswers({});
      setPhaseAnswered({});
      setPhaseSkipped({});
      setScreenState("phase_intro");
    } catch (error) {
      console.error("[InterviewSession] failed to start session:", error);
      setLoadError(
        backendErrorMessage(error, "We couldn't start your mock interview. Please try again.")
      );
    }
  }, [trackId, mode, intensity]);

  useEffect(() => {
    beginSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, mode]);

  // ─── Stale-state guard ───────────────────────────────────────────────────
  // Root cause: the Tab navigator caches this screen's component instance
  // between navigations.  After an interview completes and router.replace()
  // sends the user to the results screen, the session component stays alive
  // in memory with screenState="completing".  The next time the user starts
  // an interview and this screen gains focus, it would show the "finalising
  // results" spinner from the PREVIOUS session.
  //
  // Fix: listen for the focus event and restart whenever we see a stale
  // terminal state with no active work happening:
  //   • "completing" + no upload in progress → stale spinner from last session
  //   • "answering" + no session → screen was left mid-interview and session
  //     was never properly initialised (edge case from interrupted navigations)
  useEffect(() => {
    const unsub = navigation.addListener("focus", () => {
      const isStaleCompleting = screenState === "completing" && !uploadProgress && !completeError;
      const isOrphaned = (screenState === "answering" || screenState === "phase_intro") && !session;
      if (isStaleCompleting || isOrphaned) {
        beginSession();
      }
    });
    return unsub;
  // beginSession and navigation are stable refs — excluding from deps is safe.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenState, uploadProgress, completeError, session]);

  // ─── Back-navigation block ───────────────────────────────────────────────
  const confirmExit = useCallback(() => {
    Alert.alert("Exit interview?", "Your progress in this session will be lost.", [
      { text: "Cancel", style: "cancel" },
      { text: "Exit", style: "destructive", onPress: () => router.back() },
    ]);
  }, [router]);

  const handleConfirmExit = useCallback(() => { tapHaptic(); confirmExit(); }, [confirmExit]);

  const navigationBlocked = screenState !== "loading";

  useEffect(() => {
    if (!navigationBlocked) return undefined;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      confirmExit();
      return true;
    });
    return () => sub.remove();
  }, [navigationBlocked, confirmExit]);

  // ─── Derived state ───────────────────────────────────────────────────────
  const phases: InterviewPhase[] = session?.phases ?? [];
  const currentPhase: InterviewPhase | null = phases[phaseIndex] ?? null;
  const phaseQuestions: InterviewQuestion[] = currentPhase
    ? session?.questions[currentPhase] ?? []
    : [];
  const currentQuestion = phaseQuestions[questionIndex] ?? null;

  // Per-phase answered/skipped derived as Sets (empty by default for new phases)
  const answeredIds: Set<string> = phaseAnswered[currentPhase ?? ""] ?? new Set<string>();
  const skippedIds: Set<string> = phaseSkipped[currentPhase ?? ""] ?? new Set<string>();

  // Helpers to update per-phase Sets
  const setAnsweredIds = useCallback((ids: Set<string>) => {
    if (!currentPhase) return;
    setPhaseAnswered(prev => ({ ...prev, [currentPhase]: ids }));
  }, [currentPhase]);
  const setSkippedIds = useCallback((ids: Set<string>) => {
    if (!currentPhase) return;
    setPhaseSkipped(prev => ({ ...prev, [currentPhase]: ids }));
  }, [currentPhase]);
  const isLastQuestionInPhase = questionIndex === phaseQuestions.length - 1;
  const isLastPhase = phaseIndex === phases.length - 1;
  const isCodingPhase = currentPhase === "coding_logic";
  // True when every question in the current phase has a saved answer.
  const allPhaseQuestionsAnswered =
    phaseQuestions.length > 0 && phaseQuestions.every((q) => answeredIds.has(q.id));

  const canSubmit =
    !!currentQuestion &&
    !submitting &&
    !feedback &&
    !codingAck &&
    (currentQuestion.answerType === "voice"
      ? !!voiceRecording
      : currentQuestion.answerType === "image"
        ? !!imageAnswer
        : textAnswer.trim().length >= MIN_TEXT_ANSWER_CHARS);

  const submitLabel =
    currentQuestion?.answerType === "voice"
      ? "Save Recording"
      : currentQuestion?.answerType === "image"
        ? "Submit Coding Solution"
        : isLastQuestionInPhase
          ? "Score Technical Section"
          : "Save & Continue";

  const disabledHint =
    currentQuestion?.answerType === "voice"
      ? "Record a complete answer before submitting."
      : currentQuestion?.answerType === "image"
        ? "Attach a readable handwritten solution photo before submitting."
        : `Write at least ${MIN_TEXT_ANSWER_CHARS} characters before continuing.`;

  // ─── Skip logic ──────────────────────────────────────────────────────────
  const findNextUnansweredIndex = useCallback(
    (from: number, questions: InterviewQuestion[], answered: Set<string>, skipped: Set<string>) => {
      // Look for unanswered (not yet skipped and not answered)
      for (let i = from + 1; i < questions.length; i++) {
        const q = questions[i];
        if (!answered.has(q.id) && !skipped.has(q.id)) return i;
      }
      // All ahead answered/skipped — check for any skipped ones we can revisit
      for (let i = 0; i < questions.length; i++) {
        if (i === from) continue;
        const q = questions[i];
        if (skipped.has(q.id) && !answered.has(q.id)) return i;
      }
      return -1; // all answered
    },
    []
  );

  const handleSkip = useCallback(() => {
    if (!currentQuestion) return;
    tapHaptic();

    const newSkipped = new Set(skippedIds);
    newSkipped.add(currentQuestion.id);
    setSkippedIds(newSkipped);

    // Clear any partial input
    setVoiceRecording(null);
    setImageAnswer(null);
    setFeedback(null);
    setCodingAck(null);

    const next = findNextUnansweredIndex(questionIndex, phaseQuestions, answeredIds, newSkipped);
    if (next !== -1) {
      setQuestionIndex(next);
      if (phaseQuestions[next]?.answerType === "text") {
        setTextAnswer(pendingTextAnswers[phaseQuestions[next].id] ?? "");
      } else {
        setTextAnswer("");
      }
    } else {
      // All others answered — show a toast and stay
      Toast.show({
        type: "info",
        text1: "All other questions answered",
        text2: "Please go back to answer the skipped questions before finishing this section.",
      });
    }
  }, [
    currentQuestion, skippedIds, questionIndex, phaseQuestions, answeredIds,
    pendingTextAnswers, findNextUnansweredIndex,
  ]);

  const navigateToQuestion = useCallback(
    (index: number) => {
      if (index === questionIndex) return;
      setFeedback(null);
      setCodingAck(null);
      setVoiceRecording(null);
      setImageAnswer(null);
      setQuestionIndex(index);
      const q = phaseQuestions[index];
      if (q?.answerType === "text") {
        setTextAnswer(pendingTextAnswers[q.id] ?? "");
      } else {
        setTextAnswer("");
      }
    },
    [questionIndex, phaseQuestions, pendingTextAnswers]
  );

  const queueCodingImageUpload = useCallback(
    (params: {
      sessionId: string;
      questionId: string;
      answer: ImageAnswerValue;
    }): Promise<boolean> => {
      const { sessionId, questionId, answer } = params;

      failedCodingUploadIds.current.delete(questionId);
      setFailedCodingUploadIdState((prev) => {
        const next = new Set(prev);
        next.delete(questionId);
        return next;
      });
      setPendingCodingUploadIds((prev) => new Set(prev).add(questionId));

      const upload = interviewService
        .submitCodingAnswerAsync({
          sessionId,
          questionId,
          imageBase64: answer.base64,
          imageMimeType: answer.mimeType,
          imageWidth: answer.width,
          imageHeight: answer.height,
          imageSizeBytes: answer.sizeBytes,
        })
        .then(() => {
          uploadedCodingIds.current.add(questionId);
          Toast.show({
            type: "success",
            text1: "Coding image uploaded",
            text2: "AI scoring is now running in the background.",
          });
          return true;
        })
        .catch((error) => {
          console.error("[InterviewSession] coding background upload failed:", error);
          failedCodingUploadIds.current.add(questionId);
          setFailedCodingUploadIdState((prev) => new Set(prev).add(questionId));
          setPhaseAnswered((prev) => {
            const nextForCoding = new Set(prev.coding_logic ?? []);
            nextForCoding.delete(questionId);
            return { ...prev, coding_logic: nextForCoding };
          });
          Toast.show({
            type: "error",
            text1: "Coding upload failed",
            text2: backendErrorMessage(error, "Please re-submit the image before finishing."),
          });
          return false;
        })
        .finally(() => {
          pendingCodingUploads.current.delete(questionId);
          setPendingCodingUploadIds((prev) => {
            const next = new Set(prev);
            next.delete(questionId);
            return next;
          });
        });

      pendingCodingUploads.current.set(questionId, upload);
      return upload;
    },
    []
  );

  // ─── Submit answer ────────────────────────────────────────────────────────
  const handleSubmitAnswer = useCallback(async () => {
    if (!session || !currentQuestion || !currentPhase || !canSubmit) return;

    // ── TEXT (batch at end of phase) ─────────────────────────────────────
    if (currentQuestion.answerType === "text") {
      const nextAnswers = { ...pendingTextAnswers, [currentQuestion.id]: textAnswer.trim() };
      setPendingTextAnswers(nextAnswers);

      const newAnswered = new Set(answeredIds);
      newAnswered.add(currentQuestion.id);
      setAnsweredIds(newAnswered);
      const newSkipped = new Set(skippedIds);
      newSkipped.delete(currentQuestion.id);
      setSkippedIds(newSkipped);

      if (!isLastQuestionInPhase) {
        const nextIdx = findNextUnansweredIndex(questionIndex, phaseQuestions, newAnswered, newSkipped);
        const goTo = nextIdx !== -1 ? nextIdx : questionIndex + 1;
        setQuestionIndex(goTo);
        const nextQ = phaseQuestions[goTo];
        setTextAnswer(nextQ?.answerType === "text" ? nextAnswers[nextQ.id] ?? "" : "");
        return;
      }

      // Last text question — validate all text questions answered
      const textQuestions = phaseQuestions.filter((q) => q.answerType === "text");
      const missingAnswers = textQuestions.filter(
        (q) => (nextAnswers[q.id] ?? "").trim().length < MIN_TEXT_ANSWER_CHARS
      );
      if (missingAnswers.length > 0) {
        errorHaptic();
        // Navigate to first unanswered
        const firstMissingIdx = phaseQuestions.findIndex((q) => q.id === missingAnswers[0].id);
        if (firstMissingIdx !== -1) setQuestionIndex(firstMissingIdx);
        Toast.show({
          type: "error",
          text1: `${missingAnswers.length} question${missingAnswers.length > 1 ? "s" : ""} need answers`,
          text2: "Every question must be answered before scoring this section.",
        });
        return;
      }

      setSubmitting(true);
      try {
        await interviewService.submitTextAnswerBatchAsync({
          sessionId: session.sessionId,
          phase: currentPhase,
          answers: textQuestions.map((q) => ({
            questionId: q.id,
            textAnswer: nextAnswers[q.id],
          })),
        });
        Toast.show({
          type: "success",
          text1: "Technical answers saved",
          text2: "Scoring will finish in the background.",
        });
        setPendingTextAnswers({});
        setTextAnswer("");
        if (isLastPhase) setScreenState("completing");
        else setScreenState("phase_transition");
      } catch (error) {
        console.error("[InterviewSession] batch score failed:", error);
        errorHaptic();
        Toast.show({
          type: "error",
          text1: "Couldn't score technical section",
          text2: backendErrorMessage(error, "Something went wrong. Please try again."),
        });
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // ── IMAGE (coding) — async submission ──────────────────────────────
    if (currentQuestion.answerType === "image") {
      if (!imageAnswer) return;
      setSubmitting(true);
      try {
        const ack = await interviewService.submitCodingAnswerAsync({
          sessionId: session.sessionId,
          questionId: currentQuestion.id,
          imageBase64: imageAnswer.base64,
          imageMimeType: imageAnswer.mimeType,
          imageWidth: imageAnswer.width,
          imageHeight: imageAnswer.height,
          imageSizeBytes: imageAnswer.sizeBytes,
        });
        // Mark as answered
        const newAnswered = new Set(answeredIds);
        newAnswered.add(currentQuestion.id);
        setAnsweredIds(newAnswered);
        const newSkipped = new Set(skippedIds);
        newSkipped.delete(currentQuestion.id);
        setSkippedIds(newSkipped);

        successHaptic();
        setCodingAck(ack);
      } catch (error) {
        console.error("[InterviewSession] coding async submit failed:", error);
        errorHaptic();
        Toast.show({
          type: "error",
          text1: "Couldn't submit coding answer",
          text2: backendErrorMessage(error, "Something went wrong. Please try again."),
        });
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // ── VOICE — save locally, upload in batch at "Finish Interview" ──────
    // Uploading audio over WiFi during the interview caused 30-second Axios
    // timeouts on slow connections.  We store the recording in-memory here
    // and submit it (with a 2-minute timeout) when the user finishes.
    if (!voiceRecording) return;

    const newPending = { ...pendingVoiceAnswers, [currentQuestion.id]: voiceRecording };
    setPendingVoiceAnswers(newPending);

    const newAnswered = new Set(answeredIds);
    newAnswered.add(currentQuestion.id);
    setAnsweredIds(newAnswered);
    const newSkipped = new Set(skippedIds);
    newSkipped.delete(currentQuestion.id);
    setSkippedIds(newSkipped);

    successHaptic();
    setVoiceRecording(null);
    // Do NOT auto-advance — the user explicitly presses "Next Question →" or
    // "Submit All Recordings". This lets them review/re-record before continuing.
  }, [
    session, currentQuestion, currentPhase, canSubmit,
    pendingTextAnswers, textAnswer, isLastQuestionInPhase,
    phaseQuestions, questionIndex, isLastPhase,
    voiceRecording, imageAnswer,
    answeredIds, skippedIds, findNextUnansweredIndex,
    pendingVoiceAnswers,
  ]);

  // ─── Advance after saving a voice answer ──────────────────────────────────
  // Called by the "Next Question →" / "Submit All Recordings" button that
  // appears after the user saves a voice recording for the current question.
  const handleAdvanceVoice = useCallback(() => {
    tapHaptic();
    setVoiceRecording(null);
    const nextIdx = findNextUnansweredIndex(questionIndex, phaseQuestions, answeredIds, skippedIds);
    if (nextIdx !== -1) {
      setQuestionIndex(nextIdx);
      return;
    }
    // All questions in this phase are answered.
    if (isLastPhase) {
      setScreenState("completing");
    } else {
      setScreenState("phase_transition");
    }
  }, [questionIndex, phaseQuestions, answeredIds, skippedIds, isLastPhase, findNextUnansweredIndex]);

  // ─── Advance to next question / phase ────────────────────────────────────
  const advanceFromFeedback = useCallback(() => {
    setFeedback(null);
    setVoiceRecording(null);
    setImageAnswer(null);
    setTextAnswer("");

    // Check if any questions still unanswered
    const unanswered = phaseQuestions.filter(
      (q) => !answeredIds.has(q.id) && q.id !== currentQuestion?.id
    );

    if (unanswered.length > 0) {
      // Go to first unanswered
      const idx = phaseQuestions.findIndex((q) => q.id === unanswered[0].id);
      setQuestionIndex(idx);
      return;
    }

    if (!isLastQuestionInPhase) {
      setQuestionIndex((i) => i + 1);
      return;
    }

    if (isLastPhase) {
      setScreenState("completing");
      return;
    }

    setScreenState("phase_transition");
  }, [isLastQuestionInPhase, isLastPhase, phaseQuestions, answeredIds, currentQuestion]);

  const advanceFromCodingAck = useCallback(() => {
    setCodingAck(null);
    setImageAnswer(null);

    // Check remaining unanswered in phase
    const unanswered = phaseQuestions.filter((q) => !answeredIds.has(q.id));
    if (unanswered.length > 0) {
      const idx = phaseQuestions.findIndex((q) => q.id === unanswered[0].id);
      setQuestionIndex(idx);
      return;
    }

    if (isLastPhase) {
      setScreenState("completing");
    } else {
      setScreenState("phase_transition");
    }
  }, [phaseQuestions, answeredIds, isLastPhase]);

  const handlePhaseIntroComplete = useCallback(() => {
    setScreenState("answering");
    // Per-phase state starts empty — no explicit reset needed.
  }, []);

  const handlePhaseTransitionComplete = useCallback(() => {
    setPhaseIndex((i) => i + 1);
    setQuestionIndex(0);
    setFeedback(null);
    setCodingAck(null);
    // Per-phase state is keyed by phase name — new phase starts with empty sets.
    setScreenState("answering");
  }, []);

  // ─── Free phase navigation — lets users jump to any phase at any time ────
  const handleJumpToPhase = useCallback((targetIndex: number) => {
    if (targetIndex === phaseIndex) return;
    tapHaptic();
    setPhaseIndex(targetIndex);
    setQuestionIndex(0);
    setFeedback(null);
    setCodingAck(null);
    setVoiceRecording(null);
    setImageAnswer(null);
    setTextAnswer("");
    setScreenState("answering");
  }, [phaseIndex]);

  // ─── "completing" — upload pending voice answers then finalize session ───
  useEffect(() => {
    if (screenState !== "completing" || !session) return undefined;
    let cancelled = false;

    (async () => {
      setCompleteError(null);
      try {
        // ── Step 1: Upload any locally-stored voice recordings ─────────────
        // Recordings are stored in-memory during the interview to avoid
        // 30-second timeouts from uploading large audio files over WiFi.
        const voiceEntries = Object.entries(pendingVoiceAnswers);
        if (voiceEntries.length > 0) {
          setUploadProgress({ current: 0, total: voiceEntries.length });

          for (let i = 0; i < voiceEntries.length; i++) {
            if (cancelled) return;
            const [questionId, recording] = voiceEntries[i];
            setUploadProgress({ current: i, total: voiceEntries.length });

            // Skip answers already uploaded by a previous "Try Again" attempt
            if (uploadedVoiceIds.current.has(questionId)) {
              setUploadProgress({ current: i + 1, total: voiceEntries.length });
              continue;
            }

            // Determine which phase this question belongs to
            let voicePhase: InterviewPhase = "hr";
            for (const [ph, qs] of Object.entries(session.questions)) {
              if ((qs ?? []).some((q: InterviewQuestion) => q.id === questionId)) {
                voicePhase = ph as InterviewPhase;
                break;
              }
            }

            try {
              await interviewService.submitVoiceAnswerAsync({
                sessionId: session.sessionId,
                questionId,
                phase: voicePhase,
                audioBase64: recording.base64,
                audioFormat: recording.audioFormat,
                answerDurationSeconds: recording.durationSeconds,
              });
              uploadedVoiceIds.current.add(questionId);
            } catch (uploadErr: unknown) {
              // 400 "already submitted" → the upload succeeded on a previous
              // attempt even though the request appeared to time out on the
              // client side. Treat as success so we can proceed.
              const axErr = uploadErr as { response?: { status?: number; data?: { detail?: string } } };
              const isAlreadySubmitted =
                axErr?.response?.status === 400 &&
                (axErr?.response?.data?.detail ?? "").includes("already submitted");
              if (isAlreadySubmitted) {
                uploadedVoiceIds.current.add(questionId);
              } else {
                throw uploadErr; // surface real errors to the catch below
              }
            }
            setUploadProgress({ current: i + 1, total: voiceEntries.length });
          }
        }

        if (cancelled) return;
        setUploadProgress(null);

        // ── Step 2: Finalize the session ───────────────────────────────────
        const result = await interviewService.completeSession(session.sessionId);
        if (cancelled) return;
        successHaptic();
        router.replace(`/(app)/interview/results/${result.id}`);
      } catch (error) {
        if (cancelled) return;
        setUploadProgress(null);
        console.error("[InterviewSession] failed to complete session:", error);
        setCompleteError(
          backendErrorMessage(error, "We couldn't finalize your results. Please try again.")
        );
      }
    })();

    return () => { cancelled = true; };
  // pendingVoiceAnswers included so retry picks up any new recordings added
  // after a partial failure; uploadedVoiceIds is a ref so not in deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenState, session, pendingVoiceAnswers, router]);

  // ─── Phase guard — prevent advancing with skipped questions ─────────────
  const skippedInPhase = phaseQuestions.filter(
    (q) => skippedIds.has(q.id) && !answeredIds.has(q.id)
  );

  // =========================================================================
  // Render helpers
  // =========================================================================

  // ─── Header: inject exit button via <Tabs.Screen> so the Tab navigator's
  // header reliably picks it up. The `navigation.setOptions` approach can miss
  // updates in Expo Router 4's Tab header; this is the canonical API instead.
  const tabsHeaderOptions = (
    <Tabs.Screen
      options={{
        headerLeft: navigationBlocked ? () => null : undefined,
        headerRight: navigationBlocked
          ? () => (
              <TouchableOpacity onPress={handleConfirmExit} hitSlop={8} style={sStyles.exitBtn}>
                <Text style={sStyles.exitBtnText}>Exit</Text>
              </TouchableOpacity>
            )
          : undefined,
      }}
    />
  );

  if (screenState === "loading") {
    return (
      <>
        {tabsHeaderOptions}
        <SafeAreaView style={sStyles.center}>
          <LoadingSpinner size="large" />
          <Text style={sStyles.loadText}>{loadError ?? "Preparing your mock interview..."}</Text>
          {!loadError ? (
            <Text style={sStyles.loadSub}>
              AI is selecting questions personalised to your track, level and CV.
            </Text>
          ) : (
            <Button label="Try Again" size="md" variant="secondary" onPress={beginSession} />
          )}
        </SafeAreaView>
      </>
    );
  }

  if (screenState === "phase_intro") {
    return currentPhase ? (
      <>
        {tabsHeaderOptions}
        <PhaseTransition fromPhase={null} toPhase={currentPhase} onComplete={handlePhaseIntroComplete} />
      </>
    ) : null;
  }

  if (screenState === "phase_transition") {
    const nextPhase = phases[phaseIndex + 1] ?? null;
    return currentPhase && nextPhase ? (
      <>
        {tabsHeaderOptions}
        <PhaseTransition
          fromPhase={currentPhase}
          toPhase={nextPhase}
          onComplete={handlePhaseTransitionComplete}
        />
      </>
    ) : null;
  }

  if (screenState === "completing") {
    return (
      <>
        {tabsHeaderOptions}
      <SafeAreaView style={sStyles.center}>
        <AnimatedView
          from={{ scale: 0.9, opacity: 0.6 }}
          animate={{ scale: 1.05, opacity: 1 }}
          transition={{ type: "timing", duration: 900, loop: true }}
        >
          <LoadingSpinner size="large" />
        </AnimatedView>
        {uploadProgress ? (
          <>
            <Text style={sStyles.loadText}>
              {uploadProgress.current < uploadProgress.total
                ? `Uploading recording ${uploadProgress.current + 1} of ${uploadProgress.total}...`
                : "Uploads complete — finalising your session..."}
            </Text>
            <Text style={sStyles.loadSub}>
              Please keep this screen open while your voice answers are being uploaded.
            </Text>
          </>
        ) : completeError ? (
          <>
            <Text style={sStyles.loadText}>{completeError}</Text>
            <Button
              label="Try Again"
              size="md"
              variant="secondary"
              onPress={() => setScreenState("completing")}
            />
          </>
        ) : (
          <>
            <Text style={sStyles.loadText}>Finalising your results...</Text>
            <Text style={sStyles.loadSub}>
              Tallying phase scores and updating your plan progress.
              {"\n"}Voice and coding scores process in the background — check back shortly.
            </Text>
          </>
        )}
      </SafeAreaView>
      </>
    );
  }

  // ── answering ──────────────────────────────────────────────────────────
  const totalInPhase = phaseQuestions.length;
  const answeredInPhase = phaseQuestions.filter((q) => answeredIds.has(q.id)).length;

  return (
    <>
      {tabsHeaderOptions}
    <SafeAreaView style={sStyles.flex} edges={["bottom", "left", "right"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={sStyles.flex}>
        <View style={sStyles.flex}>
            {/* Phase tab bar — tap any phase to jump to it */}
            <PhaseTabBar
              phases={phases}
              currentPhaseIndex={phaseIndex}
              session={session}
              phaseAnswered={phaseAnswered}
              onPress={handleJumpToPhase}
            />
            {/* Per-phase progress bar */}
            <View style={sStyles.progressTrack}>
              <View
                style={[
                  sStyles.progressFill,
                  { width: totalInPhase > 0 ? `${(answeredInPhase / totalInPhase) * 100}%` : "0%" },
                ]}
              />
            </View>

            {/*
              IMPORTANT: Do NOT wrap ScrollView in TouchableWithoutFeedback.
              On Android, TouchableWithoutFeedback intercepts the initial touch
              event to watch for a tap, which prevents ScrollView from claiming
              the gesture — making the list unscrollable.
              Instead, we wrap only the scroll CONTENT in TouchableWithoutFeedback
              (inside the ScrollView), and use keyboardDismissMode for drag-dismiss.
            */}
            <ScrollView
              style={sStyles.flex}
              contentContainerStyle={sStyles.scrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
                <View>
                  {/* Question dots navigator */}
                  <ProgressDots
                    questions={phaseQuestions}
                    currentIndex={questionIndex}
                    answeredIds={answeredIds}
                    skippedIds={skippedIds}
                    onPress={navigateToQuestion}
                  />

                  {currentQuestion ? (
                    isCodingPhase ? (
                      <CodingQuestionCard
                        questionText={currentQuestion.questionText}
                        questionNumber={questionIndex + 1}
                        totalInPhase={totalInPhase}
                      />
                    ) : (
                      <QuestionDisplay
                        question={currentQuestion}
                        questionNumber={questionIndex + 1}
                        totalInPhase={totalInPhase}
                      />
                    )
                  ) : null}

                  {/* Skipped warning */}
                  {skippedInPhase.length > 0 && !feedback && !codingAck && (
                    <View style={sStyles.skippedBanner}>
                      <Ionicons name="alert-circle-outline" size={14} color="#92400E" />
                      <Text style={sStyles.skippedBannerText}>
                        {skippedInPhase.length} question{skippedInPhase.length > 1 ? "s" : ""} skipped
                        — answer them before finishing this section
                      </Text>
                    </View>
                  )}

                  <View style={sStyles.answerArea}>
                    {codingAck ? (
                      <CodingProcessingBanner
                        ack={codingAck}
                        onContinue={advanceFromCodingAck}
                        isFinal={isLastPhase}
                      />
                    ) : !feedback ? (
                      currentQuestion?.answerType === "voice" ? (
                        <>
                          {/* ── Status card: shown after saving, before the user advances ── */}
                          {answeredIds.has(currentQuestion.id) && !voiceRecording && (
                            allPhaseQuestionsAnswered ? (
                              /* All recordings done — big summary card */
                              <AnimatedView
                                from={{ opacity: 0, translateY: 8 }}
                                animate={{ opacity: 1, translateY: 0 }}
                                transition={{ type: "timing", duration: 300 }}
                                style={sStyles.voiceSummaryCard}
                              >
                                <View style={sStyles.voiceSummaryHeader}>
                                  <View style={sStyles.voiceSummaryIcon}>
                                    <Ionicons name="mic" size={22} color={colors.success} />
                                  </View>
                                  <View style={{ flex: 1 }}>
                                    <Text style={sStyles.voiceSummaryTitle}>
                                      All {phaseQuestions.length} answers recorded
                                    </Text>
                                    <Text style={sStyles.voiceSummarySub}>
                                      Ready to submit for AI scoring
                                    </Text>
                                  </View>
                                </View>
                                <View style={sStyles.voiceSummaryList}>
                                  {phaseQuestions.map((q, idx) => {
                                    const rec = pendingVoiceAnswers[q.id];
                                    const dur = rec?.durationSeconds ?? 0;
                                    return (
                                      <View key={q.id} style={sStyles.voiceSummaryRow}>
                                        <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                                        <Text style={sStyles.voiceSummaryQText} numberOfLines={1}>
                                          Q{idx + 1} — {q.questionText}
                                        </Text>
                                        <Text style={sStyles.voiceSummaryDur}>
                                          {`${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, "0")}`}
                                        </Text>
                                      </View>
                                    );
                                  })}
                                </View>
                                <Text style={sStyles.voiceSummaryHint}>
                                  Tap "Submit All Recordings" below to finalise your interview.{"\n"}
                                  To re-record any answer, use the progress dots above to revisit it.
                                </Text>
                              </AnimatedView>
                            ) : (
                              /* Single question saved — compact badge */
                              <AnimatedView
                                from={{ opacity: 0, translateY: 6 }}
                                animate={{ opacity: 1, translateY: 0 }}
                                transition={{ type: "timing", duration: 240 }}
                                style={sStyles.recordingSavedBadge}
                              >
                                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                                <View style={sStyles.recordingSavedInfo}>
                                  <Text style={sStyles.recordingSavedTitle}>Answer recorded ✓</Text>
                                  <Text style={sStyles.recordingSavedSub}>
                                    Tap "Next Question" to continue, or record again below to replace
                                  </Text>
                                </View>
                                {pendingVoiceAnswers[currentQuestion.id] && (() => {
                                  const dur = pendingVoiceAnswers[currentQuestion.id].durationSeconds;
                                  return (
                                    <Text style={sStyles.recordingSavedDur}>
                                      {`${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, "0")}`}
                                    </Text>
                                  );
                                })()}
                              </AnimatedView>
                            )
                          )}
                          {/* Recorder — hidden in "all done" summary state, shown otherwise */}
                          {!allPhaseQuestionsAnswered || voiceRecording ? (
                            <VoiceRecorder
                              key={currentQuestion.id}
                              onRecordingChange={setVoiceRecording}
                              disabled={submitting}
                            />
                          ) : null}
                        </>
                      ) : currentQuestion?.answerType === "image" ? (
                        <ImageAnswer value={imageAnswer} onChange={setImageAnswer} disabled={submitting} forCoding={isCodingPhase} />
                      ) : (
                        <TextAnswer
                          value={textAnswer}
                          onChangeText={setTextAnswer}
                          minChars={MIN_TEXT_ANSWER_CHARS}
                          disabled={submitting}
                        />
                      )
                    ) : (
                      // ─── Feedback card ────────────────────────────────────
                      <AnimatedView
                        from={{ opacity: 0, translateY: 12 }}
                        animate={{ opacity: 1, translateY: 0 }}
                        transition={{ type: "timing", duration: 280 }}
                        style={sStyles.feedbackCard}
                      >
                        <View style={sStyles.feedbackHeader}>
                          <Text style={sStyles.feedbackTitle}>Your Score</Text>
                          <View
                            style={[
                              sStyles.scoreBadge,
                              { backgroundColor: feedback.score >= 70 ? `${colors.success}26` : feedback.score >= 50 ? "#FEF3C720" : `${colors.danger}20` },
                            ]}
                          >
                            <Text
                              style={[
                                sStyles.scoreBadgeText,
                                { color: feedback.score >= 70 ? colors.success : feedback.score >= 50 ? "#D97706" : colors.danger },
                              ]}
                            >
                              {feedback.score}/100
                            </Text>
                          </View>
                        </View>

                        {feedback.transcription ? (
                          <View style={sStyles.feedbackSection}>
                            <Text style={sStyles.feedbackSectionLabel}>Captured Response</Text>
                            <Text style={sStyles.feedbackBodyText}>{feedback.transcription}</Text>
                          </View>
                        ) : null}

                        <View style={sStyles.feedbackSection}>
                          <Text style={sStyles.feedbackSectionLabel}>Feedback</Text>
                          <Text style={sStyles.feedbackBodyText}>{feedback.feedback}</Text>
                        </View>

                        {(feedback.strengths?.length ?? 0) > 0 || (feedback.improvements?.length ?? 0) > 0 ? (
                          <View style={sStyles.feedbackSection}>
                            {(feedback.strengths ?? []).slice(0, 2).map((item, idx) => (
                              <View key={`s${idx}`} style={sStyles.strengthChip}>
                                <Text style={sStyles.strengthLabel}>Strength</Text>
                                <Text style={sStyles.strengthText}>{item}</Text>
                              </View>
                            ))}
                            {(feedback.improvements ?? []).slice(0, 2).map((item, idx) => (
                              <View key={`i${idx}`} style={sStyles.improvementChip}>
                                <Text style={sStyles.improvementLabel}>Improve</Text>
                                <Text style={sStyles.improvementText}>{item}</Text>
                              </View>
                            ))}
                          </View>
                        ) : null}

                        <View style={sStyles.feedbackSection}>
                          <Text style={sStyles.feedbackSectionLabel}>Ideal Answer</Text>
                          <Text style={sStyles.feedbackBodyText}>{feedback.modelAnswer}</Text>
                        </View>

                        {Object.keys(feedback.criteriaScores).length > 0 ? (
                          <View style={sStyles.criteriaRow}>
                            {Object.entries(feedback.criteriaScores).map(([criterion, value]) => (
                              <View key={criterion} style={sStyles.criteriaBadge}>
                                <Text style={sStyles.criteriaText}>
                                  {criterion.replace(/_/g, " ")}:{" "}
                                  <Text style={sStyles.criteriaScore}>{value}/10</Text>
                                </Text>
                              </View>
                            ))}
                          </View>
                        ) : null}
                      </AnimatedView>
                    )}
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </ScrollView>

            {/* Bottom action bar */}
            <View style={sStyles.bottomBar}>
              {feedback ? (
                <Button
                  label={
                    isLastQuestionInPhase && isLastPhase && answeredIds.size >= totalInPhase
                      ? "Finish Interview"
                      : "Continue"
                  }
                  onPress={advanceFromFeedback}
                  fullWidth
                />
              ) : codingAck ? null : currentQuestion?.answerType === "voice" ? (
                /* ── VOICE ANSWER CONTROLS ───────────────────────────────────────
                   Three states:
                   A) Fresh recording captured → "Save Recording"
                   B) Current Q already answered → "Next Question →" / "Submit All"
                   C) Not yet recorded → disabled save + skip
                ─────────────────────────────────────────────────────────────── */
                voiceRecording ? (
                  /* State A: ready to save */
                  <Button
                    label="Save Recording"
                    onPress={handleSubmitAnswer}
                    loading={submitting}
                    fullWidth
                  />
                ) : answeredIds.has(currentQuestion.id) ? (
                  /* State B: this question saved — navigate */
                  <View style={sStyles.voiceNavBar}>
                    {!allPhaseQuestionsAnswered && (
                      <Text style={sStyles.voiceNavHint}>
                        <Ionicons name="mic-outline" size={12} color={colors.text.muted} />
                        {" "}Record above to replace · or continue below
                      </Text>
                    )}
                    <Button
                      label={
                        allPhaseQuestionsAnswered
                          ? isLastPhase
                            ? "Submit All Recordings"
                            : `Continue to ${PHASE_META_TAB[phases[phaseIndex + 1] ?? "hr"]?.short ?? "Next"} Phase →`
                          : "Next Question →"
                      }
                      variant={allPhaseQuestionsAnswered && isLastPhase ? "primary" : "secondary"}
                      onPress={handleAdvanceVoice}
                      fullWidth
                    />
                  </View>
                ) : (
                  /* State C: not yet recorded */
                  <View style={sStyles.bottomBtnRow}>
                    <TouchableOpacity
                      onPress={handleSkip}
                      disabled={submitting}
                      style={sStyles.skipBtn}
                      activeOpacity={0.8}
                    >
                      <Text style={sStyles.skipBtnText}>Skip for now</Text>
                      <Ionicons name="arrow-forward-outline" size={14} color={colors.text.muted} />
                    </TouchableOpacity>
                    <View style={sStyles.submitWrap}>
                      <Button label="Save Recording" onPress={() => {}} disabled fullWidth />
                      <Text style={sStyles.disabledHint}>
                        Record your answer above to continue.
                      </Text>
                    </View>
                  </View>
                )
              ) : (
                /* ── TEXT / IMAGE CONTROLS (unchanged) ── */
                <View style={sStyles.bottomBtnRow}>
                  {!isCodingPhase && !answeredIds.has(currentQuestion?.id ?? "") && (
                    <TouchableOpacity
                      onPress={handleSkip}
                      disabled={submitting}
                      style={sStyles.skipBtn}
                      activeOpacity={0.8}
                    >
                      <Text style={sStyles.skipBtnText}>Skip for now</Text>
                      <Ionicons name="arrow-forward-outline" size={14} color={colors.text.muted} />
                    </TouchableOpacity>
                  )}
                  <View style={sStyles.submitWrap}>
                    <Button
                      label={submitLabel}
                      onPress={handleSubmitAnswer}
                      disabled={!canSubmit}
                      loading={submitting}
                      fullWidth
                    />
                    {!canSubmit && !submitting ? (
                      <Text style={sStyles.disabledHint}>{disabledHint}</Text>
                    ) : null}
                  </View>
                </View>
              )}
            </View>
          </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </>
  );
}

const sStyles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background.DEFAULT },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, backgroundColor: colors.background.DEFAULT },
  loadText: { fontSize: 16, fontWeight: "700", color: colors.text.primary, textAlign: "center", marginTop: 20 },
  loadSub: { fontSize: 13, color: colors.text.muted, textAlign: "center", marginTop: 8, lineHeight: 20 },
  exitBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  exitBtnText: { color: colors.text.inverse, fontSize: 15, fontWeight: "600" },
  // Phase bar
  phaseBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  phaseLabel: { fontSize: 11, fontWeight: "700", color: colors.text.muted, letterSpacing: 0.7 },
  progressLabel: { fontSize: 11, color: colors.text.muted },
  progressTrack: { height: 3, backgroundColor: "#EDE4E9", marginHorizontal: 16, borderRadius: 2 },
  progressFill: { height: 3, backgroundColor: colors.primary[500], borderRadius: 2 },
  // Scroll
  scrollContent: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 24 },
  answerArea: { marginTop: 16 },
  // Skipped banner
  skippedBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEF3C7",
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  skippedBannerText: { fontSize: 12, color: "#92400E", flex: 1, marginLeft: 6 },
  // Bottom bar
  bottomBar: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSoft,
    backgroundColor: colors.background.DEFAULT,
  },
  bottomBtnRow: { rowGap: 8 },
  skipBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 10,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  skipBtnText: { fontSize: 13, color: colors.text.muted, fontWeight: "600" },
  submitWrap: {},
  disabledHint: { marginTop: 6, textAlign: "center", fontSize: 11, color: colors.text.muted },
  // Feedback
  feedbackCard: {
    backgroundColor: colors.background.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 16,
  },
  feedbackHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  feedbackTitle: { fontSize: 15, fontWeight: "700", color: colors.text.primary },
  scoreBadge: { borderRadius: 100, paddingHorizontal: 12, paddingVertical: 4 },
  scoreBadgeText: { fontSize: 13, fontWeight: "800" },
  feedbackSection: { marginBottom: 12 },
  feedbackSectionLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.text.muted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 5,
  },
  feedbackBodyText: { fontSize: 13, color: colors.text.secondary, lineHeight: 20 },
  strengthChip: {
    borderRadius: 10,
    backgroundColor: `${colors.success}14`,
    padding: 10,
    marginBottom: 6,
  },
  strengthLabel: { fontSize: 10, fontWeight: "700", color: colors.success, marginBottom: 2 },
  strengthText: { fontSize: 13, color: colors.text.secondary, lineHeight: 18 },
  improvementChip: {
    borderRadius: 10,
    backgroundColor: colors.background.surface,
    padding: 10,
    marginBottom: 6,
  },
  improvementLabel: { fontSize: 10, fontWeight: "700", color: colors.text.muted, marginBottom: 2 },
  improvementText: { fontSize: 13, color: colors.text.secondary, lineHeight: 18 },
  criteriaRow: { flexDirection: "row", flexWrap: "wrap", rowGap: 6, columnGap: 6, marginTop: 8 },
  criteriaBadge: {
    backgroundColor: colors.background.surface,
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  criteriaText: { fontSize: 11, color: colors.text.muted },
  criteriaScore: { fontWeight: "700", color: colors.text.secondary },
  // ── Voice: compact "Recording saved ✓" badge (single question saved) ────────
  recordingSavedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: `${colors.success}10`,
    borderWidth: 1,
    borderColor: `${colors.success}28`,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 12,
  },
  recordingSavedInfo: { flex: 1 },
  recordingSavedTitle: { fontSize: 13, fontWeight: "700", color: colors.success },
  recordingSavedSub: { fontSize: 11.5, color: `${colors.success}B0`, marginTop: 2, lineHeight: 16 },
  recordingSavedDur: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.success,
    backgroundColor: `${colors.success}18`,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 100,
  },

  // ── Voice: "all done" summary card ───────────────────────────────────────────
  voiceSummaryCard: {
    backgroundColor: `${colors.success}08`,
    borderWidth: 1.5,
    borderColor: `${colors.success}25`,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  voiceSummaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  voiceSummaryIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: `${colors.success}18`,
    alignItems: "center",
    justifyContent: "center",
  },
  voiceSummaryTitle: { fontSize: 15, fontWeight: "800", color: colors.text.primary },
  voiceSummarySub: { fontSize: 12, color: colors.text.muted, marginTop: 2 },
  voiceSummaryList: { gap: 9, marginBottom: 14 },
  voiceSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  voiceSummaryQText: { flex: 1, fontSize: 12.5, color: colors.text.secondary },
  voiceSummaryDur: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.success,
    backgroundColor: `${colors.success}14`,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 100,
  },
  voiceSummaryHint: {
    fontSize: 12,
    color: colors.text.muted,
    textAlign: "center",
    lineHeight: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: `${colors.success}20`,
    paddingTop: 12,
  },

  // ── Voice: bottom-bar navigation controls ────────────────────────────────────
  voiceNavBar: { gap: 6 },
  voiceNavHint: {
    fontSize: 11.5,
    color: colors.text.muted,
    textAlign: "center",
    marginBottom: 2,
  },
});

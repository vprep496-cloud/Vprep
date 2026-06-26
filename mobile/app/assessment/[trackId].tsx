import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import AnimatedView from "../../components/ui/AnimatedView";
import Toast from "react-native-toast-message";

import Button from "../../components/ui/Button";
import LoadingSpinner from "../../components/ui/LoadingSpinner";
import AssessmentProgress from "../../components/assessment/AssessmentProgress";
import QuestionCard from "../../components/assessment/QuestionCard";
import SkillResultCard from "../../components/assessment/SkillResultCard";
import * as assessmentService from "../../services/assessment.service";
import type { GenerateQuestionsResult } from "../../services/assessment.service";
// --- Phase 4 addition: post-assessment auto-enroll ---
import * as enrollmentService from "../../services/enrollment.service";
import { useAppStore } from "../../stores/app.store";
// --- end Phase 4 addition ---
import type {
  AssessmentQuestion,
  AssessmentResult,
  PersonalizedPlan,
  QuestionFeedback,
  TrackId,
} from "../../types";
import { colors } from "../../constants/theme";
import { errorHaptic, successHaptic, tapHaptic } from "../../lib/haptics";

// ---------------------------------------------------------------------------
// "checking"          → does a saved result already exist for this track?
// "loading_questions" → backend is preparing the first progressive question
// "answering"         → candidate is typing answers, one question at a time
// "evaluating"        → local AI is scoring all 7 answers + building the plan
// "result"            → score, skill level, and per-question feedback
// ---------------------------------------------------------------------------
type ScreenState = "checking" | "loading_questions" | "answering" | "evaluating" | "result";

const QUESTION_COUNT = 7;
const MIN_ANSWER_CHARS = 12;
const MAX_ANSWER_CHARS = 700;

const EVALUATING_MESSAGES = [
  "Reading your answers...",
  "Evaluating your knowledge...",
  "Determining your level...",
  "Building your personal plan...",
];

function backendErrorMessage(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } } | undefined)
    ?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) return detail.map((item) => String(item)).join(", ");
  if ((error as { code?: string } | undefined)?.code === "ECONNABORTED") {
    return "Scoring is taking longer than expected. Keep the app open and try again.";
  }
  return fallback;
}

function scoreBadgeMeta(score: number): { container: string; label: string } {
  if (score >= 8) return { container: "bg-success/15", label: "text-success" };
  if (score >= 5) return { container: "bg-warning/15", label: "text-warning" };
  return { container: "bg-danger/15", label: "text-danger" };
}

interface FeedbackAccordionItemProps {
  feedback: QuestionFeedback;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}

function FeedbackAccordionItem({ feedback, index, expanded, onToggle }: FeedbackAccordionItemProps) {
  const badge = scoreBadgeMeta(feedback.score);

  const handleToggle = () => {
    tapHaptic();
    onToggle();
  };

  return (
    <View className="bg-background-card border border-border rounded-2xl mb-3 overflow-hidden">
      <TouchableOpacity
        onPress={handleToggle}
        activeOpacity={0.8}
        className="flex-row items-center justify-between px-4 py-4"
      >
        <View className="flex-1 pr-3">
          <Text className="text-text-muted text-xs uppercase tracking-wide mb-1">
            Question {index + 1}
          </Text>
          <Text
            className="text-text-primary text-sm font-semibold leading-5"
            numberOfLines={expanded ? undefined : 2}
          >
            {feedback.question}
          </Text>
        </View>
        <View className="items-center">
          <View className={`rounded-full px-3 py-1 mb-1.5 ${badge.container}`}>
            <Text className={`text-xs font-bold ${badge.label}`}>{feedback.score}/10</Text>
          </View>
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={16}
            color={colors.text.muted}
          />
        </View>
      </TouchableOpacity>

      {/* Mount-on-expand instead of animating height to "auto" (which the web
          AnimatedView ignores and native Moti can't tween) so the accordion
          actually opens and closes on every platform. */}
      {expanded ? (
        <AnimatedView
          from={{ opacity: 0, translateY: -6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: "timing", duration: 200 }}
        >
        <View className="px-4 pb-4">
          <View className="h-px bg-border mb-3" />

          <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mb-1">
            Your Answer
          </Text>
          <Text className="text-text-secondary text-sm leading-6 mb-3">{feedback.userAnswer}</Text>

          <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mb-1">
            Feedback
          </Text>
          <Text className="text-text-secondary text-sm leading-6 mb-3">{feedback.feedback}</Text>

          {feedback.scoreRationale ? (
            <View className="mb-3">
              <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mb-1">
                Score Rationale
              </Text>
              <Text className="text-text-secondary text-sm leading-6">{feedback.scoreRationale}</Text>
            </View>
          ) : null}

          {feedback.criteriaScores && Object.keys(feedback.criteriaScores).length > 0 ? (
            <View className="flex-row flex-wrap gap-2 mb-3">
              {Object.entries(feedback.criteriaScores).map(([criterion, value]) => (
                <View key={criterion} className="rounded-full bg-background-surface px-3 py-1">
                  <Text className="text-text-muted text-xs">
                    {criterion.replace(/_/g, " ")}{" "}
                    <Text className="text-text-secondary font-semibold">{value}/10</Text>
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {feedback.confidence !== null && feedback.confidence !== undefined ? (
            <Text className="text-text-muted text-xs mb-3">
              AI confidence: {Math.round(feedback.confidence * 100)}%
            </Text>
          ) : null}

          <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mb-1">
            Ideal Answer
          </Text>
          <Text className="text-text-secondary text-sm leading-6">{feedback.modelAnswer}</Text>
        </View>
        </AnimatedView>
      ) : null}
    </View>
  );
}

export default function AssessmentScreen() {
  const { trackId, roleId, role } = useLocalSearchParams<{
    trackId: TrackId;
    roleId?: string;
    role?: string;
  }>();
  const navigation = useNavigation();
  const router = useRouter();
  // Phase 4 addition — see `submitAssessment` below for the auto-enroll flow.
  const addEnrollment = useAppStore((s) => s.addEnrollment);

  // The target role chosen on the tracks screen before this assessment began.
  // Personalizes the questions and is persisted onto the enrollment afterward.
  const roleSelection = useMemo<assessmentService.AssessmentRoleSelection | undefined>(
    () => (roleId || role ? { targetRoleId: roleId ?? null, targetRole: role ?? null } : undefined),
    [roleId, role]
  );

  const [screenState, setScreenState] = useState<ScreenState>("checking");
  const [loadError, setLoadError] = useState<string | null>(null);

  // "answering" state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [validationError, setValidationError] = useState<string | null>(null);
  const [loadingNextQuestion, setLoadingNextQuestion] = useState(false);

  // "evaluating" state
  const [evalMessageIndex, setEvalMessageIndex] = useState(0);

  // "result" state
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [plan, setPlan] = useState<PersonalizedPlan | null>(null);
  const [expandedFeedbackId, setExpandedFeedbackId] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Loading questions (used both for the very first session and for retakes)
  // -------------------------------------------------------------------------
  const beginSession = useCallback(
    async (
      fetcher: (
        id: TrackId,
        role?: assessmentService.AssessmentRoleSelection
      ) => Promise<GenerateQuestionsResult>
    ) => {
      setScreenState("loading_questions");
      setLoadError(null);
      try {
        const session = await fetcher(trackId, roleSelection);
        setSessionId(session.sessionId);
        setQuestions(session.questions);
        setQuestionIndex(0);
        setAnswers({});
        setValidationError(null);
        setLoadingNextQuestion(false);
        setScreenState("answering");
      } catch (error) {
        console.error("[AssessmentScreen] failed to load questions:", error);
        setLoadingNextQuestion(false);
        setLoadError("We couldn't prepare your assessment. Please try again.");
      }
    },
    [trackId, roleSelection]
  );

  // -------------------------------------------------------------------------
  // "checking": look for a saved result first; otherwise start fresh.
  //
  // IMPORTANT EXCEPTION: if `roleSelection` is present it means the user just
  // picked a target role on the tracks screen and wants a brand-new assessment
  // personalized to that role — do NOT show a stale cached result that was
  // generated for a different (or missing) role. Skipping the cache check
  // here is what makes "I selected MLOps Engineer but still see Frontend
  // Developer questions" impossible.
  // -------------------------------------------------------------------------
  const bootstrap = useCallback(async () => {
    setScreenState("checking");
    setLoadError(null);

    if (!roleSelection) {
      // No explicit role chosen — show the cached result if one exists so the
      // user can review it (and retake if they want the current role applied).
      try {
        const existing = await assessmentService.getResult(trackId);
        if (existing.result) {
          setResult(existing.result);
          setPlan(existing.plan);
          setExpandedFeedbackId(null);
          setScreenState("result");
          return;
        }
      } catch (error) {
        console.error("[AssessmentScreen] failed to check for an existing result:", error);
      }
    }

    await beginSession(assessmentService.generateQuestions);
  }, [trackId, roleSelection, beginSession]);

  useEffect(() => {
    bootstrap();
    // Intentionally runs once per `trackId` — re-running on every render of
    // `bootstrap` would re-trigger the whole flow mid-assessment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  // -------------------------------------------------------------------------
  // Rule #4: back navigation is fully blocked while answering or evaluating —
  // hide the header back button + swipe gesture, replace it with a custom
  // "Exit" action that confirms before discarding progress, and intercept the
  // Android hardware back button the same way.
  // -------------------------------------------------------------------------
  // Phase 7 Agent Rule #3: this is a *destructive confirmation* (exiting
  // mid-assessment discards all in-progress answers) — it stays an `Alert`,
  // not a Toast, exactly per the rule's carve-out ("unenroll, exit session,
  // sign out... must stay as Alerts since they require user confirmation").
  const confirmExit = useCallback(() => {
    Alert.alert("Exit assessment?", "Your progress will be lost.", [
      { text: "Cancel", style: "cancel" },
      { text: "Exit", style: "destructive", onPress: () => router.back() },
    ]);
  }, [router]);

  const navigationBlocked = screenState === "answering" || screenState === "evaluating";

  useEffect(() => {
    navigation.setOptions({
      gestureEnabled: !navigationBlocked,
      headerLeft: navigationBlocked ? () => null : undefined,
      headerRight: navigationBlocked
        ? () => (
            <TouchableOpacity
              onPress={() => {
                tapHaptic();
                confirmExit();
              }}
              hitSlop={8}
              className="px-2 py-1"
            >
              <Text className="text-text-secondary text-base font-medium">Exit</Text>
            </TouchableOpacity>
          )
        : undefined,
    });
  }, [navigation, navigationBlocked, confirmExit]);

  useEffect(() => {
    if (!navigationBlocked) return undefined;

    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      confirmExit();
      return true; // swallow the event — never let the OS pop this screen
    });

    return () => subscription.remove();
  }, [navigationBlocked, confirmExit]);

  // -------------------------------------------------------------------------
  // "answering": one question at a time, "Next" gated on a 20-char minimum
  // -------------------------------------------------------------------------
  const currentQuestion = questions[questionIndex] ?? null;
  const currentAnswer = currentQuestion ? answers[currentQuestion.id] ?? "" : "";
  const isLastQuestion = questionIndex === QUESTION_COUNT - 1;
  const meetsMinChars = currentAnswer.trim().length >= MIN_ANSWER_CHARS;

  const handleChangeAnswer = useCallback(
    (text: string) => {
      if (!currentQuestion) return;
      setAnswers((previous) => ({ ...previous, [currentQuestion.id]: text }));
      setValidationError(null);
    },
    [currentQuestion]
  );

  const ensureQuestion = useCallback(
    async (questionNumber: number) => {
      const existing = questions[questionNumber - 1];
      if (existing) return existing;
      if (!sessionId) {
        throw new Error("Assessment session is not ready yet.");
      }

      setLoadingNextQuestion(true);
      try {
        const response = await assessmentService.getSessionQuestion(sessionId, questionNumber);
        setQuestions((previous) => {
          const next = [...previous];
          next[questionNumber - 1] = response.question;
          return next;
        });
        return response.question;
      } finally {
        setLoadingNextQuestion(false);
      }
    },
    [questions, sessionId]
  );

  const submitAssessment = useCallback(
    async (finalAnswers: Record<string, string>) => {
      if (!sessionId) return;
      setScreenState("evaluating");
      try {
        const submission = await assessmentService.submitAssessment(sessionId, trackId, finalAnswers);
        setResult(submission.result);
        setPlan(submission.plan);
        setExpandedFeedbackId(null);
        setScreenState("result");
        // Phase 7 polish: "assessment completed" is exactly the kind of key
        // milestone the spec calls out for a success notification — local AI
        // just finished scoring all 7 answers and built a personalized plan.
        successHaptic();

        // ---------------------------------------------------------------
        // Phase 4: auto-enroll — fire-and-forget. The candidate is already
        // looking at their result; enrollment happens silently behind it.
        // `enroll` is idempotent server-side (Agent Rule #4), so this is
        // safe even if they'd somehow already enrolled. A failure here is
        // logged only — "View My Plan" below still works regardless (the
        // plan was just generated by /submit), and the candidate can always
        // enroll manually from the tracks screen as a fallback.
        // ---------------------------------------------------------------
        enrollmentService
          .enroll(
            trackId,
            roleSelection ? { targetRoleId: roleSelection.targetRoleId ?? undefined, targetRole: roleSelection.targetRole ?? undefined } : undefined
          )
          .then((enrollment) => addEnrollment(enrollment))
          .catch((enrollError) =>
            console.error("[AssessmentScreen] auto-enroll failed:", enrollError)
          );
      } catch (error) {
        console.error("[AssessmentScreen] submit failed:", error);
        // Phase 7 Agent Rule #3: this is an *error notification*, not a
        // destructive confirmation (there's nothing to confirm — the answers
        // are still intact and the user just needs to know the scoring
        // attempt failed), so it converts from `Alert.alert` to a `Toast`.
        // The previous `Alert`'s only real job — returning the user to the
        // "answering" state so they can retry — happens immediately rather
        // than waiting on an "OK" tap, since their answers are untouched and
        // there's no risk in resuming right away.
        errorHaptic();
        Toast.show({
          type: "error",
          text1: "Something went wrong",
          text2: backendErrorMessage(error, "We couldn't score your assessment. Please try again."),
        });
        setScreenState("answering");
      }
    },
    [sessionId, trackId, addEnrollment, roleSelection]
  );

  const handleNext = useCallback(async () => {
    if (!currentQuestion || !meetsMinChars || loadingNextQuestion) return;

    if (!isLastQuestion) {
      try {
        await ensureQuestion(questionIndex + 2);
        setQuestionIndex((index) => index + 1);
      } catch (error) {
        console.error("[AssessmentScreen] failed to load next question:", error);
        errorHaptic();
        Toast.show({
          type: "error",
          text1: "Question unavailable",
          text2: "Check the backend connection and try again.",
        });
      }
      return;
    }

    if (!sessionId) return;

    let resolvedQuestions = [...questions];
    setLoadingNextQuestion(true);
    try {
      for (let number = 1; number <= QUESTION_COUNT; number += 1) {
        if (resolvedQuestions[number - 1]) continue;
        const response = await assessmentService.getSessionQuestion(sessionId, number);
        resolvedQuestions[number - 1] = response.question;
      }
      setQuestions(resolvedQuestions);
    } catch (error) {
      console.error("[AssessmentScreen] failed to verify assessment questions:", error);
      errorHaptic();
      Toast.show({
        type: "error",
        text1: "Assessment not ready",
        text2: "We couldn't load every question for scoring. Please try again.",
      });
      setLoadingNextQuestion(false);
      return;
    }
    setLoadingNextQuestion(false);

    // Final question — re-validate every answer before bundling the submission.
    const tooShort = resolvedQuestions
      .map((question, index) => ({ index, length: (answers[question.id] ?? "").trim().length }))
      .filter((entry) => entry.length < MIN_ANSWER_CHARS);

    if (tooShort.length > 0) {
      setValidationError(
        `Please add a bit more detail to question ${tooShort
          .map((entry) => entry.index + 1)
          .join(", ")} (at least ${MIN_ANSWER_CHARS} characters each) before submitting.`
      );
      return;
    }

    const finalAnswers = Object.fromEntries(
      resolvedQuestions.map((question) => [question.id, (answers[question.id] ?? "").trim()])
    );

    submitAssessment(finalAnswers);
  }, [
    currentQuestion,
    meetsMinChars,
    loadingNextQuestion,
    isLastQuestion,
    sessionId,
    questions,
    answers,
    submitAssessment,
    ensureQuestion,
    questionIndex,
  ]);

  // -------------------------------------------------------------------------
  // "evaluating": cycle the status copy every 2.5s while local AI scores + plans
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (screenState !== "evaluating") return undefined;

    setEvalMessageIndex(0);
    const intervalId = setInterval(() => {
      setEvalMessageIndex((index) => (index + 1) % EVALUATING_MESSAGES.length);
    }, 2500);

    return () => clearInterval(intervalId);
  }, [screenState]);

  // -------------------------------------------------------------------------
  // "result": retake restarts the whole flow from "loading_questions"
  // -------------------------------------------------------------------------
  const handleRetake = useCallback(() => {
    beginSession(assessmentService.retake);
  }, [beginSession]);

  const handleViewPlan = useCallback(() => {
    router.push(`/plan/${trackId}`);
  }, [router, trackId]);

  const toggleFeedback = useCallback((questionId: string) => {
    setExpandedFeedbackId((current) => (current === questionId ? null : questionId));
  }, []);

  // =========================================================================
  // Render
  // =========================================================================

  if (screenState === "checking") {
    return <LoadingSpinner fullScreen size="large" />;
  }

  if (screenState === "loading_questions") {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <View className="flex-1 items-center justify-center px-10">
          <LoadingSpinner size="large" />
          <Text className="text-text-primary text-base font-semibold mt-5 text-center">
            {loadError ?? "Preparing your assessment..."}
          </Text>
          {!loadError ? (
            <Text className="text-text-muted text-sm text-center mt-2">
              Your first question loads immediately while local AI refines the rest in the background.
            </Text>
          ) : (
            <Button
              label="Try Again"
              size="md"
              variant="secondary"
              onPress={() => beginSession(assessmentService.generateQuestions)}
            />
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (screenState === "answering") {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom", "left", "right"]}>
        {/* Phase 7 polish: this is the app's primary free-text input screen —
            wrap it in KeyboardAvoidingView (so the "Next/Submit" button never
            sits underneath the keyboard on iOS) and a tap-to-dismiss layer
            (so tapping anywhere outside the multiline TextInput closes the
            keyboard, matching standard form UX). */}
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          className="flex-1"
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View className="flex-1">
              <ScrollView
                className="flex-1 px-5"
                contentContainerStyle={{ paddingTop: 16, paddingBottom: 24 }}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <AssessmentProgress current={questionIndex + 1} total={QUESTION_COUNT} />

                <View className="mt-5">
                  {currentQuestion ? (
                    <QuestionCard
                      question={currentQuestion}
                      value={currentAnswer}
                      onChangeText={handleChangeAnswer}
                      minChars={MIN_ANSWER_CHARS}
                      maxChars={MAX_ANSWER_CHARS}
                    />
                  ) : (
                    <View className="bg-background-card border border-border rounded-2xl p-8 items-center">
                      <LoadingSpinner size="large" />
                      <Text className="text-text-primary text-sm font-semibold mt-4">
                        Loading your next question...
                      </Text>
                    </View>
                  )}
                </View>

                {validationError ? (
                  <View className="bg-danger/10 border border-danger rounded-xl px-4 py-3 mt-4">
                    <Text className="text-danger text-sm">{validationError}</Text>
                  </View>
                ) : null}
              </ScrollView>

              <View className="px-5 pb-4 pt-2 border-t border-border bg-background">
                <Button
                  label={
                    loadingNextQuestion
                      ? "Loading Question"
                      : isLastQuestion
                        ? "Score Assessment"
                        : "Save & Continue"
                  }
                  onPress={handleNext}
                  disabled={!meetsMinChars || loadingNextQuestion}
                  loading={loadingNextQuestion}
                  fullWidth
                />
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  if (screenState === "evaluating") {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <View className="flex-1 items-center justify-center px-10">
          <AnimatedView
            from={{ scale: 0.9, opacity: 0.6 }}
            animate={{ scale: 1.05, opacity: 1 }}
            transition={{ type: "timing", duration: 900, loop: true }}
          >
            <LoadingSpinner size="large" />
          </AnimatedView>

          <AnimatedView
            key={evalMessageIndex}
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: "timing", duration: 280 }}
            className="mt-6"
          >
            <Text className="text-text-primary text-base font-semibold text-center">
              {EVALUATING_MESSAGES[evalMessageIndex]}
            </Text>
          </AnimatedView>

          <Text className="text-text-muted text-sm text-center mt-2">
            Your section answers are scored together. This usually takes less than a minute.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // screenState === "result"
  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom", "left", "right"]}>
      <ScrollView
        className="flex-1 px-5"
        contentContainerStyle={{ paddingTop: 20, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {result ? (
          <SkillResultCard skillLevel={result.skillLevel} score={result.score} breakdown={result.breakdown} />
        ) : null}

        {result && result.perQuestionFeedback.length > 0 ? (
          <View className="mt-8">
            <Text className="text-text-primary text-lg font-semibold mb-3">Question Breakdown</Text>
            <Text className="text-text-muted text-xs mb-4">
              Tap a question to see your answer, local AI feedback, and the ideal answer.
            </Text>
            {result.perQuestionFeedback.map((feedback, index) => (
              <FeedbackAccordionItem
                key={feedback.questionId}
                feedback={feedback}
                index={index}
                expanded={expandedFeedbackId === feedback.questionId}
                onToggle={() => toggleFeedback(feedback.questionId)}
              />
            ))}
          </View>
        ) : null}

        <View className="mt-4 gap-3">
          <Button label="View My Plan" onPress={handleViewPlan} fullWidth disabled={!plan} />
          <Button label="Retake Assessment" variant="ghost" onPress={handleRetake} fullWidth />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

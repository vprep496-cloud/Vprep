import { useState } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import AnimatedView from "../../../../components/ui/AnimatedView";
import BrandedHeader from "../../../../components/ui/BrandedHeader";

import Button from "../../../../components/ui/Button";
import ErrorState from "../../../../components/ui/ErrorState";
import Skeleton from "../../../../components/ui/Skeleton";
import ScoreBreakdown from "../../../../components/interview/ScoreBreakdown";
import * as interviewService from "../../../../services/interview.service";
import * as enrollmentService from "../../../../services/enrollment.service";
import type {
  AudioMetrics,
  CodeAnalysis,
  InterviewQuestionAnswer,
  InterviewSessionResult,
  StarAnalysis,
  Track,
} from "../../../../types";
import { colors, radius, trackColors } from "../../../../constants/theme";
import { tapHaptic } from "../../../../lib/haptics";

const TRACK_NAMES: Record<string, string> = {
  ml_ai: "ML & AI",
  web_dev: "Web Dev",
  devops: "DevOps",
  data_science: "Data Science",
  cloud: "Cloud",
  mobile_dev: "Mobile Dev",
};

const MODE_LABELS: Record<string, string> = {
  hr: "HR Only",
  technical: "Technical + Coding",
  behavioral: "Behavioral Only",
  full_mock: "Full Mock",
};

const PHASE_LABELS: Record<string, string> = {
  hr: "HR Round",
  technical: "Technical Round",
  coding_logic: "Coding Logic",
  behavioral: "Behavioral Round",
};

function scoreBadgeMeta(score: number): { container: string; label: string } {
  if (score >= 70) return { container: "bg-success/15", label: "text-success" };
  if (score >= 50) return { container: "bg-warning/15", label: "text-warning" };
  return { container: "bg-danger/15", label: "text-danger" };
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

// ── STAR Analysis Badge Row ────────────────────────────────────────────────────
// Shows which STAR components were detected in a behavioral voice answer.
// Source priority: LLM star_analysis > rule-based star_signals from audio_metrics.
interface StarBadgesProps {
  starAnalysis?: StarAnalysis | null;
  audioMetrics?: AudioMetrics | null;
}

function StarBadges({ starAnalysis, audioMetrics }: StarBadgesProps) {
  // Merge LLM analysis (more accurate) with rule-based signals (always available)
  const signals = audioMetrics?.star_signals;
  const components: { key: keyof StarAnalysis & string; label: string }[] = [
    { key: "situation", label: "S" },
    { key: "task",      label: "T" },
    { key: "action",    label: "A" },
    { key: "result",    label: "R" },
  ];

  const isPresent = (key: string): boolean => {
    if (starAnalysis) return Boolean((starAnalysis as unknown as Record<string, unknown>)[key]);
    if (signals)      return Boolean((signals as unknown as Record<string, unknown>)[key]);
    return false;
  };

  const completenessScore = starAnalysis?.completeness_score ?? null;
  const detectedCount = components.filter((c) => isPresent(c.key)).length;

  return (
    <View className="mb-3">
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide">
          STAR Structure
        </Text>
        {completenessScore !== null ? (
          <Text className="text-text-muted text-xs">
            <Text
              className="font-bold"
              style={{
                color:
                  completenessScore >= 75
                    ? colors.success
                    : completenessScore >= 50
                    ? colors.warning
                    : colors.danger,
              }}
            >
              {completenessScore}
            </Text>
            /100
          </Text>
        ) : (
          <Text className="text-text-muted text-xs">{detectedCount}/4 detected</Text>
        )}
      </View>
      <View className="flex-row gap-2">
        {components.map(({ key, label }) => {
          const detected = isPresent(key);
          return (
            <View
              key={key}
              className="flex-row items-center gap-1 rounded-full px-3 py-1"
              style={{
                backgroundColor: detected ? `${colors.success}22` : colors.background?.surface ?? "#F4F4F5",
                borderWidth: 1,
                borderColor: detected ? colors.success : colors.borderSoft ?? "#E4E4E7",
              }}
            >
              <Ionicons
                name={detected ? "checkmark-circle" : "ellipse-outline"}
                size={12}
                color={detected ? colors.success : colors.text?.muted}
              />
              <Text
                className="text-xs font-bold"
                style={{ color: detected ? colors.success : colors.text?.muted }}
              >
                {label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}


// ── Audio Delivery + Linguistic Metrics Card ───────────────────────────────────
// Compact summary of the professional voice analytics for voice answers.
function AudioMetricsCard({ metrics }: { metrics: AudioMetrics }) {
  type Pill = { label: string; value: string; color: string };
  const pills: Pill[] = [];

  // Speech rate
  if (metrics.words_per_minute != null) {
    const wpm = metrics.words_per_minute;
    pills.push({
      label: "Pace",
      value: `${Math.round(wpm)} WPM`,
      color: wpm >= 110 && wpm <= 170 ? colors.success : colors.warning,
    });
  }

  // Filler words
  if (metrics.filler_word_ratio_pct != null) {
    const pct = metrics.filler_word_ratio_pct;
    pills.push({
      label: "Fillers",
      value: `${pct.toFixed(1)}%`,
      color: pct < 3 ? colors.success : pct < 7 ? colors.warning : colors.danger,
    });
  }

  // Vocabulary richness
  if (metrics.vocabulary_richness_pct != null) {
    const pct = metrics.vocabulary_richness_pct;
    pills.push({
      label: "Vocab",
      value: `${Math.round(pct)}%`,
      color: pct >= 70 ? colors.success : pct >= 55 ? colors.warning : colors.danger,
    });
  }

  // Ownership language
  if (metrics.ownership_score != null) {
    const score = metrics.ownership_score;
    pills.push({
      label: "Ownership",
      value: score >= 60 ? "Strong" : score >= 30 ? "Moderate" : "Weak",
      color: score >= 60 ? colors.success : score >= 30 ? colors.warning : colors.danger,
    });
  }

  // Specificity
  if (metrics.specificity_score != null) {
    const score = metrics.specificity_score;
    pills.push({
      label: "Specificity",
      value: score >= 40 ? "High" : score >= 15 ? "Medium" : "Low",
      color: score >= 40 ? colors.success : score >= 15 ? colors.warning : colors.danger,
    });
  }

  if (pills.length === 0) return null;

  return (
    <View className="mb-3">
      <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mb-2">
        Delivery Analytics
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {pills.map((pill) => (
          <View
            key={pill.label}
            className="rounded-full px-3 py-1"
            style={{ backgroundColor: `${pill.color}18`, borderWidth: 1, borderColor: `${pill.color}55` }}
          >
            <Text className="text-xs">
              <Text className="text-text-muted">{pill.label}: </Text>
              <Text className="font-bold" style={{ color: pill.color }}>
                {pill.value}
              </Text>
            </Text>
          </View>
        ))}
      </View>
      {metrics.total_words != null && (
        <Text className="text-text-muted text-xs mt-1.5">
          {metrics.total_words} words · {metrics.speaking_duration_seconds != null ? `${Math.round(metrics.speaking_duration_seconds)}s speaking` : ""}
          {metrics.pause_count != null && metrics.pause_count > 0 ? ` · ${metrics.pause_count} long pause${metrics.pause_count > 1 ? "s" : ""}` : ""}
        </Text>
      )}
    </View>
  );
}


// ── Code Analysis Card (qwen2.5-coder) ────────────────────────────────────────
// Displays algorithm category, Big-O complexity, optimality, and language
// detected for coding_logic_image answers scored by qwen2.5-coder.
function CodeAnalysisCard({ analysis }: { analysis: CodeAnalysis }) {
  // Human-readable label for algorithm_category (replace underscores)
  const categoryLabel = analysis.algorithmCategory
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const isOptimalColor  = analysis.isOptimal ? colors.success : colors.warning;
  const correctColor    = analysis.mainCaseCorrect ? colors.success : colors.danger;
  const langLabel       = analysis.languageDetected === "unknown" ? "Detected Language" : analysis.languageDetected;

  type Row = { icon: string; label: string; value: string; valueColor?: string };
  const rows: Row[] = [
    {
      icon:  "git-branch-outline",
      label: "Algorithm",
      value: categoryLabel || "Unknown",
    },
    {
      icon:  "timer-outline",
      label: "Time Complexity",
      value: analysis.timeComplexity || "Unknown",
      valueColor: colors.secondary,
    },
    {
      icon:  "layers-outline",
      label: "Space Complexity",
      value: analysis.spaceComplexity || "Unknown",
      valueColor: colors.secondary,
    },
    {
      icon:  "checkmark-done-outline",
      label: "Main Case",
      value: analysis.mainCaseCorrect ? "Correct ✓" : "Incorrect ✗",
      valueColor: correctColor,
    },
    {
      icon:  "rocket-outline",
      label: "Optimal",
      value: analysis.isOptimal ? "Yes ✓" : "Not optimal",
      valueColor: isOptimalColor,
    },
  ];

  if (analysis.languageDetected && analysis.languageDetected !== "unknown") {
    rows.splice(1, 0, {
      icon:  "code-slash-outline",
      label: "Language",
      value: langLabel.charAt(0).toUpperCase() + langLabel.slice(1),
    });
  }

  return (
    <View className="mb-3">
      <View className="flex-row items-center gap-1.5 mb-2">
        <Ionicons name="analytics-outline" size={13} color={colors.text?.muted} />
        <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide">
          Code Analysis
        </Text>
        <View
          className="rounded-full px-2 py-0.5 ml-1"
          style={{ backgroundColor: `${colors.secondary}20` }}
        >
          <Text className="text-xs font-bold" style={{ color: colors.secondary }}>
            AI
          </Text>
        </View>
      </View>

      <View
        className="rounded-xl p-3"
        style={{
          backgroundColor: colors.background?.surface ?? "#F4F4F5",
          borderWidth: 1,
          borderColor: colors.borderSoft ?? "#E4E4E7",
        }}
      >
        {rows.map((row, i) => (
          <View
            key={row.label}
            className="flex-row items-center justify-between"
            style={{ paddingVertical: 5, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: colors.borderSoft ?? "#E4E4E7" }}
          >
            <View className="flex-row items-center gap-1.5">
              <Ionicons name={row.icon as keyof typeof Ionicons.glyphMap} size={13} color={colors.text?.muted} />
              <Text className="text-text-muted text-xs">{row.label}</Text>
            </View>
            <Text
              className="text-xs font-semibold"
              style={{ color: row.valueColor ?? (colors.text?.primary || "#18181B") }}
            >
              {row.value}
            </Text>
          </View>
        ))}
      </View>

      {/* Reconstructed code — collapsible code block */}
      {analysis.reconstructedCode ? (
        <View
          className="mt-2 rounded-xl p-3"
          style={{ backgroundColor: "#0D0D0D" }}
        >
          <Text className="text-xs font-semibold mb-1.5" style={{ color: colors.secondary }}>
            Reconstructed Code
          </Text>
          <Text
            className="text-xs leading-5"
            style={{ fontFamily: "monospace", color: "#D4D4D4" }}
            selectable
          >
            {analysis.reconstructedCode}
          </Text>
        </View>
      ) : null}
    </View>
  );
}


interface AnswerAccordionItemProps {
  answer: InterviewQuestionAnswer;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}

function AnswerAccordionItem({ answer, index, expanded, onToggle }: AnswerAccordionItemProps) {
  const isPending =
    answer.codingScoreStatus === "pending" ||
    answer.codingScoreStatus === "processing" ||
    answer.voiceScoreStatus === "pending" ||
    answer.voiceScoreStatus === "processing";
  const isFailed =
    answer.codingScoreStatus === "failed" ||
    answer.voiceScoreStatus === "failed";
  const badge = isPending ? null : scoreBadgeMeta(answer.score);

  const handleToggle = () => {
    tapHaptic();
    onToggle();
  };

  return (
    <View className="bg-background-card border border-border-soft rounded-2xl mb-3 overflow-hidden">
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
            {answer.questionText}
          </Text>
        </View>
        <View className="items-center gap-1.5">
          {isPending ? (
            <View className="rounded-full px-3 py-1 bg-warning/15">
              <Text className="text-xs font-bold text-warning">Scoring…</Text>
            </View>
          ) : isFailed ? (
            <View className="rounded-full px-3 py-1 bg-warning/15">
              <Text className="text-xs font-bold text-warning">Review needed</Text>
            </View>
          ) : badge ? (
            <View className={`rounded-full px-3 py-1 ${badge.container}`}>
              <Text className={`text-xs font-bold ${badge.label}`}>{answer.score}/100</Text>
            </View>
          ) : null}
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.text.muted} />
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
          <View className="h-px bg-border-soft mb-3" />

          {/* Phase 7 spec: voice transcriptions rendered in italic muted style
              with a mic icon prefix — distinguishes "what the AI heard" from
              intentional typed text at a glance. */}
          {answer.answerType === "voice" || answer.answerType === "image" ? (
            <View className="mb-3">
              <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mb-1">
                {answer.answerType === "voice" ? "What we heard" : "What local OCR read"}
              </Text>
              <View className="flex-row items-start gap-1.5">
                <Ionicons
                  name={answer.answerType === "voice" ? "mic-outline" : "image-outline"}
                  size={13}
                  color={colors.text.muted}
                  style={{ marginTop: 3 }}
                />
                <Text className="text-text-secondary text-sm leading-6 flex-1 italic">
                  {answer.transcription ?? "—"}
                </Text>
              </View>
            </View>
          ) : (
            <View className="mb-3">
              <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mb-1">
                Your Answer
              </Text>
              <Text className="text-text-secondary text-sm leading-6">{answer.userTextAnswer ?? "—"}</Text>
            </View>
          )}

          {/* STAR structure analysis — behavioral voice answers only */}
          {answer.answerType === "voice" && answer.phase === "behavioral" && (
            answer.starAnalysis || (answer.scoringMetadata as Record<string, unknown>)?.audio_metrics
          ) ? (
            <StarBadges
              starAnalysis={answer.starAnalysis}
              audioMetrics={
                ((answer.scoringMetadata as Record<string, unknown>)?.audio_metrics as AudioMetrics) ?? null
              }
            />
          ) : null}

          {/* Audio delivery + linguistic analytics — all voice answers */}
          {answer.answerType === "voice" &&
          (answer.scoringMetadata as Record<string, unknown>)?.audio_metrics ? (
            <AudioMetricsCard
              metrics={(answer.scoringMetadata as Record<string, unknown>).audio_metrics as AudioMetrics}
            />
          ) : null}

          {/* Code Analysis from qwen2.5-coder — coding_logic image answers */}
          {answer.answerType === "image" && answer.codeAnalysis ? (
            <CodeAnalysisCard analysis={answer.codeAnalysis} />
          ) : null}

          <View className="mb-3">
            <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mb-1">
              Feedback
            </Text>
            <Text className="text-text-secondary text-sm leading-6">{answer.feedback}</Text>
          </View>

          {answer.confidence !== null && answer.confidence !== undefined ? (
            <View className="mb-3 flex-row flex-wrap gap-2">
              <View className="rounded-full px-3 py-1 bg-background-surface">
                <Text className="text-text-muted text-xs">
                  AI confidence:{" "}
                  <Text className="text-text-secondary font-semibold">{Math.round(answer.confidence * 100)}%</Text>
                </Text>
              </View>
              {(answer.reviewFlags ?? []).map((flag) => (
                <View key={flag} className="rounded-full bg-warning/15 px-3 py-1">
                  <Text className="text-warning text-xs font-semibold">{flag.replace(/_/g, " ")}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {answer.scoreRationale ? (
            <View className="mb-3">
              <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mb-1">
                Score Rationale
              </Text>
              <Text className="text-text-secondary text-sm leading-6">{answer.scoreRationale}</Text>
            </View>
          ) : null}

          {/* Phase 7 spec: "Ideal Answer" in a visually distinct card with a
              left accent border in the secondary color and an "Ideal Answer"
              label in the top-left corner. */}
          <View
            className="rounded-xl bg-background-surface p-3 mb-3"
            style={{ borderLeftWidth: 3, borderLeftColor: colors.secondary }}
          >
            <Text className="text-xs font-semibold mb-1.5" style={{ color: colors.secondary }}>
              Ideal Answer
            </Text>
            <Text className="text-text-secondary text-sm leading-6">{answer.modelAnswer}</Text>
          </View>

          {Object.keys(answer.criteriaScores).length > 0 ? (
            <View className="flex-row flex-wrap gap-2">
              {Object.entries(answer.criteriaScores).map(([criterion, value]) => (
                <View key={criterion} className="rounded-full px-3 py-1 bg-background-surface">
                  <Text className="text-text-muted text-xs">
                    {criterion.replace(/_/g, " ")}:{" "}
                    <Text className="text-text-secondary font-semibold">{value}/10</Text>
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
        </AnimatedView>
      ) : null}
    </View>
  );
}

export default function InterviewResultsScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const [expandedAnswerId, setExpandedAnswerId] = useState<string | null>(null);

  const sessionQuery = useQuery<InterviewSessionResult>({
    queryKey: ["interview", "session", sessionId],
    queryFn: () => interviewService.getSession(sessionId),
    enabled: !!sessionId,
    // Auto-poll while any background-scored answer is still pending/processing.
    // The backend merges live answer data into phase_results on every GET, so
    // a refetch picks up the final score + code_analysis once the job finishes.
    // Uses the function form of refetchInterval so it evaluates the current data
    // without needing a separate state variable or hook ordering issue.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const hasPending = data.phaseResults
        .flatMap((pr) => pr.answers)
        .some(
          (a) =>
            a.codingScoreStatus === "pending" ||
            a.codingScoreStatus === "processing" ||
            a.voiceScoreStatus === "pending" ||
            a.voiceScoreStatus === "processing"
        );
      return hasPending ? 8000 : false;
    },
  });
  const tracksQuery = useQuery({
    queryKey: ["tracks"],
    queryFn: enrollmentService.getTracks,
  });

  // Same pre-existing `useQuery` generic-inference gap documented in
  // `plan/[trackId].tsx` (this repo's `typescript: ~5.3.3` predates the
  // `NoInfer<T>` utility that @tanstack/react-query@5's types lean on, so
  // `.data` collapses to `any` under `skipLibCheck`) — an explicit
  // assertion keeps `session` properly typed without touching that
  // Phase-1-owned dependency pin.
  const session = (sessionQuery.data ?? null) as InterviewSessionResult | null;

  const toggleAnswer = (questionId: string) => {
    setExpandedAnswerId((current) => (current === questionId ? null : questionId));
  };

  const handlePracticeAgain = () => {
    if (!session) return;
    tapHaptic();
    router.replace({
      pathname: "/(app)/interview",
      params: { trackId: session.trackId },
    });
  };

  const handleViewPlan = () => {
    if (!session) return;
    tapHaptic();
    router.push(`/(app)/plan/${session.trackId}`);
  };

  if (sessionQuery.isLoading) {
    // Phase 7 polish: skeleton shaped like the results layout — breadcrumb +
    // score ring area + phase breakdown bars + question list stubs.
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom", "left", "right"]}>
        <View className="px-5 pt-5">
          <Skeleton width="45%" height={14} />
          <Skeleton width="65%" height={26} style={{ marginTop: 10 }} />
          <Skeleton width="55%" height={12} style={{ marginTop: 8, marginBottom: 24 }} />
          <View className="items-center mb-6">
            <Skeleton width={140} height={140} borderRadius={70} />
          </View>
          {[0, 1, 2].map((i) => (
            <View key={i} className="bg-background-card border border-border rounded-2xl p-4 mb-3">
              <View className="flex-row items-center justify-between">
                <Skeleton width="40%" height={14} />
                <Skeleton width={60} height={26} borderRadius={radius.full} />
              </View>
              <Skeleton width="100%" height={8} borderRadius={radius.sm} style={{ marginTop: 12 }} />
            </View>
          ))}
        </View>
      </SafeAreaView>
    );
  }

  if (sessionQuery.isError || !session) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <ErrorState
          title="Couldn't load results"
          message="We couldn't load this interview's results."
          onRetry={() => sessionQuery.refetch()}
        />
      </SafeAreaView>
    );
  }

  const track = (tracksQuery.data ?? []).find((item: Track) => item.id === session.trackId);
  const trackName = track?.name ?? TRACK_NAMES[session.trackId] ?? session.trackId;
  const accent = trackColors[session.trackId] ?? colors.primary[500];
  const allAnswers = session.phaseResults.flatMap((phaseResult) => phaseResult.answers);
  const pendingCodingAnswers = allAnswers.filter(
    (a) => a.codingScoreStatus === "pending" || a.codingScoreStatus === "processing"
  );
  const pendingVoiceAnswers = allAnswers.filter(
    (a) => a.voiceScoreStatus === "pending" || a.voiceScoreStatus === "processing"
  );
  const anyScoresPending = pendingCodingAnswers.length > 0 || pendingVoiceAnswers.length > 0;
  const strengths = allAnswers
    .filter((answer) => answer.score >= 75)
    .slice(0, 2)
    .map((answer) => answer.feedback);
  const growthAreas = allAnswers
    .filter((answer) => answer.score < 75)
    .sort((a, b) => a.score - b.score)
    .slice(0, 2)
    .map((answer) => answer.feedback);

  return (
    <View className="flex-1 bg-background">
      <BrandedHeader
        title="Results"
        subtitle="Your AI feedback report"
        showBack
        rightIcon2="notifications-outline"
        onRightPress2={() => router.push("/(app)/notifications")}
      />
      <SafeAreaView className="flex-1" edges={["bottom", "left", "right"]}>
      <ScrollView
        className="flex-1 px-5"
        contentContainerStyle={{ paddingTop: 20, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        <AnimatedView
          from={{ opacity: 0, translateY: -10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: "timing", duration: 350 }}
        >
          <View className="flex-row items-center gap-2 mb-1">
            <View className="w-2 h-2 rounded-full" style={{ backgroundColor: accent }} />
            <Text className="text-text-secondary text-sm font-semibold">
              {trackName} · {MODE_LABELS[session.mode] ?? session.mode}
            </Text>
          </View>
          <Text className="text-text-primary text-2xl font-bold mb-1">Interview Results</Text>
          <Text className="text-text-muted text-xs mb-6">
            Completed in {formatDuration(session.durationSeconds)} ·{" "}
            {new Date(session.completedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </Text>
        </AnimatedView>

        <AnimatedView
          from={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "timing", duration: 400, delay: 150 }}
        >
          <ScoreBreakdown overallScore={session.overallScore} phaseResults={session.phaseResults} />
        </AnimatedView>

        {/* "You can navigate away" banner — shown while any background scoring is in progress */}
        {anyScoresPending && (
          <AnimatedView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: "timing", duration: 280, delay: 180 }}
            className="mt-4 rounded-2xl border border-secondary/30 bg-secondary/5 p-3 flex-row items-center gap-3"
          >
            <Ionicons name="information-circle-outline" size={18} color={colors.secondary} />
            <Text className="text-xs text-text-secondary flex-1 leading-4">
              <Text className="font-semibold">You can use the rest of the app.</Text>
              {" "}Scoring runs in the background — this page refreshes automatically and you'll receive a push notification when each score is ready.
            </Text>
          </AnimatedView>
        )}

        {/* Voice score pending banner */}
        {pendingVoiceAnswers.length > 0 && (
          <AnimatedView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: "timing", duration: 280, delay: 220 }}
            className="mt-3 rounded-2xl border border-success/30 bg-success/5 p-4 flex-row items-center gap-3"
          >
            <View className="h-10 w-10 items-center justify-center rounded-full bg-success/10">
              <Ionicons name="mic-outline" size={20} color={colors.success} />
            </View>
            <View className="flex-1">
              <Text className="text-sm font-bold text-text-primary">
                {pendingVoiceAnswers.length} voice score{pendingVoiceAnswers.length > 1 ? "s" : ""} processing
              </Text>
              <Text className="text-xs text-text-muted mt-0.5 leading-4">
                Whisper is transcribing your recordings and AI is scoring them. Usually ready within 1–3 minutes.
              </Text>
            </View>
          </AnimatedView>
        )}

        {/* Coding score pending banner */}
        {pendingCodingAnswers.length > 0 && (
          <AnimatedView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: "timing", duration: 280, delay: 260 }}
            className="mt-3 rounded-2xl border border-warning/40 bg-warning/10 p-4 flex-row items-center gap-3"
          >
            <View className="h-10 w-10 items-center justify-center rounded-full bg-warning/20">
              <Ionicons name="hourglass-outline" size={20} color={colors.warning} />
            </View>
            <View className="flex-1">
              <Text className="text-sm font-bold text-text-primary">
                Coding score{pendingCodingAnswers.length > 1 ? "s" : ""} processing
              </Text>
              <Text className="text-xs text-text-muted mt-0.5 leading-4">
                OCR + AI scoring is running in the background. Usually ready within 3–5 minutes.
              </Text>
            </View>
          </AnimatedView>
        )}

        <View className="mt-5 gap-4">
          <View className="rounded-2xl bg-[#143D1F] p-5">
            <View className="mb-3 flex-row items-center gap-2">
              <Ionicons name="star" size={18} color="#ABD0A9" />
              <Text className="text-xl font-bold text-[#C6EDC4]">Top Strengths</Text>
            </View>
            {(strengths.length > 0 ? strengths : ["Clear effort and willingness to complete the full interview flow."]).map(
              (item, index) => (
                <View key={index} className="mb-2 rounded-xl bg-white/10 p-3">
                  <Text className="text-sm leading-5 text-[#E6F6E5]">{item}</Text>
                </View>
              )
            )}
          </View>

          <View className="rounded-2xl border border-border-soft bg-background-surface p-5">
            <View className="mb-3 flex-row items-center gap-2">
              <Ionicons name="trending-up" size={18} color={colors.secondary} />
              <Text className="text-xl font-bold text-primary-700">Growth Areas</Text>
            </View>
            {(growthAreas.length > 0 ? growthAreas : ["Retake a focused round to collect more detailed improvement signals."]).map(
              (item, index) => (
                <View key={index} className="mb-2 rounded-xl border border-border-soft bg-background-card p-3">
                  <Text className="text-sm leading-5 text-text-secondary">{item}</Text>
                </View>
              )
            )}
          </View>
        </View>

        {allAnswers.length > 0 ? (
          <View className="mt-8">
            <Text className="text-text-primary text-lg font-semibold mb-3">Question-by-Question</Text>
            <Text className="text-text-muted text-xs mb-4">
              Tap a question to see your answer, local AI feedback, and the ideal answer.
            </Text>
            {session.phaseResults.map((phaseResult, phaseIndex) => (
              <View key={phaseResult.phase} className="mb-2">
                <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mb-2 px-1">
                  {PHASE_LABELS[phaseResult.phase] ?? phaseResult.phase}
                </Text>
                {phaseResult.answers.map((answer, index) => (
                  <AnimatedView
                    key={answer.questionId}
                    from={{ opacity: 0, translateY: 10 }}
                    animate={{ opacity: 1, translateY: 0 }}
                    transition={{
                      type: "timing",
                      duration: 280,
                      delay: (phaseIndex * 5 + index) * 60,
                    }}
                  >
                    <AnswerAccordionItem
                      answer={answer}
                      index={index}
                      expanded={expandedAnswerId === answer.questionId}
                      onToggle={() => toggleAnswer(answer.questionId)}
                    />
                  </AnimatedView>
                ))}
              </View>
            ))}
          </View>
        ) : null}

        <View className="mt-4 gap-3">
          <Button label="View My Plan" onPress={handleViewPlan} fullWidth />
          <Button label="Practice Again" variant="ghost" onPress={handlePracticeAgain} fullWidth />
        </View>
      </ScrollView>
      </SafeAreaView>
    </View>
  );
}

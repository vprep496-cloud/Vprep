"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Award,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FileImage,
  Loader2,
  Mic,
  Save,
  Sparkles,
  Target,
  X,
} from "lucide-react";

import { adminApi } from "@/lib/api";
import { TRACK_NAMES } from "@/lib/tracks";
import RoleBadge from "@/components/ui/RoleBadge";
import ScoreBadge from "@/components/ui/ScoreBadge";
import EnrollmentCard from "@/components/candidates/EnrollmentCard";
import SessionHistoryTable from "@/components/candidates/SessionHistoryTable";
import type { CandidateAssessment, InterviewQuestionAnswer, InterviewSessionResult } from "@/types";

type DetailTab = "enrollments" | "sessions" | "assessments";

const PHASE_LABELS: Record<string, string> = {
  hr: "HR Round",
  technical: "Technical Round",
  coding_logic: "Coding Logic",
  behavioral: "Behavioral Round",
};

const MODE_LABELS: Record<string, string> = {
  hr: "HR Only",
  technical: "Technical + Coding",
  behavioral: "Behavioral Only",
  full_mock: "Full Mock",
};

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

interface SummaryTileProps {
  icon: typeof Target;
  label: string;
  value: string | number;
}

function SummaryTile({ icon: Icon, label, value }: SummaryTileProps) {
  return (
    <div className="rounded-2xl border border-border-soft bg-background-card p-4 shadow-soft">
      <div className="flex items-center gap-1.5 text-text-muted">
        <Icon size={14} className="text-primary-400" />
        <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-text-primary">{value}</p>
    </div>
  );
}

// One always-expanded Q&A card per answer — unlike the candidate-facing
// accordion in the mobile app's `interview/results/[sessionId].tsx` (where
// collapsing keeps a long list scannable), an admin reviewing a session wants
// every transcription/score/feedback/model-answer visible at once (spec:
// "Admins can review any session including voice transcriptions").
// Derive the async scoring status badge for an answer (voice or coding)
function AsyncStatusBadge({ answer }: { answer: InterviewQuestionAnswer }) {
  const asyncStatus = answer.voiceScoreStatus ?? answer.codingScoreStatus ?? null;
  if (!asyncStatus || asyncStatus === "complete") return null;

  if (asyncStatus === "pending" || asyncStatus === "processing") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-500/10 px-2.5 py-1 text-xs font-medium text-primary-400">
        <Loader2 size={11} className="animate-spin" />
        Scoring in progress
      </span>
    );
  }
  if (asyncStatus === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger">
        <AlertTriangle size={11} />
        Scoring failed — needs review
      </span>
    );
  }
  return null;
}

// A score bar — maps a 0-10 criteria score to a coloured progress bar
function CriteriaBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round((value / 10) * 100);
  const colour = pct >= 70 ? "bg-success" : pct >= 50 ? "bg-warning" : "bg-danger";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs text-text-muted">{label.replace(/_/g, " ")}</span>
        <span className="text-xs font-semibold text-text-secondary">{value}/10</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-background-surface">
        <div className={`h-full rounded-full ${colour} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// A small metric pill for audio delivery analytics
function AudioMetricPill({ label, value, status }: { label: string; value: string; status?: "good" | "warn" | "bad" | "neutral" }) {
  const border = status === "good" ? "border-success/30 bg-success/5 text-success" :
    status === "warn" ? "border-warning/30 bg-warning/5 text-warning" :
    status === "bad"  ? "border-danger/30 bg-danger/5 text-danger" :
    "border-border bg-background-card text-text-secondary";
  return (
    <div className={`flex flex-col items-center gap-0.5 rounded-lg border px-3 py-2 ${border}`}>
      <span className="text-[10px] font-medium uppercase tracking-wide opacity-70">{label}</span>
      <span className="text-sm font-bold">{value}</span>
    </div>
  );
}

// A 0-100 score bar (for delivery score etc.)
function ScoreBar({ label, value, suffix = "/100" }: { label: string; value: number; suffix?: string }) {
  const colour = value >= 70 ? "bg-success" : value >= 50 ? "bg-warning" : "bg-danger";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs text-text-muted">{label}</span>
        <span className="text-xs font-semibold text-text-secondary">{value}{suffix}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-background-surface">
        <div className={`h-full rounded-full ${colour} transition-all duration-500`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function ReviewAnswerCard({
  sessionId,
  answer,
  index,
  onReviewed,
}: {
  sessionId: string;
  answer: InterviewQuestionAnswer;
  index: number;
  onReviewed: () => void;
}) {
  const [score, setScore] = useState(String(answer.score));
  const [feedback, setFeedback] = useState(answer.feedback);
  const [notes, setNotes] = useState(answer.reviewerNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answerLabel =
    answer.answerType === "voice"
      ? "Voice transcription"
      : answer.answerType === "image"
        ? "Handwritten solution"
        : "Typed answer";

  const asyncStatus = answer.voiceScoreStatus ?? answer.codingScoreStatus ?? null;
  const isAsyncPending = asyncStatus === "pending" || asyncStatus === "processing";

  const handleSaveReview = async () => {
    setSaving(true);
    setError(null);
    try {
      await adminApi.reviewAnswer(sessionId, answer.questionId, {
        score: Math.max(0, Math.min(Number(score), 100)),
        feedback,
        reviewerNotes: notes,
        status: "reviewed",
      });
      onReviewed();
    } catch {
      setError("Could not save manual review.");
    } finally {
      setSaving(false);
    }
  };

  const hasCriteriaScores = Object.keys(answer.criteriaScores ?? {}).length > 0;
  const needsReview =
    answer.manualReviewStatus === "pending" ||
    (answer.reviewFlags ?? []).includes("manual_review_recommended");

  return (
    <div className={`rounded-xl border bg-background-surface p-4 ${needsReview ? "border-warning/40" : "border-border"}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Q{index + 1}</p>
            {needsReview ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                <AlertTriangle size={10} />
                Needs review
              </span>
            ) : answer.manualReviewStatus === "reviewed" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                <CheckCircle2 size={10} />
                Reviewed
              </span>
            ) : null}
            <AsyncStatusBadge answer={answer} />
          </div>
          <p className="mt-1 text-sm font-medium text-text-primary">{answer.questionText}</p>
        </div>
        <div className="shrink-0">
          {isAsyncPending ? (
            <span className="rounded-full bg-primary-500/10 px-3 py-1 text-xs font-semibold text-primary-400">
              Pending
            </span>
          ) : (
            <ScoreBadge score={answer.score} />
          )}
        </div>
      </div>

      {/* Answer type + duration */}
      <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-text-muted">
        {answer.answerType === "voice" ? <Mic size={13} /> : null}
        {answer.answerType === "image" ? <FileImage size={13} /> : null}
        <span>{answerLabel}</span>
        {answer.answerDurationSeconds ? <span>· {answer.answerDurationSeconds}s</span> : null}
      </div>

      {/* Transcription / typed answer */}
      {isAsyncPending ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-primary-500/5 px-3 py-2.5">
          <Loader2 size={14} className="animate-spin text-primary-400" />
          <p className="text-sm text-text-muted">
            AI is transcribing and scoring this answer in the background…
          </p>
        </div>
      ) : (
        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-text-secondary">
          {answer.answerType === "voice" || answer.answerType === "image"
            ? answer.transcription ?? "—"
            : answer.userTextAnswer ?? "—"}
        </p>
      )}

      {!isAsyncPending ? (
        <>
          {/* Feedback */}
          {answer.feedback ? (
            <>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-text-muted">AI Feedback</p>
              <p className="mt-1 text-sm leading-6 text-text-secondary">{answer.feedback}</p>
            </>
          ) : null}

          {/* Score rationale */}
          {answer.scoreRationale ? (
            <>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Score Rationale</p>
              <p className="mt-1 text-sm leading-6 text-text-secondary">{answer.scoreRationale}</p>
            </>
          ) : null}

          {/* Evidence */}
          {(answer.evidence?.length ?? 0) > 0 ? (
            <div className="mt-3 rounded-xl border border-border bg-background-card p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Evidence Cited</p>
              <ul className="mt-2 space-y-1.5">
                {(answer.evidence ?? []).map((item, evidenceIndex) => (
                  <li key={evidenceIndex} className="flex items-start gap-1.5 text-sm leading-5 text-text-secondary">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-text-muted" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Criteria score bars */}
          {hasCriteriaScores ? (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {Object.entries(answer.criteriaScores).map(([criterion, value]) => (
                <CriteriaBar key={criterion} label={criterion} value={value} />
              ))}
            </div>
          ) : null}

          {/* Delivery Analytics — voice answers only, shown when audio metrics available */}
          {answer.answerType === "voice" && (answer.scoringMetadata as Record<string, unknown> | null | undefined)?.audio_metrics ? (() => {
            const meta = answer.scoringMetadata as Record<string, unknown>;
            const metrics = meta.audio_metrics as Record<string, number> | undefined;
            const breakdown = meta.scoring_breakdown as Record<string, unknown> | undefined;
            if (!metrics) return null;

            const wpm = Number(metrics.words_per_minute ?? 0);
            const fillerPct = Number(metrics.filler_word_ratio_pct ?? 0);
            const speakingPct = Number(metrics.speaking_ratio_pct ?? 0);
            const totalWords = Number(metrics.total_words ?? 0);
            const contentScore = breakdown ? Number(breakdown.content_communication_score ?? 0) : null;
            const deliveryScore = breakdown ? Number(breakdown.delivery_score ?? 0) : null;

            const wpmStatus: "good" | "warn" | "bad" | "neutral" =
              wpm >= 110 && wpm <= 170 ? "good" : wpm > 0 && (wpm < 80 || wpm > 200) ? "bad" : "warn";
            const fillerStatus: "good" | "warn" | "bad" | "neutral" =
              fillerPct < 3 ? "good" : fillerPct < 8 ? "warn" : "bad";
            const speakingStatus: "good" | "warn" | "bad" | "neutral" =
              speakingPct >= 65 ? "good" : speakingPct >= 45 ? "warn" : "bad";

            return (
              <div className="mt-3 rounded-xl border border-border bg-background-card p-3.5">
                <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  <Mic size={11} />
                  Delivery Analytics
                </p>

                {/* Metric pills row */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {wpm > 0 && (
                    <AudioMetricPill
                      label="Speech Rate"
                      value={`${Math.round(wpm)} WPM`}
                      status={wpmStatus}
                    />
                  )}
                  <AudioMetricPill
                    label="Filler Words"
                    value={`${fillerPct.toFixed(1)}%`}
                    status={fillerStatus}
                  />
                  <AudioMetricPill
                    label="Speaking"
                    value={`${speakingPct.toFixed(0)}%`}
                    status={speakingStatus}
                  />
                  {totalWords > 0 && (
                    <AudioMetricPill
                      label="Word Count"
                      value={String(totalWords)}
                      status={totalWords >= 60 ? "good" : totalWords >= 30 ? "warn" : "bad"}
                    />
                  )}
                </div>

                {/* Score breakdown bars (shown when both content and delivery are present) */}
                {contentScore !== null && deliveryScore !== null && (
                  <div className="mt-3 space-y-2">
                    <ScoreBar label="Content & Communication (85%)" value={contentScore} />
                    <ScoreBar label="Delivery (15%)" value={deliveryScore} />
                  </div>
                )}

                {/* WPM calibration hint */}
                {wpm > 0 && (wpm < 100 || wpm > 185) && (
                  <p className="mt-2 text-[11px] text-text-muted">
                    {wpm < 100
                      ? `↓ Speech rate (${Math.round(wpm)} WPM) is below the ideal 110–170 WPM range.`
                      : `↑ Speech rate (${Math.round(wpm)} WPM) is above the ideal 110–170 WPM range.`}
                  </p>
                )}
                {fillerPct >= 8 && (
                  <p className="mt-1 text-[11px] text-text-muted">
                    △ High filler word rate ({fillerPct.toFixed(1)}%) may indicate preparation gaps.
                  </p>
                )}
              </div>
            );
          })() : null}

          {/* Model answer */}
          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Model Answer</p>
          <p className="mt-1 text-sm leading-6 text-text-secondary">{answer.modelAnswer}</p>

          {/* Confidence + flags row */}
          {((answer.confidence !== null && answer.confidence !== undefined) ||
            (answer.reviewFlags?.length ?? 0) > 0 ||
            answer.rubricVersion) ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {answer.confidence !== null && answer.confidence !== undefined ? (
                <span className="rounded-full bg-background-card px-2.5 py-1 text-xs text-text-muted">
                  confidence: <span className="font-semibold text-text-secondary">{Math.round(answer.confidence * 100)}%</span>
                </span>
              ) : null}
              {answer.rubricVersion ? (
                <span className="rounded-full bg-background-card px-2.5 py-1 text-xs text-text-muted">
                  {answer.rubricVersion}
                </span>
              ) : null}
              {(answer.reviewFlags ?? []).filter((f) => f !== "manual_review_recommended").map((flag) => (
                <span key={flag} className="rounded-full bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning">
                  {flag.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {/* Manual Review Panel */}
      <div className="mt-4 rounded-xl border border-border bg-background-card p-3.5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Manual Review Override</p>
          {!isAsyncPending ? (
            <span className="text-xs text-text-muted">
              AI score: <span className="font-semibold text-text-secondary">{answer.aiScore ?? answer.score}/100</span>
            </span>
          ) : null}
        </div>
        {isAsyncPending ? (
          <p className="mt-2 text-xs text-text-muted">
            Manual review will be available once AI scoring completes.
          </p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[110px_1fr]">
              <input
                type="number"
                min={0}
                max={100}
                value={score}
                onChange={(event) => setScore(event.target.value)}
                className="rounded-lg border border-border bg-background-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <input
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Reviewer notes (optional)"
                className="rounded-lg border border-border bg-background-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <textarea
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              rows={2}
              placeholder="Override AI feedback…"
              className="mt-3 w-full resize-none rounded-lg border border-border bg-background-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
            <button
              type="button"
              onClick={handleSaveReview}
              disabled={saving}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-600 disabled:opacity-50"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Save Review
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SessionReviewModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: session, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-session-review", sessionId],
    queryFn: () => adminApi.getSession(sessionId),
    // `GET /admin/sessions/{id}` is the spec's dedicated full-review endpoint
    // (Agent Rule #3 admin route — every answer/transcription/score/
    // model_answer for ANY candidate's session). Fetching fresh here — rather
    // than reusing the embedded copy already in `candidate.sessions` — keeps
    // this modal correct even for a candidate's 21st+ session (the detail
    // route caps its embedded list at 20) and exercises the endpoint the
    // spec calls out by name for admin session review.
  });
  const { data: tracks } = useQuery({
    queryKey: ["admin-tracks"],
    queryFn: adminApi.getTracks,
  });
  const trackNames = useMemo(
    () => ({
      ...TRACK_NAMES,
      ...Object.fromEntries((tracks ?? []).map((track) => [track.id, track.name])),
    }),
    [tracks]
  );
  const handleReviewed = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ["admin-candidate"] });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-border bg-background-card p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-text-primary">Session Review</h2>
            {session ? (
              <p className="mt-1 text-sm text-text-secondary">
                {trackNames[session.trackId] ?? session.trackId} · {MODE_LABELS[session.mode] ?? session.mode} ·{" "}
                {formatDuration(session.durationSeconds)} · {formatDate(session.completedAt)}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-background-surface hover:text-text-primary"
            aria-label="Close session review"
          >
            <X size={18} />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-secondary">
            <Loader2 size={16} className="animate-spin" />
            Loading session…
          </div>
        ) : isError || !session ? (
          <p className="py-16 text-center text-sm text-text-muted">Couldn&apos;t load this session.</p>
        ) : (
          <div className="mt-5">
            {/* Score overview */}
            <div className="rounded-xl border border-border bg-background-surface p-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Overall</span>
                <ScoreBadge score={session.overallScore} size="md" />
                {(() => {
                  const pendingCount = session.phaseResults
                    .flatMap((p) => p.answers)
                    .filter(
                      (a) =>
                        a.manualReviewStatus === "pending" ||
                        (a.reviewFlags ?? []).includes("manual_review_recommended")
                    ).length;
                  return pendingCount > 0 ? (
                    <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning">
                      <AlertTriangle size={11} />
                      {pendingCount} answer{pendingCount > 1 ? "s" : ""} need review
                    </span>
                  ) : (
                    <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                      <CheckCircle2 size={11} />
                      All reviewed
                    </span>
                  );
                })()}
              </div>
              {/* Phase score bars */}
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {session.phaseResults.map((phaseResult) => {
                  const pct = phaseResult.score;
                  const colour = pct >= 70 ? "bg-success" : pct >= 50 ? "bg-warning" : "bg-danger";
                  return (
                    <div key={phaseResult.phase}>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-xs text-text-muted">{PHASE_LABELS[phaseResult.phase] ?? phaseResult.phase}</span>
                        <span className="text-xs font-semibold text-text-secondary">{phaseResult.score}/100</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-background-card">
                        <div className={`h-full rounded-full ${colour} transition-all duration-500`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Per-phase answers */}
            <div className="mt-5 space-y-6">
              {session.phaseResults.map((phaseResult) => (
                <div key={phaseResult.phase}>
                  <div className="mb-3 flex items-center gap-2 px-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                      {PHASE_LABELS[phaseResult.phase] ?? phaseResult.phase}
                    </p>
                    <span className="rounded-full bg-background-card px-2 py-0.5 text-xs text-text-muted">
                      {phaseResult.score}/100
                    </span>
                    {phaseResult.answers.some(
                      (a) =>
                        a.manualReviewStatus === "pending" ||
                        (a.reviewFlags ?? []).includes("manual_review_recommended")
                    ) ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                        <AlertTriangle size={9} />
                        Needs review
                      </span>
                    ) : null}
                  </div>
                  <div className="space-y-3">
                    {phaseResult.answers.map((answer, index) => (
                      <ReviewAnswerCard
                        key={answer.questionId}
                        sessionId={session.id}
                        answer={answer}
                        index={index}
                        onReviewed={handleReviewed}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AssessmentCard({
  assessment,
  trackNames,
}: {
  assessment: CandidateAssessment;
  trackNames: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasBreakdown = Object.keys(assessment.breakdown ?? {}).length > 0;
  const scoreColor = assessment.score >= 70 ? "text-success" : assessment.score >= 50 ? "text-warning" : "text-danger";
  const scoreBg = assessment.score >= 70 ? "bg-success" : assessment.score >= 50 ? "bg-warning" : "bg-danger";

  return (
    <div className="rounded-2xl border border-border bg-background-card p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-base font-bold text-text-primary">{trackNames[assessment.trackId] ?? assessment.trackId}</p>
          <p className="mt-0.5 text-xs text-text-muted">
            <span className="capitalize">{assessment.skillLevel}</span> level · Assessed {formatDate(assessment.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <ScoreBadge score={assessment.score} size="md" />
          <span className={`text-xs font-semibold ${scoreColor}`}>
            {assessment.score >= 70 ? "Proficient" : assessment.score >= 50 ? "Developing" : "Needs Work"}
          </span>
        </div>
      </div>

      {/* Overall score bar */}
      <div className="mt-4">
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-background-surface">
          <div
            className={`h-full rounded-full ${scoreBg} transition-all duration-700`}
            style={{ width: `${assessment.score}%` }}
          />
        </div>
      </div>

      {/* Topic breakdown bars */}
      {hasBreakdown ? (
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Object.entries(assessment.breakdown).map(([topic, score]) => {
            const pct = score;
            const colour = pct >= 70 ? "bg-success" : pct >= 50 ? "bg-warning" : "bg-danger";
            return (
              <div key={topic}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs text-text-muted">{topic.replace(/_/g, " ")}</span>
                  <span className="text-xs font-semibold text-text-secondary">{score}/100</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-background-surface">
                  <div className={`h-full rounded-full ${colour} transition-all duration-500`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Per-question toggle */}
      {assessment.perQuestionFeedback.length > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 transition-colors hover:text-primary-500"
        >
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {expanded ? "Hide" : "Show"} per-question breakdown ({assessment.perQuestionFeedback.length} questions)
        </button>
      ) : null}

      {expanded ? (
        <div className="mt-3 space-y-3">
          {assessment.perQuestionFeedback.map((item, idx) => {
            const itemPct = (item.score / 10) * 100;
            const itemColour = itemPct >= 70 ? "bg-success" : itemPct >= 50 ? "bg-warning" : "bg-danger";
            return (
              <div key={item.questionId} className="rounded-xl border border-border bg-background-surface p-3.5">
                {/* Q header */}
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0 text-xs font-bold text-text-muted">Q{idx + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text-primary">{item.question}</p>
                    {/* Score bar */}
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-background-card">
                        <div className={`h-full rounded-full ${itemColour}`} style={{ width: `${itemPct}%` }} />
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-text-secondary">{item.score}/10</span>
                    </div>
                  </div>
                </div>

                {/* Answer */}
                <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Answer</p>
                <p className="mt-1 text-sm text-text-secondary">{item.userAnswer}</p>

                {/* Feedback */}
                <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Feedback</p>
                <p className="mt-1 text-sm text-text-secondary">{item.feedback}</p>

                {/* Criteria bars */}
                {item.criteriaScores && Object.keys(item.criteriaScores).length > 0 ? (
                  <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {Object.entries(item.criteriaScores).map(([criterion, value]) => (
                      <CriteriaBar key={criterion} label={criterion} value={value} />
                    ))}
                  </div>
                ) : null}

                {/* Confidence + flags */}
                {((item.confidence !== null && item.confidence !== undefined) || (item.reviewFlags?.length ?? 0) > 0) ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.confidence !== null && item.confidence !== undefined ? (
                      <span className="rounded-full bg-background-card px-2.5 py-1 text-xs text-text-muted">
                        confidence: <span className="font-semibold text-text-secondary">{Math.round(item.confidence * 100)}%</span>
                      </span>
                    ) : null}
                    {(item.reviewFlags ?? []).map((flag) => (
                      <span key={flag} className="rounded-full bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning">
                        {flag.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default function CandidateDetailPage() {
  const { candidateId } = useParams<{ candidateId: string }>();
  const [tab, setTab] = useState<DetailTab>("enrollments");
  const [reviewingSessionId, setReviewingSessionId] = useState<string | null>(null);

  const { data: candidate, isLoading, isError } = useQuery({
    queryKey: ["admin-candidate", candidateId],
    queryFn: () => adminApi.getCandidate(candidateId),
    enabled: !!candidateId,
    retry: 1,
  });
  const { data: tracks } = useQuery({
    queryKey: ["admin-tracks"],
    queryFn: adminApi.getTracks,
    retry: 1,
  });
  const trackNames = useMemo(
    () => ({
      ...TRACK_NAMES,
      ...Object.fromEntries((tracks ?? []).map((track) => [track.id, track.name])),
    }),
    [tracks]
  );

  // Must be declared BEFORE any conditional returns to comply with the React
  // Rules of Hooks — hooks cannot be called after conditional early returns.
  // Uses optional chaining so it is safe to call before `candidate` is confirmed non-null.
  const pendingReviewSessions = useMemo(
    () =>
      (candidate?.sessions ?? []).filter((session) =>
        session.phaseResults.some((phase) =>
          phase.answers.some(
            (answer) =>
              answer.manualReviewStatus === "pending" ||
              (answer.reviewFlags ?? []).includes("manual_review_recommended")
          )
        )
      ),
    [candidate]
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Loading skeleton */}
        <div className="h-5 w-32 animate-pulse rounded bg-background-surface" />
        <div className="rounded-2xl border border-border-soft bg-background-card p-5">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 animate-pulse rounded-full bg-background-surface" />
            <div className="space-y-2">
              <div className="h-5 w-40 animate-pulse rounded bg-background-surface" />
              <div className="h-3.5 w-56 animate-pulse rounded bg-background-muted" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-background-surface" />
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Loader2 size={14} className="animate-spin" />
          Loading candidate data…
        </div>
      </div>
    );
  }

  if (isError || !candidate) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-danger/20 bg-danger/5 py-24 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger/10">
          <AlertTriangle size={22} className="text-danger" />
        </div>
        <div>
          <p className="font-semibold text-text-primary">Couldn&apos;t load this candidate</p>
          <p className="mt-1 text-sm text-text-muted">The candidate may not exist or you may not have access.</p>
        </div>
        <Link
          href="/candidates"
          className="inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-text-secondary transition-colors hover:bg-background-surface hover:text-text-primary"
        >
          <ArrowLeft size={14} />
          Back to Candidates
        </Link>
      </div>
    );
  }

  const { user, enrollments, assessments, sessions, stats } = candidate;

  const TABS: { value: DetailTab; label: string; count: number; badge?: number }[] = [
    { value: "enrollments", label: "Enrollments", count: enrollments.length },
    {
      value: "sessions",
      label: "Sessions",
      count: sessions.length,
      badge: pendingReviewSessions.length > 0 ? pendingReviewSessions.length : undefined,
    },
    { value: "assessments", label: "Assessment Results", count: assessments.length },
  ];

  return (
    <div>
      <Link
        href="/candidates"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
      >
        <ArrowLeft size={15} />
        Back to Candidates
      </Link>

      <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-border-soft bg-background-card p-5 shadow-soft sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- external Google avatar URL
            <img src={user.image} alt={user.name} className="h-14 w-14 rounded-full ring-2 ring-primary-500/20" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-500/10 text-xl font-bold text-primary-600 ring-2 ring-primary-500/15">
              {user.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold text-text-primary">{user.name}</h1>
              <RoleBadge role={user.role} />
            </div>
            <p className="text-sm text-text-secondary">{user.email}</p>
            {user.createdAt ? (
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted">
                <CalendarDays size={12} />
                Joined {formatDate(user.createdAt)}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryTile icon={Target} label="Avg Score" value={`${stats.averageScore}/100`} />
        <SummaryTile icon={Award} label="Best Score" value={`${stats.bestScore}/100`} />
        <SummaryTile icon={Sparkles} label="Mock Sessions" value={stats.totalSessions} />
        <SummaryTile icon={CalendarDays} label="Study Days" value={stats.totalStudyDays} />
      </div>

      <div className="mt-6 flex gap-1.5 rounded-xl border border-border bg-background-card p-1 sm:inline-flex">
        {TABS.map((tabOption) => (
          <button
            key={tabOption.value}
            type="button"
            onClick={() => setTab(tabOption.value)}
            className={`relative rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
              tab === tabOption.value ? "bg-primary-500 text-white" : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {tabOption.label} <span className="opacity-70">({tabOption.count})</span>
            {tabOption.badge ? (
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-warning text-[10px] font-bold text-white">
                {tabOption.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === "enrollments" ? (
          enrollments.length === 0 ? (
            <div className="rounded-2xl border border-border bg-background-card py-16 text-center text-sm text-text-muted">
              This candidate hasn&apos;t enrolled in any tracks yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {enrollments.map((enrollment) => (
                <EnrollmentCard key={enrollment.id} enrollment={enrollment} />
              ))}
            </div>
          )
        ) : null}

        {tab === "sessions" ? (
          <div className="space-y-5">
            {/* Pending manual reviews callout */}
            {pendingReviewSessions.length > 0 ? (
              <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4">
                <div className="flex items-center gap-2.5">
                  <AlertTriangle size={16} className="shrink-0 text-warning" />
                  <p className="text-sm font-semibold text-warning">
                    {pendingReviewSessions.length} session{pendingReviewSessions.length > 1 ? "s" : ""} need manual review
                  </p>
                </div>
                <p className="mt-1 pl-6 text-xs text-text-muted">
                  These sessions contain answers flagged by AI scoring as needing human review — either because scoring was unavailable or because the answer content triggered a review recommendation.
                </p>
                <div className="mt-3 flex flex-wrap gap-2 pl-6">
                  {pendingReviewSessions.map((session) => {
                    const flaggedCount = session.phaseResults
                      .flatMap((p) => p.answers)
                      .filter(
                        (a) =>
                          a.manualReviewStatus === "pending" ||
                          (a.reviewFlags ?? []).includes("manual_review_recommended")
                      ).length;
                    return (
                      <button
                        key={session.id}
                        type="button"
                        onClick={() => setReviewingSessionId(session.id)}
                        className="inline-flex items-center gap-2 rounded-lg border border-warning/30 bg-background-card px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-background-surface hover:text-text-primary"
                      >
                        <Clock size={12} className="text-warning" />
                        {new Date(session.completedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-xs font-semibold text-warning">
                          {flaggedCount} flagged
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : sessions.length > 0 ? (
              <div className="flex items-center gap-2 rounded-xl border border-success/20 bg-success/5 px-4 py-2.5">
                <CheckCircle2 size={14} className="text-success" />
                <p className="text-xs font-medium text-success">All sessions reviewed — no pending items</p>
              </div>
            ) : null}

            <SessionHistoryTable
              sessions={sessions}
              trackNames={trackNames}
              onReview={(session: InterviewSessionResult) => setReviewingSessionId(session.id)}
            />
          </div>
        ) : null}

        {tab === "assessments" ? (
          assessments.length === 0 ? (
            <div className="rounded-2xl border border-border bg-background-card py-16 text-center text-sm text-text-muted">
              This candidate hasn&apos;t completed a skill assessment yet.
            </div>
          ) : (
            <div className="space-y-4">
              {assessments.map((assessment) => (
                <AssessmentCard key={assessment.id} assessment={assessment} trackNames={trackNames} />
              ))}
            </div>
          )
        ) : null}
      </div>

      {reviewingSessionId ? (
        <SessionReviewModal sessionId={reviewingSessionId} onClose={() => setReviewingSessionId(null)} />
      ) : null}
    </div>
  );
}

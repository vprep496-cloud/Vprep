"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Mic,
  Code2,
  Type,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Star,
  RefreshCw,
  BookOpen,
  BarChart2,
  MessageSquare,
  Lightbulb,
  ShieldCheck,
  Activity,
  Save,
  Loader2,
} from "lucide-react";

import { adminApi } from "@/lib/api";
import CodingAnalysisPanel from "@/components/ui/CodingAnalysisPanel";
import type {
  InterviewPhaseResult,
  InterviewQuestionAnswer,
  InterviewSessionResult,
  ManualReviewInput,
} from "@/types";
import ScoreBadge from "@/components/ui/ScoreBadge";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}

function formatTime(iso: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(seconds: number) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const PHASE_LABELS: Record<string, string> = {
  hr: "HR Interview",
  technical: "Technical Questions",
  coding_logic: "Coding & Logic",
  behavioral: "Behavioral Interview",
};

const PHASE_ICONS: Record<string, typeof Users> = {
  hr: Users,
  technical: Code2,
  coding_logic: Code2,
  behavioral: Mic,
};

const MODE_LABELS: Record<string, string> = {
  hr: "HR Only",
  technical: "Technical Only",
  behavioral: "Behavioral Only",
  full_mock: "Full Mock Interview",
};

function scoreColor(score: number) {
  if (score >= 70) return "text-success";
  if (score >= 50) return "text-amber-600";
  return "text-danger";
}

function scoreBg(score: number) {
  if (score >= 70) return "bg-success/10 border-success/20";
  if (score >= 50) return "bg-amber-50 border-amber-200";
  return "bg-danger/10 border-danger/20";
}

function statusPill(status: string | null | undefined, label: string) {
  const map: Record<string, string> = {
    pending:    "bg-amber-50 text-amber-700 border-amber-200",
    processing: "bg-sky-50 text-sky-700 border-sky-200",
    complete:   "bg-success/10 text-success border-success/20",
    failed:     "bg-danger/10 text-danger border-danger/20",
    reviewed:   "bg-success/10 text-success border-success/20",
    not_required: "bg-background-muted text-text-muted border-border-soft",
  };
  const cls = map[status ?? ""] ?? "bg-background-surface text-text-muted border-border-soft";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  );
}

// ─── Score bar ───────────────────────────────────────────────────────────────

function ScoreBar({ label, value, max = 10, highlight = false }: {
  label: string; value: number; max?: number; highlight?: boolean;
}) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className={`text-xs capitalize ${highlight ? "font-semibold text-text-primary" : "text-text-secondary"}`}>
          {label.replace(/_/g, " ")}
        </span>
        <span className={`text-xs font-bold tabular-nums ${scoreColor(pct)}`}>
          {value}/{max}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-background-muted">
        <div
          className={`h-full rounded-full transition-all duration-700 ${
            pct >= 70 ? "bg-success" : pct >= 50 ? "bg-amber-400" : "bg-danger"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Audio delivery metrics ──────────────────────────────────────────────────

function DeliveryMetrics({ metadata }: { metadata: Record<string, unknown> | null | undefined }) {
  if (!metadata) return null;
  const items: { key: string; label: string; unit: string; fmt?: (v: number) => string }[] = [
    { key: "words_per_minute", label: "WPM", unit: "", fmt: (v) => Math.round(v).toString() },
    { key: "filler_word_ratio", label: "Filler Words", unit: "%", fmt: (v) => `${(v * 100).toFixed(1)}%` },
    { key: "speaking_ratio", label: "Speaking", unit: "%", fmt: (v) => `${(v * 100).toFixed(0)}%` },
    { key: "word_count", label: "Words", unit: "" },
    { key: "pause_count", label: "Pauses", unit: "" },
  ];
  const present = items.filter((i) => i.key in metadata);
  if (present.length === 0) return null;
  return (
    <div className="mt-3 rounded-xl border border-border-soft bg-background-surface px-4 py-3">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-text-muted">
        Delivery Analytics
      </p>
      <div className="flex flex-wrap gap-3">
        {present.map(({ key, label, fmt }) => {
          const raw = metadata[key] as number | undefined;
          if (raw == null) return null;
          const display = fmt ? fmt(raw) : String(raw);
          return (
            <div key={key} className="text-center">
              <p className="text-sm font-bold text-text-primary">{display}</p>
              <p className="text-[10px] text-text-muted">{label}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── STAR analysis ───────────────────────────────────────────────────────────

function StarAnalysis({ metadata }: { metadata: Record<string, unknown> | null | undefined }) {
  if (!metadata?.star_analysis && !metadata?.star) return null;
  const star = (metadata.star_analysis ?? metadata.star) as Record<string, unknown>;
  const keys = ["situation", "task", "action", "result"];
  const present = keys.filter((k) => star[k]);
  if (present.length === 0) return null;
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-border-soft bg-amber-50/50 p-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">STAR Analysis</p>
      {present.map((k) => (
        <div key={k}>
          <p className="text-[10px] font-bold uppercase text-amber-600">{k}</p>
          <p className="mt-0.5 text-xs text-text-secondary leading-relaxed">
            {String(star[k] ?? "")}
          </p>
        </div>
      ))}
    </div>
  );
}

// ─── Manual review form ──────────────────────────────────────────────────────

function ReviewForm({
  sessionId,
  answer,
  onSaved,
}: {
  sessionId: string;
  answer: InterviewQuestionAnswer;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(answer.manualReviewStatus === "pending");
  const [score, setScore] = useState<string>(
    answer.aiScore != null ? String(answer.score) : ""
  );
  const [feedback, setFeedback] = useState(answer.feedback ?? "");
  const [notes, setNotes] = useState(answer.reviewerNotes ?? "");
  const [status, setStatus] = useState<ManualReviewInput["status"]>(
    answer.manualReviewStatus ?? "reviewed"
  );
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: ManualReviewInput) =>
      adminApi.reviewAnswer(sessionId, answer.questionId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-session", sessionId] });
      onSaved();
    },
  });

  const handleSave = () => {
    const input: ManualReviewInput = {
      status: status ?? "reviewed",
      score: score !== "" ? Math.min(100, Math.max(0, Number(score))) : undefined,
      feedback: feedback || undefined,
      reviewerNotes: notes || undefined,
    };
    mutation.mutate(input);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 w-full rounded-xl border border-dashed border-border py-2 text-xs font-semibold text-text-muted transition-colors hover:border-primary-400 hover:bg-primary-50 hover:text-primary-600"
      >
        + Add Manual Review
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-primary-200 bg-primary-50/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wider text-primary-600">Manual Review Override</p>
        <button type="button" onClick={() => setOpen(false)} className="text-text-muted hover:text-text-secondary">
          <ChevronUp size={14} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Score override */}
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase text-text-muted">
            Score Override (0–100)
          </label>
          <input
            type="number"
            min={0}
            max={100}
            value={score}
            onChange={(e) => setScore(e.target.value)}
            placeholder={`Current: ${answer.score}`}
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-400/20"
          />
        </div>
        {/* Status */}
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase text-text-muted">Status</label>
          <select
            value={status ?? "reviewed"}
            onChange={(e) => setStatus(e.target.value as ManualReviewInput["status"])}
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-400/20"
          >
            <option value="reviewed">Reviewed</option>
            <option value="pending">Pending</option>
            <option value="not_required">Not Required</option>
          </select>
        </div>
      </div>

      {/* Feedback override */}
      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase text-text-muted">
          Feedback Override (leave blank to keep AI feedback)
        </label>
        <textarea
          rows={3}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Override AI-generated feedback…"
          className="w-full resize-none rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-400/20"
        />
      </div>

      {/* Reviewer notes */}
      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase text-text-muted">
          Reviewer Notes (internal only)
        </label>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Internal notes about this answer…"
          className="w-full resize-none rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-400/20"
        />
      </div>

      {mutation.isError && (
        <p className="text-xs text-danger">Save failed. Please try again.</p>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg px-4 py-2 text-sm font-medium text-text-muted hover:text-text-secondary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={mutation.isPending}
          className="inline-flex items-center gap-2 rounded-xl bg-primary-500 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save Review
        </button>
      </div>
    </div>
  );
}

// ─── Answer card ──────────────────────────────────────────────────────────────

function AnswerCard({
  sessionId,
  answer,
  index,
  onReviewSaved,
}: {
  sessionId: string;
  answer: InterviewQuestionAnswer;
  index: number;
  onReviewSaved: () => void;
}) {
  const [expanded, setExpanded] = useState(index === 0);
  const hasReview = answer.manualReviewStatus === "reviewed";
  const isPending = answer.manualReviewStatus === "pending";

  return (
    <div className={`rounded-2xl border bg-background-card shadow-soft overflow-hidden ${
      isPending ? "border-amber-300" : "border-border-soft"
    }`}>
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-background-surface/50 transition-colors"
      >
        {/* Q number */}
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-100 text-[11px] font-bold text-primary-600">
          {index + 1}
        </span>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text-primary leading-snug">
            {answer.questionText}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {/* Answer type */}
            <span className="inline-flex items-center gap-1 rounded-full bg-background-surface px-2 py-0.5 text-[10px] font-semibold text-text-secondary">
              {answer.answerType === "voice" ? <Mic size={9} /> : answer.answerType === "image" ? <Code2 size={9} /> : <Type size={9} />}
              {answer.answerType.toUpperCase()}
            </span>
            {/* Score */}
            <span className={`text-xs font-bold ${scoreColor(answer.score)}`}>
              {answer.score}/100
            </span>
            {/* Statuses */}
            {answer.voiceScoreStatus && answer.voiceScoreStatus !== "complete" &&
              statusPill(answer.voiceScoreStatus, `Voice ${answer.voiceScoreStatus}`)}
            {answer.codingScoreStatus && answer.codingScoreStatus !== "complete" &&
              statusPill(answer.codingScoreStatus, `Code ${answer.codingScoreStatus}`)}
            {hasReview && (
              <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                <ShieldCheck size={9} /> Reviewed
              </span>
            )}
            {isPending && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                <AlertCircle size={9} /> Needs Review
              </span>
            )}
          </div>
        </div>

        {expanded ? <ChevronUp size={16} className="text-text-muted mt-0.5 shrink-0" /> : <ChevronDown size={16} className="text-text-muted mt-0.5 shrink-0" />}
      </button>

      {/* Body */}
      {expanded && (
        <div className="border-t border-border-soft px-4 pb-4 pt-3 space-y-4">

          {/* Answer content */}
          {answer.transcription && (
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                <Mic size={10} /> Voice Transcription
              </p>
              <p className="rounded-lg bg-background-surface px-3 py-2.5 text-sm text-text-secondary leading-relaxed italic">
                &ldquo;{answer.transcription}&rdquo;
              </p>
              <DeliveryMetrics metadata={answer.scoringMetadata} />
              <StarAnalysis metadata={answer.scoringMetadata} />
            </div>
          )}

          {answer.userTextAnswer && (
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                <Type size={10} /> Written Answer
              </p>
              <p className="rounded-lg bg-background-surface px-3 py-2.5 text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">
                {answer.userTextAnswer}
              </p>
            </div>
          )}

          {answer.answerType === "image" && !answer.transcription && (
            <div className="rounded-lg border border-border-soft bg-background-surface px-3 py-2.5 text-xs text-text-muted">
              Code/image answer — OCR transcription pending or not available.
            </div>
          )}

          {answer.answerType === "image" ? (
            <CodingAnalysisPanel metadata={answer.scoringMetadata} />
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            {/* Left: score + criteria */}
            <div className="space-y-3">
              {/* Overall score bar */}
              <div className={`rounded-xl border p-3 ${scoreBg(answer.score)}`}>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-text-primary">AI Score</p>
                  <ScoreBadge score={answer.score} />
                </div>
                {answer.confidence != null && (
                  <p className="mt-1 text-[10px] text-text-muted">
                    Confidence: {Math.round(answer.confidence)}%
                  </p>
                )}
                {answer.aiScore != null && answer.aiScore !== answer.score && (
                  <p className="mt-1 text-[10px] text-text-muted">
                    Original AI score: {answer.aiScore}
                    {answer.manualReviewStatus === "reviewed" ? " (overridden by reviewer)" : ""}
                  </p>
                )}
              </div>

              {/* Criteria breakdown */}
              {Object.keys(answer.criteriaScores ?? {}).length > 0 && (
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                    <BarChart2 size={10} /> Criteria Scores
                  </p>
                  <div className="space-y-2">
                    {Object.entries(answer.criteriaScores).map(([k, v]) => (
                      <ScoreBar key={k} label={k} value={v} max={10} />
                    ))}
                  </div>
                </div>
              )}

              {/* Duration */}
              {answer.answerDurationSeconds != null && (
                <div className="flex items-center gap-1.5 text-xs text-text-muted">
                  <Clock size={12} /> {formatDuration(answer.answerDurationSeconds)} answer length
                </div>
              )}
            </div>

            {/* Right: feedback + model answer */}
            <div className="space-y-3">
              {/* Feedback */}
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                  <MessageSquare size={10} /> AI Feedback
                </p>
                <p className="text-sm text-text-secondary leading-relaxed">
                  {answer.feedback || "—"}
                </p>
              </div>

              {/* Strengths */}
              {(answer.strengths ?? []).length > 0 && (
                <div className="space-y-1.5">
                  {(answer.strengths ?? []).map((s, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-lg bg-success/8 px-3 py-2">
                      <CheckCircle2 size={12} className="text-success mt-0.5 shrink-0" />
                      <p className="text-xs text-text-secondary leading-relaxed">{s}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Improvements */}
              {(answer.improvements ?? []).length > 0 && (
                <div className="space-y-1.5">
                  {(answer.improvements ?? []).map((s, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2">
                      <Lightbulb size={12} className="text-amber-500 mt-0.5 shrink-0" />
                      <p className="text-xs text-text-secondary leading-relaxed">{s}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Model answer */}
              {answer.modelAnswer && (
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                    <BookOpen size={10} /> Model Answer
                  </p>
                  <p className="rounded-lg border border-border-soft bg-background-elevated px-3 py-2.5 text-xs text-text-secondary leading-relaxed">
                    {answer.modelAnswer}
                  </p>
                </div>
              )}

              {/* Score rationale */}
              {answer.scoreRationale && (
                <div>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                    Score Rationale
                  </p>
                  <p className="text-xs text-text-muted leading-relaxed italic">
                    {answer.scoreRationale}
                  </p>
                </div>
              )}

              {/* Review flags */}
              {(answer.reviewFlags ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {(answer.reviewFlags ?? []).map((flag) => (
                    <span
                      key={flag}
                      className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
                    >
                      <AlertCircle size={9} /> {flag}
                    </span>
                  ))}
                </div>
              )}

              {/* Reviewer notes (if reviewed) */}
              {answer.reviewerNotes && (
                <div className="rounded-lg border border-primary-200 bg-primary-50/50 px-3 py-2">
                  <p className="mb-1 text-[10px] font-bold uppercase text-primary-600">Reviewer Notes</p>
                  <p className="text-xs text-text-secondary">{answer.reviewerNotes}</p>
                  {answer.reviewedAt && (
                    <p className="mt-1 text-[10px] text-text-muted">
                      Reviewed {new Date(answer.reviewedAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Manual review form */}
          <ReviewForm sessionId={sessionId} answer={answer} onSaved={onReviewSaved} />
        </div>
      )}
    </div>
  );
}

// ─── Phase accordion ─────────────────────────────────────────────────────────

function PhaseSection({
  sessionId,
  phase,
  onReviewSaved,
}: {
  sessionId: string;
  phase: InterviewPhaseResult;
  onReviewSaved: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const Icon = PHASE_ICONS[phase.phase] ?? Activity;

  return (
    <div className="rounded-2xl border border-border-soft bg-background-card shadow-soft overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 p-5 text-left hover:bg-background-surface/40 transition-colors"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-100">
          <Icon size={17} className="text-primary-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-text-primary">
            {PHASE_LABELS[phase.phase] ?? phase.phase}
          </p>
          <p className="text-xs text-text-muted">{phase.questionCount} question{phase.questionCount !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-3">
          <ScoreBadge score={phase.score} />
          {expanded ? <ChevronUp size={16} className="text-text-muted" /> : <ChevronDown size={16} className="text-text-muted" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border-soft p-4 space-y-3">
          {phase.answers.map((answer, i) => (
            <AnswerCard
              key={answer.questionId}
              sessionId={sessionId}
              answer={answer}
              index={i}
              onReviewSaved={onReviewSaved}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SessionDetailPage() {
  const params = useParams();
  const sessionId = Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId;
  const queryClient = useQueryClient();

  const { data: session, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-session", sessionId],
    queryFn: () => adminApi.getSession(sessionId!),
    enabled: !!sessionId,
    retry: 1,
  });

  const onReviewSaved = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin-session", sessionId] });
    queryClient.invalidateQueries({ queryKey: ["admin-sessions"] });
  }, [queryClient, sessionId]);

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <Loader2 size={32} className="mx-auto animate-spin text-primary-400" />
          <p className="mt-3 text-sm text-text-muted">Loading session…</p>
        </div>
      </div>
    );
  }

  if (isError || !session) {
    return (
      <div className="rounded-2xl border border-danger/20 bg-danger/5 p-8 text-center">
        <XCircle size={28} className="mx-auto text-danger mb-3" />
        <p className="text-sm font-semibold text-danger">Session not found or not yet complete.</p>
        <p className="mt-1 text-xs text-text-muted">
          Only completed sessions can be reviewed.
        </p>
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center gap-2 rounded-xl bg-background-card border border-border px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-background-surface"
          >
            <RefreshCw size={13} /> Retry
          </button>
          <Link
            href="/sessions"
            className="inline-flex items-center gap-2 rounded-xl bg-primary-500 px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            <ArrowLeft size={13} /> Back to Sessions
          </Link>
        </div>
      </div>
    );
  }

  const pendingCount = session.phaseResults.flatMap((p) => p.answers).filter(
    (a) => a.manualReviewStatus === "pending"
  ).length;

  const totalAnswers = session.phaseResults.flatMap((p) => p.answers).length;
  const completedReviews = session.phaseResults.flatMap((p) => p.answers).filter(
    (a) => a.manualReviewStatus === "reviewed"
  ).length;

  return (
    <div className="space-y-6">
      {/* ── Breadcrumb ── */}
      <div className="flex items-center gap-2 text-sm text-text-muted">
        <Link href="/sessions" className="hover:text-text-secondary transition-colors">Sessions</Link>
        <span>/</span>
        <span className="text-text-secondary font-medium">Session Review</span>
      </div>

      {/* ── Hero section ── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-600 to-primary-400 p-6 text-white shadow-lift">
        <div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-white/5 -translate-y-10 translate-x-10" />
        <div className="absolute bottom-0 right-20 h-20 w-20 rounded-full bg-white/5 translate-y-8" />

        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-primary-200">
                {formatDate(session.completedAt)}
              </p>
              <h1 className="mt-1 text-2xl font-extrabold">
                {MODE_LABELS[session.mode] ?? session.mode}
              </h1>
              <p className="mt-1 text-sm text-primary-200">
                Track: <span className="font-semibold text-white capitalize">{session.trackId.replace(/_/g, " ")}</span>
              </p>
            </div>
            <div className="text-center">
              <p className="text-4xl font-black">{session.overallScore}</p>
              <p className="text-xs text-primary-200">Overall Score</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-4 border-t border-white/15 pt-4">
            <div className="flex items-center gap-1.5 text-xs text-primary-100">
              <Clock size={12} />
              {formatDuration(session.durationSeconds)}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-primary-100">
              <Star size={12} />
              {totalAnswers} answers
            </div>
            {completedReviews > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-primary-100">
                <ShieldCheck size={12} />
                {completedReviews}/{totalAnswers} manually reviewed
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Pending review alert ── */}
      {pendingCount > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <AlertCircle size={16} className="text-amber-600 shrink-0" />
          <p className="text-sm font-semibold text-amber-800">
            {pendingCount} answer{pendingCount !== 1 ? "s" : ""} pending manual review
          </p>
        </div>
      )}

      {/* ── Phase score cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {session.phaseResults.map((pr) => {
          const Icon = PHASE_ICONS[pr.phase] ?? Activity;
          return (
            <div
              key={pr.phase}
              className={`rounded-xl border p-4 ${scoreBg(pr.score)}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon size={14} className={scoreColor(pr.score)} />
                <p className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
                  {pr.phase.replace("_", " ")}
                </p>
              </div>
              <p className={`text-2xl font-black ${scoreColor(pr.score)}`}>{pr.score}</p>
              <p className="text-[10px] text-text-muted">{pr.questionCount} questions</p>
            </div>
          );
        })}
      </div>

      {/* ── Per-phase answer review ── */}
      <div className="space-y-4">
        {session.phaseResults.map((phase) => (
          <PhaseSection
            key={phase.phase}
            sessionId={session.id}
            phase={phase}
            onReviewSaved={onReviewSaved}
          />
        ))}
      </div>

      {/* ── Footer actions ── */}
      <div className="flex items-center justify-between border-t border-border-soft pt-4">
        <Link
          href="/sessions"
          className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-background-surface"
        >
          <ArrowLeft size={14} /> Back to Sessions
        </Link>
        <Link
          href={`/candidates/${session.userId}`}
          className="inline-flex items-center gap-2 rounded-xl bg-primary-500 px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          <Users size={14} /> View Candidate Profile
        </Link>
      </div>
    </div>
  );
}

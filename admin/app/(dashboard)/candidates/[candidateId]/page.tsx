"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Award,
  CalendarDays,
  Loader2,
  Mic,
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
  behavioral: "Behavioral Round",
};

const MODE_LABELS: Record<string, string> = {
  hr: "HR Only",
  technical: "Technical Only",
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
    <div className="rounded-2xl border border-border bg-background-card p-4">
      <div className="flex items-center gap-2 text-text-muted">
        <Icon size={15} />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-xl font-bold text-text-primary">{value}</p>
    </div>
  );
}

// One always-expanded Q&A card per answer — unlike the candidate-facing
// accordion in the mobile app's `interview/results/[sessionId].tsx` (where
// collapsing keeps a long list scannable), an admin reviewing a session wants
// every transcription/score/feedback/model-answer visible at once (spec:
// "Admins can review any session including voice transcriptions").
function ReviewAnswerCard({ answer, index }: { answer: InterviewQuestionAnswer; index: number }) {
  return (
    <div className="rounded-xl border border-border bg-background-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Question {index + 1}</p>
          <p className="mt-1 text-sm font-medium text-text-primary">{answer.questionText}</p>
        </div>
        <ScoreBadge score={answer.score} />
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-text-muted">
        {answer.answerType === "voice" ? <Mic size={13} /> : null}
        <span>{answer.answerType === "voice" ? "Voice transcription" : "Typed answer"}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-text-secondary">
        {answer.answerType === "voice" ? answer.transcription ?? "—" : answer.userTextAnswer ?? "—"}
      </p>

      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Feedback</p>
      <p className="mt-1 text-sm leading-6 text-text-secondary">{answer.feedback}</p>

      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Model Answer</p>
      <p className="mt-1 text-sm leading-6 text-text-secondary">{answer.modelAnswer}</p>

      {Object.keys(answer.criteriaScores).length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(answer.criteriaScores).map(([criterion, value]) => (
            <span key={criterion} className="rounded-full bg-background-card px-2.5 py-1 text-xs text-text-muted">
              {criterion.replace(/_/g, " ")}: <span className="font-semibold text-text-secondary">{value}/10</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SessionReviewModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { data: session, isLoading, isError } = useQuery({
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-border bg-background-card p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-text-primary">Session Review</h2>
            {session ? (
              <p className="mt-1 text-sm text-text-secondary">
                {TRACK_NAMES[session.trackId] ?? session.trackId} · {MODE_LABELS[session.mode] ?? session.mode} ·{" "}
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
            <div className="flex items-center gap-3 rounded-xl border border-border bg-background-surface px-4 py-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Overall Score</span>
              <ScoreBadge score={session.overallScore} size="md" />
              <div className="ml-auto flex gap-2">
                {session.phaseResults.map((phaseResult) => (
                  <span key={phaseResult.phase} className="rounded-full bg-background-card px-2.5 py-1 text-xs text-text-muted">
                    {PHASE_LABELS[phaseResult.phase] ?? phaseResult.phase}:{" "}
                    <span className="font-semibold text-text-secondary">{phaseResult.score}/100</span>
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-5 space-y-6">
              {session.phaseResults.map((phaseResult) => (
                <div key={phaseResult.phase}>
                  <p className="mb-3 px-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
                    {PHASE_LABELS[phaseResult.phase] ?? phaseResult.phase}
                  </p>
                  <div className="space-y-3">
                    {phaseResult.answers.map((answer, index) => (
                      <ReviewAnswerCard key={answer.questionId} answer={answer} index={index} />
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

function AssessmentCard({ assessment }: { assessment: CandidateAssessment }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-2xl border border-border bg-background-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text-primary">{TRACK_NAMES[assessment.trackId] ?? assessment.trackId}</p>
          <p className="text-xs text-text-muted">
            {assessment.skillLevel.charAt(0).toUpperCase() + assessment.skillLevel.slice(1)} level · {formatDate(assessment.createdAt)}
          </p>
        </div>
        <ScoreBadge score={assessment.score} size="md" />
      </div>

      {Object.keys(assessment.breakdown).length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {Object.entries(assessment.breakdown).map(([topic, score]) => (
            <span key={topic} className="rounded-full bg-background-surface px-2.5 py-1 text-xs text-text-muted">
              {topic.replace(/_/g, " ")}: <span className="font-semibold text-text-secondary">{score}/100</span>
            </span>
          ))}
        </div>
      ) : null}

      {assessment.perQuestionFeedback.length > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-4 text-xs font-semibold text-primary-400 hover:underline"
        >
          {expanded ? "Hide" : "Show"} per-question feedback ({assessment.perQuestionFeedback.length})
        </button>
      ) : null}

      {expanded ? (
        <div className="mt-3 space-y-3">
          {assessment.perQuestionFeedback.map((item) => (
            <div key={item.questionId} className="rounded-xl border border-border bg-background-surface p-3.5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium text-text-primary">{item.question}</p>
                <span className="shrink-0 rounded-full bg-background-card px-2 py-0.5 text-xs font-semibold text-text-secondary">
                  {item.score}/10
                </span>
              </div>
              <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Candidate&apos;s Answer</p>
              <p className="mt-1 text-sm text-text-secondary">{item.userAnswer}</p>
              <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Feedback</p>
              <p className="mt-1 text-sm text-text-secondary">{item.feedback}</p>
            </div>
          ))}
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
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-text-secondary">
        <Loader2 size={16} className="animate-spin" />
        Loading candidate…
      </div>
    );
  }

  if (isError || !candidate) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-background-card py-24 text-center">
        <p className="text-sm font-medium text-text-primary">We couldn&apos;t load this candidate.</p>
        <Link href="/candidates" className="text-sm font-semibold text-primary-400 hover:underline">
          Back to Candidates
        </Link>
      </div>
    );
  }

  const { user, enrollments, assessments, sessions, stats } = candidate;

  const TABS: { value: DetailTab; label: string; count: number }[] = [
    { value: "enrollments", label: "Enrollments", count: enrollments.length },
    { value: "sessions", label: "Sessions", count: sessions.length },
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

      <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-border bg-background-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- external Google avatar URL
            <img src={user.image} alt={user.name} className="h-14 w-14 rounded-full" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-background-surface text-lg font-semibold text-text-primary">
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
            className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
              tab === tabOption.value ? "bg-primary-500 text-white" : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {tabOption.label} <span className="opacity-70">({tabOption.count})</span>
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
          <SessionHistoryTable sessions={sessions} onReview={(session: InterviewSessionResult) => setReviewingSessionId(session.id)} />
        ) : null}

        {tab === "assessments" ? (
          assessments.length === 0 ? (
            <div className="rounded-2xl border border-border bg-background-card py-16 text-center text-sm text-text-muted">
              This candidate hasn&apos;t completed a skill assessment yet.
            </div>
          ) : (
            <div className="space-y-4">
              {assessments.map((assessment) => (
                <AssessmentCard key={assessment.id} assessment={assessment} />
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

import { AlertTriangle, Clock, CheckCircle2, Eye } from "lucide-react";

import ScoreBadge from "@/components/ui/ScoreBadge";
import { TRACK_NAMES } from "@/lib/tracks";
import type { InterviewSessionResult } from "@/types";

interface SessionHistoryTableProps {
  sessions: InterviewSessionResult[];
  loading?: boolean;
  onReview: (session: InterviewSessionResult) => void;
  trackNames?: Record<string, string>;
}

const MODE_CONFIG: Record<string, { label: string; color: string }> = {
  hr:         { label: "HR Only",           color: "bg-sky-500/10 text-sky-600" },
  technical:  { label: "Technical + Coding", color: "bg-purple-500/10 text-purple-600" },
  behavioral: { label: "Behavioral Only",    color: "bg-emerald-500/10 text-emerald-600" },
  full_mock:  { label: "Full Mock",          color: "bg-primary-500/10 text-primary-600" },
};

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

export default function SessionHistoryTable({
  sessions,
  loading = false,
  onReview,
  trackNames = TRACK_NAMES,
}: SessionHistoryTableProps) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-background-surface" />
        ))}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border-soft bg-background-card py-16 text-center">
        <CheckCircle2 size={28} className="text-text-muted" />
        <p className="text-sm font-medium text-text-muted">No completed mock interviews yet</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border-soft bg-background-card shadow-soft">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border-soft bg-background-surface/60">
            {["Date", "Track", "Mode", "Score", "Duration", "Review Status", ""].map((h) => (
              <th key={h} className="px-4 py-3.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => {
            const pendingCount = session.phaseResults
              .flatMap((p) => p.answers)
              .filter(
                (a) =>
                  a.manualReviewStatus === "pending" ||
                  (a.reviewFlags ?? []).includes("manual_review_recommended")
              ).length;
            const mode = MODE_CONFIG[session.mode];

            return (
              <tr
                key={session.id}
                className="border-b border-border-soft last:border-0 transition-colors hover:bg-background-elevated"
              >
                {/* Date */}
                <td className="px-4 py-3.5 whitespace-nowrap text-text-secondary">
                  {new Date(session.completedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </td>

                {/* Track */}
                <td className="px-4 py-3.5 font-medium text-text-primary">
                  {trackNames[session.trackId] ?? session.trackId}
                </td>

                {/* Mode */}
                <td className="px-4 py-3.5">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${mode?.color ?? "bg-background-surface text-text-secondary"}`}>
                    {mode?.label ?? session.mode}
                  </span>
                </td>

                {/* Score */}
                <td className="px-4 py-3.5">
                  <ScoreBadge score={session.overallScore} />
                </td>

                {/* Duration */}
                <td className="px-4 py-3.5 whitespace-nowrap">
                  <span className="flex items-center gap-1.5 text-xs text-text-muted">
                    <Clock size={11} />
                    {formatDuration(session.durationSeconds)}
                  </span>
                </td>

                {/* Review status */}
                <td className="px-4 py-3.5">
                  {pendingCount > 0 ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-semibold text-warning">
                      <AlertTriangle size={10} />
                      {pendingCount} pending
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-semibold text-success">
                      <CheckCircle2 size={10} />
                      Reviewed
                    </span>
                  )}
                </td>

                {/* Action */}
                <td className="px-4 py-3.5">
                  <button
                    type="button"
                    onClick={() => onReview(session)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500/10 px-3 py-1.5 text-xs font-semibold text-primary-600 transition-colors hover:bg-primary-500/20"
                  >
                    <Eye size={12} />
                    Review
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

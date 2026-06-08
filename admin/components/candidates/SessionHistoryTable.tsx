import { Eye } from "lucide-react";

import DataTable, { type DataTableColumn } from "@/components/ui/DataTable";
import ScoreBadge from "@/components/ui/ScoreBadge";
import { TRACK_NAMES } from "@/lib/tracks";
import type { InterviewSessionResult } from "@/types";

interface SessionHistoryTableProps {
  sessions: InterviewSessionResult[];
  loading?: boolean;
  onReview: (session: InterviewSessionResult) => void;
}

// `MODE_LABELS` mirrors the mobile app's
// `app/(app)/interview/results/[sessionId].tsx` — duplicated locally (it's
// session-result-specific, unlike `TRACK_NAMES` which now lives in
// `lib/tracks.ts` for reuse across the question modals/filters too).
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

// Phase 6 — completed-session list on the candidate detail page's "Sessions"
// tab. Read-only summary rows; the "Review" action opens the admin session
// review modal (`adminApi.getSession`, full transcript + per-answer scoring —
// spec: "Admins can review any session including voice transcriptions").
export default function SessionHistoryTable({ sessions, loading = false, onReview }: SessionHistoryTableProps) {
  const columns: DataTableColumn<InterviewSessionResult>[] = [
    {
      key: "completedAt",
      label: "Completed",
      render: (session) =>
        new Date(session.completedAt).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
    },
    {
      key: "trackId",
      label: "Track",
      render: (session) => TRACK_NAMES[session.trackId] ?? session.trackId,
    },
    {
      key: "mode",
      label: "Mode",
      render: (session) => MODE_LABELS[session.mode] ?? session.mode,
    },
    {
      key: "overallScore",
      label: "Score",
      render: (session) => <ScoreBadge score={session.overallScore} />,
    },
    {
      key: "durationSeconds",
      label: "Duration",
      render: (session) => formatDuration(session.durationSeconds),
    },
    {
      key: "actions",
      label: "",
      render: (session) => (
        <button
          type="button"
          onClick={() => onReview(session)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-background-surface hover:text-text-primary"
        >
          <Eye size={14} />
          Review
        </button>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={sessions}
      loading={loading}
      emptyMessage="No completed mock interviews yet"
    />
  );
}

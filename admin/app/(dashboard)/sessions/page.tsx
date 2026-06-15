"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  AlertCircle,
  RotateCcw,
  ChevronRight,
  Clock,
  SlidersHorizontal,
} from "lucide-react";

import { adminApi } from "@/lib/api";
import type { AdminSessionListItem, InterviewMode, InterviewPhase } from "@/types";
import ScoreBadge from "@/components/ui/ScoreBadge";
import PageHeader from "@/components/ui/PageHeader";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MODE_LABELS: Record<InterviewMode, string> = {
  hr: "HR",
  technical: "Technical",
  behavioral: "Behavioral",
  full_mock: "Full Mock",
};

const MODE_COLORS: Record<InterviewMode, string> = {
  hr: "bg-sky-500/10 text-sky-600",
  technical: "bg-violet-500/10 text-violet-600",
  behavioral: "bg-amber-500/10 text-amber-600",
  full_mock: "bg-emerald-500/10 text-emerald-600",
};

function formatDuration(seconds: number): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
  } catch {
    return iso;
  }
}

function CandidateCell({ item }: { item: AdminSessionListItem }) {
  return (
    <div className="flex items-center gap-2.5">
      {item.candidatePhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.candidatePhoto}
          alt={item.candidateName}
          className="h-8 w-8 rounded-full object-cover shrink-0"
        />
      ) : (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-[11px] font-bold text-primary-600">
          {item.candidateName.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-text-primary">{item.candidateName}</p>
        <p className="truncate text-xs text-text-muted">{item.candidateEmail}</p>
      </div>
    </div>
  );
}

function PhaseScorePills({ phaseResults }: { phaseResults: AdminSessionListItem["phaseResults"] }) {
  if (!phaseResults || phaseResults.length === 0) {
    return <span className="text-xs text-text-muted">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {phaseResults.map((pr) => {
        const color =
          pr.score >= 70 ? "bg-success/10 text-success" :
          pr.score >= 50 ? "bg-amber-500/10 text-amber-600" :
          "bg-danger/10 text-danger";
        const label = pr.phase === "coding_logic"
          ? "Code"
          : (pr.phase as string).toUpperCase().slice(0, 4);
        return (
          <span
            key={pr.phase as string}
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${color}`}
          >
            {label} {pr.score}
          </span>
        );
      })}
    </div>
  );
}

const DAY_OPTIONS = [
  { value: 7,  label: "Last 7 days" },
  { value: 14, label: "Last 14 days" },
  { value: 30, label: "Last 30 days" },
  { value: 60, label: "Last 60 days" },
  { value: 90, label: "Last 90 days" },
];

const PAGE_SIZE = 20;

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SessionsPage() {
  const [page, setPage]             = useState(1);
  const [days, setDays]             = useState(30);
  const [trackFilter, setTrackFilter] = useState("all");
  const [needsReview, setNeedsReview] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-sessions", { page, days, trackFilter, needsReview }],
    queryFn: () =>
      adminApi.getSessions({
        page,
        limit: PAGE_SIZE,
        days,
        trackId: trackFilter !== "all" ? trackFilter : undefined,
        needsReview: needsReview || undefined,
      }),
    retry: 1,
  });

  const { data: tracks } = useQuery({
    queryKey: ["admin-tracks"],
    queryFn: adminApi.getTracks,
    retry: 1,
  });

  const sessions = useMemo(() => data?.items ?? [], [data]);
  const total    = data?.total ?? 0;
  const pages    = data?.pages ?? 1;

  const hasFilters = trackFilter !== "all" || needsReview;
  const clearFilters = () => { setTrackFilter("all"); setNeedsReview(false); setPage(1); };

  const columns: DataTableColumn<AdminSessionListItem>[] = [
    {
      key: "candidate",
      label: "Candidate",
      render: (item) => <CandidateCell item={item} />,
    },
    {
      key: "mode",
      label: "Mode",
      render: (item) => (
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${MODE_COLORS[item.mode] ?? "bg-text-muted/10 text-text-muted"}`}>
          {MODE_LABELS[item.mode] ?? item.mode}
        </span>
      ),
    },
    {
      key: "track",
      label: "Track",
      render: (item) => (
        <span className="rounded-lg bg-background-surface px-2 py-1 text-xs font-medium text-text-secondary capitalize">
          {item.trackId.replace(/_/g, " ")}
        </span>
      ),
    },
    {
      key: "overallScore",
      label: "Overall Score",
      render: (item) => <ScoreBadge score={item.overallScore} />,
    },
    {
      key: "phases",
      label: "Phase Breakdown",
      render: (item) => <PhaseScorePills phaseResults={item.phaseResults} />,
    },
    {
      key: "durationSeconds",
      label: "Duration",
      render: (item) => (
        <div className="flex items-center gap-1.5 text-xs text-text-secondary">
          <Clock size={12} className="text-text-muted" />
          {formatDuration(item.durationSeconds)}
        </div>
      ),
    },
    {
      key: "completedAt",
      label: "Completed",
      render: (item) => (
        <span className="text-xs text-text-secondary">
          {formatDate(item.completedAt)}
        </span>
      ),
    },
    {
      key: "actions",
      label: "",
      render: (item) => (
        <Link
          href={`/sessions/${item.id}`}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:border-primary-400 hover:bg-primary-50 hover:text-primary-600"
        >
          Review <ChevronRight size={12} />
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Interview Sessions"
        badge={total ? `${total} total` : undefined}
        description="Review completed interview sessions, scores, and AI evaluations."
      />

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Date window */}
        <div className="flex items-center gap-2 rounded-xl border border-border-soft bg-background-card px-3 py-2 shadow-soft">
          <CalendarDays size={14} className="text-text-muted shrink-0" />
          <select
            value={days}
            onChange={(e) => { setDays(Number(e.target.value)); setPage(1); }}
            className="bg-transparent text-sm font-medium text-text-primary focus:outline-none"
          >
            {DAY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Track filter */}
        <div className="flex items-center gap-2 rounded-xl border border-border-soft bg-background-card px-3 py-2 shadow-soft">
          <SlidersHorizontal size={14} className="text-text-muted shrink-0" />
          <select
            value={trackFilter}
            onChange={(e) => { setTrackFilter(e.target.value); setPage(1); }}
            className="bg-transparent text-sm font-medium text-text-primary focus:outline-none"
          >
            <option value="all">All Tracks</option>
            {(tracks ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        {/* Needs review toggle */}
        <button
          type="button"
          onClick={() => { setNeedsReview((v) => !v); setPage(1); }}
          className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
            needsReview
              ? "border-amber-400 bg-amber-50 text-amber-700"
              : "border-border-soft bg-background-card text-text-secondary hover:bg-background-surface"
          }`}
        >
          <AlertCircle size={14} />
          Needs Review
        </button>

        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-secondary"
          >
            <RotateCcw size={13} /> Clear filters
          </button>
        )}
      </div>

      {/* ── Table ── */}
      <DataTable
        columns={columns}
        data={sessions}
        loading={isLoading}
        error={isError}
        onRetry={() => refetch()}
        emptyMessage={
          hasFilters
            ? "No sessions match your current filters."
            : "No completed sessions in this date range."
        }
      />

      {/* ── Pagination ── */}
      {!isLoading && !isError && (
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>
            Page {data?.page ?? page} of {pages} · {total} sessions
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((c) => Math.max(c - 1, 1))}
              disabled={page <= 1}
              className="rounded-lg border border-border px-3 py-1.5 font-medium transition-colors hover:bg-background-surface disabled:opacity-40"
            >
              ← Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((c) => Math.min(c + 1, pages))}
              disabled={page >= pages}
              className="rounded-lg border border-border px-3 py-1.5 font-medium transition-colors hover:bg-background-surface disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

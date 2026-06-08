"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, BarChart3, TrendingUp } from "lucide-react";

import { adminApi } from "@/lib/api";
import { TRACK_OPTIONS } from "@/lib/tracks";
import PageHeader from "@/components/ui/PageHeader";
import ScoreTrendChart from "@/components/charts/ScoreTrendChart";
import TrackDistributionChart from "@/components/charts/TrackDistributionChart";
import SessionCompletionChart from "@/components/charts/SessionCompletionChart";

const WINDOW_OPTIONS: { value: number; label: string }[] = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
];

interface ChartSectionProps {
  icon: typeof TrendingUp;
  title: string;
  description: string;
  loading: boolean;
  children: ReactNode;
}

function ChartSection({ icon: Icon, title, description, loading, children }: ChartSectionProps) {
  return (
    <div className="rounded-2xl border border-border bg-background-card p-5">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-500/15">
          <Icon size={17} className="text-primary-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-text-primary">{title}</p>
          <p className="text-xs text-text-secondary">{description}</p>
        </div>
      </div>

      <div className="mt-4">
        {loading ? (
          // Skeleton loading: a row of randomized-height bars stands in for
          // the eventual chart, mirroring `DataTable`'s `animate-pulse` rows
          // so loading states feel consistent across the portal.
          <div className="flex h-[280px] items-end gap-2 px-2">
            {[55, 80, 40, 95, 65, 50, 75, 60, 85, 45, 70, 90].map((height, index) => (
              <div
                key={index}
                className="flex-1 animate-pulse rounded-t-lg bg-background-surface"
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

// Phase 6 — score trends, completion rates, and track distribution, all
// driven by one `GET /admin/analytics` call (`adminApi.getAnalytics`). The
// time-window pills and track filter both map directly onto that endpoint's
// `days`/`track_id` query params (re-running the same three aggregation
// pipelines server-side — Agent Rule #4 — rather than slicing a bigger
// payload client-side).
export default function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const [trackFilter, setTrackFilter] = useState<string>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-analytics", { days, trackFilter }],
    queryFn: () => adminApi.getAnalytics({ days, trackId: trackFilter !== "all" ? trackFilter : undefined }),
  });

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Score trends, enrollment distribution, and session completion across V-Prep."
        actions={
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex gap-1.5 rounded-xl border border-border bg-background-card p-1">
              {WINDOW_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setDays(option.value)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    days === option.value ? "bg-primary-500 text-white" : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <select
              value={trackFilter}
              onChange={(event) => setTrackFilter(event.target.value)}
              className="rounded-xl border border-border bg-background-card px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="all">All tracks</option>
              {TRACK_OPTIONS.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.name}
                </option>
              ))}
            </select>
          </div>
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ChartSection
          icon={TrendingUp}
          title="Score Trend"
          description={`Daily average interview score over the last ${days} days`}
          loading={isLoading}
        >
          <ScoreTrendChart data={data?.scoreTrend ?? []} />
        </ChartSection>

        <ChartSection
          icon={BarChart3}
          title="Track Distribution"
          description={`Enrollments started in the last ${days} days, by track`}
          loading={isLoading}
        >
          <TrackDistributionChart data={data?.trackDistribution ?? []} />
        </ChartSection>

        <div className="xl:col-span-2">
          <ChartSection
            icon={Activity}
            title="Session Completion"
            description={`Mock interviews started vs. completed per day, last ${days} days`}
            loading={isLoading}
          >
            <SessionCompletionChart data={data?.sessionCompletion ?? []} />
          </ChartSection>
        </div>
      </div>
    </div>
  );
}

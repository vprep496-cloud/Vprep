"use client";

import { useEffect, useState } from "react";
import { Activity, CheckCircle2, Layers, Target, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import StatCard from "@/components/ui/StatCard";
import { adminApi } from "@/lib/api";
import { TRACK_COLORS } from "@/components/charts/chartTheme";
import type { TrackSummary } from "@/types";

// Phase 6 MODIFY: replaces the Phase-1 placeholder's hardcoded `STATS` array
// with `adminApi.getStats()` (`GET /admin/stats`) — refetched every 60s per
// the spec ("Dashboard shows real live stats... refetch every 60s") so the
// numbers stay current without a manual reload. `StatCard` (extracted from
// this page's old inline tile markup — see that component's header comment)
// renders a skeleton on the very first paint, before the initial fetch lands.
const REFRESH_INTERVAL_MS = 60_000;

export default function DashboardPage() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: adminApi.getStats,
    refetchInterval: REFRESH_INTERVAL_MS,
  });
  const { data: tracks } = useQuery<TrackSummary[]>({
    queryKey: ["admin-tracks"],
    queryFn: adminApi.getTracks,
  });

  const distribution = (tracks ?? []).map((track) => ({
    ...track,
    count: stats?.trackDistribution[track.id] ?? 0,
  }));
  const totalEnrollments = distribution.reduce((sum, track) => sum + track.count, 0);

  // Phase 7 polish: start bars at 0% and expand to real widths after 200ms
  // so the user sees an animation on mount rather than a static snapshot.
  const [barsReady, setBarsReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setBarsReady(true), 200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
      <p className="mt-1 text-sm text-text-secondary">
        Live overview of V-Prep activity — candidates, mock interviews, and track engagement.
      </p>

      <div className="mt-6 rounded-3xl bg-primary-500 p-8 text-white shadow-lift">
        <p className="text-2xl font-bold text-primary-100">System Performance</p>
        <p className="mt-2 text-sm font-medium text-primary-100/80">Weekly analytics overview</p>
        <div className="mt-6 grid gap-8 sm:grid-cols-2">
          <div>
            <p className="text-5xl font-extrabold text-cranberry">
              {stats ? `${stats.averageOverallScore}%` : "—"}
            </p>
            <p className="mt-2 text-xs font-bold uppercase tracking-wide text-primary-100">
              Avg. Candidate Score
            </p>
          </div>
          <div>
            <p className="text-5xl font-extrabold text-primary-100">
              {stats?.completedSessions ?? 0}
            </p>
            <p className="mt-2 text-xs font-bold uppercase tracking-wide text-primary-100">
              Interviews Done
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Candidates"
          value={stats?.totalCandidates ?? 0}
          icon={Users}
          loading={isLoading}
        />
        <StatCard
          label="Active Sessions"
          value={stats?.activeSessions ?? 0}
          icon={Activity}
          loading={isLoading}
        />
        <StatCard
          label="Avg Score"
          value={stats ? `${stats.averageOverallScore}/100` : "—"}
          icon={Target}
          loading={isLoading}
        />
        <StatCard
          label="Completed Interviews"
          value={stats?.completedSessions ?? 0}
          icon={CheckCircle2}
          loading={isLoading}
        />
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-background-card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-500/15">
              <Layers size={18} className="text-primary-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">Track Distribution</p>
              <p className="text-xs text-text-secondary">Enrollments across all six tracks</p>
            </div>
          </div>
          <span className="text-sm font-semibold text-text-primary">{totalEnrollments} total</span>
        </div>

        {/* A single segmented bar — each track's share rendered as a
            proportionally-widthed, brand-colored slice — plus a color-keyed
            legend underneath. This is deliberately a compact "distribution
            bar" (the spec's wording) rather than the fuller axis-and-tooltip
            `TrackDistributionChart` built for the analytics page; reusing
            that chart here would visually duplicate analytics on the
            landing page and (per Agent Rule #6's spirit, even though this
            isn't a recharts component) needs its own zero-state, since a
            brand-new install legitimately starts at zero enrollments. */}
        {totalEnrollments === 0 ? (
          <p className="mt-5 text-sm text-text-muted">No enrollments yet — the distribution will populate as candidates start tracks.</p>
        ) : (
          <div className="mt-5 flex h-3 w-full overflow-hidden rounded-full bg-background-surface">
            {distribution
              .filter((track) => track.count > 0)
              .map((track) => (
                <div
                  key={track.id}
                  style={{
                    width: barsReady ? `${(track.count / totalEnrollments) * 100}%` : "0%",
                    backgroundColor: TRACK_COLORS[track.id] ?? track.color,
                    transition: "width 1s ease-out",
                  }}
                  title={`${track.name}: ${track.count}`}
                />
              ))}
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3">
          {distribution.map((track) => (
            <div key={track.id} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: TRACK_COLORS[track.id] ?? track.color }} />
              <span className="truncate text-xs text-text-secondary">{track.name}</span>
              <span className="ml-auto text-xs font-semibold text-text-primary">{track.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Layers,
  Target,
  Users,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { useSession } from "next-auth/react";
import StatCard from "@/components/ui/StatCard";
import { adminApi } from "@/lib/api";
import { TRACK_COLORS } from "@/components/charts/chartTheme";
import type { TrackSummary } from "@/types";

const REFRESH_INTERVAL_MS = 60_000;

export default function DashboardPage() {
  const { data: authSession } = useSession();
  const greeting = authSession?.user?.name?.split(" ")[0] ?? "Admin";

  const {
    data: stats,
    isLoading,
    isError: statsError,
    refetch: refetchStats,
  } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: adminApi.getStats,
    refetchInterval: REFRESH_INTERVAL_MS,
    retry: 1,
  });

  const { data: tracks } = useQuery<TrackSummary[]>({
    queryKey: ["admin-tracks"],
    queryFn: adminApi.getTracks,
    retry: 1,
  });

  const distribution = (tracks ?? []).map((track) => ({
    ...track,
    count: stats?.trackDistribution[track.id] ?? 0,
  }));
  const totalEnrollments = distribution.reduce((sum, t) => sum + t.count, 0);

  const [barsReady, setBarsReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setBarsReady(true), 300);
    return () => clearTimeout(timer);
  }, []);

  if (statsError) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-danger/20 bg-danger/5 py-20 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger/10">
          <AlertTriangle size={22} className="text-danger" />
        </div>
        <div>
          <p className="font-semibold text-text-primary">Couldn&apos;t load dashboard</p>
          <p className="mt-1 text-sm text-text-muted">Make sure the backend is running at localhost:8000</p>
        </div>
        <button
          type="button"
          onClick={() => refetchStats()}
          className="rounded-xl bg-primary-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-600"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hero strip */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-600 via-primary-500 to-primary-400 p-8 text-white shadow-lift">
        {/* Background decoration */}
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute bottom-0 right-20 h-24 w-24 rounded-full bg-white/5" />

        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary-200">
            V-Prep Operations
          </p>
          <h1 className="mt-1 text-2xl font-bold text-white">
            Welcome back, {greeting}
          </h1>

          <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-4">
            <div>
              <p className={`text-3xl font-extrabold ${isLoading ? "opacity-0" : ""} transition-opacity`}>
                {stats ? `${stats.averageOverallScore}%` : "—"}
              </p>
              <p className="mt-1 text-xs font-medium text-primary-200">Avg Score</p>
            </div>
            <div>
              <p className={`text-3xl font-extrabold ${isLoading ? "opacity-0" : ""} transition-opacity`}>
                {stats?.completedSessions ?? "—"}
              </p>
              <p className="mt-1 text-xs font-medium text-primary-200">Completed</p>
            </div>
            <div>
              <p className={`text-3xl font-extrabold ${isLoading ? "opacity-0" : ""} transition-opacity`}>
                {stats?.totalCandidates ?? "—"}
              </p>
              <p className="mt-1 text-xs font-medium text-primary-200">Candidates</p>
            </div>
            <div>
              <p className={`text-3xl font-extrabold ${isLoading ? "opacity-0" : ""} transition-opacity`}>
                {stats?.totalEnrollments ?? "—"}
              </p>
              <p className="mt-1 text-xs font-medium text-primary-200">Enrollments</p>
            </div>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Candidates"
          value={stats?.totalCandidates ?? 0}
          icon={Users}
          loading={isLoading}
          sub="All registered users"
          accent="primary"
        />
        <StatCard
          label="Active Sessions"
          value={stats?.activeSessions ?? 0}
          icon={Activity}
          loading={isLoading}
          sub="Currently in progress"
          accent="sky"
        />
        <StatCard
          label="Average Score"
          value={stats ? `${stats.averageOverallScore}/100` : "—"}
          icon={Target}
          loading={isLoading}
          sub="Across all interviews"
          accent={
            (stats?.averageOverallScore ?? 0) >= 70
              ? "success"
              : (stats?.averageOverallScore ?? 0) >= 50
                ? "warning"
                : "danger"
          }
        />
        <StatCard
          label="Completed Interviews"
          value={stats?.completedSessions ?? 0}
          icon={CheckCircle2}
          loading={isLoading}
          sub="Total mock sessions done"
          accent="success"
        />
      </div>

      {/* Track distribution */}
      <div className="rounded-2xl border border-border-soft bg-background-card p-6 shadow-soft">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-500/10">
              <Layers size={18} className="text-primary-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">Track Distribution</p>
              <p className="text-xs text-text-muted">Candidate enrollments by track</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <TrendingUp size={14} className="text-success" />
            <span className="text-sm font-bold text-text-primary">{totalEnrollments} total</span>
          </div>
        </div>

        {isLoading ? (
          <div className="mt-5 space-y-3">
            <div className="h-3 w-full animate-pulse rounded-full bg-background-surface" />
            <div className="grid grid-cols-3 gap-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-4 animate-pulse rounded bg-background-surface" />
              ))}
            </div>
          </div>
        ) : totalEnrollments === 0 ? (
          <p className="mt-5 rounded-xl bg-background-surface px-4 py-3 text-sm text-text-muted">
            No enrollments yet — the distribution will appear as candidates start tracks.
          </p>
        ) : (
          <>
            {/* Segmented bar */}
            <div className="mt-5 flex h-2.5 w-full overflow-hidden rounded-full bg-background-surface">
              {distribution
                .filter((t) => t.count > 0)
                .map((t) => (
                  <div
                    key={t.id}
                    style={{
                      width: barsReady ? `${(t.count / totalEnrollments) * 100}%` : "0%",
                      backgroundColor: TRACK_COLORS[t.id] ?? t.color,
                      transition: "width 0.9s cubic-bezier(0.4,0,0.2,1)",
                    }}
                    title={`${t.name}: ${t.count}`}
                  />
                ))}
            </div>

            {/* Legend */}
            <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3">
              {distribution.map((t) => (
                <div key={t.id} className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: TRACK_COLORS[t.id] ?? t.color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">{t.name}</span>
                  <span className="text-xs font-semibold text-text-primary">{t.count}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

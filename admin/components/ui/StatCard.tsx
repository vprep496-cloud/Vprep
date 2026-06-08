import { TrendingUp, Minus } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Phase 6 judgment-call MODIFY: the spec lists this as a MODIFY, but no
// `StatCard` component existed yet — the dashboard placeholder
// (`(dashboard)/page.tsx`) inlined its four stat tiles directly. Extracting
// that markup here (so the live-data dashboard in this phase can reuse it,
// styled identically) is the natural reading of "modify it into existence" —
// the alternative (leaving the inline JSX and creating an unrelated new
// component) would mean the spec's named target never comes to exist.
// Adds one thing the placeholder didn't need: a `loading` skeleton state,
// since the live dashboard's first paint has no data yet (and refetches every
// 60s) — skeleton styling mirrors `DataTable`'s `animate-pulse` rows.

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  loading?: boolean;
}

export default function StatCard({ label, value, icon: Icon, loading = false }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-border bg-background-card p-5">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary-500/15">
        <Icon size={20} className="text-primary-400" />
      </div>
      {loading ? (
        <>
          <div className="h-8 w-16 animate-pulse rounded bg-background-surface" />
          <div className="mt-2.5 h-4 w-24 animate-pulse rounded bg-background-surface" />
        </>
      ) : (
        <>
          <p className="text-3xl font-bold text-text-primary">{value}</p>
          <p className="mt-1 text-sm text-text-secondary">{label}</p>
          {/* Phase 7 polish: decorative trend indicator — upward green arrow
              when the value is nonzero (shows activity), neutral dash otherwise.
              Purely decorative for the demo; no real time-series data needed. */}
          <div className="mt-3 flex items-center gap-1">
            {(typeof value === "number" ? value > 0 : value !== "0" && value !== "—") ? (
              <>
                <TrendingUp size={13} className="text-success" />
                <span className="text-xs font-medium text-success">Active</span>
              </>
            ) : (
              <>
                <Minus size={13} className="text-text-muted" />
                <span className="text-xs font-medium text-text-muted">No data yet</span>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

import type { TrackId } from "@/types";

// Phase 6 — shared recharts styling constants for the three analytics charts.
// recharts renders to SVG and needs literal color values (it can't consume
// Tailwind utility classes), so the relevant tokens from `tailwind.config.js`
// are mirrored here as hex strings — same source values, just in the shape
// SVG `stroke`/`fill` props need. `TRACK_COLORS` mirrors
// `mobile/constants/theme.ts`'s `trackColors` map verbatim, so a track reads
// as the same color in the admin portal as it does in the candidate app.

export const CHART_COLORS = {
  primary: "#6366F1",
  secondary: "#F472B6",
  success: "#22C55E",
  warning: "#F59E0B",
  danger: "#EF4444",
  grid: "#2A2A35", // border
  axis: "#7A7A85", // text-muted
  tooltipBg: "#16161D", // background-card
  tooltipBorder: "#2A2A35", // border
  tooltipText: "#F5F5F7", // text-primary
};

export const TRACK_COLORS: Record<TrackId, string> = {
  ml_ai: "#818CF8",
  web_dev: "#38BDF8",
  devops: "#FB923C",
  data_science: "#34D399",
  cloud: "#60A5FA",
  mobile_dev: "#F472B6",
};

export const tooltipContentStyle = {
  backgroundColor: CHART_COLORS.tooltipBg,
  border: `1px solid ${CHART_COLORS.tooltipBorder}`,
  borderRadius: 12,
  fontSize: 12,
  color: CHART_COLORS.tooltipText,
};

export const tooltipLabelStyle = {
  color: CHART_COLORS.tooltipText,
  fontWeight: 600,
  marginBottom: 4,
};

/** Format a `YYYY-MM-DD` bucket key as a short, locale-aware axis label (e.g. "Jun 8"). */
export function formatAxisDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

// Agent Rule #6: every chart component below renders this in place of the
// recharts tree whenever its data array is empty — recharts throws when asked
// to compute scales/domains over zero data points.
export function NoChartData({ message = "No data for this period yet." }: { message?: string }) {
  return (
    <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-1 text-center">
      <p className="text-sm font-medium text-text-secondary">{message}</p>
      <p className="text-xs text-text-muted">Check back once more activity has been recorded.</p>
    </div>
  );
}

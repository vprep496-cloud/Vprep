"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { CHART_COLORS, NoChartData, TRACK_COLORS, tooltipContentStyle, tooltipLabelStyle } from "./chartTheme";
import type { TrackDistributionPoint, TrackId } from "@/types";

interface TrackDistributionChartProps {
  data: TrackDistributionPoint[];
}

// Phase 6 — horizontal bar chart of enrollment counts per track within the
// selected window, fed by `GET /admin/analytics`'s `track_distribution`
// (`adminApi.getAnalytics().trackDistribution`, already sorted desc by the
// backend's `$sort: {count: -1}`). Each bar is colored with this track's
// brand color (`TRACK_COLORS`, mirroring the mobile app's `trackColors`) so a
// track reads identically across both surfaces.
export default function TrackDistributionChart({ data }: TrackDistributionChartProps) {
  // Agent Rule #6: an empty `data` array would leave recharts computing a
  // category-axis domain over nothing — short-circuit before that happens.
  if (data.length === 0) {
    return <NoChartData message="No enrollments started in this window yet." />;
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, bottom: 0, left: 8 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          allowDecimals={false}
          stroke={CHART_COLORS.axis}
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: CHART_COLORS.grid }}
        />
        <YAxis
          type="category"
          dataKey="trackName"
          stroke={CHART_COLORS.axis}
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={96}
        />
        <Tooltip
          cursor={{ fill: CHART_COLORS.grid, opacity: 0.3 }}
          contentStyle={tooltipContentStyle}
          labelStyle={tooltipLabelStyle}
          formatter={(value) => [`${value}`, "Enrollments"]}
        />
        <Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={22}>
          {data.map((entry) => (
            <Cell key={entry.trackId} fill={TRACK_COLORS[entry.trackId as TrackId] ?? CHART_COLORS.primary} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

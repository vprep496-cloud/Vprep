"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { CHART_COLORS, NoChartData, formatAxisDate, tooltipContentStyle, tooltipLabelStyle } from "./chartTheme";
import type { SessionCompletionPoint } from "@/types";

interface SessionCompletionChartProps {
  data: SessionCompletionPoint[];
}

const SERIES_LABEL: Record<string, string> = {
  started: "Started",
  completed: "Completed",
};

// Phase 6 — grouped daily bars comparing sessions started vs. completed, fed
// by `GET /admin/analytics`'s `session_completion`
// (`adminApi.getAnalytics().sessionCompletion` — already merged server-side
// from the backend's two-pipeline `$facet` into `{date, started, completed}`).
export default function SessionCompletionChart({ data }: SessionCompletionChartProps) {
  // Agent Rule #6: recharts derives its axis scales from `data` up front and
  // throws on an empty array — render the shared empty state first.
  if (data.length === 0) {
    return <NoChartData message="No interview sessions in this window yet." />;
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -16 }} barGap={4}>
        <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatAxisDate}
          stroke={CHART_COLORS.axis}
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: CHART_COLORS.grid }}
        />
        <YAxis
          allowDecimals={false}
          stroke={CHART_COLORS.axis}
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={32}
        />
        <Tooltip
          cursor={{ fill: CHART_COLORS.grid, opacity: 0.25 }}
          contentStyle={tooltipContentStyle}
          labelStyle={tooltipLabelStyle}
          labelFormatter={(value) => formatAxisDate(String(value))}
          formatter={(value, name) => [`${value}`, SERIES_LABEL[`${name}`] ?? `${name}`]}
        />
        <Legend
          formatter={(value: string) => (
            <span style={{ color: CHART_COLORS.tooltipText, fontSize: 12 }}>{SERIES_LABEL[value] ?? value}</span>
          )}
        />
        <Bar dataKey="started" name="started" fill={CHART_COLORS.secondary} radius={[4, 4, 0, 0]} maxBarSize={18} />
        <Bar dataKey="completed" name="completed" fill={CHART_COLORS.success} radius={[4, 4, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

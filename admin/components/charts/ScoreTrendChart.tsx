"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { CHART_COLORS, NoChartData, formatAxisDate, tooltipContentStyle, tooltipLabelStyle } from "./chartTheme";
import type { ScoreTrendPoint } from "@/types";

interface ScoreTrendChartProps {
  data: ScoreTrendPoint[];
}

// Phase 6 — daily average-score line, fed by `GET /admin/analytics`'s
// `score_trend` (`adminApi.getAnalytics().scoreTrend`).
export default function ScoreTrendChart({ data }: ScoreTrendChartProps) {
  // Agent Rule #6: recharts computes axis domains/scales eagerly from `data`
  // and throws on an empty array — render the shared empty state instead of
  // ever handing it one.
  if (data.length === 0) {
    return <NoChartData message="No completed interviews in this window yet." />;
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
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
          domain={[0, 100]}
          stroke={CHART_COLORS.axis}
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={36}
        />
        <Tooltip
          contentStyle={tooltipContentStyle}
          labelStyle={tooltipLabelStyle}
          labelFormatter={(value) => formatAxisDate(String(value))}
          formatter={(value, name) =>
            name === "averageScore" ? [`${value}/100`, "Avg score"] : [`${value}`, "Sessions"]
          }
        />
        <Line
          type="monotone"
          dataKey="averageScore"
          name="averageScore"
          stroke={CHART_COLORS.primary}
          strokeWidth={2.5}
          dot={{ r: 3, fill: CHART_COLORS.primary, strokeWidth: 0 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

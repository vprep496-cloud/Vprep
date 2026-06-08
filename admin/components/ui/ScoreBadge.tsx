// Phase 6 — pill that color-codes a 0-100 score, shared by the candidates
// directory, candidate detail (assessments/sessions), and session-review UI.
// Thresholds and Tailwind classes mirror `scoreBadgeMeta` in the mobile app's
// `app/(app)/interview/results/[sessionId].tsx` (>=70 success / >=50 warning /
// below danger) — same product meaning, same palette, just ported to web
// className strings instead of React Native `className` + NativeWind.

interface ScoreBadgeProps {
  score: number | null | undefined;
  size?: "sm" | "md";
}

function scoreBadgeStyles(score: number): { container: string; label: string } {
  if (score >= 70) return { container: "bg-success/15", label: "text-success" };
  if (score >= 50) return { container: "bg-warning/15", label: "text-warning" };
  return { container: "bg-danger/15", label: "text-danger" };
}

const SIZE_STYLES: Record<NonNullable<ScoreBadgeProps["size"]>, string> = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-1 text-sm",
};

export default function ScoreBadge({ score, size = "sm" }: ScoreBadgeProps) {
  if (score === null || score === undefined) {
    return (
      <span
        className={`inline-flex items-center rounded-full font-semibold bg-background-surface text-text-muted ${SIZE_STYLES[size]}`}
      >
        — N/A
      </span>
    );
  }

  const { container, label } = scoreBadgeStyles(score);
  return (
    <span className={`inline-flex items-center rounded-full font-bold ${container} ${label} ${SIZE_STYLES[size]}`}>
      {Math.round(score)}/100
    </span>
  );
}

interface ScoreBadgeProps {
  score: number | null | undefined;
  size?: "sm" | "md";
}

function getScoreConfig(score: number): { bg: string; text: string; ring: string } {
  if (score >= 70) return { bg: "bg-success/10", text: "text-success", ring: "ring-success/25" };
  if (score >= 50) return { bg: "bg-amber-500/10", text: "text-amber-600", ring: "ring-amber-500/25" };
  return { bg: "bg-danger/10", text: "text-danger", ring: "ring-danger/25" };
}

export default function ScoreBadge({ score, size = "sm" }: ScoreBadgeProps) {
  const sizeClass = size === "md" ? "px-3 py-1 text-sm font-bold" : "px-2.5 py-0.5 text-xs font-semibold";

  if (score === null || score === undefined) {
    return (
      <span className={`inline-flex items-center rounded-full bg-background-surface text-text-muted ring-1 ring-border ${sizeClass}`}>
        N/A
      </span>
    );
  }

  const { bg, text, ring } = getScoreConfig(score);
  return (
    <span className={`inline-flex items-center rounded-full ring-1 ${bg} ${text} ${ring} ${sizeClass}`}>
      {Math.round(score)}<span className="ml-0.5 opacity-60">/100</span>
    </span>
  );
}

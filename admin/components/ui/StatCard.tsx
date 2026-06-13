import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  loading?: boolean;
  sub?: string;
  accent?: "primary" | "success" | "warning" | "danger" | "sky";
}

const ACCENT_STYLES = {
  primary: { icon: "bg-primary-500/10 text-primary-500", ring: "ring-primary-500/20" },
  success: { icon: "bg-success/10 text-success", ring: "ring-success/20" },
  warning: { icon: "bg-warning/10 text-warning", ring: "ring-warning/20" },
  danger:  { icon: "bg-danger/10 text-danger",  ring: "ring-danger/20"  },
  sky:     { icon: "bg-sky-500/10 text-sky-500", ring: "ring-sky-500/20" },
};

export default function StatCard({
  label,
  value,
  icon: Icon,
  loading = false,
  sub,
  accent = "primary",
}: StatCardProps) {
  const style = ACCENT_STYLES[accent];

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border-soft bg-background-card p-5 shadow-soft transition-shadow hover:shadow-lift">
      {/* Decorative gradient blob */}
      <div className="pointer-events-none absolute -right-4 -top-4 h-20 w-20 rounded-full bg-primary-500/5 transition-transform group-hover:scale-125" />

      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ring-1 ${style.icon} ${style.ring}`}>
          <Icon size={19} />
        </div>
      </div>

      {loading ? (
        <div className="mt-4 space-y-2.5">
          <div className="h-7 w-20 animate-pulse rounded-lg bg-background-surface" />
          <div className="h-3.5 w-28 animate-pulse rounded bg-background-muted" />
        </div>
      ) : (
        <div className="mt-4">
          <p className="text-2xl font-bold text-text-primary tracking-tight">{value}</p>
          <p className="mt-0.5 text-sm text-text-secondary">{label}</p>
          {sub && <p className="mt-1 text-xs text-text-muted">{sub}</p>}
        </div>
      )}
    </div>
  );
}

import { CalendarDays, CheckCircle2, FileText } from "lucide-react";
import ScoreBadge from "@/components/ui/ScoreBadge";
import type { CandidateEnrollment } from "@/types";

const SKILL_CONFIG: Record<CandidateEnrollment["skillLevel"], { label: string; color: string }> = {
  beginner:     { label: "Beginner",     color: "bg-sky-500/10 text-sky-600" },
  intermediate: { label: "Intermediate", color: "bg-amber-500/10 text-amber-600" },
  advanced:     { label: "Advanced",     color: "bg-purple-500/10 text-purple-600" },
};

export default function EnrollmentCard({ enrollment }: { enrollment: CandidateEnrollment }) {
  const track = enrollment.track;
  const accent = track?.color ?? "#60164B";
  const totalDays = track?.totalDays ?? Math.max(enrollment.currentDay, 30);
  const progressPct = totalDays > 0 ? Math.min(100, Math.round((enrollment.currentDay / totalDays) * 100)) : 0;
  const skillConfig = SKILL_CONFIG[enrollment.skillLevel] ?? SKILL_CONFIG.beginner;

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border-soft bg-background-card p-5 shadow-soft transition-shadow hover:shadow-lift">
      {/* Accent strip */}
      <div
        className="absolute inset-y-0 left-0 w-1 rounded-l-2xl"
        style={{ backgroundColor: accent }}
      />

      <div className="pl-2">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-text-primary">{track?.name ?? enrollment.trackId}</p>
            <div className="mt-1.5 flex items-center gap-2">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${skillConfig.color}`}>
                {skillConfig.label}
              </span>
              {enrollment.planExists ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                  <FileText size={9} />
                  Plan ready
                </span>
              ) : null}
            </div>
          </div>
          <ScoreBadge score={enrollment.averageScore} />
        </div>

        {/* Progress */}
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-xs text-text-muted">
            <span>Day {enrollment.currentDay} of {totalDays}</span>
            <span className="font-semibold text-text-secondary">{progressPct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-background-surface">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${progressPct}%`, backgroundColor: accent }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="mt-4 flex items-center justify-between text-xs text-text-muted">
          <span className="flex items-center gap-1">
            <CheckCircle2 size={11} className="text-success" />
            {enrollment.totalSessions} session{enrollment.totalSessions !== 1 ? "s" : ""}
          </span>
          <span className="flex items-center gap-1">
            <CalendarDays size={11} />
            {new Date(enrollment.startDate).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>
      </div>
    </div>
  );
}

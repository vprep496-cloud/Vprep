import ScoreBadge from "@/components/ui/ScoreBadge";
import type { CandidateEnrollment } from "@/types";

interface EnrollmentCardProps {
  enrollment: CandidateEnrollment;
}

const SKILL_LABEL: Record<CandidateEnrollment["skillLevel"], string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

// Phase 6 — one card per track enrollment on the candidate detail page.
// `enrollment.track` comes pre-attached by `GET /admin/candidates/{id}`
// (the backend's local `_attach_track_data`-style enrichment, mirroring
// `enrollment_service`) — it's `null` only for an orphaned `track_id` that no
// longer exists in the static catalog, hence the `track?.` fallbacks below.
export default function EnrollmentCard({ enrollment }: EnrollmentCardProps) {
  const track = enrollment.track;
  const accent = track?.color ?? "#6366F1";
  const totalDays = track?.totalDays ?? enrollment.currentDay;
  const progressPct = totalDays > 0 ? Math.min(100, Math.round((enrollment.currentDay / totalDays) * 100)) : 0;

  return (
    // Phase 7 spec: "color the left accent border with the track's exact
    // accent color" — uses the same `track.color` value that the mobile
    // `TrackCard` uses for its left border, so the visual language is
    // consistent across both portals.
    <div
      className="rounded-2xl border border-border bg-background-card p-5"
      style={{ borderLeftWidth: 4, borderLeftColor: accent }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
          <div>
            <p className="text-sm font-semibold text-text-primary">{track?.name ?? enrollment.trackId}</p>
            <p className="text-xs text-text-muted">{SKILL_LABEL[enrollment.skillLevel]} level</p>
          </div>
        </div>
        <ScoreBadge score={enrollment.averageScore} />
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-text-secondary">
          <span>
            Day {enrollment.currentDay} of {totalDays}
          </span>
          <span>{progressPct}%</span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-background-surface">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${progressPct}%`, backgroundColor: accent }}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-text-secondary">
        <span>
          {enrollment.totalSessions} mock session{enrollment.totalSessions === 1 ? "" : "s"}
        </span>
        <span>
          Started{" "}
          {new Date(enrollment.startDate).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
      </div>

      <div className="mt-3">
        {enrollment.planExists ? (
          <span className="inline-flex items-center rounded-full bg-success/15 px-2.5 py-1 text-xs font-semibold text-success">
            Plan generated
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-background-surface px-2.5 py-1 text-xs font-semibold text-text-muted">
            No plan yet
          </span>
        )}
      </div>
    </div>
  );
}

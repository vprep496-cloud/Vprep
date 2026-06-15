import api from "./api";
import type { Enrollment, EnrollmentProgress, SkillLevel, TargetRole, Track, TrackId } from "../types";

// ---------------------------------------------------------------------------
// Backend response shapes — api.ts's deepCamel interceptor converts all
// snake_case keys to camelCase before these types are used, so the shapes
// here already reflect the post-conversion camelCase field names.
// ---------------------------------------------------------------------------

interface BackendTrack {
  id: TrackId;
  name: string;
  description: string;
  icon: string;
  color: string;
  totalDays: number;
  topicAreas?: string[];
}

interface BackendEnrollment {
  id: string;
  userId: string;
  trackId: TrackId;
  skillLevel: Enrollment["skillLevel"];
  targetRole?: string | null;
  targetRoleId?: string | null;
  roleSeniority?: Enrollment["roleSeniority"];
  roleConfirmed?: boolean;
  startDate: string;
  currentDay: number;
  completedTopics: string[];
  averageScore: number;
  totalSessions: number;
  updatedAt: string;
  track: BackendTrack;
  planExists: boolean;
}

interface BackendEnrollResponse {
  enrollment: BackendEnrollment;
  message: string;
}

interface BackendEnrollmentResponse {
  enrollment: BackendEnrollment;
}

interface BackendEnrolledListResponse {
  enrollments: BackendEnrollment[];
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function toTrack(track: BackendTrack): Track {
  return {
    id: track.id,
    name: track.name,
    description: track.description,
    icon: track.icon,
    color: track.color,
    totalDays: track.totalDays,
    topicAreas: track.topicAreas ?? [],
  };
}

function toEnrollment(enrollment: BackendEnrollment): Enrollment {
  return {
    id: enrollment.id,
    userId: enrollment.userId,
    trackId: enrollment.trackId,
    skillLevel: enrollment.skillLevel,
    targetRole: enrollment.targetRole ?? null,
    targetRoleId: enrollment.targetRoleId ?? null,
    roleSeniority: enrollment.roleSeniority ?? null,
    roleConfirmed: enrollment.roleConfirmed ?? false,
    startDate: enrollment.startDate,
    currentDay: enrollment.currentDay,
    completedTopics: enrollment.completedTopics ?? [],
    averageScore: enrollment.averageScore,
    totalSessions: enrollment.totalSessions,
    updatedAt: enrollment.updatedAt,
    track: toTrack(enrollment.track),
    planExists: enrollment.planExists,
  };
}

function fromProgress(progress: EnrollmentProgress) {
  return {
    current_day: progress.currentDay,
    completed_topic: progress.completedTopic ?? null,
    session_score: progress.sessionScore ?? null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// GET /api/v1/tracks/ — the static track catalog. Not in the Phase 4 spec's
// file list as its own service, and a dedicated `track.service.ts` felt like
// overkill for one read-only endpoint — it lives here since this is already
// the one-stop home for everything under `/api/v1/tracks/*`. Replaces the
// hardcoded placeholder list previously inlined in `(app)/tracks.tsx`.
export async function getTracks(): Promise<Track[]> {
  const { data } = await api.get<BackendTrack[]>("/api/v1/tracks/");
  return data.map(toTrack);
}

// POST /api/v1/tracks/enroll — idempotent: returns the existing enrollment if
// the candidate is already enrolled rather than erroring or duplicating.
export interface RoleSelection {
  /** A predefined catalog role id (preferred). */
  targetRoleId?: string | null;
  /** A free custom role label (used when no predefined role fits). */
  targetRole?: string | null;
}

export async function enroll(trackId: TrackId, role?: RoleSelection): Promise<Enrollment> {
  const { data } = await api.post<BackendEnrollResponse>("/api/v1/tracks/enroll", {
    track_id: trackId,
    ...(role?.targetRoleId ? { target_role_id: role.targetRoleId } : {}),
    ...(role?.targetRole && role.targetRole.trim() ? { target_role: role.targetRole.trim() } : {}),
  });
  return toEnrollment(data.enrollment);
}

// PUT /api/v1/tracks/enrollment/{trackId}/target-role — set this track's own
// target role (a predefined id or a custom label). Passing neither re-derives
// the track's smart default.
export async function updateTargetRole(
  trackId: TrackId,
  role: RoleSelection
): Promise<Enrollment> {
  const { data } = await api.put<BackendEnrollmentResponse>(
    `/api/v1/tracks/enrollment/${trackId}/target-role`,
    {
      target_role_id: role.targetRoleId ?? null,
      target_role: role.targetRole && role.targetRole.trim() ? role.targetRole.trim() : null,
    }
  );
  return toEnrollment(data.enrollment);
}

// GET /api/v1/tracks/{trackId}/roles — the curated target roles for a track.
interface BackendTargetRole {
  id: string;
  label: string;
  seniority: TargetRole["seniority"];
  seniorityLabel: string;
  focus: string[];
}
export async function getTrackRoles(trackId: TrackId): Promise<TargetRole[]> {
  const { data } = await api.get<{ trackId: TrackId; roles: BackendTargetRole[] }>(
    `/api/v1/tracks/${trackId}/roles`
  );
  return data.roles.map((role) => ({
    id: role.id,
    label: role.label,
    seniority: role.seniority,
    seniorityLabel: role.seniorityLabel,
    focus: role.focus ?? [],
  }));
}

// GET /api/v1/tracks/enrolled — every track the user is enrolled in, with
// joined track data + plan_exists, sorted by most-recently-updated.
export async function getEnrollments(): Promise<Enrollment[]> {
  const { data } = await api.get<BackendEnrolledListResponse>("/api/v1/tracks/enrolled");
  return data.enrollments.map(toEnrollment);
}

// GET /api/v1/tracks/enrollment/{trackId} — single enrollment, or throws (404)
// if the candidate isn't enrolled in this track.
export async function getEnrollment(trackId: TrackId): Promise<Enrollment> {
  const { data } = await api.get<BackendEnrollmentResponse>(
    `/api/v1/tracks/enrollment/${trackId}`
  );
  return toEnrollment(data.enrollment);
}

// PUT /api/v1/tracks/enrollment/{trackId}/progress — Phase 5 will call this
// after each completed session; wired now so the path is ready end-to-end.
export async function updateProgress(
  trackId: TrackId,
  progress: EnrollmentProgress
): Promise<Enrollment> {
  const { data } = await api.put<BackendEnrollmentResponse>(
    `/api/v1/tracks/enrollment/${trackId}/progress`,
    fromProgress(progress)
  );
  return toEnrollment(data.enrollment);
}

// DELETE /api/v1/tracks/enrollment/{trackId} — removes the enrollment record.
export async function unenroll(trackId: TrackId): Promise<void> {
  await api.delete(`/api/v1/tracks/enrollment/${trackId}`);
}

// POST /api/v1/tracks/enrollment/{trackId}/reset — reset progress counters.
// Clears current_day, completed_topics, average_score, total_sessions without
// removing the enrollment or any session history.
export async function resetProgress(trackId: TrackId): Promise<Enrollment> {
  const { data } = await api.post<BackendEnrollResponse>(
    `/api/v1/tracks/enrollment/${trackId}/reset`
  );
  return toEnrollment(data.enrollment);
}

// PATCH /api/v1/tracks/enrollment/{trackId}/skill-level — manually override
// the skill level (useful when the assessment mis-calibrated or the candidate
// wants harder/easier questions without re-taking the diagnostic).
export async function updateSkillLevel(
  trackId: TrackId,
  skillLevel: SkillLevel
): Promise<Enrollment> {
  const { data } = await api.patch<BackendEnrollmentResponse>(
    `/api/v1/tracks/enrollment/${trackId}/skill-level`,
    { skill_level: skillLevel }
  );
  return toEnrollment(data.enrollment);
}

// GET /api/v1/tracks/enrollment/{trackId}/stats — aggregated performance stats.
export interface TrackStats {
  trackId: TrackId;
  skillLevel: SkillLevel;
  currentDay: number;
  totalSessions: number;
  averageScore: number;
  bestScore: number;
  worstScore: number;
  completedTopicsCount: number;
  daysSinceEnrollment: number;
  totalPracticeTimeSeconds: number;
}

interface BackendTrackStatsResponse {
  stats: {
    trackId: TrackId;
    skillLevel: SkillLevel;
    currentDay: number;
    totalSessions: number;
    averageScore: number;
    bestScore: number;
    worstScore: number;
    completedTopicsCount: number;
    daysSinceEnrollment: number;
    totalPracticeTimeSeconds: number;
  };
}

export async function getTrackStats(trackId: TrackId): Promise<TrackStats> {
  const { data } = await api.get<BackendTrackStatsResponse>(
    `/api/v1/tracks/enrollment/${trackId}/stats`
  );
  return data.stats;
}

import api from "./api";
import type { SkillLevel, TrackId, User, UserRole } from "../types";

// GET /api/v1/users/{userId} — admin-only lookup of another user's profile.
export async function getUser(userId: string): Promise<User> {
  const { data } = await api.get<User>(`/api/v1/users/${userId}`);
  return data;
}

// PUT /api/v1/users/me — update the current user's own profile fields.
export async function updateProfile(input: {
  displayName?: string;
  photoUrl?: string;
}): Promise<User> {
  const { data } = await api.put<User>("/api/v1/users/me", {
    display_name: input.displayName,
    photo_url: input.photoUrl,
  });
  return data;
}

export interface OnboardingCvFile {
  uri: string;
  name: string;
  mimeType?: string | null;
  file?: unknown;
}

export interface CompleteOnboardingInput {
  selfReportedLevel: SkillLevel;
  targetRole?: string;
  preferredTrackId?: TrackId | null;
  cv?: OnboardingCvFile | null;
}

// POST /api/v1/users/me/onboarding — completes the candidate setup and lets
// local AI extract a professional profile from the uploaded CV when present.
export async function completeOnboarding(input: CompleteOnboardingInput): Promise<User> {
  const formData = new FormData();
  formData.append("self_reported_level", input.selfReportedLevel);
  if (input.targetRole?.trim()) formData.append("target_role", input.targetRole.trim());
  if (input.preferredTrackId) formData.append("preferred_track_id", input.preferredTrackId);
  if (input.cv?.file) {
    formData.append("cv", input.cv.file as Blob, input.cv.name);
  } else if (input.cv) {
    (formData as any).append("cv", {
      uri: input.cv.uri,
      name: input.cv.name,
      type: input.cv.mimeType ?? "application/pdf",
    });
  }

  const { data } = await api.post<User>("/api/v1/users/me/onboarding", formData, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 60000,
  });
  return data;
}

export interface ListUsersResult {
  users: User[];
  total: number;
}

// GET /api/v1/users?page=&role= — admin-only paginated user list.
// Exposed here for type-sharing; called from the admin portal via its own
// Axios instance (lib/api.ts), not from the mobile app.
export async function listUsers(page: number, role?: UserRole): Promise<ListUsersResult> {
  const { data } = await api.get<{ users: User[]; total: number; page: number; pages: number }>(
    "/api/v1/users",
    { params: { page, role } }
  );
  return { users: data.users, total: data.total };
}

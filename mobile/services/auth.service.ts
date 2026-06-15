import api from "./api";
import type { User, UserRole } from "../types";

// POST /api/v1/auth/sync — upserts the Firebase-authenticated user in MongoDB
// and returns the canonical backend user record.
export async function syncUser(): Promise<User> {
  const { data } = await api.post<User>("/api/v1/auth/sync");
  return data;
}

// GET /api/v1/auth/me — returns the currently authenticated user.
export async function getMe(): Promise<User> {
  const { data } = await api.get<User>("/api/v1/auth/me");
  return data;
}

// POST /api/v1/auth/promote — superadmin-only role change for another user.
export async function promoteUser(targetUserId: string, role: UserRole): Promise<User> {
  const { data } = await api.post<User>("/api/v1/auth/promote", {
    target_user_id: targetUserId,
    role,
  });
  return data;
}

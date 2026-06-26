import axios from "axios";

import api, { TOKEN_STORAGE_KEY } from "./api";
import { API_BASE_URL } from "../config/runtime";
import { getItem as getStoredItem } from "../lib/storage";
import type { User, UserRole } from "../types";

function describeToken(token: string | null | undefined) {
  return {
    tokenLength: token?.length ?? 0,
    tokenLooksLikeJwt: token ? token.split(".").length === 3 : false,
  };
}

// POST /api/v1/auth/sync — upserts the Firebase-authenticated user in MongoDB
// and returns the canonical backend user record. When a fresh Firebase token is
// available, pass it explicitly so a stale stored token cannot be sent instead.
export async function syncUser(firebaseIdToken?: string): Promise<User> {
  const storedToken = await getStoredItem(TOKEN_STORAGE_KEY);
  const tokenForSync = firebaseIdToken ?? storedToken;
  const authorizationHeader = tokenForSync ? `Bearer ${tokenForSync}` : undefined;
  if (__DEV__) {
    console.log("[BackendSync] calling URL", {
      endpoint: `${API_BASE_URL}/api/v1/auth/sync`,
      tokenSource: firebaseIdToken ? "fresh-firebase-token" : "stored-token",
      hasAuthorizationBearerToken: Boolean(tokenForSync),
      authorizationHeaderStartsWithBearer: Boolean(
        authorizationHeader?.startsWith("Bearer ")
      ),
      ...describeToken(tokenForSync),
      storageKey: TOKEN_STORAGE_KEY,
    });
  }

  try {
    const response = await api.post<User>(
      "/api/v1/auth/sync",
      undefined,
      authorizationHeader ? { headers: { Authorization: authorizationHeader } } : undefined
    );
    if (__DEV__) {
      console.log("[BackendSync] response", {
        endpoint: `${API_BASE_URL}/api/v1/auth/sync`,
        status: response.status,
        responseKeys: Object.keys(response.data ?? {}),
      });
    }
    return response.data;
  } catch (error) {
    if (__DEV__ && axios.isAxiosError(error)) {
      console.warn("[BackendSync] failure", {
        endpoint: `${API_BASE_URL}/api/v1/auth/sync`,
        status: error.response?.status,
        body: error.response?.data,
        code: error.code,
        message: error.message,
      });
    }
    throw error;
  }
}

// GET /api/v1/auth/me — returns the currently authenticated user.
export async function getMe(): Promise<User> {
  const token = await getStoredItem(TOKEN_STORAGE_KEY);
  if (__DEV__) {
    console.log("[AuthMe] request", {
      endpoint: `${API_BASE_URL}/api/v1/auth/me`,
      hasAuthorizationBearerToken: Boolean(token),
      storageKey: TOKEN_STORAGE_KEY,
    });
  }

  const response = await api.get<User>("/api/v1/auth/me");
  if (__DEV__) {
    console.log("[AuthMe] response", {
      endpoint: `${API_BASE_URL}/api/v1/auth/me`,
      status: response.status,
      responseKeys: Object.keys(response.data ?? {}),
    });
  }
  return response.data;
}

// POST /api/v1/auth/promote — superadmin-only role change for another user.
export async function promoteUser(targetUserId: string, role: UserRole): Promise<User> {
  const { data } = await api.post<User>("/api/v1/auth/promote", {
    target_user_id: targetUserId,
    role,
  });
  return data;
}

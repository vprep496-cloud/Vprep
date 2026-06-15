/**
 * Secure storage — web implementation.
 *
 * expo-secure-store is a native-only library; on web it throws
 * "getValueWithKeyAsync is not a function" on every call.  This web variant
 * uses localStorage directly, which is the standard Expo-recommended
 * alternative for browser environments.
 *
 * Metro picks this file on web and lib/storage.native.ts on iOS/Android.
 */

export async function getItem(key: string): Promise<string | null> {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage unavailable (e.g. private-browsing quota exceeded) — no-op.
  }
}

export async function deleteItem(key: string): Promise<void> {
  try {
    localStorage.removeItem(key);
  } catch {
    // no-op
  }
}

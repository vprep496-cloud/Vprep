import { useEffect, useRef } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { firebaseAuth } from "../lib/firebase";
import { useAuthStore } from "../stores/auth.store";
import api from "../services/api";

// Firebase ID tokens are valid for 1 hour — refresh this long before expiry
// so the user is never caught mid-session with a stale token.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

// Silently keeps the Firebase ID token fresh. Pure side-effect hook — renders
// nothing. Mount it once inside the authenticated app shell.
export function useTokenRefresh() {
  const setToken = useAuthStore((s) => s.setToken);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    // `expirationTime` is an ISO string decoded by the Firebase SDK from the
    // token's `exp` claim — schedule the next silent refresh 5 minutes early.
    const scheduleFromExpiry = (expirationTime: string) => {
      const expiresAtMs = new Date(expirationTime).getTime();
      const delay = Math.max(expiresAtMs - Date.now() - REFRESH_MARGIN_MS, 0);
      clearTimer();
      timerRef.current = setTimeout(refresh, delay);
    };

    async function refresh() {
      const firebaseUser = firebaseAuth.currentUser;
      if (!firebaseUser) return;

      try {
        const freshToken = await firebaseUser.getIdToken(true);
        await setToken(freshToken);
        api.defaults.headers.common.Authorization = `Bearer ${freshToken}`;

        const result = await firebaseUser.getIdTokenResult(false);
        scheduleFromExpiry(result.expirationTime);
      } catch (error) {
        console.error("[useTokenRefresh] failed to refresh token:", error);
      }
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser) => {
      clearTimer();
      if (!firebaseUser) return;

      try {
        const result = await firebaseUser.getIdTokenResult(false);
        api.defaults.headers.common.Authorization = `Bearer ${result.token}`;
        scheduleFromExpiry(result.expirationTime);
      } catch (error) {
        console.error("[useTokenRefresh] failed to read token expiry:", error);
      }
    });

    return () => {
      clearTimer();
      unsubscribe();
    };
  }, [setToken]);
}

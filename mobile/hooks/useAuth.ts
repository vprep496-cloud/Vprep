import { useRef, useState } from "react";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import {
  GoogleAuthProvider,
  signInWithCredential,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { firebaseAuth } from "../lib/firebase";
import { useAuthStore } from "../stores/auth.store";
import { syncUser } from "../services/auth.service";
// Use the shared api instance so the snake→camelCase interceptor is applied
// to demo-login responses automatically.
import api from "../services/api";
import { useAppStore } from "../stores/app.store";
import { getEnrollments } from "../services/enrollment.service";
import { unregisterPushToken } from "../services/notification.service";

WebBrowser.maybeCompleteAuthSession();

// Google's OAuth 2.0 discovery document — used directly with AuthSession so we
// stay on the generic AuthRequest API rather than a provider-specific helper.
const googleDiscovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  revocationEndpoint: "https://oauth2.googleapis.com/revoke",
};

export function useAuth() {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setUser = useAuthStore((s) => s.setUser);
  const setToken = useAuthStore((s) => s.setToken);
  const logout = useAuthStore((s) => s.logout);
  const setEnrollments = useAppStore((s) => s.setEnrollments);

  // makeRedirectUri behaviour:
  //   native build  → "vprep://"           (deep-link, registered in Google Console as iOS/Android client)
  //   Expo web dev  → "http://localhost:PORT" derived from window.location
  //   Expo Go       → "exp://localhost:PORT"
  // The exact URI logged below must be added to your Google Cloud Console
  // OAuth 2.0 Web Client → Authorized redirect URIs AND JavaScript origins.
  const redirectUri = AuthSession.makeRedirectUri({
    scheme: "vprep",
    // preferLocalhost avoids "127.0.0.1" vs "localhost" mismatch in dev
    preferLocalhost: true,
  });
  // DEV ONLY — copy this to Google Cloud Console
  if (__DEV__) console.log("[useAuth] Google redirect URI:", redirectUri);

  // Stable nonce: generated once per hook mount, never on re-render.
  // Math.random() inside useAuthRequest options was generating a new nonce
  // on every render, causing useAuthRequest to detect changed options every
  // render, set internal state, and trigger another render — an infinite
  // re-render loop that blocked the JS thread on the first click.
  const nonceRef = useRef(Math.random().toString(36).substring(2));

  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? "",
      scopes: ["openid", "profile", "email"],
      redirectUri,
      responseType: AuthSession.ResponseType.IdToken,
      usePKCE: false,
      extraParams: {
        nonce: nonceRef.current,
      },
    },
    googleDiscovery
  );

  const signInWithGoogle = async () => {
    setError(null);
    setIsSigningIn(true);
    try {
      const result = await promptAsync();

      if (result.type !== "success") {
        if (result.type === "error") {
          setError(result.error?.message ?? "Google sign-in failed. Please try again.");
        }
        return;
      }

      const idToken = result.params?.id_token;
      if (!idToken) {
        setError("Google did not return an ID token. Please try again.");
        return;
      }

      // Exchange the Google ID token for a Firebase credential/session.
      const credential = GoogleAuthProvider.credential(idToken);
      const userCredential = await signInWithCredential(firebaseAuth, credential);

      // Always fetch a fresh Firebase ID token before persisting/calling the API.
      const firebaseIdToken = await userCredential.user.getIdToken(true);
      await setToken(firebaseIdToken);

      const backendUser = await syncUser();
      setUser(backendUser);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong while signing in.";
      setError(message);
    } finally {
      setIsSigningIn(false);
    }
  };

  // -------------------------------------------------------------------------
  // Demo login — bypasses Firebase entirely; calls POST /auth/demo-login
  // directly and stores the returned locally-signed JWT in SecureStore.
  // -------------------------------------------------------------------------
  const signInWithDemo = async (accountKey: string) => {
    setError(null);
    setIsSigningIn(true);
    try {
      // `api` applies the snake→camelCase interceptor, so `user` arrives with
      // camelCase keys (displayName, firebaseUid, etc.) matching the User type.
      const response = await api.post("/api/v1/auth/demo-login", {
        account_key: accountKey,
      });
      const { token, user } = response.data;
      await setToken(token);
      setUser(user);
      // Hydrate enrollment store immediately so the home screen shows real
      // data (the _layout.tsx auth guard only loads enrollments via the
      // Firebase onAuthStateChanged path, which never fires for demo login).
      try {
        const enrollments = await getEnrollments();
        setEnrollments(enrollments);
      } catch {
        // Non-fatal — home screen shows empty state gracefully.
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Demo login failed. Is the backend running?";
      setError(message);
    } finally {
      setIsSigningIn(false);
    }
  };

  const signOut = async () => {
    // Step 1 — best-effort: remove the push token while we still have a valid
    // auth token.  Non-fatal if it fails (device may not have a token).
    try {
      await unregisterPushToken();
    } catch {
      // ignore
    }

    // Step 2 — clear our local session BEFORE calling firebaseSignOut.
    //
    // ⚠️  ORDER MATTERS: firebaseSignOut triggers onAuthStateChanged(null)
    // immediately when it resolves.  The AuthGuard in _layout.tsx then reads
    // the stored token from SecureStore; if the token is still present at that
    // moment it calls getMe(), which may succeed (Firebase ID tokens remain
    // valid for ~1 hour after sign-out), and the user is silently
    // re-authenticated — making the sign-out button appear broken.
    //
    // Calling logout() first guarantees the token is gone before
    // onAuthStateChanged ever fires.
    await logout();

    // Step 3 — sign out of Firebase.  If this throws, local session is already
    // cleared so we suppress the error — the user cannot take further
    // authenticated actions regardless.
    try {
      await firebaseSignOut(firebaseAuth);
    } catch {
      // local session cleared; Firebase error is cosmetic
    }
  };

  return { signInWithGoogle, signInWithDemo, signOut, request, isSigningIn, error };
}

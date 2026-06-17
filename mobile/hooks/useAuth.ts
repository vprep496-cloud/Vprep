import { useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import Constants, { ExecutionEnvironment } from "expo-constants";
import axios from "axios";
import {
  GoogleAuthProvider,
  signInWithCredential,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { firebaseAuth } from "../lib/firebase";
import { useAuthStore } from "../stores/auth.store";
import { syncUser } from "../services/auth.service";
import api from "../services/api";
import { useAppStore } from "../stores/app.store";
import { getEnrollments } from "../services/enrollment.service";
import { unregisterPushToken } from "../services/notification.service";
import { API_BASE_URL } from "../config/runtime";

WebBrowser.maybeCompleteAuthSession();

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const GOOGLE_OAUTH_SCHEME = "com.vprep.app";
const GOOGLE_OAUTH_REDIRECT_PATH = "oauthredirect";
const GOOGLE_OAUTH_NATIVE_REDIRECT_URI = `${GOOGLE_OAUTH_SCHEME}:/${GOOGLE_OAUTH_REDIRECT_PATH}`;
const GOOGLE_SCOPES = ["openid", "profile", "email"];

const googleDiscovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  revocationEndpoint: "https://oauth2.googleapis.com/revoke",
};

function readPublicEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function getExpoAuthProxyRedirectUri() {
  const explicitUri = readPublicEnv("EXPO_PUBLIC_EXPO_AUTH_PROXY_REDIRECT_URI");
  if (explicitUri) return explicitUri;

  const owner = readPublicEnv("EXPO_PUBLIC_EXPO_OWNER") ?? Constants.expoConfig?.owner;
  const slug = readPublicEnv("EXPO_PUBLIC_EXPO_SLUG") ?? Constants.expoConfig?.slug;

  if (owner && slug) {
    return `https://auth.expo.io/@${owner.replace(/^@/, "")}/${slug}`;
  }

  return "https://auth.expo.io/@vprep/vprep";
}

function getGoogleClientConfig() {
  const androidClientId = readPublicEnv("EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID");
  const iosClientId = readPublicEnv("EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID");
  const webClientId =
    readPublicEnv("EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID") ??
    readPublicEnv("EXPO_PUBLIC_GOOGLE_CLIENT_ID");

  if (isExpoGo) {
    return {
      clientId: webClientId,
      envName: "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID",
      label: "Expo Go Web",
    };
  }

  if (Platform.OS === "android") {
    return {
      clientId: androidClientId,
      envName: "EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID",
      label: "Android",
    };
  }

  if (Platform.OS === "ios") {
    return {
      clientId: iosClientId,
      envName: "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID",
      label: "iOS",
    };
  }

  return {
    clientId: webClientId,
    envName: "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID",
    label: "Web",
  };
}

function getIdTokenFromUrl(url: string): string | undefined {
  const queryStart = url.indexOf("?");
  const hashStart = url.indexOf("#");
  let params = "";

  if (queryStart !== -1) {
    params += url.slice(queryStart + 1, hashStart !== -1 ? hashStart : url.length);
  }
  if (hashStart !== -1) {
    if (params) params += "&";
    params += url.slice(hashStart + 1);
  }

  return new URLSearchParams(params).get("id_token") ?? undefined;
}

export function useAuth() {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setUser = useAuthStore((s) => s.setUser);
  const setToken = useAuthStore((s) => s.setToken);
  const logout = useAuthStore((s) => s.logout);
  const setEnrollments = useAppStore((s) => s.setEnrollments);

  const nonceRef = useRef(Math.random().toString(36).substring(2));
  const googleClient = useMemo(() => getGoogleClientConfig(), []);
  const expoAuthProxyRedirectUri = useMemo(() => getExpoAuthProxyRedirectUri(), []);
  const appReturnUri = useMemo(
    () =>
      AuthSession.makeRedirectUri({
        native: GOOGLE_OAUTH_NATIVE_REDIRECT_URI,
        scheme: GOOGLE_OAUTH_SCHEME,
        path: GOOGLE_OAUTH_REDIRECT_PATH,
      }),
    []
  );
  const authorizationRedirectUri = isExpoGo ? expoAuthProxyRedirectUri : appReturnUri;

  const googleConfigError = useMemo(() => {
    if (!isExpoGo && authorizationRedirectUri.startsWith("exp://")) {
      return `Google sign-in generated ${authorizationRedirectUri}. Rebuild the app so the native ${GOOGLE_OAUTH_SCHEME} scheme is installed.`;
    }

    if (!googleClient.clientId) {
      return `Missing ${googleClient.envName}. Add the ${googleClient.label} OAuth client ID to your mobile environment.`;
    }

    return null;
  }, [googleClient, authorizationRedirectUri]);

  useEffect(() => {
    if (!__DEV__) return;
    console.log("[useAuth] Google OAuth redirect URI:", authorizationRedirectUri);
    console.log("[useAuth] Google OAuth app return URI:", appReturnUri);
    console.log("[useAuth] Google OAuth client env:", googleClient.envName);
    console.log("[useAuth] API base URL:", API_BASE_URL);
  }, [appReturnUri, authorizationRedirectUri, googleClient.envName]);

  const isWebAuth = Platform.OS === "web";
  const usesImplicitIdTokenFlow = isExpoGo || isWebAuth;

  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: googleClient.clientId ?? "missing-google-client-id",
      scopes: GOOGLE_SCOPES,
      redirectUri: authorizationRedirectUri,
      responseType: usesImplicitIdTokenFlow
        ? AuthSession.ResponseType.IdToken
        : AuthSession.ResponseType.Code,
      usePKCE: !usesImplicitIdTokenFlow,
      prompt: AuthSession.Prompt.SelectAccount,
      extraParams: usesImplicitIdTokenFlow
        ? {
            nonce: nonceRef.current,
          }
        : undefined,
    },
    googleDiscovery
  );

  const signInWithGoogle = async () => {
    setError(null);
    setIsSigningIn(true);
    try {
      if (googleConfigError) {
        return;
      }

      if (!request || !request.url || !googleClient.clientId) {
        return;
      }

      let idToken: string | undefined;

      if (isExpoGo) {
        const proxyStartUrl =
          `${expoAuthProxyRedirectUri}/start?` +
          new URLSearchParams({
            authUrl: request.url ?? "",
            returnUrl: appReturnUri,
          }).toString();

        const browserResult = await WebBrowser.openAuthSessionAsync(proxyStartUrl, appReturnUri);
        if (browserResult.type !== "success") {
          return;
        }

        idToken = getIdTokenFromUrl(browserResult.url);
      } else {
        const result = await promptAsync();
        if (result.type !== "success") {
          if (result.type === "error") {
            setError(
              result.params?.error_description ??
                result.error?.message ??
                "Google sign-in failed. Please try again."
            );
          }
          return;
        }

        idToken = result.params?.id_token;
        const authCode = result.params?.code;

        if (!idToken && authCode) {
          const tokenResponse = await AuthSession.exchangeCodeAsync(
            {
              clientId: googleClient.clientId,
              code: authCode,
              redirectUri: authorizationRedirectUri,
              scopes: GOOGLE_SCOPES,
              extraParams: {
                code_verifier: request.codeVerifier ?? "",
              },
            },
            googleDiscovery
          );
          idToken = tokenResponse.idToken;
        }
      }

      if (!idToken) {
        setError("Google did not return an ID token. Please try again.");
        return;
      }

      // Exchange the Google ID token for a Firebase credential/session.
      const credential = GoogleAuthProvider.credential(idToken);
      const userCredential = await signInWithCredential(firebaseAuth, credential);
      const firebaseIdToken = await userCredential.user.getIdToken(true);
      await setToken(firebaseIdToken);

      const backendUser = await syncUser();
      setUser(backendUser);

    } catch (err) {
      await setToken(null);
      try {
        await firebaseSignOut(firebaseAuth);
      } catch {
        // Ignore cleanup failures; the original auth error is more useful.
      }

      if (axios.isAxiosError(err)) {
        if (err.code === "ERR_NETWORK" || !err.response) {
          setError(
            `Google sign-in finished, but the backend is unreachable at ${API_BASE_URL}. Update EXPO_PUBLIC_API_URL to this laptop's LAN IP and make sure backend port 8000 is running.`
          );
          return;
        }

        if (err.response.status === 401 || err.response.status === 403) {
          setError(
            "Google sign-in finished, but the backend rejected the Firebase token. Make sure backend/firebase-service-account.json and the mobile Firebase env values are from the same Firebase project."
          );
          return;
        }
      }

      const message = err instanceof Error ? err.message : "Something went wrong while signing in.";
      setError(message);
    } finally {
      setIsSigningIn(false);
    }
  };

  // ── Demo login — bypasses Firebase entirely ─────────────────────────────────
  const signInWithDemo = async (accountKey: string) => {
    setError(null);
    setIsSigningIn(true);
    try {
      const response = await api.post("/api/v1/auth/demo-login", {
        account_key: accountKey,
      });
      const { token, user } = response.data;
      await setToken(token);
      setUser(user);
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
    try {
      await unregisterPushToken();
    } catch {
      // ignore
    }
    // Clear local session BEFORE Firebase sign-out to prevent race condition
    // where onAuthStateChanged fires with a still-valid stored token.
    await logout();
    try {
      await firebaseSignOut(firebaseAuth);
    } catch {
      // local session already cleared; Firebase error is cosmetic
    }
  };

  return {
    signInWithGoogle,
    signInWithDemo,
    signOut,
    isGoogleSignInAvailable: !googleConfigError,
    request,
    isSigningIn,
    error,
  };
}

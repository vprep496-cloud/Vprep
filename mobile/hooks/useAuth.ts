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
import api, { TOKEN_STORAGE_KEY } from "../services/api";
import { useAppStore } from "../stores/app.store";
import { getEnrollments } from "../services/enrollment.service";
import { unregisterPushToken } from "../services/notification.service";
import { API_BASE_URL } from "../config/runtime";
import { getItem as getStoredItem } from "../lib/storage";
import {
  MOBILE_ROLE_BLOCK_MESSAGE,
  ensureMobileCandidate,
  isMobileRoleAccessError,
} from "../lib/mobileAuthAccess";
import type { User } from "../types";

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
      label: "Expo Go",
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

type AuthResponsePayload = {
  token?: string;
  accessToken?: string;
  access_token?: string;
  idToken?: string;
  id_token?: string;
  user?: User;
};

type GoogleAuthResult = AuthSession.AuthSessionResult;
type CompletedGoogleAuthResult = Extract<
  GoogleAuthResult,
  { params: Record<string, string> }
>;
type SuccessfulGoogleAuthResult = CompletedGoogleAuthResult & { type: "success" };

type GoogleTokens = {
  idToken?: string;
  accessToken?: string;
  code?: string;
};

function normalizeAuthResponse(data: AuthResponsePayload) {
  const token =
    data?.token ??
    data?.accessToken ??
    data?.access_token ??
    data?.idToken ??
    data?.id_token;

  return {
    token,
    user: data?.user,
  };
}

function logAuthDebug(message: string, details?: Record<string, unknown>) {
  if (!__DEV__) return;
  console.log(message, details ?? {});
}

function getBackendErrorMessage(error: unknown, fallback: string) {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error.message : fallback;
  }

  const detail = error.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length > 0) return "Please check your login details.";
  return error.message || fallback;
}

function isAuthRejected(error: unknown) {
  return (
    axios.isAxiosError(error) &&
    (error.response?.status === 401 || error.response?.status === 403)
  );
}

function isSuccessfulAuthResult(
  result: GoogleAuthResult
): result is SuccessfulGoogleAuthResult {
  return result.type === "success";
}

function isCompletedAuthResult(result: GoogleAuthResult): result is CompletedGoogleAuthResult {
  return result.type === "success" || result.type === "error";
}

function extractGoogleTokens(result: GoogleAuthResult): GoogleTokens {
  if (!isSuccessfulAuthResult(result)) return {};

  const params = result.params ?? {};
  return {
    idToken: params.id_token ?? params.idToken ?? result.authentication?.idToken,
    accessToken:
      params.access_token ?? params.accessToken ?? result.authentication?.accessToken,
    code: params.code,
  };
}

function logGoogleAuthResult(label: string, result: GoogleAuthResult) {
  const tokens = extractGoogleTokens(result);
  const params = isCompletedAuthResult(result) ? result.params : {};

  logAuthDebug(label, {
    responseType: result.type,
    paramsKeys: Object.keys(params ?? {}),
    hasIdToken: Boolean(tokens.idToken),
    hasAccessToken: Boolean(tokens.accessToken),
    hasCode: Boolean(tokens.code),
    hasAuthentication: isSuccessfulAuthResult(result)
      ? Boolean(result.authentication)
      : false,
    hasAuthenticationIdToken: isSuccessfulAuthResult(result)
      ? Boolean(result.authentication?.idToken)
      : false,
    hasAuthenticationAccessToken: isSuccessfulAuthResult(result)
      ? Boolean(result.authentication?.accessToken)
      : false,
  });
}

function getGoogleResultError(result: GoogleAuthResult) {
  if (result.type !== "error") return null;

  const description = result.params?.error_description;
  if (description) return description;

  const errorMessage = result.error?.message;
  if (errorMessage) return errorMessage;

  return "Google sign-in failed. Please try again.";
}

function getFirebaseAuthCode(error: unknown) {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }

  return undefined;
}

function getGoogleSignInFailureMessage(error: unknown) {
  if (isMobileRoleAccessError(error)) {
    return MOBILE_ROLE_BLOCK_MESSAGE;
  }

  if (axios.isAxiosError(error)) {
    if (error.code === "ERR_NETWORK" || !error.response) {
      return `Google sign-in finished, but the backend is unreachable at ${API_BASE_URL}. Update EXPO_PUBLIC_API_URL to this laptop's LAN IP and make sure backend port 8000 is running.`;
    }

    if (error.response.status === 401 || error.response.status === 403) {
      return "Google sign-in finished, but the backend rejected the Firebase token. Make sure backend/firebase-service-account.json and the mobile Firebase env values are from the same Firebase project.";
    }

    return getBackendErrorMessage(error, "Google sign-in failed. Please try again.");
  }

  const firebaseCode = getFirebaseAuthCode(error);
  if (firebaseCode === "auth/operation-not-allowed") {
    return "Google sign-in is not enabled in Firebase Authentication for this project.";
  }
  if (firebaseCode === "auth/account-exists-with-different-credential") {
    return "This email is already registered with a different sign-in method.";
  }
  if (firebaseCode === "auth/invalid-credential") {
    return "Google returned a credential Firebase could not use. Check that the app's Google OAuth client IDs belong to the same Firebase project.";
  }

  return error instanceof Error ? error.message : "Something went wrong while signing in.";
}

export function useAuth() {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setUser = useAuthStore((s) => s.setUser);
  const setToken = useAuthStore((s) => s.setToken);
  const logout = useAuthStore((s) => s.logout);
  const setOAuthProcessing = useAuthStore((s) => s.setOAuthProcessing);
  const setAccessMessage = useAuthStore((s) => s.setAccessMessage);
  const setEnrollments = useAppStore((s) => s.setEnrollments);

  const nonceRef = useRef(Math.random().toString(36).slice(2));
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

  const isWebAuth = Platform.OS === "web";
  const usesImplicitIdTokenFlow = isExpoGo || isWebAuth;
  const authorizationRedirectUri = usesImplicitIdTokenFlow
    ? isExpoGo
      ? expoAuthProxyRedirectUri
      : appReturnUri
    : appReturnUri;

  const googleConfigError = useMemo(() => {
    if (!isExpoGo && authorizationRedirectUri.startsWith("exp://")) {
      return `Google sign-in generated ${authorizationRedirectUri}. Rebuild the app so the native ${GOOGLE_OAUTH_SCHEME} scheme is installed.`;
    }

    if (!googleClient.clientId) {
      return `Missing ${googleClient.envName}. Add the ${googleClient.label} OAuth client ID to your mobile environment.`;
    }

    return null;
  }, [authorizationRedirectUri, googleClient]);

  useEffect(() => {
    logAuthDebug("[useAuth] Google OAuth config", {
      runtime: isExpoGo ? "expo-go" : Platform.OS,
      redirectUri: authorizationRedirectUri,
      appReturnUri,
      proxyRedirectUri: expoAuthProxyRedirectUri,
      clientEnv: googleClient.envName,
      responseType: usesImplicitIdTokenFlow
        ? AuthSession.ResponseType.IdToken
        : AuthSession.ResponseType.Code,
      apiBaseUrl: API_BASE_URL,
    });
  }, [
    appReturnUri,
    authorizationRedirectUri,
    expoAuthProxyRedirectUri,
    googleClient.envName,
    usesImplicitIdTokenFlow,
  ]);

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

  const resetAuthenticatedState = async () => {
    await setToken(null);
    setUser(null);
    setEnrollments([]);
    setAccessMessage(null);
    try {
      await firebaseSignOut(firebaseAuth);
    } catch {
      // Local state is already cleared; Firebase cleanup can retry later.
    }
  };

  const exchangeGoogleCode = async (code: string) => {
    if (!googleClient.clientId) {
      throw new Error(`Missing ${googleClient.envName}.`);
    }

    if (!request?.codeVerifier) {
      throw new Error(
        "Google returned an authorization code, but the app has no PKCE verifier to exchange it."
      );
    }

    const tokenResponse = await AuthSession.exchangeCodeAsync(
      {
        clientId: googleClient.clientId,
        code,
        redirectUri: authorizationRedirectUri,
        scopes: GOOGLE_SCOPES,
        extraParams: {
          code_verifier: request.codeVerifier,
        },
      },
      googleDiscovery
    );

    return {
      idToken: tokenResponse.idToken,
      accessToken: tokenResponse.accessToken,
    };
  };

  const resolveGoogleTokens = async (authResult: GoogleAuthResult) => {
    const tokens = extractGoogleTokens(authResult);

    if ((!tokens.idToken || !tokens.accessToken) && tokens.code) {
      logAuthDebug("[GoogleAuth] exchanging authorization code", {
        hasCodeVerifier: Boolean(request?.codeVerifier),
        redirectUri: authorizationRedirectUri,
      });

      const exchangedTokens = await exchangeGoogleCode(tokens.code);
      tokens.idToken = tokens.idToken ?? exchangedTokens.idToken;
      tokens.accessToken = tokens.accessToken ?? exchangedTokens.accessToken;
    }

    if (!tokens.idToken && !tokens.accessToken) {
      throw new Error("Google did not return a usable authentication token.");
    }

    return tokens;
  };

  const signIntoFirebaseAndBackend = async (tokens: GoogleTokens) => {
    logAuthDebug("[GoogleAuth] creating Firebase credential", {
      hasIdToken: Boolean(tokens.idToken),
      hasAccessToken: Boolean(tokens.accessToken),
    });

    const credential = GoogleAuthProvider.credential(
      tokens.idToken ?? null,
      tokens.accessToken ?? null
    );

    logAuthDebug("[FirebaseAuth] signInWithCredential started");
    const userCredential = await signInWithCredential(firebaseAuth, credential);
    const firebaseIdToken = await userCredential.user.getIdToken(true);

    logAuthDebug("[FirebaseAuth] signInWithCredential success", {
      firebaseUid: userCredential.user.uid,
      hasFirebaseIdToken: Boolean(firebaseIdToken),
      firebaseIdTokenLength: firebaseIdToken.length,
      firebaseIdTokenLooksLikeJwt: firebaseIdToken.split(".").length === 3,
    });

    const backendUser = ensureMobileCandidate(await syncUser(firebaseIdToken));
    await setToken(firebaseIdToken);
    api.defaults.headers.common.Authorization = `Bearer ${firebaseIdToken}`;

    const storedToken = await getStoredItem(TOKEN_STORAGE_KEY);
    logAuthDebug("[Storage] Firebase token persisted", {
      key: TOKEN_STORAGE_KEY,
      saved: Boolean(storedToken),
    });

    try {
      const enrollments = await getEnrollments();
      setEnrollments(enrollments);
    } catch (enrollmentError) {
      if (isAuthRejected(enrollmentError)) {
        throw enrollmentError;
      }
      logAuthDebug("[useAuth] failed to load enrollments after Google login", {
        message: getBackendErrorMessage(enrollmentError, "Enrollment load failed."),
      });
    }

    setUser(backendUser);
    logAuthDebug("[useAuth] Google authentication complete", {
      endpoint: `${API_BASE_URL}/api/v1/auth/sync`,
      userId: backendUser.id,
      role: backendUser.role,
    });
  };

  const promptWithExpoGoProxy = async () => {
    if (!request?.url) {
      throw new Error("Google sign-in is still initializing. Please try again in a moment.");
    }

    const proxyStartUrl =
      `${expoAuthProxyRedirectUri}/start?` +
      new URLSearchParams({
        authUrl: request.url,
        returnUrl: appReturnUri,
      }).toString();

    const browserResult = await WebBrowser.openAuthSessionAsync(proxyStartUrl, appReturnUri);
    logAuthDebug("[GoogleAuth] Expo Go browser result", {
      type: browserResult.type,
      hasUrl: "url" in browserResult && Boolean(browserResult.url),
    });

    if (browserResult.type !== "success" || !("url" in browserResult)) {
      return { type: browserResult.type } as GoogleAuthResult;
    }

    return request.parseReturnUrl(browserResult.url);
  };

  const signInWithGoogle = async () => {
    if (isSigningIn) return;

    setError(null);
    setAccessMessage(null);
    setIsSigningIn(true);
    setOAuthProcessing(true);

    try {
      if (googleConfigError) {
        setError(googleConfigError);
        return;
      }

      if (!request || !request.url || !googleClient.clientId) {
        setError("Google sign-in is still initializing. Please try again in a moment.");
        return;
      }

      logAuthDebug("[GoogleAuth] prompt started", {
        runtime: isExpoGo ? "expo-go" : Platform.OS,
        redirectUri: authorizationRedirectUri,
        returnUri: appReturnUri,
      });

      const authResult = isExpoGo ? await promptWithExpoGoProxy() : await promptAsync();
      logGoogleAuthResult("[GoogleAuth] OAuth result", authResult);

      if (!isSuccessfulAuthResult(authResult)) {
        const message = getGoogleResultError(authResult);
        if (message) setError(message);
        return;
      }

      const tokens = await resolveGoogleTokens(authResult);
      logAuthDebug("[GoogleAuth] token availability before Firebase", {
        hasIdToken: Boolean(tokens.idToken),
        hasAccessToken: Boolean(tokens.accessToken),
      });

      await signIntoFirebaseAndBackend(tokens);
    } catch (err) {
      await resetAuthenticatedState();

      if (__DEV__) {
        if (axios.isAxiosError(err)) {
          console.warn("[useAuth] Google login/sync failed", {
            endpoint: `${API_BASE_URL}/api/v1/auth/sync`,
            status: err.response?.status,
            detail: err.response?.data?.detail,
            code: err.code,
            message: err.message,
          });
        } else {
          const firebaseCode = getFirebaseAuthCode(err);
          console.warn("[useAuth] Google login failed", {
            code: firebaseCode,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      setError(getGoogleSignInFailureMessage(err));
    } finally {
      setOAuthProcessing(false);
      setIsSigningIn(false);
    }
  };

  const signInWithDemo = async (accountKey: string) => {
    setError(null);
    setAccessMessage(null);
    setIsSigningIn(true);
    try {
      logAuthDebug("[useAuth] demo login request", {
        endpoint: `${API_BASE_URL}/api/v1/auth/demo-login`,
        accountKey,
      });

      const response = await api.post<AuthResponsePayload>("/api/v1/auth/demo-login", {
        account_key: accountKey,
      });

      const { token, user } = normalizeAuthResponse(response.data);
      logAuthDebug("[useAuth] demo login response", {
        endpoint: `${API_BASE_URL}/api/v1/auth/demo-login`,
        status: response.status,
        responseKeys: Object.keys(response.data ?? {}),
        hasToken: Boolean(token),
        hasUser: Boolean(user),
      });

      if (!token || !user) {
        throw new Error("Login response did not include a token and user.");
      }

      const candidateUser = ensureMobileCandidate(user);

      await setToken(token);
      api.defaults.headers.common.Authorization = `Bearer ${token}`;

      try {
        const enrollments = await getEnrollments();
        setEnrollments(enrollments);
      } catch (enrollmentError) {
        if (isAuthRejected(enrollmentError)) {
          throw enrollmentError;
        }
        logAuthDebug("[useAuth] failed to load enrollments after demo login", {
          message: getBackendErrorMessage(enrollmentError, "Enrollment load failed."),
        });
      }
      setUser(candidateUser);
    } catch (err) {
      await setToken(null);
      setUser(null);
      setEnrollments([]);

      if (__DEV__ && axios.isAxiosError(err)) {
        console.warn("[useAuth] demo login failed", {
          endpoint: `${API_BASE_URL}/api/v1/auth/demo-login`,
          status: err.response?.status,
          detail: err.response?.data?.detail,
          code: err.code,
        });
      }

      const message = isMobileRoleAccessError(err)
        ? MOBILE_ROLE_BLOCK_MESSAGE
        : getBackendErrorMessage(err, "Demo login failed. Is the backend running?");
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

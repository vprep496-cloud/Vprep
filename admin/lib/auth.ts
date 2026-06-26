import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import axios from "axios";
import type { UserRole } from "../types";

const FIREBASE_REFRESH_MARGIN_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Module augmentation — extend NextAuth's types with V-Prep specific fields.
// `Account.vprep*` is a side-channel used to pass the backend sync result
// from the `signIn` callback to the `jwt` callback (both run on initial login).
// ---------------------------------------------------------------------------
declare module "next-auth" {
  interface Session {
    accessToken?: string;
    authError?: string;
    user: {
      role?: UserRole;
      backendUserId?: string;
    } & DefaultSession["user"];
  }

  interface Account {
    vprepRole?: UserRole;
    vprepUserId?: string;
    vprepAccessToken?: string;
    vprepRefreshToken?: string;
    vprepExpiresAt?: number;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    accessToken?: string;
    firebaseRefreshToken?: string;
    firebaseExpiresAt?: number;
    role?: UserRole;
    backendUserId?: string;
    authError?: string;
  }
}

interface FirebaseSignInWithIdpResponse {
  idToken: string;
  refreshToken: string;
  expiresIn: string;
}

interface FirebaseRefreshResponse {
  id_token: string;
  refresh_token: string;
  expires_in: string;
}

interface BackendUserResponse {
  id: string;
  role: UserRole;
}

interface FirebaseSession {
  idToken: string;
  refreshToken: string;
  expiresAt: number;
}

function getBackendBaseUrl() {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!baseUrl) {
    throw new Error("Missing NEXT_PUBLIC_API_URL for admin authentication.");
  }
  return baseUrl.replace(/\/$/, "");
}

function getFirebaseApiKey() {
  const apiKey =
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() ??
    process.env.EXPO_PUBLIC_FIREBASE_API_KEY?.trim() ??
    process.env.FIREBASE_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      "Missing Firebase API key. Set NEXT_PUBLIC_FIREBASE_API_KEY in the admin environment."
    );
  }

  return apiKey;
}

function getAuthRequestUri() {
  return process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";
}

function expiresAtFromSeconds(expiresIn: string | number) {
  return Date.now() + Number(expiresIn) * 1000;
}

async function exchangeGoogleIdTokenForFirebaseSession(
  googleIdToken: string
): Promise<FirebaseSession> {
  const { data } = await axios.post<FirebaseSignInWithIdpResponse>(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${getFirebaseApiKey()}`,
    {
      postBody: new URLSearchParams({
        id_token: googleIdToken,
        providerId: "google.com",
      }).toString(),
      requestUri: getAuthRequestUri(),
      returnIdpCredential: true,
      returnSecureToken: true,
    }
  );

  if (!data.idToken || !data.refreshToken) {
    throw new Error("Firebase did not return a complete admin session.");
  }

  return {
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAt: expiresAtFromSeconds(data.expiresIn),
  };
}

async function refreshFirebaseSession(refreshToken: string): Promise<FirebaseSession> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const { data } = await axios.post<FirebaseRefreshResponse>(
    `https://securetoken.googleapis.com/v1/token?key=${getFirebaseApiKey()}`,
    body,
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  if (!data.id_token || !data.refresh_token) {
    throw new Error("Firebase token refresh did not return a complete session.");
  }

  return {
    idToken: data.id_token,
    refreshToken: data.refresh_token,
    expiresAt: expiresAtFromSeconds(data.expires_in),
  };
}

async function syncFirebaseSessionWithBackend(firebaseSession: FirebaseSession) {
  const { data } = await axios.post<BackendUserResponse>(
    `${getBackendBaseUrl()}/api/v1/auth/sync`,
    {},
    {
      headers: {
        Authorization: `Bearer ${firebaseSession.idToken}`,
      },
    }
  );

  return {
    firebaseSession,
    role: data.role,
    backendUserId: data.id,
  };
}

async function completeGoogleAdminLogin(googleIdToken: string) {
  const firebaseSession = await exchangeGoogleIdTokenForFirebaseSession(googleIdToken);
  return syncFirebaseSessionWithBackend(firebaseSession);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: { scope: "openid email profile" },
      },
    }),

    // -----------------------------------------------------------------------
    // Demo Credentials provider — calls the backend's /auth/demo-login
    // endpoint and stores the returned demo JWT as the session access token.
    // This provider is intentionally simple: no password, no email — just an
    // `account_key` string that maps to a hardcoded demo persona on the backend.
    // -----------------------------------------------------------------------
    Credentials({
      id: "demo",
      name: "Demo Account",
      credentials: {
        account_key: { label: "Account Key", type: "text" },
      },
      async authorize(credentials) {
        const accountKey = credentials?.account_key as string | undefined;
        if (!accountKey) return null;

        try {
          const { data } = await axios.post(
            `${process.env.NEXT_PUBLIC_API_URL}/api/v1/auth/demo-login`,
            { account_key: accountKey }
          );

          // Shape must match what NextAuth stores in the JWT callback below.
          return {
            id: data.user.id,
            name: data.user.display_name,
            email: data.user.email,
            image: data.user.photo_url ?? null,
            // Side-channel fields picked up in the `jwt` callback:
            demoToken: data.token as string,
            demoRole: data.user.role as UserRole,
            demoUserId: data.user.id as string,
          };
        } catch (error) {
          console.error("[auth] demo-login failed:", error);
          return null;
        }
      },
    }),
  ],

  callbacks: {
    async signIn({ account }) {
      // Credentials (demo) provider: account.type === "credentials".
      // authorize() already validated the account key and fetched the user —
      // returning true here lets Auth.js proceed to the jwt callback where
      // we store the demo JWT as accessToken.
      if (!account || account.type === "credentials") return true;

      if (account.provider !== "google") return false;

      // NextAuth's Google provider returns a Google OAuth ID token. The V-Prep
      // backend expects Firebase ID tokens, so we exchange Google -> Firebase
      // first, then sync that Firebase session with FastAPI.
      const googleIdToken = account.id_token;
      if (!googleIdToken) return false;

      try {
        const login = await completeGoogleAdminLogin(googleIdToken);
        account.vprepRole = login.role;
        account.vprepUserId = login.backendUserId;
        account.vprepAccessToken = login.firebaseSession.idToken;
        account.vprepRefreshToken = login.firebaseSession.refreshToken;
        account.vprepExpiresAt = login.firebaseSession.expiresAt;
        return true;
      } catch (error) {
        console.error("[auth] failed to complete Google admin login:", error);
        return false;
      }
    },

    async jwt({ token, account, user }) {
      if (account?.type === "credentials") {
        // Demo Credentials provider — `authorize` attached the extra fields to
        // the user object; copy them straight into the JWT.
        const demoUser = user as (typeof user & {
          demoToken?: string;
          demoRole?: UserRole;
          demoUserId?: string;
        }) | undefined;
        if (demoUser?.demoToken) {
          token.accessToken = demoUser.demoToken;
          token.role = demoUser.demoRole;
          token.backendUserId = demoUser.demoUserId;
        }
        return token;
      }

      if (account?.provider === "google") {
        if (!account.vprepAccessToken && account.id_token) {
          // Defensive fallback for Auth.js beta behavior: if Account mutation
          // from signIn() is not preserved, complete the same exchange here.
          const login = await completeGoogleAdminLogin(account.id_token);
          account.vprepRole = login.role;
          account.vprepUserId = login.backendUserId;
          account.vprepAccessToken = login.firebaseSession.idToken;
          account.vprepRefreshToken = login.firebaseSession.refreshToken;
          account.vprepExpiresAt = login.firebaseSession.expiresAt;
        }

        token.accessToken = account.vprepAccessToken;
        token.firebaseRefreshToken = account.vprepRefreshToken;
        token.firebaseExpiresAt = account.vprepExpiresAt;
        token.role = account.vprepRole;
        token.backendUserId = account.vprepUserId;
        token.authError = undefined;
        return token;
      }

      if (
        token.firebaseRefreshToken &&
        token.firebaseExpiresAt &&
        Date.now() >= token.firebaseExpiresAt - FIREBASE_REFRESH_MARGIN_MS
      ) {
        try {
          const refreshed = await refreshFirebaseSession(token.firebaseRefreshToken);
          token.accessToken = refreshed.idToken;
          token.firebaseRefreshToken = refreshed.refreshToken;
          token.firebaseExpiresAt = refreshed.expiresAt;
          token.authError = undefined;
        } catch (error) {
          console.error("[auth] failed to refresh Firebase admin token:", error);
          token.accessToken = undefined;
          token.authError = "RefreshAccessTokenError";
        }
      }

      return token;
    },

    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.authError = token.authError;
      if (session.user) {
        session.user.role = token.role;
        session.user.backendUserId = token.backendUserId;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});

import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import axios from "axios";
import type { UserRole } from "../types";

// ---------------------------------------------------------------------------
// Module augmentation — extend NextAuth's types with V-Prep specific fields.
// `Account.vprep*` is a side-channel used to pass the backend sync result
// from the `signIn` callback to the `jwt` callback (both run on initial login).
// ---------------------------------------------------------------------------
declare module "next-auth" {
  interface Session {
    accessToken?: string;
    user: {
      role?: UserRole;
      backendUserId?: string;
    } & DefaultSession["user"];
  }

  interface Account {
    vprepRole?: UserRole;
    vprepUserId?: string;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    accessToken?: string;
    role?: UserRole;
    backendUserId?: string;
  }
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

      // Google provider: sync the Firebase ID token with the backend to get
      // the user's role before granting portal access.
      const idToken = account.id_token;
      if (!idToken) return false;

      try {
        const { data } = await axios.post(
          `${process.env.NEXT_PUBLIC_API_URL}/api/v1/auth/sync`,
          {},
          { headers: { Authorization: `Bearer ${idToken}` } }
        );

        account.vprepRole = data.role as UserRole;
        account.vprepUserId = data.id as string;
        return true;
      } catch (error) {
        console.error("[auth] failed to sync user with backend:", error);
        return false;
      }
    },

    async jwt({ token, account, user }) {
      // Only runs on initial sign-in (account is present); subsequent
      // requests just return the existing token unchanged.
      if (!account) return token;

      if (account.type === "credentials") {
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
      } else {
        // Google OAuth provider — vprepRole/vprepUserId were attached in
        // the `signIn` callback after the backend sync.
        token.accessToken = account.id_token;
        token.role = account.vprepRole;
        token.backendUserId = account.vprepUserId;
      }

      return token;
    },

    async session({ session, token }) {
      session.accessToken = token.accessToken;
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

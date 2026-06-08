import NextAuth, { type DefaultSession } from "next-auth";
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
  ],
  callbacks: {
    async signIn({ account }) {
      const idToken = account?.id_token;
      if (!idToken) return false;

      try {
        // Sync the Google-authenticated user with the FastAPI backend so we
        // know their role (candidate / admin / superadmin) before granting
        // access to the admin portal.
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

    async jwt({ token, account }) {
      // `account` is only present on the initial sign-in.
      if (account) {
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

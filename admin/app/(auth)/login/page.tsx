"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession, signIn } from "next-auth/react";

// ---------------------------------------------------------------------------
// Demo account definitions — mirrors _DEMO_ACCOUNTS in backend/app/api/v1/auth.py
// ---------------------------------------------------------------------------
const DEMO_ACCOUNTS = [
  {
    key: "superadmin",
    label: "Superadmin",
    name: "Demo Superadmin",
    email: "superadmin@demo.vprep",
    badge: "SA",
    badgeColor: "bg-purple-500",
    description: "Full access · promote users · manage questions",
  },
  {
    key: "admin",
    label: "Admin",
    name: "Demo Admin",
    email: "admin@demo.vprep",
    badge: "A",
    badgeColor: "bg-sky-500",
    description: "View candidates · analytics · read-only questions",
  },
  {
    key: "candidate1",
    label: "Candidate 1",
    name: "Ahmad Raza",
    email: "ahmad.raza@demo.vprep",
    badge: "AR",
    badgeColor: "bg-emerald-500",
    description: "ML/AI track · intermediate · 3 sessions",
  },
  {
    key: "candidate2",
    label: "Candidate 2",
    name: "Fatima Malik",
    email: "fatima.malik@demo.vprep",
    badge: "FM",
    badgeColor: "bg-pink-500",
    description: "Web Dev track · beginner · 2 sessions",
  },
  {
    key: "candidate3",
    label: "Candidate 3",
    name: "Usman Khan",
    email: "usman.khan@demo.vprep",
    badge: "UK",
    badgeColor: "bg-amber-500",
    description: "DevOps track · advanced · 3 sessions",
  },
] as const;

export default function LoginPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [demoLoading, setDemoLoading] = useState<string | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);

  // Once NextAuth resolves an authenticated session, route by backend role.
  useEffect(() => {
    if (status !== "authenticated" || !session?.user) return;

    if (session.user.role === "candidate") {
      router.replace("/unauthorized");
    } else {
      router.replace("/");
    }
  }, [status, session, router]);

  const handleDemoLogin = async (accountKey: string) => {
    setDemoError(null);
    setDemoLoading(accountKey);
    try {
      const result = await signIn("demo", {
        account_key: accountKey,
        redirect: false,
      });
      if (result?.error) {
        setDemoError("Demo login failed — is the backend running on :8000?");
      }
      // Navigation handled by the useEffect above once the session updates.
    } catch {
      setDemoError("Could not reach the backend. Make sure it's running.");
    } finally {
      setDemoLoading(null);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-lg flex flex-col items-center text-center">
        {/* Logo */}
        <div className="w-16 h-16 rounded-2xl bg-primary-500 flex items-center justify-center mb-5">
          <span className="text-white text-2xl font-bold">VP</span>
        </div>
        <h1 className="text-2xl font-bold text-text-primary">V-Prep</h1>
        <p className="text-text-secondary text-sm mt-1 mb-8">Admin Portal</p>

        {/* Google sign-in */}
        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl: "/" })}
          disabled={status === "loading"}
          className="w-full flex items-center justify-center gap-3 rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <GoogleIcon />
          Sign in with Google
        </button>

        {/* Divider */}
        <div className="w-full flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-text-muted font-medium uppercase tracking-wide">
            or use a demo account
          </span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Demo error */}
        {demoError ? (
          <div className="w-full mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 text-left">
            {demoError}
          </div>
        ) : null}

        {/* Demo account grid */}
        <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {DEMO_ACCOUNTS.map((account) => {
            const isLoading = demoLoading === account.key;
            const isAnyLoading = demoLoading !== null;

            return (
              <button
                key={account.key}
                type="button"
                onClick={() => handleDemoLogin(account.key)}
                disabled={isAnyLoading}
                className="flex items-start gap-3 rounded-xl border border-border bg-background-card p-3.5 text-left transition-colors hover:bg-background-surface hover:border-primary-500/40 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {/* Avatar */}
                <div
                  className={`flex-shrink-0 w-9 h-9 rounded-full ${account.badgeColor} flex items-center justify-center text-white text-xs font-bold`}
                >
                  {isLoading ? (
                    <svg
                      className="animate-spin w-4 h-4 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                  ) : (
                    account.badge
                  )}
                </div>

                {/* Text */}
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text-primary leading-tight">
                    {account.name}
                  </p>
                  <p className="text-xs text-text-muted mt-0.5 leading-tight">
                    {account.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        <p className="text-text-muted text-xs mt-8">
          Demo accounts are for testing only and do not require a Google account.
        </p>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.85.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72A5.4 5.4 0 0 1 3.69 9c0-.6.1-1.18.28-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.59-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

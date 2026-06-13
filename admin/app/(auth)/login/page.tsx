"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession, signIn } from "next-auth/react";
import { Loader2 } from "lucide-react";
import VPrepLogo from "@/components/ui/VPrepLogo";

const DEMO_ACCOUNTS = [
  {
    key: "superadmin",
    label: "Superadmin",
    name: "Demo Superadmin",
    description: "Full access · promote users · manage questions",
    initials: "SA",
    color: "from-purple-600 to-purple-500",
    dotColor: "bg-purple-500",
  },
  {
    key: "admin",
    label: "Admin",
    name: "Demo Admin",
    description: "View candidates · analytics · read-only questions",
    initials: "A",
    color: "from-sky-600 to-sky-500",
    dotColor: "bg-sky-500",
  },
  {
    key: "candidate1",
    label: "Candidate 1",
    name: "Ahmad Raza",
    description: "ML/AI track · intermediate · 3 sessions",
    initials: "AR",
    color: "from-emerald-600 to-emerald-500",
    dotColor: "bg-emerald-500",
  },
  {
    key: "candidate2",
    label: "Candidate 2",
    name: "Fatima Malik",
    description: "Web Dev track · beginner · 2 sessions",
    initials: "FM",
    color: "from-pink-600 to-pink-500",
    dotColor: "bg-pink-500",
  },
  {
    key: "candidate3",
    label: "Candidate 3",
    name: "Usman Khan",
    description: "DevOps track · advanced · 3 sessions",
    initials: "UK",
    color: "from-amber-600 to-amber-500",
    dotColor: "bg-amber-500",
  },
] as const;

export default function LoginPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [demoLoading, setDemoLoading] = useState<string | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);

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
      const result = await signIn("demo", { account_key: accountKey, redirect: false });
      if (result?.error) {
        setDemoError("Demo login failed — is the backend running on :8000?");
      }
    } catch {
      setDemoError("Could not reach the backend. Make sure it's running.");
    } finally {
      setDemoLoading(null);
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* Left panel — brand */}
      <div className="hidden lg:flex w-[420px] shrink-0 flex-col bg-gradient-to-br from-primary-600 via-primary-500 to-primary-400 p-12 text-white">
        <div className="flex items-center gap-3">
          <VPrepLogo size={44} />
          <div>
            <p className="font-bold text-white">V-Prep</p>
            <p className="text-xs text-primary-200">Admin Portal</p>
          </div>
        </div>

        <div className="mt-auto">
          <h2 className="text-3xl font-bold leading-tight">
            Manage candidates,<br />
            tracks &amp; interviews<br />
            with confidence.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-primary-200">
            Monitor AI-scored mock interviews, review candidates, manage question banks, and keep your V-Prep deployment healthy.
          </p>

          <div className="mt-10 space-y-3">
            {[
              "Real-time candidate analytics",
              "AI-powered interview scoring",
              "Multi-track question management",
            ].map((feature) => (
              <div key={feature} className="flex items-center gap-2.5">
                <div className="h-1.5 w-1.5 rounded-full bg-cranberry" />
                <span className="text-sm text-primary-100">{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel — login form */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
        {/* Mobile logo */}
        <div className="mb-8 flex flex-col items-center lg:hidden">
          <VPrepLogo size={56} />
          <p className="mt-3 text-lg font-bold text-text-primary">V-Prep Admin</p>
        </div>

        <div className="w-full max-w-md">
          <div className="hidden lg:block mb-8">
            <h1 className="text-2xl font-bold text-text-primary">Sign in</h1>
            <p className="mt-1 text-sm text-text-secondary">Access your admin portal</p>
          </div>

          {/* Google sign-in */}
          <button
            type="button"
            onClick={() => signIn("google", { callbackUrl: "/" })}
            disabled={status === "loading"}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-border bg-background-card px-6 py-3.5 text-sm font-semibold text-text-primary shadow-soft transition-all hover:shadow-lift hover:border-primary-200 disabled:opacity-50"
          >
            <GoogleIcon />
            Continue with Google
          </button>

          {/* Divider */}
          <div className="my-7 flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              or demo account
            </span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Error */}
          {demoError && (
            <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3">
              <div className="h-2 w-2 shrink-0 rounded-full bg-danger" />
              <p className="text-sm text-danger">{demoError}</p>
            </div>
          )}

          {/* Demo accounts grid */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {DEMO_ACCOUNTS.map((account) => {
              const loading = demoLoading === account.key;
              const anyLoading = demoLoading !== null;
              return (
                <button
                  key={account.key}
                  type="button"
                  onClick={() => handleDemoLogin(account.key)}
                  disabled={anyLoading}
                  className="group flex items-center gap-3 rounded-xl border border-border bg-background-card p-3.5 text-left transition-all hover:border-primary-200 hover:bg-background-elevated hover:shadow-soft disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${account.color} text-xs font-bold text-white shadow-sm`}
                  >
                    {loading ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      account.initials
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary leading-tight">
                      {account.name}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-text-muted">
                      {account.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          <p className="mt-8 text-center text-xs text-text-muted">
            Demo accounts are for testing only and do not require a password.
          </p>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.85.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"/>
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.69 9c0-.6.1-1.18.28-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33Z"/>
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.59-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"/>
    </svg>
  );
}

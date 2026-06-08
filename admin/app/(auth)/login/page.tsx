"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession, signIn } from "next-auth/react";

export default function LoginPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  // Once NextAuth resolves an authenticated session, route by backend role:
  // candidates aren't allowed in the admin portal, everyone else lands on /.
  useEffect(() => {
    if (status !== "authenticated" || !session?.user) return;

    if (session.user.role === "candidate") {
      router.replace("/unauthorized");
    } else {
      router.replace("/");
    }
  }, [status, session, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-2xl bg-primary-500 flex items-center justify-center mb-5">
          <span className="text-white text-2xl font-bold">VP</span>
        </div>
        <h1 className="text-2xl font-bold text-text-primary">V-Prep</h1>
        <p className="text-text-secondary text-sm mt-1 mb-10">Admin Portal</p>

        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl: "/" })}
          disabled={status === "loading"}
          className="w-full flex items-center justify-center gap-3 rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <GoogleIcon />
          Sign in with Google
        </button>

        <p className="text-text-muted text-xs mt-8">
          Access is restricted to V-Prep admins and recruiters.
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

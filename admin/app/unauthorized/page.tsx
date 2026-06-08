"use client";

import { ShieldAlert } from "lucide-react";
import { signOut } from "next-auth/react";

export default function UnauthorizedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-2xl bg-danger/15 flex items-center justify-center mb-5">
          <ShieldAlert size={28} className="text-danger" />
        </div>
        <h1 className="text-2xl font-bold text-text-primary">Not authorized</h1>
        <p className="text-text-secondary text-sm mt-2">
          Your account doesn't have access to the V-Prep admin portal. This
          area is reserved for admins and recruiters.
        </p>

        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="mt-8 rounded-xl border border-border px-6 py-3 text-sm font-semibold text-text-primary hover:bg-background-surface"
        >
          Sign out
        </button>
      </div>
    </main>
  );
}

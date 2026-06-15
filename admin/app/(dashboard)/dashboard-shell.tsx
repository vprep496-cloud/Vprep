"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import type { Session } from "next-auth";
import {
  LayoutDashboard,
  Users,
  UserCog,
  FileQuestion,
  Layers,
  BarChart3,
  Sparkles,
  ClipboardList,
  LogOut,
  CheckCircle2,
  AlertCircle,
  Loader2,
  type LucideIcon,
} from "lucide-react";

import { adminApi, setApiToken } from "@/lib/api";
import VPrepLogo from "@/components/ui/VPrepLogo";

interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_LINKS: NavLink[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/users", label: "Users", icon: UserCog },
  { href: "/candidates", label: "Candidates", icon: Users },
  { href: "/sessions", label: "Sessions", icon: ClipboardList },
  { href: "/tracks", label: "Tracks", icon: Layers },
  { href: "/questions", label: "Questions", icon: FileQuestion },
  { href: "/ai", label: "AI Engine", icon: Sparkles },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
];

export default function DashboardShell({
  session,
  children,
}: {
  session: Session;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const userName = session.user?.name ?? "Admin";
  const userRole = session.user?.role ?? "admin";

  // Robust sign-out: `redirect: false` prevents next-auth from doing its own
  // redirect (which can be unreliable in v5 beta); we drive the navigation
  // ourselves via router.push so the user always lands on /login.
  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut({ redirect: false });
    } finally {
      // Always navigate even if signOut throws — the session will be invalid.
      router.push("/login");
    }
  };

  // ── Token sync ────────────────────────────────────────────────────────────
  // Set the module-level token immediately from the server-provided session
  // (available on first render) so every React Query child fires with auth.
  // Keep in sync as the client-side session evolves (token refresh, etc.).
  const { data: clientSession } = useSession();
  const activeToken = clientSession?.accessToken ?? session.accessToken ?? null;

  // Synchronously set token on first render via the initializer pattern
  // (runs before children's React Query hooks fire)
  setApiToken(activeToken);

  useEffect(() => {
    setApiToken(activeToken);
  }, [activeToken]);
  // ─────────────────────────────────────────────────────────────────────────

  const { data: aiStatus } = useQuery({
    queryKey: ["admin-ai-status"],
    queryFn: () => adminApi.getAIStatus(false),
    staleTime: 120_000,
    retry: 1,
  });
  const aiOk = aiStatus?.configured ?? null;

  const initials = userName
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <div className="flex min-h-screen bg-background">
      {/* ── Sidebar ── */}
      <aside className="fixed inset-y-0 left-0 z-20 flex w-64 flex-col bg-primary-600 shadow-lift">
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <VPrepLogo size={40} />
          <div>
            <p className="text-sm font-bold text-white leading-tight">V-Prep</p>
            <p className="text-[11px] text-primary-200">Admin Portal</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          {NAV_LINKS.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/"
                ? pathname === href
                : pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                  active
                    ? "bg-white text-primary-700 shadow-soft"
                    : "text-primary-100 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon
                  size={17}
                  className={active ? "text-primary-600" : "text-primary-300 group-hover:text-white"}
                />
                {label}
                {active && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary-500" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* AI Status widget */}
        <div className="mx-3 mb-3 rounded-2xl border border-white/10 bg-white/5 p-3.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-primary-300 mb-2">
            System Status
          </p>
          <div className="flex items-center gap-2">
            {aiOk === null ? (
              <Loader2 size={13} className="animate-spin text-primary-300 shrink-0" />
            ) : aiOk ? (
              <CheckCircle2 size={13} className="text-success shrink-0" />
            ) : (
              <AlertCircle size={13} className="text-cranberry shrink-0" />
            )}
            <span className={`text-xs font-semibold ${aiOk === null ? "text-primary-200" : aiOk ? "text-white" : "text-cranberry"}`}>
              {aiOk === null ? "Checking…" : aiOk ? "AI Active" : "AI Offline"}
            </span>
          </div>
          {aiStatus?.models.scoring && (
            <p className="mt-1 text-[10px] text-primary-300 truncate">{aiStatus.models.scoring}</p>
          )}
        </div>

        {/* User footer */}
        <div className="border-t border-white/10 px-3 py-3">
          <div className="flex items-center gap-2.5">
            {session.user?.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={session.user.image} alt={userName} className="h-8 w-8 rounded-full ring-1 ring-white/20" />
            ) : (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-400 text-[11px] font-bold text-white">
                {initials}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-white">{userName}</p>
              <p className="text-[10px] capitalize text-primary-300">{userRole}</p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              title="Sign out"
              className="rounded-lg p-1.5 text-primary-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              {signingOut ? <Loader2 size={15} className="animate-spin" /> : <LogOut size={15} />}
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="ml-64 flex min-h-screen flex-1 flex-col">
        {/* Top header */}
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-border-soft bg-background-card/95 px-8 backdrop-blur-sm shadow-soft">
          {/* Breadcrumb */}
          <div>
            {(() => {
              const segments = pathname.split("/").filter(Boolean);
              const crumb = segments.length === 0
                ? "Dashboard"
                : segments.map((s) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " ")).join(" › ");
              return (
                <>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                    V-Prep Admin
                  </p>
                  <p className="text-sm font-bold text-text-primary">{crumb}</p>
                </>
              );
            })()}
          </div>

          <div className="flex items-center gap-3">
            {/* Role badge */}
            <span
              className={`hidden rounded-full px-3 py-1 text-xs font-semibold sm:inline-flex ${
                userRole === "superadmin"
                  ? "bg-purple-500/15 text-purple-500"
                  : "bg-sky-500/15 text-sky-500"
              }`}
            >
              {userRole === "superadmin" ? "Superadmin" : "Admin"}
            </span>

            {/* Sign-out button — always visible in the top header */}
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              title="Sign out"
              className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:border-danger/40 hover:bg-danger/5 hover:text-danger disabled:opacity-50"
            >
              {signingOut
                ? <Loader2 size={14} className="animate-spin" />
                : <LogOut size={14} />}
              <span className="hidden sm:inline">{signingOut ? "Signing out…" : "Sign out"}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 px-8 py-8">{children}</main>
      </div>
    </div>
  );
}

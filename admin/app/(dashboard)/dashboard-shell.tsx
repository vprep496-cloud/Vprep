"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import type { Session } from "next-auth";
import {
  LayoutDashboard,
  Users,
  UserCog,
  FileQuestion,
  Layers,
  BarChart3,
  Sparkles,
  LogOut,
  type LucideIcon,
} from "lucide-react";

interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_LINKS: NavLink[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/users", label: "Users", icon: UserCog },
  { href: "/candidates", label: "Candidates", icon: Users },
  { href: "/tracks", label: "Tracks", icon: Layers },
  { href: "/questions", label: "Questions", icon: FileQuestion },
  { href: "/ai", label: "AI", icon: Sparkles },
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
  const userName = session.user?.name ?? "Admin";

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-10 flex w-64 flex-col bg-primary-500 px-4 py-6 text-text-inverse shadow-lift">
        <div className="mb-8 flex items-center gap-2 px-2">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15">
            <span className="text-sm font-bold text-cranberry">VP</span>
          </div>
          <div>
            <span className="block text-lg font-bold text-white">V-Prep</span>
            <span className="text-xs font-medium text-primary-100">Admin Portal</span>
          </div>
        </div>

        <nav className="flex-1 space-y-1">
          {NAV_LINKS.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                  active
                    ? "bg-white text-primary-700 shadow-soft"
                    : "text-primary-100 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon size={18} />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-100">System Status</p>
          <div className="mt-2 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-success" />
            <span className="text-sm font-bold text-white">AI Core Active</span>
          </div>
        </div>
      </aside>

      <div className="ml-64 flex flex-1 flex-col">
        <header className="flex h-[72px] items-center justify-between border-b border-border-soft bg-background-card px-8 shadow-soft">
          <div>
            <p className="text-sm font-bold text-primary-700">Operations Center</p>
            <p className="text-xs text-text-muted">Candidates, reviews, questions, tracks, and AI setup</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              {session.user?.image ? (
                // eslint-disable-next-line @next/next/no-img-element -- external Google avatar URL
                <img
                  src={session.user.image}
                  alt={userName}
                  width={36}
                  height={36}
                  className="h-10 w-10 rounded-full border-2 border-primary-100"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-background-surface text-sm font-bold text-primary-700">
                  {userName.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="leading-tight">
                <p className="text-sm font-semibold text-text-primary">{userName}</p>
                <p className="text-xs capitalize text-text-muted">{session.user?.role}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex items-center gap-2 rounded-full border border-border-soft px-4 py-2 text-sm font-semibold text-text-secondary transition-colors hover:bg-background-surface hover:text-primary-700"
            >
              <LogOut size={16} />
              Sign Out
            </button>
          </div>
        </header>

        {/* Phase 7 polish: transition-opacity on page content so route changes
            fade in smoothly instead of snapping — the `duration-200` window
            is short enough not to feel sluggish during fast navigation. */}
        <main className="flex-1 px-8 py-8 transition-opacity duration-200">{children}</main>
      </div>
    </div>
  );
}

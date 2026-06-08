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
  BarChart3,
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
  { href: "/questions", label: "Questions", icon: FileQuestion },
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
      <aside className="fixed inset-y-0 left-0 z-10 flex w-64 flex-col border-r border-border bg-background-card px-4 py-6">
        <div className="mb-8 flex items-center gap-2 px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-500">
            <span className="text-sm font-bold text-white">VP</span>
          </div>
          <span className="text-lg font-bold text-text-primary">V-Prep</span>
        </div>

        <nav className="flex-1 space-y-1">
          {NAV_LINKS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary-500/15 text-primary-400"
                    : "text-text-secondary hover:bg-background-surface hover:text-text-primary"
                }`}
              >
                <Icon size={18} />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="ml-64 flex flex-1 flex-col">
        <header className="flex items-center justify-end gap-4 border-b border-border bg-background-card px-8 py-4">
          <div className="flex items-center gap-3">
            {session.user?.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- external Google avatar URL
              <img
                src={session.user.image}
                alt={userName}
                width={36}
                height={36}
                className="h-9 w-9 rounded-full"
              />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-background-surface text-sm font-semibold text-text-primary">
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
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-background-surface hover:text-text-primary"
          >
            <LogOut size={16} />
            Sign Out
          </button>
        </header>

        {/* Phase 7 polish: transition-opacity on page content so route changes
            fade in smoothly instead of snapping — the `duration-200` window
            is short enough not to feel sluggish during fast navigation. */}
        <main className="flex-1 px-8 py-6 transition-opacity duration-200">{children}</main>
      </div>
    </div>
  );
}

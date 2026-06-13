"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { ChevronRight, Search, UserCog } from "lucide-react";

import { adminApi } from "@/lib/api";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable";
import RoleBadge from "@/components/ui/RoleBadge";
import ScoreBadge from "@/components/ui/ScoreBadge";
import PageHeader from "@/components/ui/PageHeader";
import PromoteUserModal from "@/components/modals/PromoteUserModal";
import type { AdminUser, CandidateListItem, UserRole } from "@/types";

type RoleFilter = "all" | UserRole;

const ROLE_TABS: { value: RoleFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "candidate", label: "Candidates" },
  { value: "admin", label: "Admins" },
  { value: "superadmin", label: "Superadmins" },
];

const PAGE_SIZE = 20;

function toAdminUser(candidate: CandidateListItem): AdminUser {
  return {
    id: candidate.id,
    backendUserId: candidate.id,
    email: candidate.email,
    name: candidate.name,
    image: candidate.image,
    role: candidate.role,
    createdAt: candidate.createdAt,
  };
}

export default function CandidatesPage() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const isSuperadmin = session?.user?.role === "superadmin";

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [trackFilter, setTrackFilter] = useState<string>("all");
  const [promotingCandidate, setPromotingCandidate] = useState<CandidateListItem | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-candidates", { page, search, roleFilter, trackFilter }],
    queryFn: () =>
      adminApi.getCandidates({
        page,
        limit: PAGE_SIZE,
        search: search || undefined,
        role: roleFilter !== "all" ? roleFilter : undefined,
        trackId: trackFilter !== "all" ? trackFilter : undefined,
      }),
    retry: 1,
  });

  const { data: tracks } = useQuery({
    queryKey: ["admin-tracks"],
    queryFn: adminApi.getTracks,
    retry: 1,
  });

  const candidates = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;
  const pages = data?.pages ?? 1;

  const hasFilters = search !== "" || roleFilter !== "all" || trackFilter !== "all";

  const clearFilters = () => {
    setSearch(""); setRoleFilter("all"); setTrackFilter("all"); setPage(1);
  };

  const columns: DataTableColumn<CandidateListItem>[] = [
    {
      key: "name",
      label: "Candidate",
      render: (c) => (
        <Link href={`/candidates/${c.id}`} className="group flex items-center gap-3">
          {c.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.image} alt={c.name} className="h-8 w-8 rounded-full ring-1 ring-border" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-500/10 text-xs font-bold text-primary-600">
              {(c.name || "?").charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <p className="font-semibold text-text-primary group-hover:text-primary-600 transition-colors">{c.name}</p>
            <p className="text-xs text-text-muted">{c.email}</p>
          </div>
        </Link>
      ),
    },
    {
      key: "role",
      label: "Role",
      render: (c) => <RoleBadge role={c.role} />,
    },
    {
      key: "enrollmentCount",
      label: "Tracks",
      render: (c) => (
        <span className="inline-flex items-center rounded-full bg-background-surface px-2.5 py-0.5 text-xs font-semibold text-text-secondary">
          {c.enrollmentCount}
        </span>
      ),
    },
    {
      key: "sessionCount",
      label: "Sessions",
      render: (c) => (
        <span className="inline-flex items-center rounded-full bg-background-surface px-2.5 py-0.5 text-xs font-semibold text-text-secondary">
          {c.sessionCount}
        </span>
      ),
    },
    {
      key: "averageScore",
      label: "Avg Score",
      render: (c) => <ScoreBadge score={c.averageScore} />,
    },
    {
      key: "createdAt",
      label: "Joined",
      render: (c) =>
        new Date(c.createdAt).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        }),
    },
    {
      key: "actions",
      label: "",
      render: (c) => {
        const isSelf = c.id === session?.user?.backendUserId;
        return (
          <div className="flex items-center gap-2">
            <Link
              href={`/candidates/${c.id}`}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-primary-300 hover:bg-primary-500/5 hover:text-primary-600"
            >
              View <ChevronRight size={12} />
            </Link>
            {isSuperadmin && c.role !== "superadmin" && !isSelf ? (
              <button
                type="button"
                onClick={() => setPromotingCandidate(c)}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-primary-300 hover:bg-primary-500/5 hover:text-primary-600"
              >
                <UserCog size={12} /> Role
              </button>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Candidates"
        badge={total ? `${total} total` : undefined}
        description="Search, filter, and drill into every candidate's interview activity."
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {/* Search */}
        <div className="relative w-full lg:max-w-sm">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by name or email…"
            className="w-full rounded-xl border border-border bg-background-card py-2.5 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500/50"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Role tabs */}
          <div className="flex gap-1 rounded-xl border border-border bg-background-surface p-1">
            {ROLE_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => { setRoleFilter(tab.value); setPage(1); }}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  roleFilter === tab.value
                    ? "bg-primary-500 text-white shadow-sm"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Track filter */}
          <select
            value={trackFilter}
            onChange={(e) => { setTrackFilter(e.target.value); setPage(1); }}
            className="rounded-xl border border-border bg-background-card px-3 py-2.5 text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500/50"
          >
            <option value="all">All tracks</option>
            {(tracks ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={candidates}
        loading={isLoading}
        error={isError}
        onRetry={() => refetch()}
        emptyMessage={
          hasFilters ? (
            <span className="flex flex-col items-center gap-3">
              <span className="text-text-muted">No candidates match your search.</span>
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-text-secondary transition-colors hover:bg-background-surface"
              >
                Clear filters
              </button>
            </span>
          ) : (
            "No candidates yet."
          )
        }
      />

      {!isLoading && !isError && (
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>Page {data?.page ?? page} of {pages} · {total} candidates</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((c) => Math.max(c - 1, 1))}
              disabled={page <= 1}
              className="rounded-lg border border-border px-3 py-1.5 font-medium transition-colors hover:bg-background-surface disabled:opacity-40"
            >
              ← Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((c) => Math.min(c + 1, pages))}
              disabled={page >= pages}
              className="rounded-lg border border-border px-3 py-1.5 font-medium transition-colors hover:bg-background-surface disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {promotingCandidate ? (
        <PromoteUserModal
          user={toAdminUser(promotingCandidate)}
          isOpen={!!promotingCandidate}
          onClose={() => setPromotingCandidate(null)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["admin-candidates"] });
            setPromotingCandidate(null);
          }}
        />
      ) : null}
    </div>
  );
}

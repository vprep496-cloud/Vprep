"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { ChevronRight, Search } from "lucide-react";

import { adminApi } from "@/lib/api";
import { TRACK_OPTIONS } from "@/lib/tracks";
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

// `PromoteUserModal` expects `AdminUser` (it needs `backendUserId` to post to
// `/auth/promote`). `CandidateListItem.id` IS that backend user id — it's
// `_serialize(user)["id"]` straight off `admin.py`'s `/candidates` route — so
// this is a structural widen, not a remapping (mirrors `toAdminUser` in
// `users/page.tsx`, just starting from a richer source shape).
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

// Phase 6 — searchable/filterable candidate directory. Built on
// `adminApi.getCandidates` (`GET /admin/candidates`), which — unlike
// `/admin/users` (Phase 2's role-management list) — enriches each row with
// interview-specific stats (`enrollmentCount`/`sessionCount`/`averageScore`)
// and supports a `track_id` filter, so this page can do double duty as both
// "find a candidate" and "see who's engaging with track X."
export default function CandidatesPage() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const isSuperadmin = session?.user?.role === "superadmin";

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [trackFilter, setTrackFilter] = useState<string>("all");
  const [promotingCandidate, setPromotingCandidate] = useState<CandidateListItem | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-candidates", { page, search, roleFilter, trackFilter }],
    queryFn: () =>
      adminApi.getCandidates({
        page,
        limit: PAGE_SIZE,
        search: search || undefined,
        role: roleFilter !== "all" ? roleFilter : undefined,
        trackId: trackFilter !== "all" ? trackFilter : undefined,
      }),
  });

  const candidates = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;
  const pages = data?.pages ?? 1;

  const columns: DataTableColumn<CandidateListItem>[] = [
    {
      key: "name",
      label: "Candidate",
      render: (candidate) => (
        <Link href={`/candidates/${candidate.id}`} className="group flex items-center gap-3">
          {candidate.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- external Google avatar URL
            <img src={candidate.image} alt={candidate.name} className="h-8 w-8 rounded-full" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-background-surface text-xs font-semibold text-text-primary">
              {candidate.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <p className="font-medium text-text-primary group-hover:underline">{candidate.name}</p>
            <p className="text-xs text-text-muted">{candidate.email}</p>
          </div>
        </Link>
      ),
    },
    {
      key: "role",
      label: "Role",
      render: (candidate) => <RoleBadge role={candidate.role} />,
    },
    {
      key: "enrollmentCount",
      label: "Enrollments",
      render: (candidate) => <span className="text-text-secondary">{candidate.enrollmentCount}</span>,
    },
    {
      key: "sessionCount",
      label: "Sessions",
      render: (candidate) => <span className="text-text-secondary">{candidate.sessionCount}</span>,
    },
    {
      key: "averageScore",
      label: "Avg Score",
      render: (candidate) => <ScoreBadge score={candidate.averageScore} />,
    },
    {
      key: "createdAt",
      label: "Joined",
      render: (candidate) =>
        new Date(candidate.createdAt).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        }),
    },
    {
      key: "actions",
      label: "Actions",
      render: (candidate) => {
        const isSelf = candidate.id === session?.user?.backendUserId;
        return (
          <div className="flex items-center gap-2">
            <Link
              href={`/candidates/${candidate.id}`}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-background-surface hover:text-text-primary"
            >
              View <ChevronRight size={13} />
            </Link>
            {/* Agent Rule #7: promotion is a superadmin-only action — backend
                enforces it via `require_role("superadmin")` on `/auth/promote`,
                so a plain admin clicking this would only ever see a 403. HIDE
                it for them rather than show-then-fail (a deliberate
                improvement over `users/page.tsx`'s Phase-2 button, which this
                phase isn't permitted to modify — see that file's Actions
                column for the un-gated precedent this page intentionally
                departs from). */}
            {isSuperadmin && candidate.role !== "superadmin" && !isSelf ? (
              <button
                type="button"
                onClick={() => setPromotingCandidate(candidate)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-background-surface hover:text-text-primary"
              >
                Promote
              </button>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Candidates"
        badge={`${total} total`}
        description="Search, filter, and drill into every candidate's interview activity."
      />

      <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-xs">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search by name or email"
            className="w-full rounded-xl border border-border bg-background-card py-2.5 pl-10 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex gap-1.5 rounded-xl border border-border bg-background-card p-1">
            {ROLE_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => {
                  setRoleFilter(tab.value);
                  setPage(1);
                }}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  roleFilter === tab.value
                    ? "bg-primary-500 text-white"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <select
            value={trackFilter}
            onChange={(event) => {
              setTrackFilter(event.target.value);
              setPage(1);
            }}
            className="rounded-xl border border-border bg-background-card px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="all">All tracks</option>
            {TRACK_OPTIONS.map((track) => (
              <option key={track.id} value={track.id}>
                {track.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-6">
        <DataTable
          columns={columns}
          data={candidates}
          loading={isLoading}
          emptyMessage={
            // Phase 7 spec: "empty search state shows 'No candidates match your
            // search' with a clear filters button."
            search || roleFilter !== "all" || trackFilter !== "all" ? (
              <span className="flex flex-col items-center gap-3">
                <span className="text-text-muted">No candidates match your search.</span>
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setRoleFilter("all");
                    setTrackFilter("all");
                    setPage(1);
                  }}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-background-surface hover:text-text-primary"
                >
                  Clear filters
                </button>
              </span>
            ) : (
              "No candidates yet."
            )
          }
        />
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-text-secondary">
        <span>
          Page {data?.page ?? page} of {pages}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(current - 1, 1))}
            disabled={page <= 1}
            className="rounded-lg border border-border px-3 py-1.5 font-medium transition-colors hover:bg-background-surface disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(current + 1, pages))}
            disabled={page >= pages}
            className="rounded-lg border border-border px-3 py-1.5 font-medium transition-colors hover:bg-background-surface disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      {promotingCandidate ? (
        <PromoteUserModal
          user={toAdminUser(promotingCandidate)}
          isOpen={!!promotingCandidate}
          onClose={() => setPromotingCandidate(null)}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ["admin-candidates"] })}
        />
      ) : null}
    </div>
  );
}

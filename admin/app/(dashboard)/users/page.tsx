"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { Search } from "lucide-react";
import api from "@/lib/api";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable";
import RoleBadge from "@/components/ui/RoleBadge";
import PromoteUserModal from "@/components/modals/PromoteUserModal";
import type { AdminUser, UserRole } from "@/types";

type RoleFilter = "all" | UserRole;

const ROLE_TABS: { value: RoleFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "candidate", label: "Candidates" },
  { value: "admin", label: "Admins" },
  { value: "superadmin", label: "Superadmins" },
];

const ROLE_LABEL: Record<UserRole, string> = {
  candidate: "Candidate",
  admin: "Admin",
  superadmin: "Superadmin",
};

const PAGE_SIZE = 20;

// Shape returned by FastAPI's GET /api/v1/users — converted to AdminUser
// (the shape PromoteUserModal and the rest of the admin UI expect) below.
interface BackendUser {
  id: string;
  email: string;
  display_name: string;
  photo_url: string | null;
  role: UserRole;
  created_at: string;
}

interface UsersResponse {
  users: BackendUser[];
  total: number;
  page: number;
  pages: number;
}

function toAdminUser(user: BackendUser): AdminUser {
  return {
    id: user.id,
    backendUserId: user.id,
    email: user.email,
    name: user.display_name,
    image: user.photo_url,
    role: user.role,
    createdAt: user.created_at,
  };
}

export default function UsersPage() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [promotingUser, setPromotingUser] = useState<AdminUser | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users", { page, search, roleFilter }],
    queryFn: async () => {
      const { data } = await api.get<UsersResponse>("/api/v1/users", {
        params: {
          page,
          limit: PAGE_SIZE,
          ...(search ? { search } : {}),
          ...(roleFilter !== "all" ? { role: roleFilter } : {}),
        },
      });
      return data;
    },
  });

  const users = useMemo(() => (data?.users ?? []).map(toAdminUser), [data]);
  const total = data?.total ?? 0;
  const pages = data?.pages ?? 1;

  const columns: DataTableColumn<AdminUser>[] = [
    {
      key: "name",
      label: "Name",
      render: (user) => (
        <div className="flex items-center gap-3">
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- external Google avatar URL
            <img src={user.image} alt={user.name} className="h-8 w-8 rounded-full" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-background-surface text-xs font-semibold text-text-primary">
              {user.name.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="font-medium text-text-primary">{user.name}</span>
        </div>
      ),
    },
    { key: "email", label: "Email" },
    {
      key: "role",
      label: "Role",
      render: (user) => <RoleBadge role={user.role} />,
    },
    {
      key: "createdAt",
      label: "Joined",
      render: (user) =>
        user.createdAt
          ? new Date(user.createdAt).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })
          : "—",
    },
    {
      key: "actions",
      label: "Actions",
      render: (user) => {
        const isSelf = user.backendUserId === session?.user?.backendUserId;
        if (user.role === "superadmin" || isSelf) return null;
        return (
          <button
            type="button"
            onClick={() => setPromotingUser(user)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-background-surface hover:text-text-primary"
          >
            Promote
          </button>
        );
      },
    },
  ];

  return (
    <div>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-text-primary">Users</h1>
        <span className="rounded-full bg-background-card px-2.5 py-1 text-xs font-semibold text-text-secondary">
          {total} total
        </span>
      </div>
      <p className="mt-1 text-sm text-text-secondary">
        Search, filter, and manage every V-Prep account.
      </p>

      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
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
      </div>

      <div className="mt-6">
        <DataTable
          columns={columns}
          data={users}
          loading={isLoading}
          emptyMessage="No users match your filters"
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

      {promotingUser ? (
        <PromoteUserModal
          user={promotingUser}
          isOpen={!!promotingUser}
          onClose={() => setPromotingUser(null)}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ["admin-users"] })}
        />
      ) : null}
    </div>
  );
}

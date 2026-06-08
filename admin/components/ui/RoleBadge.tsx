import type { UserRole } from "@/types";

const ROLE_STYLES: Record<UserRole, string> = {
  candidate: "bg-background-surface text-text-secondary",
  admin: "bg-warning/15 text-warning",
  superadmin: "bg-danger/15 text-danger",
};

const ROLE_LABEL: Record<UserRole, string> = {
  candidate: "Candidate",
  admin: "Admin",
  superadmin: "Superadmin",
};

export default function RoleBadge({ role }: { role: UserRole }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${ROLE_STYLES[role]}`}
    >
      {ROLE_LABEL[role]}
    </span>
  );
}

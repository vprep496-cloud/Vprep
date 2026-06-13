import type { UserRole } from "@/types";

const ROLE_CONFIG: Record<UserRole, { label: string; className: string }> = {
  candidate: {
    label: "Candidate",
    className: "bg-sky-500/10 text-sky-600 ring-sky-500/20",
  },
  admin: {
    label: "Admin",
    className: "bg-amber-500/10 text-amber-600 ring-amber-500/20",
  },
  superadmin: {
    label: "Superadmin",
    className: "bg-purple-500/10 text-purple-600 ring-purple-500/20",
  },
};

export default function RoleBadge({ role }: { role: UserRole }) {
  const config = ROLE_CONFIG[role] ?? ROLE_CONFIG.candidate;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${config.className}`}
    >
      {config.label}
    </span>
  );
}

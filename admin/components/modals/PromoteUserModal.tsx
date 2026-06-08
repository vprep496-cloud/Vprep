"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import axios from "axios";
import { Loader2 } from "lucide-react";
import api from "@/lib/api";
import type { AdminUser, UserRole } from "@/types";

interface PromoteUserModalProps {
  user: AdminUser;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const ALL_ROLES: UserRole[] = ["candidate", "admin", "superadmin"];

const ROLE_LABEL: Record<UserRole, string> = {
  candidate: "Candidate",
  admin: "Admin",
  superadmin: "Superadmin",
};

export default function PromoteUserModal({ user, isOpen, onClose, onSuccess }: PromoteUserModalProps) {
  const { data: session } = useSession();
  const isSuperadmin = session?.user?.role === "superadmin";

  // Never offer the user's current role, and never offer "superadmin" unless
  // the acting admin is themselves a superadmin.
  const roleOptions = ALL_ROLES.filter(
    (role) => role !== user.role && (role !== "superadmin" || isSuperadmin)
  );

  const [selectedRole, setSelectedRole] = useState<UserRole | "">(roleOptions[0] ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!selectedRole) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await api.post("/api/v1/auth/promote", {
        target_user_id: user.backendUserId,
        role: selectedRole,
      });
      onSuccess();
      onClose();
    } catch (err) {
      const detail = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      setError(typeof detail === "string" ? detail : "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Wrapped in a min-height parent so the layout height stays stable whether
  // or not the fixed-position overlay is currently rendered (keeps embedding
  // contexts such as iframes from collapsing/jumping).
  return (
    <div style={{ minHeight: 500 }}>
      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-background-card p-6 shadow-xl">
            <h2 className="text-lg font-bold text-text-primary">Change Role</h2>
            <p className="mt-1 text-sm text-text-secondary">
              {user.name} — currently{" "}
              <span className="font-semibold text-text-primary">{ROLE_LABEL[user.role]}</span>
            </p>

            <label className="mt-5 block text-sm font-medium text-text-secondary">
              New Role
              <select
                value={selectedRole}
                onChange={(event) => setSelectedRole(event.target.value as UserRole)}
                className="mt-1.5 w-full rounded-xl border border-border bg-background-surface px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {roleOptions.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABEL[role]}
                  </option>
                ))}
              </select>
            </label>

            <p className="mt-4 rounded-xl bg-warning/10 px-3 py-2.5 text-sm text-warning">
              This action changes the user&apos;s access level immediately.
            </p>

            {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-background-surface disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isSubmitting || !selectedRole}
                className="flex items-center gap-2 rounded-xl bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-600 disabled:opacity-50"
              >
                {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : null}
                Confirm Change
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

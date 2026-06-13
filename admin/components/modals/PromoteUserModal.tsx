"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import axios from "axios";
import { Loader2, ShieldCheck, X } from "lucide-react";
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

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-background-card shadow-xl">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-500/10">
                <ShieldCheck size={16} className="text-primary-600" />
              </div>
              <div>
                <h2 className="text-base font-bold text-text-primary">Change Role</h2>
                <p className="text-xs text-text-muted">
                  {user.name} · currently{" "}
                  <span className="font-semibold text-text-secondary">{ROLE_LABEL[user.role]}</span>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-background-surface hover:text-text-primary disabled:opacity-50"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="px-6 py-5">
            <label className="block text-sm font-medium text-text-secondary">
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

            <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-warning/25 bg-warning/10 px-4 py-3">
              <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warning" />
              <p className="text-sm text-warning">
                This changes the user&apos;s access level immediately and cannot be undone without another role change.
              </p>
            </div>

            {error ? (
              <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3">
                <div className="h-2 w-2 shrink-0 rounded-full bg-danger" />
                <p className="text-sm text-danger">{error}</p>
              </div>
            ) : null}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
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
              {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              Confirm Change
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

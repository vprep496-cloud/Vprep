"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import axios from "axios";
import { AlertTriangle, Eye, Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import { adminApi } from "@/lib/api";
import { PHASE_OPTIONS, TRACK_NAMES, TRACK_OPTIONS } from "@/lib/tracks";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable";
import PageHeader from "@/components/ui/PageHeader";
import AddQuestionModal from "@/components/modals/AddQuestionModal";
import EditQuestionModal from "@/components/modals/EditQuestionModal";
import type { AdminQuestion } from "@/types";

const PAGE_SIZE = 25;

const PHASE_LABEL: Record<string, string> = Object.fromEntries(PHASE_OPTIONS.map((p) => [p.value, p.label]));
const DIFFICULTY_STYLES: Record<string, string> = {
  easy: "bg-success/15 text-success",
  medium: "bg-warning/15 text-warning",
  hard: "bg-danger/15 text-danger",
};

// Phase 7 spec: "Phase badge: HR = blue, Technical = purple, Behavioral = green"
const PHASE_STYLES: Record<string, string> = {
  hr: "bg-sky-500/15 text-sky-400",
  technical: "bg-purple-500/15 text-purple-400",
  behavioral: "bg-success/15 text-success",
};

function DeleteQuestionDialog({
  question,
  onClose,
  onDeleted,
}: {
  question: AdminQuestion;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await adminApi.deleteQuestion(question.id);
      onDeleted();
      onClose();
    } catch (err) {
      // Agent Rule #5: `admin.py`'s DELETE checks whether this question has
      // been used in any completed session and responds 400 rather than
      // deleting — surface that explanation verbatim instead of a generic error.
      const detail = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      setError(typeof detail === "string" ? detail : "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: 500 }}>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-background-card p-6 shadow-xl">
          <h2 className="text-lg font-bold text-text-primary">Delete Question</h2>
          <p className="mt-2 text-sm text-text-secondary">
            This permanently removes &ldquo;{question.questionText.slice(0, 96)}
            {question.questionText.length > 96 ? "…" : ""}&rdquo; from the {TRACK_NAMES[question.trackId] ?? question.trackId} bank.
          </p>
          <p className="mt-3 rounded-xl bg-warning/10 px-3 py-2.5 text-sm text-warning">
            This cannot be undone. Questions already used in a completed interview can&apos;t be deleted.
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
              onClick={handleDelete}
              disabled={isSubmitting}
              className="flex items-center gap-2 rounded-xl bg-danger px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-danger/90 disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={15} />}
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Phase 6 — question bank manager. Read access is shared (admin +
// superadmin, per Agent Rule #3's base `require_role`), but every mutation
// (`POST`/`PUT`/`DELETE /admin/questions*`) is `require_role("superadmin")`
// only. Per Agent Rule #7, the Add/Edit/Delete controls are HIDDEN — not
// disabled — for plain admins; they instead see a "View Only" badge next to
// the page title so the read-only mode is self-explanatory rather than silent.
export default function QuestionsPage() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const isSuperadmin = session?.user?.role === "superadmin";

  const [page, setPage] = useState(1);
  const [phaseFilter, setPhaseFilter] = useState<string>("all");
  const [trackFilter, setTrackFilter] = useState<string>("all");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<AdminQuestion | null>(null);
  const [deletingQuestion, setDeletingQuestion] = useState<AdminQuestion | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-questions", { page, phaseFilter, trackFilter }],
    queryFn: () =>
      adminApi.getQuestions({
        page,
        limit: PAGE_SIZE,
        phase: phaseFilter !== "all" ? phaseFilter : undefined,
        trackId: trackFilter !== "all" ? trackFilter : undefined,
      }),
  });

  const questions = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;
  const pages = data?.pages ?? 1;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-questions"] });

  const columns: DataTableColumn<AdminQuestion>[] = [
    {
      key: "questionText",
      label: "Question",
      render: (question) => {
        const isExpanded = expandedId === question.id;
        return (
          <button
            type="button"
            onClick={() => setExpandedId((current) => (current === question.id ? null : question.id))}
            className="group flex max-w-md items-start gap-2 text-left"
          >
            <Eye size={14} className="mt-0.5 shrink-0 text-text-muted group-hover:text-text-secondary" />
            <span className={`text-sm text-text-primary ${isExpanded ? "" : "line-clamp-2"}`}>
              {question.questionText}
            </span>
          </button>
        );
      },
    },
    {
      key: "trackId",
      label: "Track",
      render: (question) => <span className="text-text-secondary">{TRACK_NAMES[question.trackId] ?? question.trackId}</span>,
    },
    {
      key: "phase",
      label: "Phase",
      // Phase 7 spec: "Phase badge: HR = blue, Technical = purple, Behavioral = green"
      render: (question) => (
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${PHASE_STYLES[question.phase] ?? "bg-background-surface text-text-secondary"}`}>
          {PHASE_LABEL[question.phase] ?? question.phase}
        </span>
      ),
    },
    {
      key: "difficulty",
      label: "Difficulty",
      render: (question) => (
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${DIFFICULTY_STYLES[question.difficulty] ?? "bg-background-surface text-text-secondary"}`}>
          {question.difficulty}
        </span>
      ),
    },
    {
      key: "answerType",
      label: "Answer",
      render: (question) => (
        <span className="text-xs text-text-muted">{question.answerType === "voice" ? "Voice" : "Typed"}</span>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      render: (question) => {
        // Agent Rule #7 — hidden (not disabled) for plain admins.
        if (!isSuperadmin) return null;
        return (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditingQuestion(question)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-background-surface hover:text-text-primary"
            >
              <Pencil size={13} />
              Edit
            </button>
            <button
              type="button"
              onClick={() => setDeletingQuestion(question)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/10"
            >
              <Trash2 size={13} />
              Delete
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Question Bank"
        badge={`${total} total`}
        description="Browse every interview question across all tracks and phases."
        actions={
          isSuperadmin ? (
            <button
              type="button"
              onClick={() => setIsAddOpen(true)}
              className="flex items-center gap-2 rounded-xl bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-600"
            >
              <Plus size={16} />
              Add Question
            </button>
          ) : null
        }
      />

      {/* Phase 7 spec: "View Only" banner for non-superadmin admins — use an
          amber info banner at the TOP of the page (not just a badge in the
          header) so it's unmissable. Kept outside PageHeader so it sits flush
          below the title rather than inline with the action button slot. */}
      {!isSuperadmin ? (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3">
          <AlertTriangle size={16} className="shrink-0 text-warning" />
          <p className="text-sm text-warning">
            <span className="font-semibold">View Only</span> — only superadmins can add, edit, or delete questions.
          </p>
        </div>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <select
          value={phaseFilter}
          onChange={(event) => {
            setPhaseFilter(event.target.value);
            setPage(1);
          }}
          className="rounded-xl border border-border bg-background-card px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="all">All phases</option>
          {PHASE_OPTIONS.map((phase) => (
            <option key={phase.value} value={phase.value}>
              {phase.label}
            </option>
          ))}
        </select>

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

        <p className="text-xs text-text-muted sm:ml-auto">Click a question to expand its full text.</p>
      </div>

      <div className="mt-6">
        <DataTable columns={columns} data={questions} loading={isLoading} emptyMessage="No questions match your filters" />
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

      {/* Agent Rule #7: these three modals/dialogs are only ever mounted when
          `isSuperadmin` is true (the buttons that set their state don't
          render otherwise) — so this isn't a "render but gate" pattern, the
          superadmin-only surfaces simply don't exist in the DOM for admins. */}
      {isAddOpen ? (
        <AddQuestionModal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} onSuccess={invalidate} />
      ) : null}
      {editingQuestion ? (
        <EditQuestionModal
          question={editingQuestion}
          isOpen={!!editingQuestion}
          onClose={() => setEditingQuestion(null)}
          onSuccess={invalidate}
        />
      ) : null}
      {deletingQuestion ? (
        <DeleteQuestionDialog question={deletingQuestion} onClose={() => setDeletingQuestion(null)} onDeleted={invalidate} />
      ) : null}
    </div>
  );
}

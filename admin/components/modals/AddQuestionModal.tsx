"use client";

import { useState } from "react";
import axios from "axios";
import { Loader2, PlusCircle, X } from "lucide-react";

import { adminApi } from "@/lib/api";
import { ANSWER_TYPE_BY_PHASE, DIFFICULTY_OPTIONS, PHASE_OPTIONS, type TrackOption } from "@/lib/tracks";
import type { Difficulty, InterviewPhase, QuestionInput, TrackId } from "@/types";

interface AddQuestionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  trackOptions: TrackOption[];
}

interface FormState {
  trackId: TrackId | "";
  phase: InterviewPhase | "";
  questionText: string;
  difficulty: Difficulty | "";
  scoringCriteria: string; // one criterion per line in the textarea
  modelAnswer: string;
  tags: string; // comma-separated in the input
}

const EMPTY_FORM: FormState = {
  trackId: "",
  phase: "",
  questionText: "",
  difficulty: "",
  scoringCriteria: "",
  modelAnswer: "",
  tags: "",
};

const FIELD_CLASS =
  "mt-1.5 w-full rounded-xl border border-border bg-background-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500";
const LABEL_CLASS = "block text-sm font-medium text-text-secondary";

function linesToList(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function csvToList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

// Phase 6 — superadmin-only "Add Question" form (Agent Rule #7: this modal is
// only ever mounted from `questions/page.tsx` behind a
// `session.user.role === "superadmin"` check — not rendered-but-disabled for
// plain admins). Mirrors `PromoteUserModal`'s overlay/loading/error shape.
//
// Judgment call: `answer_type` is intentionally NOT a field here. `admin.py`'s
// `_validate_question_fields` hard-requires `answer_type` to match a fixed
// mapping per `phase` — voice for HR/Behavioral, text for Technical — and
// rejects any mismatch. Rather than expose a control whose only valid value is
// dictated by another field, the form derives it from `phase` via
// `ANSWER_TYPE_BY_PHASE` and surfaces it as a read-only badge.
export default function AddQuestionModal({ isOpen, onClose, onSuccess, trackOptions }: AddQuestionModalProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const derivedAnswerType = form.phase ? ANSWER_TYPE_BY_PHASE[form.phase] : null;

  // HR and Behavioral questions can be shared across all tracks (track_id = "all").
  // Technical and Coding Logic questions must belong to a specific track.
  const allowsAllTrack = form.phase === "hr" || form.phase === "behavioral";
  const filteredTrackOptions = trackOptions.filter(
    (track) => track.id !== "all" || allowsAllTrack
  );

  const isValid =
    form.trackId !== "" &&
    form.phase !== "" &&
    form.questionText.trim().length > 0 &&
    form.difficulty !== "" &&
    linesToList(form.scoringCriteria).length > 0 &&
    form.modelAnswer.trim().length > 0;

  const reset = () => {
    setForm(EMPTY_FORM);
    setError(null);
  };

  const handleClose = () => {
    if (isSubmitting) return;
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!isValid || !form.phase || !derivedAnswerType) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const payload: QuestionInput = {
        trackId: form.trackId,
        phase: form.phase,
        questionText: form.questionText.trim(),
        answerType: derivedAnswerType,
        difficulty: form.difficulty,
        scoringCriteria: linesToList(form.scoringCriteria),
        modelAnswer: form.modelAnswer.trim(),
        tags: csvToList(form.tags),
      };
      await adminApi.createQuestion(payload);
      onSuccess();
      reset();
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
      <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4">
        <div className="w-full max-w-xl rounded-2xl border border-border bg-background-card shadow-xl">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-500/10">
                <PlusCircle size={16} className="text-primary-600" />
              </div>
              <div>
                <h2 className="text-base font-bold text-text-primary">Add Question</h2>
                <p className="text-xs text-text-muted">Add a new question to the interview bank</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-background-surface hover:text-text-primary disabled:opacity-50"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className={LABEL_CLASS}>
                Track
                <select
                  value={form.trackId}
                  onChange={(event) => update("trackId", event.target.value as TrackId)}
                  className={FIELD_CLASS}
                >
                  <option value="" disabled>
                    Select a track
                  </option>
                  {filteredTrackOptions.map((track) => (
                    <option key={track.id} value={track.id}>
                      {track.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className={LABEL_CLASS}>
                Phase
                <select
                  value={form.phase}
                  onChange={(event) => update("phase", event.target.value as InterviewPhase)}
                  className={FIELD_CLASS}
                >
                  <option value="" disabled>
                    Select a phase
                  </option>
                  {PHASE_OPTIONS.map((phase) => (
                    <option key={phase.value} value={phase.value}>
                      {phase.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {derivedAnswerType ? (
              <p className="mt-3 rounded-lg bg-background-surface px-3 py-2 text-xs text-text-muted">
                Answer type for this phase is fixed:{" "}
                <span className="font-semibold text-text-secondary">
                  {derivedAnswerType === "voice"
                    ? "Voice response"
                    : derivedAnswerType === "image"
                      ? "Image upload"
                      : "Typed response"}
                </span>
              </p>
            ) : null}

            <label className={`${LABEL_CLASS} mt-4`}>
              Question Text
              <textarea
                value={form.questionText}
                onChange={(event) => update("questionText", event.target.value)}
                rows={2}
                placeholder="e.g. Tell me about a time you disagreed with a teammate's technical decision."
                className={`${FIELD_CLASS} resize-none`}
              />
            </label>

            <label className={`${LABEL_CLASS} mt-4`}>
              Difficulty
              <select
                value={form.difficulty}
                onChange={(event) => update("difficulty", event.target.value as Difficulty)}
                className={FIELD_CLASS}
              >
                <option value="" disabled>
                  Select difficulty
                </option>
                {DIFFICULTY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className={`${LABEL_CLASS} mt-4`}>
              Scoring Criteria <span className="text-text-muted">(one per line)</span>
              <textarea
                value={form.scoringCriteria}
                onChange={(event) => update("scoringCriteria", event.target.value)}
                rows={3}
                placeholder={"Clarity of communication\nUse of a concrete example\nReflection / lesson learned"}
                className={`${FIELD_CLASS} resize-none font-mono`}
              />
            </label>

            <label className={`${LABEL_CLASS} mt-4`}>
              Model Answer{" "}
              <span className="text-text-muted">(rubric the AI scores against — never shown to candidates)</span>
              <textarea
                value={form.modelAnswer}
                onChange={(event) => update("modelAnswer", event.target.value)}
                rows={3}
                className={`${FIELD_CLASS} resize-none`}
              />
            </label>

            <label className={`${LABEL_CLASS} mt-4`}>
              Tags <span className="text-text-muted">(comma-separated, optional)</span>
              <input
                type="text"
                value={form.tags}
                onChange={(event) => update("tags", event.target.value)}
                placeholder="communication, conflict-resolution"
                className={FIELD_CLASS}
              />
            </label>

            {error ? (
              <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3">
                <div className="h-2 w-2 shrink-0 rounded-full bg-danger" />
                <p className="text-sm text-danger">{error}</p>
              </div>
            ) : null}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-background-surface disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || !isValid}
              className="flex items-center gap-2 rounded-xl bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-600 disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <PlusCircle size={16} />}
              Add Question
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

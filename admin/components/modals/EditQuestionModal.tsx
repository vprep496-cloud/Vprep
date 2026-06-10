"use client";

import { useState } from "react";
import axios from "axios";
import { Loader2 } from "lucide-react";

import { adminApi } from "@/lib/api";
import { ANSWER_TYPE_BY_PHASE, DIFFICULTY_OPTIONS, PHASE_OPTIONS, type TrackOption } from "@/lib/tracks";
import type { AdminQuestion, Difficulty, InterviewPhase, QuestionInput, TrackId } from "@/types";

interface EditQuestionModalProps {
  question: AdminQuestion;
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
  scoringCriteria: string;
  modelAnswer: string;
  tags: string;
}

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

function toFormState(question: AdminQuestion): FormState {
  return {
    trackId: question.trackId,
    phase: question.phase,
    questionText: question.questionText,
    difficulty: question.difficulty,
    scoringCriteria: question.scoringCriteria.join("\n"),
    modelAnswer: question.modelAnswer,
    tags: question.tags.join(", "),
  };
}

// Phase 6 — superadmin-only "Edit Question" form. Structurally a near-twin of
// `AddQuestionModal` (same field set, same `answer_type`-derived-from-`phase`
// judgment call — see that file's comment for the full rationale), but kept
// as its own component per the spec's file tree rather than parameterizing
// one shared modal: the two have different lifecycles (uncontrolled blank
// form vs. an externally-supplied `question` to seed from and diff against)
// and ​Agent Rule #2 only asked for these two file *targets*, not an
// internal refactor of how they're composed.
//
// Sends only the fields that changed — `admin.py`'s `PUT /questions/{id}`
// uses `payload.model_dump(exclude_none=True)` and re-validates the
// *resulting* phase/answer_type combination, so a partial diff is exactly
// what it expects (and keeps `updated_at` semantics meaningful).
export default function EditQuestionModal({ question, isOpen, onClose, onSuccess, trackOptions }: EditQuestionModalProps) {
  const [form, setForm] = useState<FormState>(() => toFormState(question));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const derivedAnswerType = form.phase ? ANSWER_TYPE_BY_PHASE[form.phase] : null;

  const isValid =
    form.trackId !== "" &&
    form.phase !== "" &&
    form.questionText.trim().length > 0 &&
    form.difficulty !== "" &&
    linesToList(form.scoringCriteria).length > 0 &&
    form.modelAnswer.trim().length > 0;

  const handleClose = () => {
    if (isSubmitting) return;
    setError(null);
    onClose();
  };

  const handleSubmit = async () => {
    if (!isValid || !form.phase || !derivedAnswerType) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const diff: Partial<QuestionInput> = {};
      const scoringCriteria = linesToList(form.scoringCriteria);
      const tags = csvToList(form.tags);

      if (form.trackId !== question.trackId) diff.trackId = form.trackId;
      if (form.phase !== question.phase) diff.phase = form.phase;
      if (derivedAnswerType !== question.answerType) diff.answerType = derivedAnswerType;
      if (form.questionText.trim() !== question.questionText) diff.questionText = form.questionText.trim();
      if (form.difficulty !== question.difficulty) diff.difficulty = form.difficulty;
      if (JSON.stringify(scoringCriteria) !== JSON.stringify(question.scoringCriteria)) {
        diff.scoringCriteria = scoringCriteria;
      }
      if (form.modelAnswer.trim() !== question.modelAnswer) diff.modelAnswer = form.modelAnswer.trim();
      if (JSON.stringify(tags) !== JSON.stringify(question.tags)) diff.tags = tags;

      await adminApi.updateQuestion(question.id, diff);
      onSuccess();
      onClose();
    } catch (err) {
      const detail = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      setError(typeof detail === "string" ? detail : "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: 500 }}>
      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl rounded-2xl border border-border bg-background-card p-6 shadow-xl">
            <h2 className="text-lg font-bold text-text-primary">Edit Question</h2>
            <p className="mt-1 text-sm text-text-secondary">
              Update this question's content, rubric, or classification.
            </p>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className={LABEL_CLASS}>
                Track
                <select
                  value={form.trackId}
                  onChange={(event) => update("trackId", event.target.value as TrackId)}
                  className={FIELD_CLASS}
                >
                  {trackOptions.map((track) => (
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
                  {PHASE_OPTIONS.map((phase) => (
                    <option key={phase.value} value={phase.value}>
                      {phase.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {derivedAnswerType ? (
              <p className="mt-3 text-xs text-text-muted">
                Answer type for this phase is fixed:{" "}
                <span className="font-semibold text-text-secondary">
                  {derivedAnswerType === "voice"
                    ? "Voice response"
                    : derivedAnswerType === "image"
                      ? "Image upload"
                      : "Typed response"}
                </span>
                {derivedAnswerType !== question.answerType ? (
                  <span className="text-warning">
                    {" "}
                    — changing from {question.answerType === "voice" ? "voice" : question.answerType === "image" ? "image" : "typed"}
                  </span>
                ) : null}
              </p>
            ) : null}

            <label className={`${LABEL_CLASS} mt-4`}>
              Question Text
              <textarea
                value={form.questionText}
                onChange={(event) => update("questionText", event.target.value)}
                rows={2}
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
                className={`${FIELD_CLASS} resize-none font-mono`}
              />
            </label>

            <label className={`${LABEL_CLASS} mt-4`}>
              Model Answer
              <textarea
                value={form.modelAnswer}
                onChange={(event) => update("modelAnswer", event.target.value)}
                rows={3}
                className={`${FIELD_CLASS} resize-none`}
              />
            </label>

            <label className={`${LABEL_CLASS} mt-4`}>
              Tags <span className="text-text-muted">(comma-separated)</span>
              <input
                type="text"
                value={form.tags}
                onChange={(event) => update("tags", event.target.value)}
                className={FIELD_CLASS}
              />
            </label>

            {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}

            <div className="mt-6 flex justify-end gap-3">
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
                {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : null}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

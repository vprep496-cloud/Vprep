"use client";

import { useState } from "react";
import axios from "axios";
import { Loader2, Pencil, Save, X } from "lucide-react";

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

function questionPlaceholder(phase: InterviewPhase | "") {
  if (phase === "coding_logic") {
    return "Handwrite pseudocode for a production-style task, such as retrying failed API writes with backoff, preserving order, and preventing duplicate submissions. Include input/output, one example, complexity, and edge cases.";
  }
  return "Write one realistic interviewer question.";
}

function criteriaPlaceholder(phase: InterviewPhase | "") {
  if (phase === "coding_logic") {
    return "problem_decomposition\nalgorithm_correctness\nedge_cases\ncomplexity_awareness\nclarity";
  }
  return "Clarity of communication\nUse of a concrete example\nReflection / lesson learned";
}

function modelAnswerPlaceholder(phase: InterviewPhase | "") {
  if (phase === "coding_logic") {
    return "Approach: describe the intended algorithm and data structures.\nCode: concise pseudocode or Python-like solution.\nComplexity: Time: O(...) | Space: O(...)\nEdge cases: list the important boundary cases.";
  }
  return "Describe the ideal answer or rubric points the AI should score against.";
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
// form vs. an externally-supplied `question` to seed from and diff against).
//
// Sends only the fields that changed — `admin.py`'s `PUT /questions/{id}`
// uses `payload.model_dump(exclude_none=True)` and re-validates the
// *resulting* phase/answer_type combination, so a partial diff is exactly
// what it expects.
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

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4">
        <div className="w-full max-w-xl rounded-2xl border border-border bg-background-card shadow-xl">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-500/10">
                <Pencil size={15} className="text-primary-600" />
              </div>
              <div>
                <h2 className="text-base font-bold text-text-primary">Edit Question</h2>
                <p className="text-xs text-text-muted">Update content, rubric, or classification</p>
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
              <p className="mt-3 rounded-lg bg-background-surface px-3 py-2 text-xs text-text-muted">
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
                    — changing from{" "}
                    {question.answerType === "voice" ? "voice" : question.answerType === "image" ? "image" : "typed"}
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
                placeholder={questionPlaceholder(form.phase)}
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
                placeholder={criteriaPlaceholder(form.phase)}
                className={`${FIELD_CLASS} resize-none font-mono`}
              />
            </label>

            <label className={`${LABEL_CLASS} mt-4`}>
              Model Answer
              <textarea
                value={form.modelAnswer}
                onChange={(event) => update("modelAnswer", event.target.value)}
                rows={3}
                placeholder={modelAnswerPlaceholder(form.phase)}
                className={`${FIELD_CLASS} resize-none`}
              />
            </label>

            <label className={`${LABEL_CLASS} mt-4`}>
              Tags <span className="text-text-muted">(comma-separated)</span>
              <input
                type="text"
                value={form.tags}
                onChange={(event) => update("tags", event.target.value)}
                placeholder={form.phase === "coding_logic" ? "retry, queue, complexity, handwritten" : "communication, conflict-resolution"}
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
              {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

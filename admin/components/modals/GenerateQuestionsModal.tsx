"use client";

import { useState } from "react";
import axios from "axios";
import { Code2, Loader2, Sparkles, X } from "lucide-react";

import { adminApi } from "@/lib/api";
import { DIFFICULTY_OPTIONS, PHASE_OPTIONS, type TrackOption } from "@/lib/tracks";
import type { Difficulty, InterviewPhase, QuestionGenerateInput, TrackId } from "@/types";

interface GenerateQuestionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (count: number) => void;
  trackOptions: TrackOption[];
}

interface FormState {
  trackId: TrackId | "";
  phase: InterviewPhase;
  count: number;
  difficulty: Difficulty | "";
  guidance: string;
}

const FIELD_CLASS =
  "mt-1.5 w-full rounded-xl border border-border bg-background-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500";
const LABEL_CLASS = "block text-sm font-medium text-text-secondary";

export default function GenerateQuestionsModal({
  isOpen,
  onClose,
  onSuccess,
  trackOptions,
}: GenerateQuestionsModalProps) {
  const [form, setForm] = useState<FormState>({
    trackId: trackOptions.find((track) => track.id !== "all")?.id ?? "",
    phase: "technical",
    count: 5,
    difficulty: "",
    guidance: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const isValid = form.trackId !== "" && form.count >= 1 && form.count <= 20;

  const handleClose = () => {
    if (isSubmitting) return;
    setError(null);
    onClose();
  };

  const handleSubmit = async () => {
    if (!isValid) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const payload: QuestionGenerateInput = {
        trackId: form.trackId,
        phase: form.phase,
        count: form.count,
        ...(form.difficulty ? { difficulty: form.difficulty } : {}),
        ...(form.guidance.trim() ? { guidance: form.guidance.trim() } : {}),
      };
      const questions = await adminApi.generateQuestions(payload);
      onSuccess(questions.length);
      onClose();
    } catch (err) {
      const detail = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      setError(typeof detail === "string" ? detail : "Local AI could not generate questions right now.");
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
                <Sparkles size={16} className="text-primary-600" />
              </div>
              <div>
                <h2 className="text-base font-bold text-text-primary">Generate Questions</h2>
                <p className="text-xs text-text-muted">AI-generate a batch and add to the question bank</p>
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
          <div className="px-6 py-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className={LABEL_CLASS}>
                Track
                <select
                  value={form.trackId}
                  onChange={(event) => update("trackId", event.target.value)}
                  className={FIELD_CLASS}
                >
                  <option value="" disabled>
                    Select a track
                  </option>
                  {trackOptions
                    .filter((track) => track.id !== "all")
                    .map((track) => (
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

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className={LABEL_CLASS}>
                Count
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={form.count}
                  onChange={(event) => update("count", Number(event.target.value))}
                  className={FIELD_CLASS}
                />
              </label>

              <label className={LABEL_CLASS}>
                Difficulty
                <select
                  value={form.difficulty}
                  onChange={(event) => update("difficulty", event.target.value as Difficulty | "")}
                  className={FIELD_CLASS}
                >
                  <option value="">Mixed</option>
                  {DIFFICULTY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className={`${LABEL_CLASS} mt-4`}>
              Guidance <span className="text-text-muted">(optional)</span>
              <textarea
                value={form.guidance}
                onChange={(event) => update("guidance", event.target.value)}
                rows={3}
                placeholder={
                  form.phase === "coding_logic"
                    ? "e.g. Generate professional handwritten coding tasks around offline sync, rate limits, retries, caching, routing, or data validation. Avoid toy/demo problems."
                    : "e.g. Focus on junior React Native candidates and practical debugging."
                }
                className={`${FIELD_CLASS} resize-none`}
              />
            </label>

            {form.phase === "coding_logic" ? (
              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
                <Code2 size={15} className="mt-0.5 shrink-0 text-sky-700" />
                <p className="text-sm leading-5 text-sky-900">
                  Coding generation is routed through the configured code-specialized model. Prompts are expected to be track-specific, hand-solvable, and scored on correctness, edge cases, complexity, and clarity.
                </p>
              </div>
            ) : null}

            {/* Warning when about to run LLM */}
            {isSubmitting ? (
              <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-primary-500/20 bg-primary-500/5 px-4 py-3">
                <Loader2 size={14} className="shrink-0 animate-spin text-primary-500" />
                <p className="text-sm text-primary-600">
                  Generating questions with local AI — this may take a moment…
                </p>
              </div>
            ) : null}

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
              {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              Generate
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

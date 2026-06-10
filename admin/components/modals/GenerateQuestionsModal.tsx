"use client";

import { useState } from "react";
import axios from "axios";
import { Loader2, Sparkles } from "lucide-react";

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
      setError(typeof detail === "string" ? detail : "Gemini could not generate questions right now.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: 500 }}>
      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl rounded-2xl border border-border bg-background-card p-6 shadow-xl">
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-primary-400" />
              <h2 className="text-lg font-bold text-text-primary">Generate Questions</h2>
            </div>
            <p className="mt-1 text-sm text-text-secondary">
              Create a Gemini-generated batch and save it directly to the question bank.
            </p>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                placeholder="e.g. Focus on junior React Native candidates and practical debugging."
                className={`${FIELD_CLASS} resize-none`}
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
                {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                Generate
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

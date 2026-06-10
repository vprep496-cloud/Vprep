import type { InterviewPhase, AnswerType, TrackId } from "@/types";

// Phase 6 — shared static track catalog for the admin portal's UI (track
// pickers in the question modals, the candidates/analytics track filters, and
// session-history track-name rendering). The admin app has no `GET /tracks`
// call of its own (and doesn't need one — the catalog is the same hardcoded
// six entries `backend/app/api/v1/tracks.py` serves, mirrored here exactly
// like `mobile/constants/theme.ts`'s `trackColors` mirrors that catalog's
// `color` field). Centralized in one module so the four+ places that need a
// track id -> display-name mapping don't each redeclare their own copy.

export interface TrackOption {
  id: TrackId;
  name: string;
}

export const TRACK_OPTIONS: TrackOption[] = [
  { id: "all", name: "Reusable HR/Behavioral" },
  { id: "ml_ai", name: "ML & AI" },
  { id: "web_dev", name: "Web Dev" },
  { id: "devops", name: "DevOps" },
  { id: "data_science", name: "Data Science" },
  { id: "cloud", name: "Cloud" },
  { id: "mobile_dev", name: "Mobile Dev" },
];

export const TRACK_NAMES: Record<string, string> = Object.fromEntries(
  TRACK_OPTIONS.map((track) => [track.id, track.name])
);

// Mirrors `admin.py`'s `_ANSWER_TYPE_BY_PHASE` / `_validate_question_fields`:
// each interview phase has exactly one valid `answer_type`, so the question
// forms derive (and lock) it from the chosen phase rather than collecting it
// as an independent field the backend would then reject on a mismatch.
export const ANSWER_TYPE_BY_PHASE: Record<InterviewPhase, AnswerType> = {
  hr: "voice",
  technical: "text",
  coding_logic: "image",
  behavioral: "voice",
};

export const PHASE_OPTIONS: { value: InterviewPhase; label: string }[] = [
  { value: "hr", label: "HR" },
  { value: "technical", label: "Technical" },
  { value: "coding_logic", label: "Coding Logic" },
  { value: "behavioral", label: "Behavioral" },
];

export const DIFFICULTY_OPTIONS: { value: "easy" | "medium" | "hard"; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

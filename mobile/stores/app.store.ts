import { create } from "zustand";
import type { Enrollment, TrackId } from "../types";

interface AppState {
  activeTrackId: TrackId | null;
  enrolledTrackIds: TrackId[];
  onboardingComplete: boolean;
  setActiveTrackId: (trackId: TrackId | null) => void;
  setEnrolledTrackIds: (trackIds: TrackId[]) => void;
  addEnrolledTrack: (trackId: TrackId) => void;
  setOnboardingComplete: (complete: boolean) => void;

  // --- Phase 4 additions -----------------------------------------------
  // `enrollments` is now the mobile-side source of truth for enrollment
  // state — full records (progress, skill level, joined track data,
  // plan_exists), not just bare ids. It's populated on login (root
  // `_layout.tsx` auth guard, after `getMe()` succeeds) and kept current by
  // the post-assessment auto-enroll flow, the tracks-screen enroll action,
  // and the plan-screen unenroll action.
  //
  // `enrolledTrackIds` above predates this and is still read by
  // `profile.tsx` (a Phase 1 file, not in this phase's MODIFY list) purely
  // as an "Enrolled Tracks" count. Rather than leave it to silently drift
  // out of sync with the new array, every mutator below re-derives it from
  // `enrollments` — so `profile.tsx` keeps working correctly untouched.
  enrollments: Enrollment[];
  setEnrollments: (enrollments: Enrollment[]) => void;
  addEnrollment: (enrollment: Enrollment) => void;
  removeEnrollment: (trackId: TrackId) => void;
  updateEnrollment: (updated: Enrollment) => void;
  // --- end Phase 4 additions --------------------------------------------
}

const deriveTrackIds = (enrollments: Enrollment[]): TrackId[] =>
  enrollments.map((enrollment) => enrollment.trackId);

export const useAppStore = create<AppState>((set) => ({
  activeTrackId: null,
  enrolledTrackIds: [],
  onboardingComplete: false,
  enrollments: [],

  setActiveTrackId: (trackId) => set({ activeTrackId: trackId }),

  setEnrolledTrackIds: (trackIds) => set({ enrolledTrackIds: trackIds }),

  addEnrolledTrack: (trackId) =>
    set((state) =>
      state.enrolledTrackIds.includes(trackId)
        ? state
        : { enrolledTrackIds: [...state.enrolledTrackIds, trackId] }
    ),

  setOnboardingComplete: (complete) => set({ onboardingComplete: complete }),

  // --- Phase 4 additions -------------------------------------------------
  setEnrollments: (enrollments) =>
    set({ enrollments, enrolledTrackIds: deriveTrackIds(enrollments) }),

  addEnrollment: (enrollment) =>
    set((state) => {
      if (state.enrollments.some((existing) => existing.trackId === enrollment.trackId)) {
        return state; // already enrolled — no duplicate, no-op (mirrors backend idempotency)
      }
      const enrollments = [...state.enrollments, enrollment];
      return { enrollments, enrolledTrackIds: deriveTrackIds(enrollments) };
    }),

  removeEnrollment: (trackId) =>
    set((state) => {
      const enrollments = state.enrollments.filter((existing) => existing.trackId !== trackId);
      return { enrollments, enrolledTrackIds: deriveTrackIds(enrollments) };
    }),

  updateEnrollment: (updated) =>
    set((state) => {
      const enrollments = state.enrollments.map((existing) =>
        existing.trackId === updated.trackId ? updated : existing
      );
      return { enrollments, enrolledTrackIds: deriveTrackIds(enrollments) };
    }),
  // --- end Phase 4 additions ----------------------------------------------
}));

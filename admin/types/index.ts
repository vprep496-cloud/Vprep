// Shared TypeScript types for the V-Prep admin portal.
// Mirrors mobile/types/index.ts for the subset relevant to the web app.

export type UserRole = "candidate" | "admin" | "superadmin";

export type SkillLevel = "beginner" | "intermediate" | "advanced";

export type TrackId =
  | "ml_ai"
  | "web_dev"
  | "devops"
  | "data_science"
  | "cloud"
  | "mobile_dev";

export interface AdminUser {
  id: string;
  backendUserId: string;
  email: string;
  name: string;
  image: string | null;
  role: UserRole;
  createdAt?: string;
}

export interface StatCard {
  label: string;
  value: string | number;
  icon: string; // Lucide icon component name, e.g. "Users", "Activity"
}

// ---------------------------------------------------------------------------
// Phase 6 — admin portal types. Mirrors the backend's `GET /api/v1/admin/*`
// response shapes (snake_case) converted to the camelCase domain types below
// by the `adminApi.*` helpers in `lib/api.ts` — the same
// backend-shape -> camelCase-domain-type split `mobile/services/*.service.ts`
// uses (see `toSessionResult` et al. there), and the same spirit as this
// file's existing `AdminUser`/`toAdminUser` pairing in `users/page.tsx`.
// ---------------------------------------------------------------------------

export type InterviewMode = "hr" | "technical" | "behavioral" | "full_mock";
export type InterviewPhase = "hr" | "technical" | "behavioral";
export type AnswerType = "voice" | "text";
export type Difficulty = "easy" | "medium" | "hard";

export interface TrackSummary {
  id: TrackId;
  name: string;
  description: string;
  icon: string;
  color: string;
  totalDays: number;
}

export interface DashboardStats {
  totalCandidates: number;
  totalAdmins: number;
  activeSessions: number;
  completedSessions: number;
  averageOverallScore: number;
  totalEnrollments: number;
  trackDistribution: Record<string, number>;
}

export interface CandidateListItem {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: UserRole;
  createdAt: string;
  enrollmentCount: number;
  sessionCount: number;
  averageScore: number | null;
}

export interface CandidateEnrollment {
  id: string;
  userId: string;
  trackId: TrackId;
  track: TrackSummary | null;
  skillLevel: SkillLevel;
  startDate: string;
  currentDay: number;
  completedTopics: string[];
  averageScore: number;
  totalSessions: number;
  updatedAt: string;
  planExists: boolean;
}

export interface QuestionFeedback {
  questionId: string;
  question: string;
  userAnswer: string;
  score: number;
  feedback: string;
  modelAnswer: string;
}

export interface CandidateAssessment {
  id: string;
  userId: string;
  trackId: TrackId;
  skillLevel: SkillLevel;
  score: number;
  breakdown: Record<string, number>;
  perQuestionFeedback: QuestionFeedback[];
  createdAt: string;
}

export interface InterviewQuestionAnswer {
  questionId: string;
  questionText: string;
  phase: InterviewPhase;
  answerType: AnswerType;
  transcription: string | null;
  userTextAnswer: string | null;
  score: number;
  criteriaScores: Record<string, number>;
  feedback: string;
  modelAnswer: string;
}

export interface InterviewPhaseResult {
  phase: InterviewPhase;
  score: number;
  questionCount: number;
  answers: InterviewQuestionAnswer[];
}

export interface InterviewSessionResult {
  id: string;
  userId: string;
  trackId: TrackId;
  mode: InterviewMode;
  overallScore: number;
  phaseResults: InterviewPhaseResult[];
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
}

export interface CandidateStats {
  totalSessions: number;
  averageScore: number;
  bestScore: number;
  totalStudyDays: number;
}

export interface CandidateDetail {
  user: AdminUser;
  enrollments: CandidateEnrollment[];
  assessments: CandidateAssessment[];
  sessions: InterviewSessionResult[];
  stats: CandidateStats;
}

export interface AdminQuestion {
  id: string;
  trackId: TrackId;
  phase: InterviewPhase;
  questionText: string;
  answerType: AnswerType;
  difficulty: Difficulty;
  scoringCriteria: string[];
  modelAnswer: string;
  tags: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface QuestionInput {
  trackId: string;
  phase: string;
  questionText: string;
  answerType: string;
  difficulty: string;
  scoringCriteria: string[];
  modelAnswer: string;
  tags: string[];
}

export interface ScoreTrendPoint {
  date: string;
  averageScore: number;
  sessionCount: number;
}

export interface TrackDistributionPoint {
  trackId: string;
  trackName: string;
  count: number;
}

export interface SessionCompletionPoint {
  date: string;
  started: number;
  completed: number;
}

export interface AdminAnalytics {
  scoreTrend: ScoreTrendPoint[];
  trackDistribution: TrackDistributionPoint[];
  sessionCompletion: SessionCompletionPoint[];
}

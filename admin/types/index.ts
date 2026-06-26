// Shared TypeScript types for the V-Prep admin portal.
// Mirrors mobile/types/index.ts for the subset relevant to the web app.

export type UserRole = "candidate" | "admin" | "superadmin";

export type SkillLevel = "beginner" | "intermediate" | "advanced";

export type TrackId = string;

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
export type InterviewPhase = "hr" | "technical" | "coding_logic" | "behavioral";
export type AnswerType = "voice" | "text" | "image";
export type Difficulty = "easy" | "medium" | "hard";

export interface TrackSummary {
  id: TrackId;
  name: string;
  description: string;
  icon: string;
  color: string;
  totalDays: number;
  topicAreas: string[];
  isActive?: boolean;
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
  criteriaScores?: Record<string, number>;
  confidence?: number | null;
  strengths?: string[];
  improvements?: string[];
  reviewFlags?: string[];
  evidence?: string[];
  scoreRationale?: string | null;
  feedback: string;
  modelAnswer: string;
  scoringMetadata?: Record<string, unknown> | null;
}

export interface CandidateAssessment {
  id: string;
  userId: string;
  trackId: TrackId;
  skillLevel: SkillLevel;
  score: number;
  breakdown: Record<string, number>;
  perQuestionFeedback: QuestionFeedback[];
  scoringVersion?: string | null;
  createdAt: string;
}

export interface InterviewQuestionAnswer {
  questionId: string;
  questionText: string;
  phase: InterviewPhase;
  answerType: AnswerType;
  transcription: string | null;
  userTextAnswer: string | null;
  answerDurationSeconds?: number | null;
  score: number;
  criteriaScores: Record<string, number>;
  feedback: string;
  modelAnswer: string;
  confidence?: number | null;
  strengths?: string[];
  improvements?: string[];
  reviewFlags?: string[];
  evidence?: string[];
  scoreRationale?: string | null;
  rubricVersion?: string | null;
  scoringMode?: string | null;
  scoringMetadata?: Record<string, unknown> | null;
  aiScore?: number | null;
  aiCriteriaScores?: Record<string, number> | null;
  aiFeedback?: string | null;
  aiConfidence?: number | null;
  aiReviewFlags?: string[];
  aiScoringMetadata?: Record<string, unknown> | null;
  manualReviewStatus?: "pending" | "reviewed" | "not_required" | null;
  reviewerNotes?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  /** Async coding score lifecycle — populated only for coding_logic answers */
  codingScoreStatus?: "pending" | "processing" | "complete" | "failed" | null;
  /** Async voice score lifecycle — populated only for async-scored voice answers */
  voiceScoreStatus?: "pending" | "processing" | "complete" | "failed" | null;
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

export interface QuestionGenerateInput {
  trackId: string;
  phase: InterviewPhase;
  count: number;
  difficulty?: Difficulty;
  guidance?: string;
}

export interface TrackInput {
  id?: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  totalDays: number;
  topicAreas: string[];
}

export interface ManualReviewInput {
  score?: number;
  criteriaScores?: Record<string, number>;
  feedback?: string;
  reviewerNotes?: string;
  status?: "pending" | "reviewed" | "not_required";
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

export interface AdminSessionListItem {
  id: string;
  userId: string;
  candidateName: string;
  candidateEmail: string;
  candidatePhoto: string | null;
  trackId: string;
  mode: InterviewMode;
  overallScore: number;
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  phaseResults: Array<{
    phase: InterviewPhase;
    score: number;
    questionCount: number;
  }>;
}

export interface AIStatus {
  provider: string;
  configured: boolean;
  sdk: string;
  endpoint?: string | null;
  models: {
    default: string;
    text: string;
    json: string;
    scoringVoiceHr: string;
    scoringCoding: string;
    codingModelActive: boolean;
    scoring?: string;
    mediaReasoning?: string;
  };
  generation: {
    temperature: number;
    creativeTemperature: number;
    topP: number;
    maxOutputTokens: number;
    requestTimeoutSeconds?: number;
    codingTimeoutSeconds?: number;
    codingNumCtx?: number;
  };
  media?: {
    imageOcr?: string;
    audioTranscription?: string;
    note?: string;
  };
  live?: {
    ok: boolean;
    message: string;
    availableModels?: string[];
    codingModelReady?: boolean;
    codingModelWarning?: string;
  };
}

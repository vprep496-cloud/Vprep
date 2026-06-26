// Shared TypeScript types for the V-Prep mobile app.
// Mirrors the shapes returned by the FastAPI backend (snake_case is converted
// to camelCase at the service boundary — see services/*.ts).

// ---------------------------------------------------------------------------
// Auth / Users
// ---------------------------------------------------------------------------

export type UserRole = "candidate" | "admin" | "superadmin";
export type SkillLevel = "beginner" | "intermediate" | "advanced";

export interface CandidateProfile {
  selfReportedLevel: SkillLevel;
  detectedLevel: SkillLevel;
  normalizedLevel: SkillLevel;
  yearsExperience: number | null;
  targetRole: string | null;
  primaryRoles: string[];
  skills: string[];
  projects: string[];
  education: string[];
  summary: string;
  recommendedTrackIds: string[];
  preferredTrackId: string | null;
  confidence: number;
  cv?: {
    filename: string | null;
    mimeType: string | null;
    extracted: boolean;
    status: string;
  };
}

export interface User {
  id: string;
  firebaseUid: string;
  email: string;
  displayName: string;
  photoUrl: string | null;
  role: UserRole;
  profileComplete: boolean;
  selfReportedLevel?: SkillLevel | null;
  normalizedLevel?: SkillLevel | null;
  yearsExperience?: number | null;
  targetRole?: string | null;
  preferredTrackId?: string | null;
  cvFilename?: string | null;
  cvMimeType?: string | null;
  cvSummary?: string | null;
  profile?: CandidateProfile | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Tracks / Enrollments
// ---------------------------------------------------------------------------

export type TrackId = string;

export interface Track {
  id: TrackId;
  name: string;
  description: string;
  icon: string;
  color: string;
  totalDays: number;
  topicAreas: string[];
}

export type RoleSeniority = "junior" | "mid" | "senior";

// A curated target role a candidate can prepare for on a track. The seniority
// drives question difficulty; focus areas steer which topics get asked.
export interface TargetRole {
  id: string;
  label: string;
  seniority: RoleSeniority;
  seniorityLabel: string;
  focus: string[];
}

export interface Enrollment {
  id: string;
  userId: string;
  trackId: TrackId;
  skillLevel: SkillLevel;
  /** Per-track target role (each track keeps its own). Derived intelligently
   *  by the backend on enroll; editable from the plan screen. */
  targetRole: string | null;
  /** Predefined catalog role id, or null for a custom typed role. */
  targetRoleId: string | null;
  /** Seniority of the chosen role — drives question difficulty. */
  roleSeniority: RoleSeniority | null;
  /** False while still the system default; true once the user picks a role. */
  roleConfirmed: boolean;
  startDate: string;
  currentDay: number;
  completedTopics: string[];
  averageScore: number;
  // --- Phase 4 additions: enrollment lifecycle + progress fields, plus the
  // joined data the backend's EnrollmentResponse attaches (static track entry
  // + whether a personalized plan exists yet for this user+track) ---
  totalSessions: number;
  updatedAt: string;
  track: Track;
  planExists: boolean;
}

// Phase 4 — request body for PUT /tracks/enrollment/{trackId}/progress.
// Consumed by the Phase 5 interview module after each completed session; the
// route + plumbing exist now so the data model is ready ahead of that work.
export interface EnrollmentProgress {
  currentDay: number;
  completedTopic?: string | null;
  sessionScore?: number | null;
}

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------
// Phase 3 design decision: every question is open-ended / short-answer. There
// is no `options` or `correctOptionIndex` anywhere — local AI grades free-typed
// answers holistically against a server-side rubric (see backend model_answer,
// which is intentionally never sent to the client except inside /submit's result).

export type QuestionDifficulty = "easy" | "medium" | "hard";

export interface AssessmentQuestion {
  id: string;
  question: string;
  topicArea: string;
  sectionId?: string;
  sectionTitle?: string;
  difficulty: QuestionDifficulty;
}

export interface QuestionFeedback {
  questionId: string;
  question: string;
  userAnswer: string;
  score: number; // 0-10
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

export interface AssessmentResult {
  id: string;
  userId: string;
  trackId: TrackId;
  skillLevel: SkillLevel;
  score: number; // overall score, 0-100
  breakdown: Record<string, number>; // topicArea -> score, scaled 0-100
  perQuestionFeedback: QuestionFeedback[];
  scoringVersion?: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Personalized Plan
// ---------------------------------------------------------------------------

export interface PlanDay {
  dayNumber: number;
  topic: string;
  subtopics: string[];
  estimatedMinutes: number;
  practiceQuestions: number;
}

export interface PlanWeek {
  weekNumber: number;
  title: string;
  focus: string;
  days: PlanDay[];
}

export interface PersonalizedPlan {
  id: string;
  userId: string;
  trackId: TrackId;
  skillLevel: SkillLevel;
  totalDays: number;
  weeks: PlanWeek[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Mock Interview (Phase 5)
//
// Replaces the Phase 1 stub `InterviewPhase` / `SessionStatus` /
// `InterviewSession` types — grep confirmed zero references to those stub
// shapes anywhere in the app, and they modeled a single-phase "scheduled"
// session that doesn't match the real multi-phase mock-interview flow, so
// they're fully replaced here (mirrors the same judgment call already made
// for the backend's `app/models/session.py` stub).
// ---------------------------------------------------------------------------

export type InterviewMode = "hr" | "technical" | "behavioral" | "full_mock";

/** How many questions per phase. "quick" ≈ 50%, "standard" = 100%, "deep" ≈ 150% */
export type SessionIntensity = "quick" | "standard" | "deep";

export type InterviewPhase = "hr" | "technical" | "coding_logic" | "behavioral";

export type AnswerType = "voice" | "text" | "image";

export type InterviewSessionStatus = "in_progress" | "completed";

// A question as returned mid-session — `modelAnswer` is intentionally absent
// from this shape: Agent Rule #3 forbids it appearing before the answer is
// submitted, and the backend's `sanitize_question` strips it server-side.
export interface InterviewQuestion {
  id: string;
  trackId: string;
  phase: InterviewPhase;
  questionText: string;
  answerType: AnswerType;
  difficulty: QuestionDifficulty;
  scoringCriteria: string[];
  tags: string[];
}

export interface SessionStartResult {
  sessionId: string;
  trackId: TrackId;
  mode: InterviewMode;
  intensity: SessionIntensity;
  phases: InterviewPhase[];
  questions: Partial<Record<InterviewPhase, InterviewQuestion[]>>;
  startedAt: string;
}

/** Async coding score polling response */
export interface CodingScoreStatus {
  questionId: string;
  status: "pending" | "processing" | "complete" | "failed";
  score: number | null;
  feedback: string | null;
  transcription: string | null;
  criteriaScores: Record<string, number>;
  estimatedSeconds: number;
}

/** Async coding submission acknowledgement */
export interface CodingSubmitAck {
  questionId: string;
  status: "pending";
  message: string;
  estimatedSeconds: number;
}

/** Async technical section polling response */
export interface TechnicalScoreStatus {
  questionId: string;
  status: "pending" | "processing" | "complete" | "failed";
  score: number | null;
  feedback: string | null;
  criteriaScores: Record<string, number>;
  estimatedSeconds: number;
}

/** Async technical batch submission acknowledgement */
export interface TechnicalSubmitAck {
  questionIds: string[];
  status: "pending";
  message: string;
  estimatedSeconds: number;
}

/** Async voice score polling response (one entry per voice answer in the session) */
export interface VoiceScoreStatus {
  questionId: string;
  phase: InterviewPhase;
  status: "pending" | "processing" | "complete" | "failed";
  score: number | null;
  feedback: string | null;
  transcription: string | null;
  criteriaScores: Record<string, number>;
  estimatedSeconds: number;
}

/** Async voice submission acknowledgement */
export interface VoiceSubmitAck {
  questionId: string;
  status: "pending";
  message: string;
  estimatedSeconds: number;
}

// Returned only after an answer is submitted — this is the one place
// `modelAnswer` is allowed to reach the client mid-session (Rule #3: it's
// the post-submission feedback the spec wants surfaced).
export interface AnswerResult {
  questionId: string;
  score: number;
  criteriaScores: Record<string, number>;
  feedback: string;
  modelAnswer: string;
  transcription: string | null;
  confidence?: number | null;
  strengths?: string[];
  improvements?: string[];
  reviewFlags?: string[];
  evidence?: string[];
  scoreRationale?: string | null;
  rubricVersion?: string | null;
  scoringMode?: string | null;
}

/** STAR analysis from behavioral voice scoring (LLM-extracted + rule-based). */
export interface StarAnalysis {
  situation: boolean;
  task: boolean;
  action: boolean;
  result: boolean;
  /** 0–100 LLM-assessed STAR completeness. Present only when LLM scoring succeeded. */
  completeness_score?: number | null;
}

/**
 * Code analysis produced by qwen2.5-coder for coding_logic_image answers.
 * Extracted from the scoring response and stored alongside the score.
 */
export interface CodeAnalysis {
  /** Algorithm category: e.g. "sliding_window", "dynamic_programming", "hash_map" */
  algorithmCategory: string;
  /** Big-O time complexity, e.g. "O(n log n)" */
  timeComplexity: string;
  /** Big-O space complexity, e.g. "O(n)" */
  spaceComplexity: string;
  /** True if the chosen algorithm is the best practical complexity for this problem */
  isOptimal: boolean;
  /** True if the algorithm produces the correct output for the primary input */
  mainCaseCorrect: boolean;
  /** Programming language detected, e.g. "python", "java", "pseudocode" */
  languageDetected: string;
  /** OCR-cleaned, readable version of the candidate's handwritten code */
  reconstructedCode?: string | null;
}

/** Audio delivery + linguistic metrics stored in scoring_metadata.audio_metrics. */
export interface AudioMetrics {
  words_per_minute?: number | null;
  filler_word_count?: number | null;
  filler_word_ratio_pct?: number | null;
  speaking_ratio_pct?: number | null;
  total_words?: number | null;
  pause_count?: number | null;
  speaking_duration_seconds?: number | null;
  avg_word_confidence_pct?: number | null;
  vocabulary_richness_pct?: number | null;
  hedging_ratio_pct?: number | null;
  specificity_score?: number | null;
  ownership_score?: number | null;
  /** Rule-based phrase-detection of STAR components. */
  star_signals?: { situation: boolean; task: boolean; action: boolean; result: boolean } | null;
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
  manualReviewStatus?: "pending" | "reviewed" | "not_required" | null;
  /**
   * Full scoring metadata from the backend — includes audio_metrics (delivery +
   * linguistic signals) and scoring_breakdown. Shape varies by scoring mode.
   */
  scoringMetadata?: Record<string, unknown> | null;
  /** Structured STAR analysis (behavioral voice only). */
  starAnalysis?: StarAnalysis | null;
  /**
   * Code analysis from qwen2.5-coder (coding_logic_image only).
   * Contains algorithm category, Big-O, language, optimality.
   */
  codeAnalysis?: CodeAnalysis | null;
  /** Async coding score lifecycle — only present on coding_logic answers */
  codingScoreStatus?: "pending" | "processing" | "complete" | "failed" | null;
  /** Async voice score lifecycle — only present on async-scored voice answers */
  voiceScoreStatus?: "pending" | "processing" | "complete" | "failed" | null;
  /** Async technical text lifecycle — only present on async-scored technical answers */
  technicalScoreStatus?: "pending" | "processing" | "complete" | "failed" | null;
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

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface ApiError {
  message: string;
  status?: number;
  code?: string;
}

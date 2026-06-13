import axios from "axios";
import type {
  AdminAnalytics,
  AIStatus,
  AdminQuestion,
  CandidateAssessment,
  CandidateDetail,
  CandidateEnrollment,
  CandidateListItem,
  DashboardStats,
  InterviewPhaseResult,
  InterviewQuestionAnswer,
  InterviewSessionResult,
  QuestionFeedback,
  QuestionGenerateInput,
  QuestionInput,
  ScoreTrendPoint,
  SessionCompletionPoint,
  ManualReviewInput,
  TrackInput,
  TrackDistributionPoint,
  TrackSummary,
} from "@/types";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  timeout: 20000,
  headers: {
    "Content-Type": "application/json",
  },
});

// ---------------------------------------------------------------------------
// Synchronous token store — avoids the previous pattern of calling
// `getSession()` (which makes an extra HTTP round-trip to /api/auth/session)
// inside the request interceptor for every single API call.
//
// DashboardShell (the top-level authenticated layout) calls `setApiToken`
// immediately on mount and whenever the NextAuth session changes, so the
// token is always available synchronously by the time any child component's
// React Query hook fires its first request.
// ---------------------------------------------------------------------------
let _authToken: string | null = null;

export function setApiToken(token: string | null): void {
  _authToken = token;
}

// Synchronous interceptor — zero extra round-trips per request.
api.interceptors.request.use((config) => {
  if (_authToken) {
    config.headers.Authorization = `Bearer ${_authToken}`;
  }
  return config;
});

// Global 401/403 handler — clears stale token and lets the layout redirect.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && (error.response?.status === 401 || error.response?.status === 403)) {
      _authToken = null;
    }
    return Promise.reject(error);
  }
);

export default api;

// ---------------------------------------------------------------------------
// Phase 6 — `adminApi`: typed helpers over `GET/POST/PUT/DELETE /api/v1/admin/*`.
//
// Judgment call (centralizing here rather than mirroring `users/page.tsx`'s
// per-page `Backend*`/`toAdminUser` pattern): that page owns exactly one
// endpoint, so an inline mapper is the simplest thing that works. Phase 6
// adds NINE admin endpoints across five pages with substantially overlapping
// shapes (sessions, enrollments, assessments, tracks all show up in more than
// one response) — duplicating `Backend*` interfaces and snake_case->camelCase
// mappers in every page would be a maintenance hazard. Centralizing the raw
// (snake_case) response interfaces and `to*` mappers here, and exporting only
// the already-camelCase, typed `adminApi.*` functions, mirrors exactly what
// `mobile/services/interview.service.ts` does for the same backend shapes —
// just relocated from a `services/` module to this app's `lib/api.ts` (this
// app has no `services/` directory; `lib/api.ts` is its one shared API layer).
//
// Note: a `promoteUser` helper was sketched in planning but deliberately
// **omitted** — `components/modals/PromoteUserModal.tsx` already encapsulates
// that POST (with its own loading/error state) and is reused as-is on the
// candidates page, so a parallel `adminApi.promoteUser` would be dead code.
// ---------------------------------------------------------------------------

// --- Raw (snake_case) response shapes, mirroring `admin.py` field-for-field ---

interface BackendTrack {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  total_days: number;
  topic_areas?: string[];
  is_active?: boolean;
}

interface BackendTracksResponse {
  tracks: BackendTrack[];
}

interface BackendDashboardStats {
  total_candidates: number;
  total_admins: number;
  active_sessions: number;
  completed_sessions: number;
  average_overall_score: number;
  total_enrollments: number;
  track_distribution: Record<string, number>;
}

interface BackendCandidateListItem {
  id: string;
  email: string;
  display_name: string;
  photo_url: string | null;
  role: CandidateListItem["role"];
  created_at: string;
  enrollment_count: number;
  session_count: number;
  average_score: number | null;
}

interface BackendCandidatesResponse {
  candidates: BackendCandidateListItem[];
  total: number;
  page: number;
  pages: number;
}

interface BackendCandidateEnrollment {
  id: string;
  user_id: string;
  track_id: string;
  track: BackendTrack | null;
  skill_level: CandidateEnrollment["skillLevel"];
  start_date: string;
  current_day: number;
  completed_topics: string[];
  average_score: number;
  total_sessions: number;
  updated_at: string;
  plan_exists: boolean;
}

interface BackendQuestionFeedback {
  question_id: string;
  question: string;
  user_answer: string;
  score: number;
  criteria_scores?: Record<string, number>;
  confidence?: number | null;
  strengths?: string[];
  improvements?: string[];
  review_flags?: string[];
  evidence?: string[];
  score_rationale?: string | null;
  feedback: string;
  model_answer: string;
  scoring_metadata?: Record<string, unknown> | null;
}

interface BackendCandidateAssessment {
  id: string;
  user_id: string;
  track_id: string;
  skill_level: CandidateEnrollment["skillLevel"];
  score: number;
  breakdown: Record<string, number>;
  per_question_feedback: BackendQuestionFeedback[];
  scoring_version?: string | null;
  created_at: string;
}

interface BackendQuestionAnswer {
  question_id: string;
  question_text: string;
  phase: InterviewQuestionAnswer["phase"];
  answer_type: InterviewQuestionAnswer["answerType"];
  transcription: string | null;
  user_text_answer: string | null;
  answer_duration_seconds?: number | null;
  score: number;
  criteria_scores: Record<string, number>;
  feedback: string;
  model_answer: string;
  confidence?: number | null;
  strengths?: string[];
  improvements?: string[];
  review_flags?: string[];
  evidence?: string[];
  score_rationale?: string | null;
  rubric_version?: string | null;
  scoring_mode?: string | null;
  scoring_metadata?: Record<string, unknown> | null;
  ai_score?: number | null;
  ai_criteria_scores?: Record<string, number> | null;
  ai_feedback?: string | null;
  ai_confidence?: number | null;
  ai_review_flags?: string[];
  ai_scoring_metadata?: Record<string, unknown> | null;
  manual_review_status?: "pending" | "reviewed" | "not_required" | null;
  reviewer_notes?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  voice_score_status?: "pending" | "processing" | "complete" | "failed" | null;
  coding_score_status?: "pending" | "processing" | "complete" | "failed" | null;
}

interface BackendPhaseResult {
  phase: InterviewPhaseResult["phase"];
  score: number;
  question_count: number;
  answers: BackendQuestionAnswer[];
}

interface BackendSessionResult {
  id: string;
  user_id: string;
  track_id: string;
  mode: InterviewSessionResult["mode"];
  overall_score: number;
  phase_results: BackendPhaseResult[];
  started_at: string;
  completed_at: string;
  duration_seconds: number;
}

interface BackendCandidateDetail {
  user: BackendCandidateListItem & { firebase_uid?: string; updated_at?: string };
  enrollments: BackendCandidateEnrollment[];
  assessments: BackendCandidateAssessment[];
  sessions: BackendSessionResult[];
  stats: {
    total_sessions: number;
    average_score: number;
    best_score: number;
    total_study_days: number;
  };
}

interface BackendQuestion {
  id: string;
  track_id: string;
  phase: AdminQuestion["phase"];
  question_text: string;
  answer_type: AdminQuestion["answerType"];
  difficulty: AdminQuestion["difficulty"];
  scoring_criteria: string[];
  model_answer: string;
  tags: string[];
  created_at?: string;
  updated_at?: string;
}

interface BackendQuestionsResponse {
  questions: BackendQuestion[];
  total: number;
  page: number;
  pages: number;
}

interface BackendGeneratedQuestionsResponse {
  questions: BackendQuestion[];
  total: number;
}

interface BackendScoreTrendPoint {
  date: string;
  average_score: number;
  session_count: number;
}

interface BackendTrackDistributionPoint {
  track_id: string;
  track_name: string;
  count: number;
}

interface BackendAnalytics {
  score_trend: BackendScoreTrendPoint[];
  track_distribution: BackendTrackDistributionPoint[];
  session_completion: SessionCompletionPoint[]; // already flat {date, started, completed} — no snake_case fields
}

interface BackendAIStatus {
  provider: string;
  configured: boolean;
  sdk: string;
  endpoint?: string | null;
  models: {
    text: string;
    json: string;
    scoring: string;
    media_reasoning: string;
  };
  generation: {
    temperature: number;
    creative_temperature: number;
    top_p: number;
    max_output_tokens: number;
    request_timeout_seconds?: number;
  };
  media?: {
    image_ocr?: string;
    audio_transcription?: string;
    note?: string;
  };
  live?: {
    ok: boolean;
    message: string;
    available_models?: string[];
  };
}

// --- snake_case -> camelCase mappers (mirrors `mobile/services/interview.service.ts`'s `to*` family) ---

function toTrackSummary(track: BackendTrack | null): TrackSummary | null {
  if (!track) return null;
  return {
    id: track.id as TrackSummary["id"],
    name: track.name,
    description: track.description,
    icon: track.icon,
    color: track.color,
    totalDays: track.total_days,
    topicAreas: track.topic_areas ?? [],
    isActive: track.is_active ?? true,
  };
}

function toCandidateListItem(candidate: BackendCandidateListItem): CandidateListItem {
  return {
    id: candidate.id,
    email: candidate.email,
    name: candidate.display_name,
    image: candidate.photo_url,
    role: candidate.role,
    createdAt: candidate.created_at,
    enrollmentCount: candidate.enrollment_count,
    sessionCount: candidate.session_count,
    averageScore: candidate.average_score,
  };
}

function toCandidateEnrollment(enrollment: BackendCandidateEnrollment): CandidateEnrollment {
  return {
    id: enrollment.id,
    userId: enrollment.user_id,
    trackId: enrollment.track_id as CandidateEnrollment["trackId"],
    track: toTrackSummary(enrollment.track),
    skillLevel: enrollment.skill_level,
    startDate: enrollment.start_date,
    currentDay: enrollment.current_day,
    completedTopics: enrollment.completed_topics,
    averageScore: enrollment.average_score,
    totalSessions: enrollment.total_sessions,
    updatedAt: enrollment.updated_at,
    planExists: enrollment.plan_exists,
  };
}

function toQuestionFeedback(feedback: BackendQuestionFeedback): QuestionFeedback {
  return {
    questionId: feedback.question_id,
    question: feedback.question,
    userAnswer: feedback.user_answer,
    score: feedback.score,
    criteriaScores: feedback.criteria_scores ?? {},
    confidence: feedback.confidence ?? null,
    strengths: feedback.strengths ?? [],
    improvements: feedback.improvements ?? [],
    reviewFlags: feedback.review_flags ?? [],
    evidence: feedback.evidence ?? [],
    scoreRationale: feedback.score_rationale ?? null,
    feedback: feedback.feedback,
    modelAnswer: feedback.model_answer,
    scoringMetadata: feedback.scoring_metadata ?? null,
  };
}

function toCandidateAssessment(assessment: BackendCandidateAssessment): CandidateAssessment {
  return {
    id: assessment.id,
    userId: assessment.user_id,
    trackId: assessment.track_id as CandidateAssessment["trackId"],
    skillLevel: assessment.skill_level,
    score: assessment.score,
    breakdown: assessment.breakdown ?? {},
    perQuestionFeedback: (assessment.per_question_feedback ?? []).map(toQuestionFeedback),
    scoringVersion: assessment.scoring_version ?? null,
    createdAt: assessment.created_at,
  };
}

function toQuestionAnswer(answer: BackendQuestionAnswer): InterviewQuestionAnswer {
  return {
    questionId: answer.question_id,
    questionText: answer.question_text,
    phase: answer.phase,
    answerType: answer.answer_type,
    transcription: answer.transcription,
    userTextAnswer: answer.user_text_answer,
    answerDurationSeconds: answer.answer_duration_seconds ?? null,
    score: answer.score,
    criteriaScores: answer.criteria_scores ?? {},
    feedback: answer.feedback,
    modelAnswer: answer.model_answer,
    confidence: answer.confidence ?? null,
    strengths: answer.strengths ?? [],
    improvements: answer.improvements ?? [],
    reviewFlags: answer.review_flags ?? [],
    evidence: answer.evidence ?? [],
    scoreRationale: answer.score_rationale ?? null,
    rubricVersion: answer.rubric_version ?? null,
    scoringMode: answer.scoring_mode ?? null,
    scoringMetadata: answer.scoring_metadata ?? null,
    aiScore: answer.ai_score ?? null,
    aiCriteriaScores: answer.ai_criteria_scores ?? null,
    aiFeedback: answer.ai_feedback ?? null,
    aiConfidence: answer.ai_confidence ?? null,
    aiReviewFlags: answer.ai_review_flags ?? [],
    aiScoringMetadata: answer.ai_scoring_metadata ?? null,
    manualReviewStatus: answer.manual_review_status ?? null,
    reviewerNotes: answer.reviewer_notes ?? null,
    reviewedBy: answer.reviewed_by ?? null,
    reviewedAt: answer.reviewed_at ?? null,
    voiceScoreStatus: answer.voice_score_status ?? null,
    codingScoreStatus: answer.coding_score_status ?? null,
  };
}

function toPhaseResult(phaseResult: BackendPhaseResult): InterviewPhaseResult {
  return {
    phase: phaseResult.phase,
    score: phaseResult.score,
    questionCount: phaseResult.question_count,
    answers: phaseResult.answers.map(toQuestionAnswer),
  };
}

function toSessionResult(result: BackendSessionResult): InterviewSessionResult {
  return {
    id: result.id,
    userId: result.user_id,
    trackId: result.track_id as InterviewSessionResult["trackId"],
    mode: result.mode,
    overallScore: result.overall_score,
    phaseResults: (result.phase_results ?? []).map(toPhaseResult),
    startedAt: result.started_at,
    completedAt: result.completed_at,
    durationSeconds: result.duration_seconds,
  };
}

function toAdminQuestion(question: BackendQuestion): AdminQuestion {
  return {
    id: question.id,
    trackId: question.track_id as AdminQuestion["trackId"],
    phase: question.phase,
    questionText: question.question_text,
    answerType: question.answer_type,
    difficulty: question.difficulty,
    scoringCriteria: question.scoring_criteria ?? [],
    modelAnswer: question.model_answer,
    tags: question.tags ?? [],
    createdAt: question.created_at,
    updatedAt: question.updated_at,
  };
}

function toScoreTrendPoint(point: BackendScoreTrendPoint): ScoreTrendPoint {
  return {
    date: point.date,
    averageScore: point.average_score,
    sessionCount: point.session_count,
  };
}

function toTrackDistributionPoint(point: BackendTrackDistributionPoint): TrackDistributionPoint {
  return {
    trackId: point.track_id,
    trackName: point.track_name,
    count: point.count,
  };
}

function toAIStatus(status: BackendAIStatus): AIStatus {
  return {
    provider: status.provider,
    configured: status.configured,
    sdk: status.sdk,
    endpoint: status.endpoint ?? null,
    models: {
      text: status.models.text,
      json: status.models.json,
      scoring: status.models.scoring,
      mediaReasoning: status.models.media_reasoning,
    },
    generation: {
      temperature: status.generation.temperature,
      creativeTemperature: status.generation.creative_temperature,
      topP: status.generation.top_p,
      maxOutputTokens: status.generation.max_output_tokens,
      requestTimeoutSeconds: status.generation.request_timeout_seconds,
    },
    media: status.media
      ? {
          imageOcr: status.media.image_ocr,
          audioTranscription: status.media.audio_transcription,
          note: status.media.note,
        }
      : undefined,
    live: status.live
      ? {
          ok: status.live.ok,
          message: status.live.message,
          availableModels: status.live.available_models,
        }
      : undefined,
  };
}

// --- Request param / pagination shapes shared by list endpoints ---

interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
}

export interface ListCandidatesParams {
  page?: number;
  limit?: number;
  role?: string;
  search?: string;
  trackId?: string;
}

export interface ListQuestionsParams {
  page?: number;
  limit?: number;
  phase?: string;
  trackId?: string;
}

export interface GetAnalyticsParams {
  days?: number;
  trackId?: string;
}

// QuestionInput is already snake_case-key-free on the wire — `admin.py`'s
// `QuestionCreate`/`QuestionUpdate` Pydantic models use the same `track_id`/
// `question_text`/... field names the form will collect, so the only mapping
// needed going OUT is camelCase keys -> the snake_case the API expects.
function questionInputToPayload(input: Partial<QuestionInput>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.trackId !== undefined) payload.track_id = input.trackId;
  if (input.phase !== undefined) payload.phase = input.phase;
  if (input.questionText !== undefined) payload.question_text = input.questionText;
  if (input.answerType !== undefined) payload.answer_type = input.answerType;
  if (input.difficulty !== undefined) payload.difficulty = input.difficulty;
  if (input.scoringCriteria !== undefined) payload.scoring_criteria = input.scoringCriteria;
  if (input.modelAnswer !== undefined) payload.model_answer = input.modelAnswer;
  if (input.tags !== undefined) payload.tags = input.tags;
  return payload;
}

function questionGenerateToPayload(input: QuestionGenerateInput): Record<string, unknown> {
  return {
    track_id: input.trackId,
    phase: input.phase,
    count: input.count,
    ...(input.difficulty ? { difficulty: input.difficulty } : {}),
    ...(input.guidance ? { guidance: input.guidance } : {}),
  };
}

function trackInputToPayload(input: Partial<TrackInput>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.id !== undefined) payload.id = input.id;
  if (input.name !== undefined) payload.name = input.name;
  if (input.description !== undefined) payload.description = input.description;
  if (input.icon !== undefined) payload.icon = input.icon;
  if (input.color !== undefined) payload.color = input.color;
  if (input.totalDays !== undefined) payload.total_days = input.totalDays;
  if (input.topicAreas !== undefined) payload.topic_areas = input.topicAreas;
  return payload;
}

function manualReviewToPayload(input: ManualReviewInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.score !== undefined) payload.score = input.score;
  if (input.criteriaScores !== undefined) payload.criteria_scores = input.criteriaScores;
  if (input.feedback !== undefined) payload.feedback = input.feedback;
  if (input.reviewerNotes !== undefined) payload.reviewer_notes = input.reviewerNotes;
  if (input.status !== undefined) payload.status = input.status;
  return payload;
}

export const adminApi = {
  async getAIStatus(liveCheck = false): Promise<AIStatus> {
    const { data } = await api.get<BackendAIStatus>("/api/v1/admin/ai/status", {
      params: liveCheck ? { live_check: true } : undefined,
    });
    return toAIStatus(data);
  },

  async getTracks(): Promise<TrackSummary[]> {
    const { data } = await api.get<BackendTracksResponse>("/api/v1/admin/tracks");
    return (data.tracks ?? []).map((track) => toTrackSummary(track)).filter(Boolean) as TrackSummary[];
  },

  async createTrack(input: TrackInput): Promise<TrackSummary> {
    const { data } = await api.post<BackendTrack>("/api/v1/admin/tracks", trackInputToPayload(input));
    return toTrackSummary(data) as TrackSummary;
  },

  async updateTrack(trackId: string, input: Partial<TrackInput>): Promise<TrackSummary> {
    const { data } = await api.put<BackendTrack>(`/api/v1/admin/tracks/${trackId}`, trackInputToPayload(input));
    return toTrackSummary(data) as TrackSummary;
  },

  async deleteTrack(trackId: string): Promise<void> {
    await api.delete(`/api/v1/admin/tracks/${trackId}`);
  },

  async getStats(): Promise<DashboardStats> {
    const { data } = await api.get<BackendDashboardStats>("/api/v1/admin/stats");
    return {
      totalCandidates: data.total_candidates,
      totalAdmins: data.total_admins,
      activeSessions: data.active_sessions,
      completedSessions: data.completed_sessions,
      averageOverallScore: data.average_overall_score,
      totalEnrollments: data.total_enrollments,
      trackDistribution: data.track_distribution,
    };
  },

  async getCandidates(params: ListCandidatesParams = {}): Promise<PaginatedResult<CandidateListItem>> {
    const { data } = await api.get<BackendCandidatesResponse>("/api/v1/admin/candidates", {
      params: {
        page: params.page ?? 1,
        limit: params.limit ?? 20,
        ...(params.role ? { role: params.role } : {}),
        ...(params.search ? { search: params.search } : {}),
        ...(params.trackId ? { track_id: params.trackId } : {}),
      },
    });
    return {
      items: data.candidates.map(toCandidateListItem),
      total: data.total,
      page: data.page,
      pages: data.pages,
    };
  },

  async getCandidate(candidateId: string): Promise<CandidateDetail> {
    const { data } = await api.get<BackendCandidateDetail>(`/api/v1/admin/candidates/${candidateId}`);
    return {
      user: {
        id: data.user.id,
        backendUserId: data.user.id,
        email: data.user.email,
        name: data.user.display_name,
        image: data.user.photo_url,
        role: data.user.role,
        createdAt: data.user.created_at,
      },
      enrollments: data.enrollments.map(toCandidateEnrollment),
      assessments: data.assessments.map(toCandidateAssessment),
      sessions: data.sessions.map(toSessionResult),
      stats: {
        totalSessions: data.stats.total_sessions,
        averageScore: data.stats.average_score,
        bestScore: data.stats.best_score,
        totalStudyDays: data.stats.total_study_days,
      },
    };
  },

  async getQuestions(params: ListQuestionsParams = {}): Promise<PaginatedResult<AdminQuestion>> {
    const { data } = await api.get<BackendQuestionsResponse>("/api/v1/admin/questions", {
      params: {
        page: params.page ?? 1,
        limit: params.limit ?? 25,
        ...(params.phase ? { phase: params.phase } : {}),
        ...(params.trackId ? { track_id: params.trackId } : {}),
      },
    });
    return {
      items: data.questions.map(toAdminQuestion),
      total: data.total,
      page: data.page,
      pages: data.pages,
    };
  },

  async createQuestion(input: QuestionInput): Promise<AdminQuestion> {
    const { data } = await api.post<BackendQuestion>("/api/v1/admin/questions", questionInputToPayload(input));
    return toAdminQuestion(data);
  },

  async generateQuestions(input: QuestionGenerateInput): Promise<AdminQuestion[]> {
    // Local LLM generation (Ollama/llama3.2:3b) of a whole batch can run well
    // past the default 20s axios timeout — give it the same headroom the
    // mobile app gives answer scoring rather than failing with a timeout.
    const { data } = await api.post<BackendGeneratedQuestionsResponse>(
      "/api/v1/admin/questions/generate",
      questionGenerateToPayload(input),
      { timeout: 120000 }
    );
    return data.questions.map(toAdminQuestion);
  },

  async updateQuestion(questionId: string, input: Partial<QuestionInput>): Promise<AdminQuestion> {
    const { data } = await api.put<BackendQuestion>(
      `/api/v1/admin/questions/${questionId}`,
      questionInputToPayload(input)
    );
    return toAdminQuestion(data);
  },

  async deleteQuestion(questionId: string): Promise<void> {
    await api.delete(`/api/v1/admin/questions/${questionId}`);
  },

  async getAnalytics(params: GetAnalyticsParams = {}): Promise<AdminAnalytics> {
    const { data } = await api.get<BackendAnalytics>("/api/v1/admin/analytics", {
      params: {
        ...(params.days ? { days: params.days } : {}),
        ...(params.trackId ? { track_id: params.trackId } : {}),
      },
    });
    return {
      scoreTrend: (data.score_trend ?? []).map(toScoreTrendPoint),
      trackDistribution: (data.track_distribution ?? []).map(toTrackDistributionPoint),
      sessionCompletion: data.session_completion ?? [],
    };
  },

  async getSession(sessionId: string): Promise<InterviewSessionResult> {
    const { data } = await api.get<BackendSessionResult>(`/api/v1/admin/sessions/${sessionId}`);
    return toSessionResult(data);
  },

  async reviewAnswer(
    sessionId: string,
    questionId: string,
    input: ManualReviewInput
  ): Promise<InterviewSessionResult> {
    const { data } = await api.put<BackendSessionResult>(
      `/api/v1/admin/sessions/${sessionId}/answers/${questionId}/review`,
      manualReviewToPayload(input)
    );
    return toSessionResult(data);
  },
};

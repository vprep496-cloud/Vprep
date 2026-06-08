import axios from "axios";
import { getSession } from "next-auth/react";
import type {
  AdminAnalytics,
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
  QuestionInput,
  ScoreTrendPoint,
  SessionCompletionPoint,
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

// Attach the NextAuth session's backend access token to every request.
api.interceptors.request.use(async (config) => {
  const session = await getSession();
  if (session?.accessToken) {
    config.headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return config;
});

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
  feedback: string;
  model_answer: string;
}

interface BackendCandidateAssessment {
  id: string;
  user_id: string;
  track_id: string;
  skill_level: CandidateEnrollment["skillLevel"];
  score: number;
  breakdown: Record<string, number>;
  per_question_feedback: BackendQuestionFeedback[];
  created_at: string;
}

interface BackendQuestionAnswer {
  question_id: string;
  question_text: string;
  phase: InterviewQuestionAnswer["phase"];
  answer_type: InterviewQuestionAnswer["answerType"];
  transcription: string | null;
  user_text_answer: string | null;
  score: number;
  criteria_scores: Record<string, number>;
  feedback: string;
  model_answer: string;
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
    feedback: feedback.feedback,
    modelAnswer: feedback.model_answer,
  };
}

function toCandidateAssessment(assessment: BackendCandidateAssessment): CandidateAssessment {
  return {
    id: assessment.id,
    userId: assessment.user_id,
    trackId: assessment.track_id as CandidateAssessment["trackId"],
    skillLevel: assessment.skill_level,
    score: assessment.score,
    breakdown: assessment.breakdown,
    perQuestionFeedback: assessment.per_question_feedback.map(toQuestionFeedback),
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
    score: answer.score,
    criteriaScores: answer.criteria_scores,
    feedback: answer.feedback,
    modelAnswer: answer.model_answer,
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
    phaseResults: result.phase_results.map(toPhaseResult),
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
    scoringCriteria: question.scoring_criteria,
    modelAnswer: question.model_answer,
    tags: question.tags,
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

export const adminApi = {
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
      scoreTrend: data.score_trend.map(toScoreTrendPoint),
      trackDistribution: data.track_distribution.map(toTrackDistributionPoint),
      sessionCompletion: data.session_completion,
    };
  },

  async getSession(sessionId: string): Promise<InterviewSessionResult> {
    const { data } = await api.get<BackendSessionResult>(`/api/v1/admin/sessions/${sessionId}`);
    return toSessionResult(data);
  },
};

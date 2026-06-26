import api from "./api";
import type {
  AssessmentQuestion,
  AssessmentResult,
  PersonalizedPlan,
  PlanDay,
  PlanWeek,
  QuestionFeedback,
  TrackId,
} from "../types";

// ---------------------------------------------------------------------------
// Backend response shapes — api.ts's deepCamel interceptor already converts
// all snake_case keys to camelCase before these types are used.
// ---------------------------------------------------------------------------

interface BackendQuestion {
  id: string;
  question: string;
  topicArea: string;
  sectionId?: string;
  sectionTitle?: string;
  difficulty: AssessmentQuestion["difficulty"];
}

interface BackendQuestionFeedback {
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

interface BackendAssessmentResult {
  id: string;
  userId: string;
  trackId: TrackId;
  skillLevel: AssessmentResult["skillLevel"];
  score: number;
  breakdown: Record<string, number>;
  perQuestionFeedback: BackendQuestionFeedback[];
  scoringVersion?: string | null;
  createdAt: string;
}

interface BackendPlanDay {
  dayNumber: number;
  topic: string;
  subtopics: string[];
  estimatedMinutes: number;
  practiceQuestions: number;
}

interface BackendPlanWeek {
  weekNumber: number;
  title: string;
  focus: string;
  days: BackendPlanDay[];
}

interface BackendPlan {
  id: string;
  userId: string;
  trackId: TrackId;
  skillLevel: PersonalizedPlan["skillLevel"];
  totalDays: number;
  weeks: BackendPlanWeek[];
  createdAt: string;
}

interface BackendGenerateQuestionsResponse {
  sessionId: string;
  questions: BackendQuestion[];
  trackId: TrackId;
}

interface BackendQuestionResponse {
  question: BackendQuestion;
  questionNumber: number;
  total: number;
  generationStatus: string;
}

interface BackendSubmitResponse {
  result: BackendAssessmentResult;
  plan: BackendPlan;
}

interface BackendGetResultResponse {
  result: BackendAssessmentResult | null;
  plan: BackendPlan | null;
}

// ---------------------------------------------------------------------------
// Mappers — field names now match the post-deepCamel camelCase shape.
// ---------------------------------------------------------------------------

function toQuestion(question: BackendQuestion): AssessmentQuestion {
  return {
    id: question.id,
    question: question.question,
    topicArea: question.topicArea,
    sectionId: question.sectionId,
    sectionTitle: question.sectionTitle,
    difficulty: question.difficulty,
  };
}

function toFeedback(feedback: BackendQuestionFeedback): QuestionFeedback {
  return {
    questionId: feedback.questionId,
    question: feedback.question,
    userAnswer: feedback.userAnswer,
    score: feedback.score,
    criteriaScores: feedback.criteriaScores ?? {},
    confidence: feedback.confidence ?? null,
    strengths: feedback.strengths ?? [],
    improvements: feedback.improvements ?? [],
    reviewFlags: feedback.reviewFlags ?? [],
    evidence: feedback.evidence ?? [],
    scoreRationale: feedback.scoreRationale ?? null,
    feedback: feedback.feedback,
    modelAnswer: feedback.modelAnswer,
    scoringMetadata: feedback.scoringMetadata ?? null,
  };
}

function toResult(result: BackendAssessmentResult): AssessmentResult {
  return {
    id: result.id,
    userId: result.userId,
    trackId: result.trackId,
    skillLevel: result.skillLevel,
    score: result.score,
    breakdown: result.breakdown,
    perQuestionFeedback: result.perQuestionFeedback.map(toFeedback),
    scoringVersion: result.scoringVersion ?? null,
    createdAt: result.createdAt,
  };
}

function toPlanDay(day: BackendPlanDay): PlanDay {
  return {
    dayNumber: day.dayNumber,
    topic: day.topic,
    subtopics: day.subtopics,
    estimatedMinutes: day.estimatedMinutes,
    practiceQuestions: day.practiceQuestions,
  };
}

function toPlanWeek(week: BackendPlanWeek): PlanWeek {
  return {
    weekNumber: week.weekNumber,
    title: week.title,
    focus: week.focus,
    days: week.days.map(toPlanDay),
  };
}

function toPlan(plan: BackendPlan): PersonalizedPlan {
  return {
    id: plan.id,
    userId: plan.userId,
    trackId: plan.trackId,
    skillLevel: plan.skillLevel,
    totalDays: plan.totalDays,
    weeks: plan.weeks.map(toPlanWeek),
    createdAt: plan.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GenerateQuestionsResult {
  sessionId: string;
  questions: AssessmentQuestion[];
  trackId: TrackId;
}

export interface GetQuestionResult {
  question: AssessmentQuestion;
  questionNumber: number;
  total: number;
  generationStatus: string;
}

function toGenerateQuestionsResult(
  data: BackendGenerateQuestionsResponse
): GenerateQuestionsResult {
  return {
    sessionId: data.sessionId,
    questions: data.questions.map(toQuestion),
    trackId: data.trackId,
  };
}

// POST /api/v1/assessment/generate-questions — starts a progressive
// personalized 7-question session. The backend returns q1 immediately and
// refines q2-q7 in the background through the local AI layer.
export interface AssessmentRoleSelection {
  targetRoleId?: string | null;
  targetRole?: string | null;
}

// The backend waits up to 50 s for the local AI to generate questions
// (see _SYNC_GENERATION_TIMEOUT_SECONDS). Axios's default 30 s would
// race and lose — bump AI-related endpoints to 90 s so the phone always
// waits long enough to receive the personalized first question.
const AI_TIMEOUT_MS = 90_000;
const AI_SUBMIT_TIMEOUT_MS = 240_000;

function roleBody(role?: AssessmentRoleSelection): Record<string, string> {
  if (!role) return {};
  return {
    ...(role.targetRoleId ? { target_role_id: role.targetRoleId } : {}),
    ...(role.targetRole && role.targetRole.trim() ? { target_role: role.targetRole.trim() } : {}),
  };
}

export async function generateQuestions(
  trackId: TrackId,
  role?: AssessmentRoleSelection
): Promise<GenerateQuestionsResult> {
  const { data } = await api.post<BackendGenerateQuestionsResponse>(
    "/api/v1/assessment/generate-questions",
    { track_id: trackId, ...roleBody(role) },
    { timeout: AI_TIMEOUT_MS }
  );
  return toGenerateQuestionsResult(data);
}

// GET /api/v1/assessment/session/{sessionId}/question/{questionNumber} —
// fetches the next question on demand. If local AI is still working, the
// backend returns the seeded fallback question so the assessment never blocks.
export async function getSessionQuestion(
  sessionId: string,
  questionNumber: number
): Promise<GetQuestionResult> {
  const { data } = await api.get<BackendQuestionResponse>(
    `/api/v1/assessment/session/${sessionId}/question/${questionNumber}`
  );
  return {
    question: toQuestion(data.question),
    questionNumber: data.questionNumber,
    total: data.total,
    generationStatus: data.generationStatus,
  };
}

export interface SubmitAssessmentResult {
  result: AssessmentResult;
  plan: PersonalizedPlan;
}

// POST /api/v1/assessment/submit — scores all 7 answers in one local AI call,
// determines skill level, and generates + persists the personalized plan.
export async function submitAssessment(
  sessionId: string,
  trackId: TrackId,
  answers: Record<string, string>
): Promise<SubmitAssessmentResult> {
  const { data } = await api.post<BackendSubmitResponse>(
    "/api/v1/assessment/submit",
    {
      session_id: sessionId,
      track_id: trackId,
      answers,
    },
    { timeout: AI_SUBMIT_TIMEOUT_MS }
  );
  return { result: toResult(data.result), plan: toPlan(data.plan) };
}

export interface GetResultResult {
  result: AssessmentResult | null;
  plan: PersonalizedPlan | null;
}

// GET /api/v1/assessment/result/{trackId} — most recent saved result + plan,
// used on mount to decide whether to show "result" or start a fresh assessment.
export async function getResult(trackId: TrackId): Promise<GetResultResult> {
  const { data } = await api.get<BackendGetResultResponse>(
    `/api/v1/assessment/result/${trackId}`
  );
  return {
    result: data.result ? toResult(data.result) : null,
    plan: data.plan ? toPlan(data.plan) : null,
  };
}

// GET /api/v1/assessment/plan/{trackId} — most recent personalized plan.
// Throws (404) if the candidate hasn't completed an assessment for this track.
export async function getPlan(trackId: TrackId): Promise<PersonalizedPlan> {
  const { data } = await api.get<BackendPlan>(`/api/v1/assessment/plan/${trackId}`);
  return toPlan(data);
}

// POST /api/v1/assessment/retake — starts a brand-new session without
// deleting prior assessment/plan history.
export async function retake(
  trackId: TrackId,
  role?: AssessmentRoleSelection
): Promise<GenerateQuestionsResult> {
  const { data } = await api.post<BackendGenerateQuestionsResponse>(
    "/api/v1/assessment/retake",
    { track_id: trackId, ...roleBody(role) },
    { timeout: AI_TIMEOUT_MS }
  );
  return toGenerateQuestionsResult(data);
}

import api from "./api";
import type {
  AnswerResult,
  AnswerType,
  CodeAnalysis,
  CodingScoreStatus,
  CodingSubmitAck,
  InterviewMode,
  InterviewPhase,
  InterviewPhaseResult,
  InterviewQuestion,
  InterviewQuestionAnswer,
  InterviewSessionResult,
  QuestionDifficulty,
  SessionIntensity,
  SessionStartResult,
  TechnicalScoreStatus,
  TechnicalSubmitAck,
  TrackId,
  VoiceScoreStatus,
  VoiceSubmitAck,
} from "../types";

// ---------------------------------------------------------------------------
// Backend response shapes — api.ts's deepCamel interceptor already converts
// all snake_case keys to camelCase before these types are used.
// ---------------------------------------------------------------------------

interface BackendQuestion {
  id: string;
  trackId: string;
  phase: InterviewPhase;
  questionText: string;
  answerType: AnswerType;
  difficulty: QuestionDifficulty;
  scoringCriteria: string[];
  tags: string[];
}

interface BackendSessionStartResponse {
  sessionId: string;
  trackId: TrackId;
  mode: InterviewMode;
  intensity: SessionIntensity;
  phases: InterviewPhase[];
  questions: Partial<Record<InterviewPhase, BackendQuestion[]>>;
  startedAt: string;
}

interface BackendCodingSubmitAck {
  questionId: string;
  status: "pending";
  message: string;
  estimatedSeconds: number;
}

interface BackendCodingStatusResponse {
  codingAnswers: Array<{
    questionId: string;
    status: "pending" | "processing" | "complete" | "failed";
    score: number | null;
    feedback: string | null;
    transcription: string | null;
    criteriaScores: Record<string, number>;
    estimatedSeconds: number;
  }>;
}

interface BackendTechnicalSubmitAck {
  questionIds: string[];
  status: "pending";
  message: string;
  estimatedSeconds: number;
}

interface BackendTechnicalStatusResponse {
  technicalAnswers: Array<{
    questionId: string;
    status: "pending" | "processing" | "complete" | "failed";
    score: number | null;
    feedback: string | null;
    criteriaScores: Record<string, number>;
    estimatedSeconds: number;
  }>;
}

interface BackendVoiceSubmitAck {
  questionId: string;
  status: "pending";
  message: string;
  estimatedSeconds: number;
}

interface BackendVoiceStatusResponse {
  voiceAnswers: Array<{
    questionId: string;
    phase: InterviewPhase;
    status: "pending" | "processing" | "complete" | "failed";
    score: number | null;
    feedback: string | null;
    transcription: string | null;
    criteriaScores: Record<string, number>;
    estimatedSeconds: number;
  }>;
}

interface BackendAnswerResponse {
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
  /** Scoring telemetry (audio metrics, provider, breakdown). camelCased by api.ts. */
  scoringMetadata?: Record<string, unknown> | null;
  /** STAR analysis for behavioral voice answers — camelCased by api.ts. */
  starAnalysis?: Record<string, unknown> | null;
  /** Code analysis from qwen2.5-coder for coding image answers — camelCased by api.ts. */
  codeAnalysis?: Record<string, unknown> | null;
}

interface BackendQuestionAnswer {
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
  scoringMetadata?: Record<string, unknown> | null;
  starAnalysis?: Record<string, unknown> | null;
  /** camelCased by api.ts interceptor from snake_case backend fields */
  codeAnalysis?: Record<string, unknown> | null;
  codingScoreStatus?: "pending" | "processing" | "complete" | "failed" | null;
  voiceScoreStatus?: "pending" | "processing" | "complete" | "failed" | null;
  technicalScoreStatus?: "pending" | "processing" | "complete" | "failed" | null;
}

interface BackendPhaseResult {
  phase: InterviewPhase;
  score: number;
  questionCount: number;
  answers: BackendQuestionAnswer[];
}

interface BackendSessionResult {
  id: string;
  userId: string;
  trackId: TrackId;
  mode: InterviewMode;
  overallScore: number;
  phaseResults: BackendPhaseResult[];
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
}

interface BackendHistoryResponse {
  sessions: BackendSessionResult[];
}

// ---------------------------------------------------------------------------
// Mappers — field names now match the post-deepCamel camelCase shape.
// ---------------------------------------------------------------------------

function toQuestion(question: BackendQuestion): InterviewQuestion {
  return {
    id: question.id,
    trackId: question.trackId,
    phase: question.phase,
    questionText: question.questionText,
    answerType: question.answerType,
    difficulty: question.difficulty,
    scoringCriteria: question.scoringCriteria,
    tags: question.tags,
  };
}

function toSessionStartResult(data: BackendSessionStartResponse): SessionStartResult {
  const questions: SessionStartResult["questions"] = {};
  // Group by each question's own `phase` field rather than the response's
  // object keys: api.ts's `deepCamel` interceptor camelCases every object key,
  // so the backend's `coding_logic` phase key arrives as `codingLogic` and a
  // `data.questions["coding_logic"]` lookup would miss the whole coding phase.
  // The `phase` *value* on each question is a plain string and is never
  // rewritten, so it stays the canonical `coding_logic`.
  for (const list of Object.values(data.questions)) {
    for (const backendQuestion of list ?? []) {
      const question = toQuestion(backendQuestion);
      (questions[question.phase] ??= []).push(question);
    }
  }
  return {
    sessionId: data.sessionId,
    trackId: data.trackId,
    mode: data.mode,
    intensity: data.intensity ?? "standard",
    phases: data.phases,
    questions,
    startedAt: data.startedAt,
  };
}

function toAnswerResult(data: BackendAnswerResponse): AnswerResult {
  return {
    questionId: data.questionId,
    score: data.score,
    criteriaScores: data.criteriaScores,
    feedback: data.feedback,
    modelAnswer: data.modelAnswer,
    transcription: data.transcription,
    confidence: data.confidence ?? null,
    strengths: data.strengths ?? [],
    improvements: data.improvements ?? [],
    reviewFlags: data.reviewFlags ?? [],
    evidence: data.evidence ?? [],
    scoreRationale: data.scoreRationale ?? null,
    rubricVersion: data.rubricVersion ?? null,
    scoringMode: data.scoringMode ?? null,
  };
}

function toQuestionAnswer(answer: BackendQuestionAnswer): InterviewQuestionAnswer {
  return {
    questionId: answer.questionId,
    questionText: answer.questionText,
    phase: answer.phase,
    answerType: answer.answerType,
    transcription: answer.transcription,
    userTextAnswer: answer.userTextAnswer,
    answerDurationSeconds: answer.answerDurationSeconds ?? null,
    score: answer.score,
    criteriaScores: answer.criteriaScores,
    feedback: answer.feedback,
    modelAnswer: answer.modelAnswer,
    confidence: answer.confidence ?? null,
    strengths: answer.strengths ?? [],
    improvements: answer.improvements ?? [],
    reviewFlags: answer.reviewFlags ?? [],
    evidence: answer.evidence ?? [],
    scoreRationale: answer.scoreRationale ?? null,
    rubricVersion: answer.rubricVersion ?? null,
    scoringMode: answer.scoringMode ?? null,
    manualReviewStatus: answer.manualReviewStatus ?? null,
    scoringMetadata: answer.scoringMetadata ?? null,
    // starAnalysis from backend is camelCased by the API interceptor
    starAnalysis: answer.starAnalysis
      ? {
          situation: Boolean((answer.starAnalysis as Record<string, unknown>).situation),
          task:      Boolean((answer.starAnalysis as Record<string, unknown>).task),
          action:    Boolean((answer.starAnalysis as Record<string, unknown>).action),
          result:    Boolean((answer.starAnalysis as Record<string, unknown>).result),
          completeness_score:
            typeof (answer.starAnalysis as Record<string, unknown>).completenessScore === "number"
              ? ((answer.starAnalysis as Record<string, unknown>).completenessScore as number)
              : null,
        }
      : null,
    // codeAnalysis from qwen2.5-coder (coding_logic_image only)
    // Keys are camelCased by api.ts interceptor (algorithm_category → algorithmCategory etc.)
    codeAnalysis: answer.codeAnalysis
      ? ({
          algorithmCategory: String(
            (answer.codeAnalysis as Record<string, unknown>).algorithmCategory ?? "unknown"
          ),
          timeComplexity: String(
            (answer.codeAnalysis as Record<string, unknown>).timeComplexity ?? "unknown"
          ),
          spaceComplexity: String(
            (answer.codeAnalysis as Record<string, unknown>).spaceComplexity ?? "unknown"
          ),
          isOptimal: Boolean((answer.codeAnalysis as Record<string, unknown>).isOptimal),
          mainCaseCorrect: Boolean((answer.codeAnalysis as Record<string, unknown>).mainCaseCorrect),
          languageDetected: String(
            (answer.codeAnalysis as Record<string, unknown>).languageDetected ?? "unknown"
          ),
          reconstructedCode:
            typeof (answer.codeAnalysis as Record<string, unknown>).reconstructedCode === "string"
              ? ((answer.codeAnalysis as Record<string, unknown>).reconstructedCode as string)
              : null,
        } as CodeAnalysis)
      : null,
    codingScoreStatus: answer.codingScoreStatus ?? null,
    voiceScoreStatus: answer.voiceScoreStatus ?? null,
    technicalScoreStatus: answer.technicalScoreStatus ?? null,
  };
}

function toPhaseResult(phaseResult: BackendPhaseResult): InterviewPhaseResult {
  return {
    phase: phaseResult.phase,
    score: phaseResult.score,
    questionCount: phaseResult.questionCount,
    answers: phaseResult.answers.map(toQuestionAnswer),
  };
}

function toSessionResult(result: BackendSessionResult): InterviewSessionResult {
  return {
    id: result.id,
    userId: result.userId,
    trackId: result.trackId,
    mode: result.mode,
    overallScore: result.overallScore,
    phaseResults: result.phaseResults.map(toPhaseResult),
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    durationSeconds: result.durationSeconds,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// POST /api/v1/interview/start — launches a new mock interview session.
// Requires an active enrollment in the track (the backend returns a 400
// "You must enroll..." otherwise — surfaced to the launcher screen as-is).
export async function startSession(
  trackId: TrackId,
  mode: InterviewMode,
  intensity: SessionIntensity = "standard"
): Promise<SessionStartResult> {
  const { data } = await api.post<BackendSessionStartResponse>("/api/v1/interview/start", {
    track_id: trackId,
    mode,
    intensity,
  });
  return toSessionStartResult(data);
}

export interface SubmitAnswerParams {
  sessionId: string;
  questionId: string;
  phase: InterviewPhase;
  answerType: AnswerType;
  /** Required for voice answers — base64-encoded audio (no size limit, Rule #4). */
  audioBase64?: string;
  audioFormat?: string;
  answerDurationSeconds?: number;
  /** Required for handwritten coding-logic answers — base64 image data. */
  imageBase64?: string;
  imageMimeType?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageSizeBytes?: number;
  /** Required for text answers (Technical phase). */
  textAnswer?: string;
}

export interface SubmitTextAnswerBatchParams {
  sessionId: string;
  phase: InterviewPhase;
  answers: { questionId: string; textAnswer: string }[];
}

// POST /api/v1/interview/answer — scores a single answer. Voice/image answers
// are extracted locally on the backend, then scored through Ollama/Llama. The
// base64 payload plus local model latency can exceed the default axios timeout.
const ANSWER_SUBMISSION_TIMEOUT_MS = 120000;

export async function submitAnswer(params: SubmitAnswerParams): Promise<AnswerResult> {
  const { data } = await api.post<BackendAnswerResponse>(
    "/api/v1/interview/answer",
    {
      session_id: params.sessionId,
      question_id: params.questionId,
      phase: params.phase,
      answer_type: params.answerType,
      audio_base64: params.audioBase64 ?? null,
      audio_format: params.audioFormat ?? null,
      answer_duration_seconds: params.answerDurationSeconds ?? null,
      image_base64: params.imageBase64 ?? null,
      image_mime_type: params.imageMimeType ?? null,
      image_width: params.imageWidth ?? null,
      image_height: params.imageHeight ?? null,
      image_size_bytes: params.imageSizeBytes ?? null,
      text_answer: params.textAnswer ?? null,
    },
    { timeout: ANSWER_SUBMISSION_TIMEOUT_MS }
  );
  return toAnswerResult(data);
}

export async function submitTextAnswerBatch(
  params: SubmitTextAnswerBatchParams
): Promise<AnswerResult[]> {
  const { data } = await api.post<{ answers: BackendAnswerResponse[] }>(
    "/api/v1/interview/answer-batch",
    {
      session_id: params.sessionId,
      phase: params.phase,
      answers: params.answers.map((answer) => ({
        question_id: answer.questionId,
        text_answer: answer.textAnswer,
      })),
    },
    { timeout: ANSWER_SUBMISSION_TIMEOUT_MS }
  );
  return data.answers.map(toAnswerResult);
}

export async function submitTextAnswerBatchAsync(
  params: SubmitTextAnswerBatchParams
): Promise<TechnicalSubmitAck> {
  const { data } = await api.post<BackendTechnicalSubmitAck>(
    "/api/v1/interview/answer-batch-async",
    {
      session_id: params.sessionId,
      phase: params.phase,
      answers: params.answers.map((answer) => ({
        question_id: answer.questionId,
        text_answer: answer.textAnswer,
      })),
    },
    { timeout: 30000 }
  );
  return {
    questionIds: data.questionIds,
    status: data.status,
    message: data.message,
    estimatedSeconds: data.estimatedSeconds,
  };
}

export async function getTechnicalStatus(sessionId: string): Promise<TechnicalScoreStatus[]> {
  const { data } = await api.get<BackendTechnicalStatusResponse>(
    `/api/v1/interview/session/${sessionId}/technical-status`
  );
  return data.technicalAnswers.map((item) => ({
    questionId: item.questionId,
    status: item.status,
    score: item.score,
    feedback: item.feedback,
    criteriaScores: item.criteriaScores ?? {},
    estimatedSeconds: item.estimatedSeconds,
  }));
}

// POST /api/v1/interview/complete — finalizes the session: computes weighted
// phase/overall scores, advances enrollment progress server-side (Rule #6),
// and returns the full SessionResult for the results screen.
export async function completeSession(sessionId: string): Promise<InterviewSessionResult> {
  const { data } = await api.post<BackendSessionResult>("/api/v1/interview/complete", {
    session_id: sessionId,
  });
  return toSessionResult(data);
}

// GET /api/v1/interview/session/{sessionId} — used by the results screen to
// (re)fetch a completed session by id (e.g. on deep-link / refresh). Only
// ever called for completed sessions by the mobile app, so the
// SessionResult shape is what callers should expect back.
export async function getSession(sessionId: string): Promise<InterviewSessionResult> {
  const { data } = await api.get<BackendSessionResult>(`/api/v1/interview/session/${sessionId}`);
  return toSessionResult(data);
}

// GET /api/v1/interview/history — every completed session for the current
// user, optionally filtered by track. Used by the progress screen.
export async function getHistory(trackId?: TrackId): Promise<InterviewSessionResult[]> {
  const { data } = await api.get<BackendHistoryResponse>("/api/v1/interview/history", {
    params: trackId ? { track_id: trackId } : undefined,
  });
  return data.sessions.map(toSessionResult);
}

// ---------------------------------------------------------------------------
// Async coding scoring
// ---------------------------------------------------------------------------

export interface SubmitCodingAsyncParams {
  sessionId: string;
  questionId: string;
  imageBase64: string;
  imageMimeType?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageSizeBytes?: number;
}

/**
 * POST /api/v1/interview/answer-coding — submit a coding answer for async
 * background scoring (202 Accepted).  The server scores in the background
 * and pushes a notification when done; the client polls getCodingStatus().
 */
export async function submitCodingAnswerAsync(params: SubmitCodingAsyncParams): Promise<CodingSubmitAck> {
  const { data } = await api.post<BackendCodingSubmitAck>(
    "/api/v1/interview/answer-coding",
    {
      session_id: params.sessionId,
      question_id: params.questionId,
      phase: "coding_logic",
      image_base64: params.imageBase64,
      image_mime_type: params.imageMimeType ?? null,
      image_width: params.imageWidth ?? null,
      image_height: params.imageHeight ?? null,
      image_size_bytes: params.imageSizeBytes ?? null,
    },
    { timeout: 30000 }
  );
  return {
    questionId: data.questionId,
    status: data.status,
    message: data.message,
    estimatedSeconds: data.estimatedSeconds,
  };
}

/**
 * GET /api/v1/interview/session/{id}/coding-status — poll async scoring status.
 * Returns one entry per coding_logic answer in the session.
 */
export async function getCodingStatus(sessionId: string): Promise<CodingScoreStatus[]> {
  const { data } = await api.get<BackendCodingStatusResponse>(
    `/api/v1/interview/session/${sessionId}/coding-status`
  );
  return data.codingAnswers.map((item) => ({
    questionId: item.questionId,
    status: item.status,
    score: item.score,
    feedback: item.feedback,
    transcription: item.transcription,
    criteriaScores: item.criteriaScores ?? {},
    estimatedSeconds: item.estimatedSeconds,
  }));
}

// ---------------------------------------------------------------------------
// Async voice scoring
// ---------------------------------------------------------------------------

export interface SubmitVoiceAsyncParams {
  sessionId: string;
  questionId: string;
  phase: InterviewPhase;
  audioBase64: string;
  audioFormat?: string;
  answerDurationSeconds?: number;
}

/**
 * POST /api/v1/interview/answer-voice — submit a voice answer for async
 * background Whisper + Ollama scoring (202 Accepted). The server transcribes
 * and scores in the background, then pushes a notification when done.
 * The client should poll getVoiceStatus() to check for completion.
 */
export async function submitVoiceAnswerAsync(params: SubmitVoiceAsyncParams): Promise<VoiceSubmitAck> {
  const { data } = await api.post<BackendVoiceSubmitAck>(
    "/api/v1/interview/answer-voice",
    {
      session_id: params.sessionId,
      question_id: params.questionId,
      phase: params.phase,
      audio_base64: params.audioBase64,
      audio_format: params.audioFormat ?? null,
      answer_duration_seconds: params.answerDurationSeconds ?? null,
    },
    // 2-minute timeout: audio files are submitted in batch at the end of the
    // interview. Each file is 4-5 MB base64 and uploading over WiFi to Atlas
    // can take 30-90 s on a slow connection — well beyond the 30 s default.
    { timeout: 120_000 }
  );
  return {
    questionId: data.questionId,
    status: data.status,
    message: data.message,
    estimatedSeconds: data.estimatedSeconds,
  };
}

/**
 * GET /api/v1/interview/session/{id}/voice-status — poll async voice scoring status.
 * Returns one entry per async-scored voice answer in the session.
 */
export async function getVoiceStatus(sessionId: string): Promise<VoiceScoreStatus[]> {
  const { data } = await api.get<BackendVoiceStatusResponse>(
    `/api/v1/interview/session/${sessionId}/voice-status`
  );
  return data.voiceAnswers.map((item) => ({
    questionId: item.questionId,
    phase: item.phase,
    status: item.status,
    score: item.score,
    feedback: item.feedback,
    transcription: item.transcription,
    criteriaScores: item.criteriaScores ?? {},
    estimatedSeconds: item.estimatedSeconds,
  }));
}

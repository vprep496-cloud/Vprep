# V-PREP Professional Scoring Architecture

This system uses Gemini as the AI evaluator, but final scoring is controlled by the backend. The model reads the answer, produces schema-constrained JSON, and explains the result. The backend then validates the JSON, normalizes every rubric dimension, recomputes the final score from criteria weights, and stores audit metadata.

## Design Sources

- Google Gemini structured output docs: JSON mode is suitable for machine-readable evaluator output, but application code should still validate final values.
  https://ai.google.dev/gemini-api/docs/structured-output
- Google Gemini audio and image docs: Gemini can process audio for transcription/analysis and images for multimodal understanding.
  https://ai.google.dev/gemini-api/docs/audio
  https://ai.google.dev/gemini-api/docs/image-understanding
- U.S. OPM structured interview guidance: professional interviews should use predefined questions, job-related competencies, common rating scales, and consistent scoring standards.
  https://www.opm.gov/policy-data-oversight/assessment-and-selection/other-assessment-methods/structured-interviews/
- EEOC selection procedure guidance: assessments used for employment decisions should be job-related, validated for their purpose, and monitored for adverse impact.
  https://www.eeoc.gov/laws/guidance/employment-tests-and-selection-procedures
- NIST AI RMF: AI systems should be valid, reliable, accountable, transparent, explainable, privacy-aware, and monitored with human judgment where needed.
  https://www.nist.gov/itl/ai-risk-management-framework

## Scoring Modes

The centralized scoring engine lives in `backend/app/services/scoring_engine.py`.

- `hr_voice`: communication clarity, question relevance, structure, professionalism, role alignment.
- `behavioral_voice`: situation context, action ownership, result impact, reflection/learning, communication clarity.
- `technical_text`: technical correctness, depth, reasoning quality, terminology, conciseness.
- `coding_logic_image`: problem understanding, algorithm correctness, edge cases, complexity awareness, readability.
- `assessment_text`: technical correctness, depth, clarity, practical application.

Admin-created question-specific criteria are respected. If a question has custom `scoring_criteria`, the engine scores those exact criteria; otherwise it applies the default professional rubric for that mode.

## Model Routing

- `GEMINI_SCORING_MODEL`: default `gemini-3.5-flash`, used for structured text scoring and technical assessment scoring.
- `GEMINI_MULTIMODAL_MODEL`: default `gemini-3.5-flash`, used for voice/audio scoring and handwritten image scoring.
- `GEMINI_HEALTH_MODEL`: default `gemini-3.1-flash-lite`, used for lightweight live health checks.

The app uses stable model names by default for production predictability. Real secrets stay server-side in backend environment variables.

## Calibration

Every criterion is scored from 0 to 10:

- 0-2: missing, irrelevant, unintelligible, or fundamentally wrong.
- 3-4: weak, vague, mostly incorrect, or keyword-level only.
- 5-6: partially correct but incomplete or shallow.
- 7-8: solid and mostly complete with minor gaps.
- 9-10: excellent, precise, nuanced, and role-ready.

The backend recomputes the final answer score from the criteria weights. This avoids inflated or inconsistent model totals and keeps score math stable across all assessment modes.

## AI Output Contract

The model must return JSON containing:

- `overall_score`
- `criteria_scores`
- `confidence`
- `strengths`
- `improvements`
- `review_flags`
- `evidence`
- `score_rationale`
- `feedback`
- `model_answer`
- `transcription` for audio/image modes

The backend stores:

- candidate-facing score and feedback
- original AI score fields
- confidence and review flags
- scoring rationale and evidence snippets
- `rubric_version`
- `scoring_mode`
- `scoring_metadata`

## Manual Review

Manual review is recommended automatically when:

- the phase is behavioral or coding logic
- model confidence is low
- audio or handwriting transcription is missing or unclear
- the model's raw total differs significantly from backend-calibrated score
- the answer is empty, too short, or very low scoring
- a recording is shorter than the minimum duration or longer than the maximum
- an uploaded coding image is too low-resolution or unusually large

Manual reviewer edits preserve original AI scoring fields so admins can compare the AI result with the human override.

## Performance

- Interview answers are scored one at a time because each answer can be voice, typed text, or image.
- Technical assessment answers are scored in one batch call for speed.
- Gemini calls use temperature `0.0`, JSON schema-constrained output, and a retry-on-invalid-JSON path.
- Final score math is local and fast.

## Production Notes

This architecture is ready for a professional prep platform. For real hiring decisions, keep the system as an assistive scoring workflow unless the organization has completed job-analysis validation, adverse-impact monitoring, and human review policies for the exact role and use case.

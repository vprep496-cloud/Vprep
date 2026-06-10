# Scoring Architecture

The scoring system is backend-controlled and local-AI powered.

Flow:

React Native app -> FastAPI -> LangChain -> Ollama -> `llama3.2:3b`

The mobile app never calls the model directly. It sends answers, recordings,
or coding-solution images to FastAPI. The backend extracts text where needed,
prompts the local model, validates JSON, recalibrates scores from rubric
criteria, and stores scoring metadata.

## Provider

- Provider: Ollama
- Model: `llama3.2:3b`
- LangChain package: `langchain-ollama`
- Backend provider file: `app/services/ai_provider.py`

## Media Handling

`llama3.2:3b` is text-only.

- Typed answers go directly to the scoring prompt.
- Handwritten coding images are OCR-extracted locally, then scored.
- CV PDFs/images/text are extracted locally, then summarized into candidate
  profile signals for personalization.
- Voice recordings can be transcribed locally through `faster-whisper` when
  installed; otherwise the backend returns a clear setup error.

## Professional Scoring

The backend owns final scoring:

- Independent 0-10 criterion scores.
- Weighted rubric aggregation.
- Overall 0-100 calibrated score.
- Confidence, strengths, improvements, evidence, and review flags.
- Manual-review flags for low confidence, OCR issues, behavioral answers, and
  coding-logic submissions.

## Personalization

Question generation uses:

- Track topic areas.
- Candidate level.
- Target role.
- Years of experience.
- CV skills.
- CV projects.
- CV summary.
- Predefined-style calibration questions.

This gives each user a personalized interview while keeping standardized
questions for fair scoring across users.

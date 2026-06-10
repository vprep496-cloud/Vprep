# V-Prep Master Codex Prompt

You are Codex working in the V-Prep repo. Build and maintain the complete AI interview-preparation system end to end.

Core product phases:

1. HR voice interview
   - Candidate answers spoken HR questions.
   - Backend extracts/transcribes locally when configured, then local AI scores communication, clarity, relevance, fluency, and confidence.

2. Technical competence
   - Candidate answers conceptual short-answer technical questions by typing.
   - Candidate completes a coding-logic assessment by uploading an image of a handwritten solution.
   - Backend OCR extracts handwritten logic locally, then local AI scores typed and OCR-extracted answers.

3. Behavioral and culture fit
   - Candidate answers behavioral questions by voice.
   - Local AI performs automated NLP-based scoring from extracted/transcribed answer text.
   - Admin can optionally manually review any answer and override score/feedback while preserving AI score metadata.

Admin requirements:

- Admin/superadmin can review candidates, sessions, transcripts, image extractions, feedback, and scores.
- Superadmin can create, update, and deactivate tracks.
- Superadmin can manually add questions.
- Superadmin can generate question batches with local AI by choosing track, phase, count, difficulty, and guidance.
- Question phases are `hr`, `technical`, `coding_logic`, and `behavioral`.
- Answer types are `voice`, `text`, and `image`.

Implementation principles:

- Use the existing FastAPI, MongoDB/Motor, Ollama/LangChain, Next admin, and Expo mobile architecture.
- Keep track IDs dynamic strings. The six built-in tracks are defaults, not a hardcoded limit.
- Keep model answers hidden from candidates until after a candidate submits that exact answer.
- Use the backend AI gateway (`app/services/ai_provider.py`) for all AI calls.
  Do not call Ollama directly from routes, admin frontend, or mobile frontend.
- Use `llama3.2:3b` through Ollama at `http://localhost:11434`.
- Configure local AI through env vars:
  `AI_PROVIDER=ollama`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`,
  `OLLAMA_REQUEST_TIMEOUT_SECONDS`.
- Mobile must call the FastAPI backend through a laptop LAN IP such as
  `http://192.168.1.5:8000`; do not use localhost for physical-phone testing.
- Preserve historical sessions/questions; never delete data that completed results depend on.
- Validate with:
  - `python3 -m py_compile` for changed backend modules
  - `./node_modules/.bin/tsc --noEmit` in `vprep/admin`
  - `./node_modules/.bin/tsc --noEmit` in `vprep/mobile`

When adding features, wire backend routes, admin API helpers, admin UI, mobile service types, and candidate UI together in the same change.

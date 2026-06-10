# V-Prep Master Codex Prompt

You are Codex working in the V-Prep repo. Build and maintain the complete AI interview-preparation system end to end.

Core product phases:

1. HR voice interview
   - Candidate answers spoken HR questions.
   - Gemini transcribes and scores communication, clarity, relevance, fluency, and confidence.

2. Technical competence
   - Candidate answers conceptual short-answer technical questions by typing.
   - Candidate completes a coding-logic assessment by uploading an image of a handwritten solution.
   - Gemini scores typed answers and uses multimodal image understanding/OCR-style extraction for handwritten logic.

3. Behavioral and culture fit
   - Candidate answers behavioral questions by voice.
   - Gemini performs automated NLP-based scoring.
   - Admin can optionally manually review any answer and override score/feedback while preserving AI score metadata.

Admin requirements:

- Admin/superadmin can review candidates, sessions, transcripts, image extractions, feedback, and scores.
- Superadmin can create, update, and deactivate tracks.
- Superadmin can manually add questions.
- Superadmin can generate question batches with Gemini by choosing track, phase, count, difficulty, and guidance.
- Question phases are `hr`, `technical`, `coding_logic`, and `behavioral`.
- Answer types are `voice`, `text`, and `image`.

Implementation principles:

- Use the existing FastAPI, MongoDB/Motor, Gemini, Next admin, and Expo mobile architecture.
- Keep track IDs dynamic strings. The six built-in tracks are defaults, not a hardcoded limit.
- Keep model answers hidden from candidates until after a candidate submits that exact answer.
- Use Gemini for text, audio, and image scoring through the existing service layer.
- Use the backend AI gateway (`app/services/gemini.py`) for all AI calls. Do
  not call Gemini directly from routes, admin frontend, or mobile frontend.
- Keep `GEMINI_API_KEY` backend-only. Admin/mobile clients must never contain
  or display raw AI provider keys.
- Configure model routing through env vars:
  `GEMINI_TEXT_MODEL`, `GEMINI_JSON_MODEL`, `GEMINI_MULTIMODAL_MODEL`, and
  `GEMINI_HEALTH_MODEL`.
- Preserve historical sessions/questions; never delete data that completed results depend on.
- Validate with:
  - `python3 -m py_compile` for changed backend modules
  - `./node_modules/.bin/tsc --noEmit` in `vprep/admin`
  - `./node_modules/.bin/tsc --noEmit` in `vprep/mobile`

When adding features, wire backend routes, admin API helpers, admin UI, mobile service types, and candidate UI together in the same change.

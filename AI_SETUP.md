# V-Prep AI Setup

V-Prep uses Gemini through the backend only. Do not put `GEMINI_API_KEY` in the
mobile app or the Next admin app.

## 1. Create the key

Create a Gemini API key in Google AI Studio:

https://aistudio.google.com/app/apikey

Add it to `vprep/backend/.env`:

```env
GEMINI_API_KEY=your-real-key
```

`GOOGLE_API_KEY` is supported as a fallback, but prefer `GEMINI_API_KEY` so the
deployment is explicit.

## 2. Install the current Gemini SDK

From `vprep/backend`:

```bash
pip install -r requirements.txt
```

The backend uses Google’s current `google-genai` SDK, not the legacy
`google-generativeai` package.

## 3. Model routing

Defaults:

```env
GEMINI_TEXT_MODEL=gemini-2.5-flash
GEMINI_JSON_MODEL=gemini-2.5-flash
GEMINI_MULTIMODAL_MODEL=gemini-2.5-flash
GEMINI_HEALTH_MODEL=gemini-2.5-flash
```

Where each route is used:

- `GEMINI_TEXT_MODEL`: plain text generation.
- `GEMINI_JSON_MODEL`: assessment questions, scoring JSON, plans, admin-generated questions.
- `GEMINI_MULTIMODAL_MODEL`: voice transcription/scoring and handwritten coding-logic image scoring.
- `GEMINI_HEALTH_MODEL`: low-cost live setup check.

## 4. Professional safety model

- Candidate apps never receive the Gemini key.
- Admin status shows only a SHA-256 key fingerprint, never the key itself.
- Scoring uses low temperature for consistent evaluation.
- Admin question/plan generation uses a higher creative temperature.
- Model names are environment-driven so you can upgrade without code changes.

## 5. Verify setup

Start the backend and check:

```bash
curl http://localhost:8000/health
```

Then open the admin dashboard and go to **AI**. Press **Run Live Check** to make
a real Gemini request and confirm the key/model works.

## 6. Recommended production environment

Set these variables in your hosting provider’s secret manager:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_TEXT_MODEL=gemini-2.5-flash
GEMINI_JSON_MODEL=gemini-2.5-flash
GEMINI_MULTIMODAL_MODEL=gemini-2.5-flash
GEMINI_HEALTH_MODEL=gemini-2.5-flash
AI_TEMPERATURE=0.2
AI_CREATIVE_TEMPERATURE=0.7
AI_TOP_P=0.95
AI_MAX_OUTPUT_TOKENS=8192
```

Rotate the key immediately if it is ever pasted into frontend code, committed
to git, shared in screenshots, or exposed in logs.

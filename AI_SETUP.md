# Local AI Setup

V-Prep now uses a local AI backend only. The React Native app calls FastAPI
over HTTP; FastAPI talks to Ollama through LangChain.

## 1. Install and pull the model

```bash
ollama pull llama3.2:3b
```

Ollama must be reachable from the backend laptop at:

```bash
http://localhost:11434
```

## 2. Start the backend

```bash
cd interview-ai-backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

## 3. Configure the mobile app

Use the laptop LAN IP, not localhost:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.5:8000
```

Change `192.168.1.5` to your laptop IP.

## 4. Media extraction

`llama3.2:3b` is text-only, so the backend extracts media content first:

- CV PDFs: `pypdf`
- CV and coding images: `pytesseract` + `pillow`
- Voice recordings: optional `faster-whisper`

Install the Tesseract system binary on the laptop for OCR.

## 5. Health check

Open:

```bash
http://localhost:8000/health
```

The admin portal also exposes a live Ollama check under AI Configuration.

# OtaconAI

A streaming chat assistant built on Google's Gemini API, with a React frontend and a FastAPI backend. Named after Hal "Otacon" Emmerich from Metal Gear Solid.

![React](https://img.shields.io/badge/React-18-61dafb) ![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688) ![Python](https://img.shields.io/badge/Python-3.12-3776ab)

## What it does

- **Streams replies token by token** over server-sent events, so answers appear as they're written instead of after a pause
- **Reads images, PDFs and text files** — drag them anywhere, paste from the clipboard, or use the paperclip
- **Keeps multiple conversations** side by side, saved locally, searchable, renameable, exportable as Markdown
- **Renders Markdown** including fenced code blocks with per-block copy
- **Tells you when it's broken** — a live backend status indicator and error messages that say what to do next

## Running it

You need [Python 3.10+](https://python.org) and [Node 18+](https://nodejs.org).

1. Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)
2. Copy `backend/.env.example` to `backend/.env` and paste your key in
3. Run the launcher:

   **Windows** — double-click `start.bat`
   **macOS / Linux** — `./start.sh`

The launcher creates the virtual environment, installs both sets of dependencies, and starts both servers. First run takes a few minutes; after that it's a few seconds. The app opens at `http://localhost:3000`.

## Architecture

```
Browser ──► React (:3000 in dev)
              │  POST /api/chat/stream
              ▼
           FastAPI (:8000) ──► Gemini API
```

The backend holds no conversation state. The client sends the history it wants the model to see with each request, which is what lets several chats run at once without bleeding into each other — and what makes the server horizontally scalable, since any instance can serve any request.

In production FastAPI also serves the built React bundle, so the whole app is **one process on one port**.

### API

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Liveness check and current model |
| `/api/chat` | POST | Single-shot reply |
| `/api/chat/stream` | POST | Server-sent events, one frame per delta |

Request body:

```json
{
  "message": "What's in this screenshot?",
  "history": [{ "role": "user", "content": "..." }],
  "attachments": [{ "name": "shot.png", "mime_type": "image/png", "data": "<base64>" }]
}
```

## Deploying

The `Dockerfile` builds the frontend and serves it from the backend as one image:

```bash
docker build -t otacon .
docker run -p 8000:8000 -e GEMINI_API_KEY=your-key otacon
```

It respects `$PORT`, so it runs as-is on Render, Railway, Fly.io or Cloud Run. Set `GEMINI_API_KEY` as a secret in your host's dashboard — never commit `.env`.

To build without Docker:

```bash
cd frontend && npm run build
cd ../backend && uvicorn main:app --port 8000
```

FastAPI picks up `frontend/build` automatically and serves the app at `/`.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `GEMINI_API_KEY` | — | Required |
| `GEMINI_MODEL` | `gemini-3.6-flash` | Any Gemini model string |
| `OTACON_ORIGINS` | `http://localhost:3000` | CORS allowlist, comma separated |
| `REACT_APP_API_BASE` | same origin | Set only if the frontend is hosted separately |

## Tests

```bash
cd frontend && npm test
```

Covers the empty state, send-button gating, streaming assembly, server errors, offline handling, search, and conversation creation.

## Limits

Attachments are capped at 5 files and 10 MB each, and the accepted types are PNG, JPEG, WebP, HEIC, PDF, plain text, Markdown and CSV. File bytes aren't written to localStorage — a reload keeps the file name in the transcript but not the image itself, which keeps conversations under the browser storage quota.

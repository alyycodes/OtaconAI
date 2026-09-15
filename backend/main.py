"""OtaconAI API.

In development the React dev server runs on :3000 and talks to this on :8000.
In production this process serves the built frontend too, so the whole app is
one service on one port.
"""

import json
import logging
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from chat import MODEL, OtaconError, chat_with_otacon, stream_otacon

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("otacon")

app = FastAPI(title="OtaconAI", version="3.0.0")

# Same-origin in production, so this only matters for the dev server. Set
# OTACON_ORIGINS="https://yourdomain.com" if you host the frontend separately.
ORIGINS = os.getenv(
    "OTACON_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in ORIGINS if o.strip()],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class Turn(BaseModel):
    role: str
    content: str


class Attachment(BaseModel):
    name: str = Field(max_length=300)
    mime_type: str = Field(max_length=120)
    data: str  # base64, with or without the data: URL prefix


class Message(BaseModel):
    message: str = Field(default="", max_length=8000)
    history: list[Turn] = Field(default_factory=list, max_length=100)
    attachments: list[Attachment] = Field(default_factory=list, max_length=5)


def _unpack(msg: Message):
    return (
        msg.message,
        [turn.model_dump() for turn in msg.history],
        [a.model_dump() for a in msg.attachments],
    )


@app.get("/api/health")
def health():
    return {"status": "ok", "model": MODEL}


@app.post("/api/chat")
def chat(msg: Message):
    """Non-streaming reply. Kept as a fallback and for simple integrations."""
    message, history, attachments = _unpack(msg)
    try:
        reply = chat_with_otacon(message, history=history, attachments=attachments)
    except OtaconError as exc:
        logger.error("Chat failed: %s", exc)
        # 502: this server is fine, the upstream model call is not.
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"reply": reply}


@app.post("/api/chat/stream")
def chat_stream(msg: Message):
    """Server-sent events. Each frame is one delta; the last one is done."""
    message, history, attachments = _unpack(msg)

    generator = stream_otacon(message, history=history, attachments=attachments)

    # Pull the first chunk here so a bad request becomes a real HTTP error
    # instead of a 200 that immediately fails mid-stream.
    try:
        first = next(generator, None)
    except OtaconError as exc:
        logger.error("Stream failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    def frames():
        def frame(payload):
            return f"data: {json.dumps(payload)}\n\n"

        try:
            if first:
                yield frame({"delta": first})
            for piece in generator:
                yield frame({"delta": piece})
            yield frame({"done": True})
        except OtaconError as exc:
            logger.error("Stream interrupted: %s", exc)
            yield frame({"error": str(exc)})
        except Exception as exc:  # noqa: BLE001 - never leave the client hanging
            logger.exception("Unexpected stream failure")
            yield frame({"error": f"Stream failed: {exc}"})

    return StreamingResponse(
        frames(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # stops nginx from buffering the stream
        },
    )


# --------------------------------------------------------------------------
# Serve the built frontend, when there is one.
# --------------------------------------------------------------------------

BUILD_DIR = Path(__file__).resolve().parent.parent / "frontend" / "build"

if BUILD_DIR.is_dir():
    app.mount(
        "/static", StaticFiles(directory=BUILD_DIR / "static"), name="static"
    )

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        """Serve real files directly, everything else falls back to index.html."""
        candidate = (BUILD_DIR / full_path).resolve()
        if full_path and candidate.is_file() and BUILD_DIR in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(BUILD_DIR / "index.html")

    logger.info("Serving frontend from %s", BUILD_DIR)
else:

    @app.get("/")
    def root():
        return {
            "message": "OtaconAI is online. Codec open.",
            "note": "No frontend build found — run the React dev server on :3000.",
        }

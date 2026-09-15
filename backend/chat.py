"""Gemini wrapper for OtaconAI.

Stateless by design: the client owns the conversation, so several chats can run
side by side without bleeding into each other.
"""

import base64
import os

from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv(override=False)

API_KEY = os.getenv("GEMINI_API_KEY")
if not API_KEY:
    raise RuntimeError(
        "GEMINI_API_KEY environment variable is missing."
    )

MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")

# One turn is one message, so this keeps roughly the last 20 exchanges.
MAX_TURNS = 40

# What the model can actually read. Anything else is rejected before upload.
ALLOWED_MIME = {
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/heic",
    "image/heif",
    "application/pdf",
    "text/plain",
    "text/markdown",
    "text/csv",
}

MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB per file

client = genai.Client(api_key=API_KEY)

SYSTEM_PROMPT = """You are OtaconAI, a highly intelligent AI assistant inspired by Hal Emmerich (Otacon) from Metal Gear Solid.
You are brilliant, helpful, slightly nerdy, and loyal.
You adapt to the user's personality and pay close attention to what the user tells you.
You are here to help with anything — coding, life advice, questions, everything.

Format your replies in Markdown. Use fenced code blocks with a language tag for code,
short paragraphs for explanations, and bullet lists only when the content is genuinely a list.
When the user attaches an image or document, read it carefully and refer to what you actually see in it."""


class OtaconError(Exception):
    """Raised when the model call fails or comes back empty."""


def _attachment_parts(attachments):
    """Turn [{name, mime_type, data(base64)}] into Gemini Parts."""
    parts = []
    for item in attachments or []:
        mime = (item.get("mime_type") or "").split(";")[0].strip().lower()
        if mime not in ALLOWED_MIME:
            raise OtaconError(f"Unsupported file type: {mime or 'unknown'}")

        raw = item.get("data") or ""
        # Browsers send data URLs; keep only the payload after the comma.
        if "," in raw and raw.strip().startswith("data:"):
            raw = raw.split(",", 1)[1]

        try:
            blob = base64.b64decode(raw, validate=True)
        except Exception as exc:
            raise OtaconError(f"Could not decode {item.get('name', 'file')}") from exc

        if not blob:
            raise OtaconError(f"{item.get('name', 'File')} is empty")
        if len(blob) > MAX_FILE_BYTES:
            raise OtaconError(
                f"{item.get('name', 'File')} is larger than "
                f"{MAX_FILE_BYTES // (1024 * 1024)} MB"
            )

        parts.append(types.Part.from_bytes(data=blob, mime_type=mime))
    return parts


def _to_contents(history):
    """Convert the frontend's [{role, content}] into Gemini Content objects.

    Gemini calls the assistant role "model" and rejects empty parts, so blanks
    are dropped rather than sent.
    """
    contents = []
    for turn in history[-MAX_TURNS:]:
        text = (turn.get("content") or "").strip()
        if not text:
            continue
        role = "model" if turn.get("role") in ("assistant", "ai", "model") else "user"
        contents.append(types.Content(role=role, parts=[types.Part(text=text)]))
    return contents


def _build_contents(user_message, history, attachments):
    contents = _to_contents(history or [])

    parts = _attachment_parts(attachments)
    text = (user_message or "").strip()
    if text:
        parts.append(types.Part(text=text))

    if not parts:
        raise OtaconError("Nothing to send — add a message or a file.")

    contents.append(types.Content(role="user", parts=parts))
    return contents


def _config():
    return types.GenerateContentConfig(system_instruction=SYSTEM_PROMPT)


def chat_with_otacon(user_message: str, history=None, attachments=None) -> str:
    """Single-shot reply. Used by /chat and by anything that can't stream."""
    contents = _build_contents(user_message, history, attachments)

    try:
        response = client.models.generate_content(
            model=MODEL, contents=contents, config=_config()
        )
    except Exception as exc:
        raise OtaconError(f"Gemini request failed: {exc}") from exc

    reply = (response.text or "").strip()

    if not reply:
        # Usually a safety block or a finish reason other than STOP.
        feedback = getattr(response, "prompt_feedback", None)
        raise OtaconError(
            f"The model returned no text (prompt_feedback={feedback})."
            if feedback
            else "The model returned no text."
        )

    return reply


def stream_otacon(user_message: str, history=None, attachments=None):
    """Yield the reply in chunks as the model produces it.

    Raises OtaconError before the first chunk if the request itself is bad, so
    the caller can still return a clean HTTP error instead of a broken stream.
    """
    contents = _build_contents(user_message, history, attachments)

    try:
        stream = client.models.generate_content_stream(
            model=MODEL, contents=contents, config=_config()
        )
    except Exception as exc:
        raise OtaconError(f"Gemini request failed: {exc}") from exc

    produced = False
    for chunk in stream:
        piece = getattr(chunk, "text", None)
        if piece:
            produced = True
            yield piece

    if not produced:
        raise OtaconError("The model returned no text.")

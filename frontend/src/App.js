import { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect } from "react";
import "./App.css";

/* ==========================================================================
   Configuration
   ========================================================================== */

/* In development the React dev server runs on :3000 and the API on :8000.
   In production FastAPI serves this bundle, so same-origin relative URLs work. */
const DEV = window.location.port === "3000";
const API_BASE = process.env.REACT_APP_API_BASE ?? (DEV ? "http://127.0.0.1:8000" : "");

const STORE_KEY = "otacon.chats.v3";
const MAX_CHARS = 8000;
const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const ACCEPTED = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
];

const STARTERS = [
  { title: "Explain a concept", body: "Break down how JWT authentication works" },
  { title: "Review my code", body: "Find the bugs in this function and explain each one" },
  { title: "Plan something", body: "Outline a two-week plan to ship a REST API" },
  { title: "Read a screenshot", body: "Attach an image and ask me what's wrong with it" },
];

/* ==========================================================================
   Helpers
   ========================================================================== */

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const stamp = () =>
  new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const blankChat = () => ({
  id: uid(),
  title: "New conversation",
  messages: [],
  createdAt: Date.now(),
});

const isImage = (mime) => (mime || "").startsWith("image/");

function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function titleFrom(messages, current) {
  if (current && current !== "New conversation") return current;
  const first = messages.find((m) => m.role === "user");
  if (!first) return "New conversation";
  const clean = (first.text || first.files?.[0]?.name || "").replace(/\s+/g, " ").trim();
  if (!clean) return "New conversation";
  return clean.length > 38 ? `${clean.slice(0, 38)}…` : clean;
}

/* Attachment payloads are huge, so they're dropped before saving. The file
   name and type stay, which is enough to render the chip after a reload. */
function forStorage(chats) {
  return chats.slice(0, 60).map((c) => ({
    ...c,
    messages: c.messages.map(({ streaming, ...m }) => ({
      ...m,
      files: m.files?.map(({ data, ...f }) => ({ ...f, dropped: true })),
    })),
  }));
}

function loadChats() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (Array.isArray(saved) && saved.length && saved[0].id) return saved;
  } catch {
    /* corrupt or unavailable storage — start fresh */
  }
  return [blankChat()];
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function exportMarkdown(chat) {
  const lines = [`# ${chat.title}`, ""];
  chat.messages.forEach((m) => {
    lines.push(`**${m.role === "user" ? "You" : "OtaconAI"}** · ${m.time}`, "");
    if (m.files?.length) lines.push(m.files.map((f) => `\`${f.name}\``).join(" "), "");
    lines.push(m.text || "", "");
  });

  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${chat.title.replace(/[^\w\s-]/g, "").trim() || "conversation"}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ==========================================================================
   Icons
   ========================================================================== */

const Icon = ({ d, size = 17, fill = "none" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill}
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {d}
  </svg>
);

const IconPlus = () => <Icon d={<><path d="M12 5v14" /><path d="M5 12h14" /></>} />;
const IconTrash = ({ size = 15 }) => (
  <Icon size={size} d={<><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /></>} />
);
const IconCopy = () => (
  <Icon size={13} d={<><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></>} />
);
const IconCheck = ({ size = 13 }) => <Icon size={size} d={<path d="M20 6L9 17l-5-5" />} />;
const IconRefresh = () => (
  <Icon size={13} d={<><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></>} />
);
const IconSend = () => <Icon size={19} d={<><path d="M12 19V5" /><path d="M6 11l6-6 6 6" /></>} />;
const IconStop = () => <Icon size={16} fill="currentColor" d={<rect x="7" y="7" width="10" height="10" rx="2" />} />;
const IconMenu = () => <Icon d={<><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>} />;
const IconDown = () => <Icon size={14} d={<><path d="M12 5v14" /><path d="M6 13l6 6 6-6" /></>} />;
const IconEdit = () => (
  <Icon size={15} d={<><path d="M4 20h4L20 8l-4-4L4 16v4z" /><path d="M14 6l4 4" /></>} />
);
const IconClip = () => (
  <Icon size={18} d={<path d="M20 11l-8.5 8.5a4.5 4.5 0 0 1-6.4-6.4L13 4.8a3 3 0 0 1 4.3 4.3l-8 8a1.5 1.5 0 0 1-2.2-2.2l7.6-7.6" />} />
);
const IconSearch = () => (
  <Icon size={14} d={<><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>} />
);
const IconDownload = () => (
  <Icon size={15} d={<><path d="M12 4v11" /><path d="M7 11l5 5 5-5" /><path d="M5 20h14" /></>} />
);
const IconFile = ({ size = 15 }) => (
  <Icon size={size} d={<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>} />
);
const IconX = ({ size = 13 }) => <Icon size={size} d={<><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>} />;
const IconGlyph = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 2.6l9.4 9.4-9.4 9.4L2.6 12z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M12 7.6l4.4 4.4-4.4 4.4L7.6 12z" fill="currentColor" />
  </svg>
);

/* ==========================================================================
   Markdown — dependency-free renderer
   ========================================================================== */

const INLINE = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|https?:\/\/[^\s<]+)/g;

function inlineNodes(text, keyBase) {
  return text.split(INLINE).filter(Boolean).map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={key}>{part.slice(1, -1)}</code>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={key}>{part.slice(1, -1)}</em>;

    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    const href = link ? link[2] : part.startsWith("http") ? part : null;
    if (href) {
      return (
        <a key={key} href={href} target="_blank" rel="noreferrer noopener">
          {link ? link[1] : part}
        </a>
      );
    }
    return <span key={key}>{part}</span>;
  });
}

function CodeBlock({ lang, code }) {
  const [done, setDone] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setDone(true);
      setTimeout(() => setDone(false), 1800);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="code">
      <div className="code__bar">
        <span>{lang || "code"}</span>
        <button className="mini-btn" onClick={copy} data-done={done} type="button">
          {done ? <IconCheck /> : <IconCopy />}
          {done ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Markdown({ text }) {
  const segments = String(text ?? "").split(/```/);

  return segments.map((segment, s) => {
    // Odd segments sit between fences, so they are code.
    if (s % 2 === 1) {
      const newline = segment.indexOf("\n");
      const firstLine = newline === -1 ? segment : segment.slice(0, newline);
      const isLang = /^[\w+#.-]{0,16}$/.test(firstLine.trim());
      return (
        <CodeBlock
          key={s}
          lang={isLang ? firstLine.trim() : ""}
          code={(isLang && newline !== -1 ? segment.slice(newline + 1) : segment).replace(/\n$/, "")}
        />
      );
    }

    const blocks = [];
    let paragraph = [];
    let list = null;

    const flush = () => {
      if (paragraph.length) {
        blocks.push(
          <p key={`p${s}-${blocks.length}`}>{inlineNodes(paragraph.join("\n"), `i${s}-${blocks.length}`)}</p>
        );
        paragraph = [];
      }
      if (list) {
        const Tag = list.ordered ? "ol" : "ul";
        blocks.push(
          <Tag key={`l${s}-${blocks.length}`}>
            {list.items.map((item, n) => (
              <li key={n}>{inlineNodes(item, `li${s}-${blocks.length}-${n}`)}</li>
            ))}
          </Tag>
        );
        list = null;
      }
    };

    segment.split("\n").forEach((line) => {
      const heading = /^#{1,6}\s+(.*)$/.exec(line);
      const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
      const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);

      if (heading) {
        flush();
        blocks.push(<h3 key={`h${s}-${blocks.length}`}>{inlineNodes(heading[1], `hi${s}-${blocks.length}`)}</h3>);
      } else if (bullet || numbered) {
        if (paragraph.length) flush();
        const ordered = Boolean(numbered);
        if (!list || list.ordered !== ordered) {
          if (list) flush();
          list = { ordered, items: [] };
        }
        list.items.push((bullet || numbered)[1]);
      } else if (!line.trim()) {
        flush();
      } else {
        if (list) flush();
        paragraph.push(line);
      }
    });

    flush();
    return <div key={s}>{blocks}</div>;
  });
}

/* ==========================================================================
   Attachments
   ========================================================================== */

function FileChips({ files, onRemove }) {
  if (!files?.length) return null;

  return (
    <div className="chips">
      {files.map((f, i) => (
        <div className="chip" key={`${f.name}-${i}`} title={f.name}>
          {isImage(f.mime_type) && f.data ? (
            <img src={f.data} alt="" className="chip__thumb" />
          ) : (
            <span className="chip__icon">
              <IconFile size={14} />
            </span>
          )}
          <span className="chip__name">{f.name}</span>
          {f.size ? <span className="chip__size">{fileSize(f.size)}</span> : null}
          {onRemove && (
            <button className="chip__x" onClick={() => onRemove(i)} aria-label={`Remove ${f.name}`} type="button">
              <IconX />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ==========================================================================
   Message
   ========================================================================== */

function Message({ msg, onRetry, isLastAI }) {
  const [copied, setCopied] = useState(false);
  const mine = msg.role === "user";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(msg.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked */
    }
  };

  const bubbleClass = msg.error ? "bubble--error" : mine ? "bubble--user" : "bubble--ai";

  return (
    <article className={`msg ${mine ? "msg--user" : "msg--ai"}`}>
      <div className={`avatar ${mine ? "avatar--user" : "avatar--ai"}`} aria-hidden="true">
        {mine ? "You" : <IconGlyph size={17} />}
      </div>

      <div className="msg__col">
        {msg.files?.length > 0 && <FileChips files={msg.files} />}

        {(msg.text || !msg.files?.length) && (
          <div className={`bubble ${bubbleClass}`}>
            {mine ? msg.text : <Markdown text={msg.text} />}
            {msg.streaming && <span className="caret" aria-hidden="true" />}
          </div>
        )}

        {!msg.streaming && (
          <div className="msg__foot">
            <span className="msg__time">{msg.time}</span>
            {msg.text && (
              <button className="mini-btn" onClick={copy} data-done={copied} type="button">
                {copied ? <IconCheck /> : <IconCopy />}
                {copied ? "Copied" : "Copy"}
              </button>
            )}
            {!mine && isLastAI && (
              <button className="mini-btn" onClick={onRetry} type="button">
                <IconRefresh />
                Try again
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

/* ==========================================================================
   App
   ========================================================================== */

export default function App() {
  const [chats, setChats] = useState(loadChats);
  const [activeId, setActiveId] = useState(() => chats[0].id);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState([]); // staged attachments
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState("checking"); // checking | online | offline
  const [railOpen, setRailOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);
  const [toasts, setToasts] = useState([]);

  const transcriptRef = useRef(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const renameRef = useRef(null);
  const fileRef = useRef(null);
  const abortRef = useRef(null);
  const dragDepth = useRef(0);

  const chat = useMemo(
    () => chats.find((c) => c.id === activeId) || chats[0],
    [chats, activeId]
  );
  const messages = useMemo(() => chat?.messages || [], [chat]);
  const lastAIIndex = messages.map((m) => m.role).lastIndexOf("ai");

  const visibleChats = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => (m.text || "").toLowerCase().includes(q))
    );
  }, [chats, query]);

  /* ---- toasts ---- */
  const toast = useCallback((text, tone = "info") => {
    const id = uid();
    setToasts((prev) => [...prev, { id, text, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  /* ---- persistence ---- */
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(forStorage(chats)));
    } catch {
      /* quota or private mode — the session still works in memory */
    }
  }, [chats]);

  /* ---- backend reachability ---- */
  const ping = useCallback(async () => {
    setServer("checking");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(`${API_BASE}/api/health`, { signal: ctrl.signal });
      setServer(res.ok ? "online" : "offline");
    } catch {
      setServer("offline");
    } finally {
      clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    ping();
  }, [ping]);

  /* ---- scrolling ---- */
  useEffect(() => {
    if (atBottom) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, busy, atBottom]);

  const onScroll = () => {
    const el = transcriptRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 90);
  };

  /* ---- textarea auto-height ---- */
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  useEffect(() => {
    if (renaming) {
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [renaming]);

  /* ---- chat operations ---- */
  const writeMessages = useCallback((id, next) => {
    setChats((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, messages: next, title: titleFrom(next, c.title) } : c
      )
    );
  }, []);

  const newChat = useCallback(() => {
    const fresh = blankChat();
    setChats((prev) => [fresh, ...prev]);
    setActiveId(fresh.id);
    setRailOpen(false);
    setAtBottom(true);
    setPending([]);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const openChat = (id) => {
    setActiveId(id);
    setRailOpen(false);
    setAtBottom(true);
  };

  const deleteChat = (id, event) => {
    event.stopPropagation();
    const rest = chats.filter((c) => c.id !== id);
    if (!rest.length) {
      const fresh = blankChat();
      setChats([fresh]);
      setActiveId(fresh.id);
      return;
    }
    setChats(rest);
    if (id === activeId) setActiveId(rest[0].id);
  };

  const rename = (value) => {
    const title = value.trim() || "New conversation";
    setChats((prev) => prev.map((c) => (c.id === activeId ? { ...c, title } : c)));
    setRenaming(false);
  };

  /* ---- attachments ---- */
  const addFiles = useCallback(
    async (fileList) => {
      const incoming = Array.from(fileList || []);
      if (!incoming.length) return;

      const room = MAX_FILES - pending.length;
      if (room <= 0) {
        toast(`Up to ${MAX_FILES} files per message`, "warn");
        return;
      }

      const accepted = [];
      for (const file of incoming.slice(0, room)) {
        if (!ACCEPTED.includes(file.type)) {
          toast(`${file.name}: unsupported file type`, "warn");
          continue;
        }
        if (file.size > MAX_FILE_BYTES) {
          toast(`${file.name} is over 10 MB`, "warn");
          continue;
        }
        try {
          accepted.push({
            name: file.name,
            mime_type: file.type,
            size: file.size,
            data: await readAsDataURL(file),
          });
        } catch {
          toast(`Could not read ${file.name}`, "warn");
        }
      }

      if (accepted.length) setPending((prev) => [...prev, ...accepted]);
    },
    [pending.length, toast]
  );

  const onPaste = (event) => {
    const files = Array.from(event.clipboardData?.files || []);
    if (files.length) {
      event.preventDefault();
      addFiles(files);
    }
  };

  /* Drag and drop over the whole window. */
  useEffect(() => {
    const over = (e) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    };
    const leave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const drop = (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      addFiles(e.dataTransfer.files);
    };
    const allow = (e) => {
      if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
    };

    window.addEventListener("dragenter", over);
    window.addEventListener("dragover", allow);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", over);
      window.removeEventListener("dragover", allow);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [addFiles]);

  /* ---- sending ---- */
  const ask = useCallback(
    async (text, files, base, chatId) => {
      setBusy(true);
      setAtBottom(true);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const history = base
        .slice(0, -1) // the backend appends the current turn itself
        .filter((m) => m.text)
        .map((m) => ({ role: m.role === "ai" ? "assistant" : "user", content: m.text }));

      let acc = "";
      const paint = (streaming) =>
        writeMessages(chatId, [
          ...base,
          { role: "ai", text: acc, time: stamp(), streaming },
        ]);

      try {
        const res = await fetch(`${API_BASE}/api/chat/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            history,
            attachments: files.map(({ name, mime_type, data }) => ({ name, mime_type, data })),
          }),
          signal: ctrl.signal,
        });

        if (!res.ok) {
          let detail = `Server replied ${res.status}`;
          try {
            const body = await res.json();
            if (body?.detail) detail = body.detail;
          } catch {
            /* not JSON — keep the status line */
          }
          throw new Error(detail);
        }

        setServer("online");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamError = null;

        // Server-sent events: frames separated by a blank line.
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const payload = frame
              .split("\n")
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trim())
              .join("");
            if (!payload) continue;

            let parsed;
            try {
              parsed = JSON.parse(payload);
            } catch {
              continue;
            }

            if (parsed.error) streamError = parsed.error;
            if (parsed.delta) {
              acc += parsed.delta;
              paint(true);
            }
          }
        }

        if (streamError && !acc) throw new Error(streamError);

        writeMessages(chatId, [
          ...base,
          {
            role: "ai",
            text: acc.trim() || "The server returned an empty reply.",
            time: stamp(),
            error: !acc.trim(),
          },
        ]);
      } catch (err) {
        if (err.name === "AbortError") {
          // Keep whatever streamed in before the stop.
          writeMessages(chatId, [
            ...base,
            acc.trim()
              ? { role: "ai", text: acc, time: stamp() }
              : { role: "ai", text: "Stopped before a reply came back.", time: stamp(), error: true },
          ]);
        } else {
          const network = err instanceof TypeError;
          if (network) setServer("offline");
          writeMessages(chatId, [
            ...base,
            {
              role: "ai",
              text: network
                ? `Can't reach the backend${API_BASE ? ` at ${API_BASE}` : ""}. Start it with \`uvicorn main:app --reload\` from your backend folder, then try again.`
                : err.message,
              time: stamp(),
              error: true,
            },
          ]);
        }
      } finally {
        abortRef.current = null;
        setBusy(false);
      }
    },
    [writeMessages]
  );

  const send = (raw) => {
    const text = (raw ?? input).trim();
    const files = pending;
    if ((!text && !files.length) || busy || text.length > MAX_CHARS) return;

    setInput("");
    setPending([]);

    const base = [...messages, { role: "user", text, time: stamp(), files }];
    writeMessages(activeId, base);
    ask(text, files, base, activeId);
  };

  const retry = () => {
    if (busy) return;
    const cut = lastAIIndex < 0 ? messages.length : lastAIIndex;
    const base = messages.slice(0, cut);
    const lastUser = [...base].reverse().find((m) => m.role === "user");
    if (!lastUser) return;

    writeMessages(activeId, base);
    // Attachment bytes are gone after a reload, so retry sends whatever remains.
    ask(lastUser.text, lastUser.files?.filter((f) => f.data) || [], base, activeId);
  };

  const stop = () => abortRef.current?.abort();

  const onKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  /* ---- shortcuts ---- */
  useEffect(() => {
    const handler = (event) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        newChat();
      }
      if (meta && event.key === "/") {
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (event.key === "Escape") {
        setRailOpen(false);
        setRenaming(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [newChat]);

  const over = input.length > MAX_CHARS;
  const canSend = (input.trim() || pending.length) && !over;
  const statusText = { online: "Connected", offline: "Backend offline", checking: "Connecting" }[server];

  return (
    <div className="app">
      {railOpen && <div className="scrim" onClick={() => setRailOpen(false)} aria-hidden="true" />}

      {dragging && (
        <div className="dropzone">
          <div className="dropzone__card">
            <IconClip />
            <strong>Drop to attach</strong>
            <span>Images, PDFs and text files up to 10 MB</span>
          </div>
        </div>
      )}

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast" data-tone={t.tone}>
            {t.text}
          </div>
        ))}
      </div>

      {/* ---------- Rail ---------- */}
      <aside className="rail" data-open={railOpen}>
        <div className="brand">
          <div className="brand__mark">
            <IconGlyph size={20} />
          </div>
          <div>
            <div className="brand__name">OtaconAI</div>
            <div className="brand__freq">140.85</div>
          </div>
        </div>

        <div className="status" data-state={server}>
          <span className="status__dot" />
          {statusText}
          {server === "offline" && (
            <button className="status__retry" onClick={ping} type="button">
              Retry
            </button>
          )}
        </div>

        <button className="new-chat" onClick={newChat} type="button">
          <IconPlus />
          New conversation
        </button>

        <div className="search">
          <IconSearch />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
          />
          {query && (
            <button onClick={() => setQuery("")} aria-label="Clear search" type="button">
              <IconX size={12} />
            </button>
          )}
        </div>

        <div className="rail__scroll">
          {visibleChats.length === 0 ? (
            <div className="rail__empty">No conversations match that.</div>
          ) : (
            visibleChats.map((c) => (
              <div key={c.id} className="thread" data-active={c.id === activeId}>
                <button
                  className="thread__open"
                  aria-current={c.id === activeId}
                  onClick={() => openChat(c.id)}
                  type="button"
                >
                  <span className="thread__title">{c.title}</span>
                  {c.messages.length > 0 && <span className="thread__count">{c.messages.length}</span>}
                </button>
                <button
                  className="thread__delete"
                  aria-label={`Delete ${c.title}`}
                  onClick={(e) => deleteChat(c.id, e)}
                  type="button"
                >
                  <IconTrash />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="rail__foot">
          <span>OtaconAI v3.0</span>
          <span>{chats.length} saved</span>
        </div>
      </aside>

      {/* ---------- Main ---------- */}
      <main className="main">
        <header className="topbar">
          <button
            className="icon-btn rail-toggle"
            onClick={() => setRailOpen((v) => !v)}
            aria-label="Show conversations"
            type="button"
          >
            <IconMenu />
          </button>

          <div className="topbar__title">
            {renaming ? (
              <input
                ref={renameRef}
                className="rename-input"
                defaultValue={chat.title}
                onBlur={(e) => rename(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") rename(e.target.value);
                  if (e.key === "Escape") setRenaming(false);
                }}
                aria-label="Conversation name"
              />
            ) : (
              <>
                <h1 onDoubleClick={() => setRenaming(true)}>{chat.title}</h1>
                <div className="topbar__meta">
                  {messages.length === 0
                    ? "No messages yet"
                    : `${messages.length} message${messages.length === 1 ? "" : "s"}`}
                </div>
              </>
            )}
          </div>

          {!renaming && (
            <button className="icon-btn" onClick={() => setRenaming(true)} aria-label="Rename conversation" type="button">
              <IconEdit />
            </button>
          )}

          {messages.length > 0 && (
            <>
              <button
                className="icon-btn"
                onClick={() => {
                  exportMarkdown(chat);
                  toast("Saved as Markdown");
                }}
                aria-label="Export conversation"
                type="button"
              >
                <IconDownload />
              </button>
              <button
                className="ghost-btn ghost-btn--danger"
                onClick={() => writeMessages(activeId, [])}
                type="button"
              >
                <IconTrash />
                Clear
              </button>
            </>
          )}
        </header>

        <div className="transcript" ref={transcriptRef} onScroll={onScroll}>
          <div className="transcript__inner">
            {messages.length === 0 ? (
              <section className="welcome">
                <div className="welcome__mark">
                  <IconGlyph size={30} />
                </div>
                <h2>Codec open. What are we working on?</h2>
                <p>
                  Ask a question, attach a screenshot or PDF, or pick a starting point below.
                  Conversations stay on this device.
                </p>
                <div className="starters">
                  {STARTERS.map((s) => (
                    <button key={s.title} className="starter" onClick={() => send(s.body)} type="button">
                      <strong>{s.title}</strong>
                      <span>{s.body}</span>
                    </button>
                  ))}
                </div>
              </section>
            ) : (
              <div className="stream" aria-live="polite">
                {messages.map((m, i) => (
                  <Message
                    key={`${m.role}-${i}`}
                    msg={m}
                    isLastAI={i === lastAIIndex && !busy}
                    onRetry={retry}
                  />
                ))}
              </div>
            )}

            {busy && !messages.some((m) => m.streaming) && (
              <div className="msg msg--ai">
                <div className="avatar avatar--ai" aria-hidden="true">
                  <IconGlyph size={17} />
                </div>
                <div className="thinking" role="status" aria-label="Waiting for a reply">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        <div className="composer-wrap">
          {!atBottom && messages.length > 0 && (
            <button
              className="jump"
              onClick={() => {
                setAtBottom(true);
                bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
              }}
              type="button"
            >
              <IconDown />
              Jump to latest
            </button>
          )}

          <div className="composer">
            {pending.length > 0 && (
              <FileChips
                files={pending}
                onRemove={(i) => setPending((prev) => prev.filter((_, n) => n !== i))}
              />
            )}

            <div className="composer__row">
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={ACCEPTED.join(",")}
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
                hidden
              />
              <button
                className="attach"
                onClick={() => fileRef.current?.click()}
                aria-label="Attach files"
                type="button"
              >
                <IconClip />
              </button>

              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                placeholder="Message OtaconAI"
                aria-label="Message"
              />

              {busy ? (
                <button className="send send--stop" onClick={stop} aria-label="Stop generating" type="button">
                  <IconStop />
                </button>
              ) : (
                <button
                  className="send"
                  onClick={() => send()}
                  disabled={!canSend}
                  aria-label="Send message"
                  type="button"
                >
                  <IconSend />
                </button>
              )}
            </div>
          </div>

          <div className="composer-hint">
            <span className="composer-hint__keys">
              <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
            </span>
            <span className={over ? "count-warn" : undefined}>
              {over
                ? `${input.length - MAX_CHARS} characters over the limit`
                : input.length > MAX_CHARS * 0.8
                ? `${input.length} / ${MAX_CHARS}`
                : ""}
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}

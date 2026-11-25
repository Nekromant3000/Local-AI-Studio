# Local AI Studio

> *Unofficial local web UI compatible with Google AI Studio JSON format. Built with FastAPI and React for local LLMs. Not affiliated with Google.*

**Local AI Studio** is a fully offline desktop-style web workspace for your chats. It reads — and edits **in place** — the original JSON chats exported by Google AI Studio (GAS), so your existing library stays the single source of truth: no import, no export, no lock-in, no format translation. Generation is delegated to any **OpenAI-compatible local API** (Strata, LM Studio, Ollama, llama.cpp, …), and every added feature is written back as GAS-compatible JSON — so a chat touched by Local AI Studio still opens perfectly in the original Google AI Studio.

---

## Key features

- **Native GAS JSON + `_localAsset`** — chats are parsed, edited and saved in the original format (`chunkedPrompt`, `runSettings`, thoughts, attachments). Inline base64 never travels to the browser: it is swapped for a lightweight `_localAsset` descriptor and rehydrated on save. Every write is atomic, preceded by a backup, and deletions go to a local trash folder.
- **Total control over every message and attachment** — edit, delete, duplicate or regenerate any frame (user prompt, model reply, thought block, image/file slot) through an optimistic composer. Nothing is silently rewritten: untouched chunks stay byte-for-byte identical.
- **Thinking Level + Depth Prompting** — a compact `Off / Low / Medium / High / Extra High` selector mapped to `reasoning_effort` on the API side and GAS-compatible `runSettings.thinkingLevel` on the storage side. High levels inject a `<system_reminder>` depth block (alternative scenarios, pitfalls, plan B) at request time only — the JSON on disk never changes.
- **Direct `.docx` uploads** — drop a Word document straight into the composer; headings, lists and tables are converted to readable Markdown, the original file is kept locally, and only the extracted text is stored in the chat (full GAS compatibility).
- **Cacheable URL Context** — links in your prompts are fetched, cleaned with `trafilatura` and cached; their text is injected into the model context at runtime only. Per-link chips show domain, title and token cost, and one click excludes a link — all stored outside the chat JSON.
- **Real-time token counting** — tiktoken-based estimation (with graceful fallback) of the exact outgoing request, attachments and URL context included, with context-window progress and truncation warnings.
- **Fullscreen history search** — an instant full-screen overview of the whole chat library (100+ chats indexed with an mtime cache), with search, create, rename and delete.

## Screenshots

> Screenshots are on their way — the images below will live in [`docs/screenshots/`](docs/screenshots/).

| Chat workspace | Model & context panel | History search |
|---|---|---|
| ![Main chat view](docs/screenshots/chat-workspace.png) | ![Right panel: model, thinking level, tokens](docs/screenshots/context-panel.png) | ![Fullscreen chat history](docs/screenshots/history-search.png) |

## Quick Start

**Prerequisites:** Windows 10/11, Python 3.10+ (3.12–3.14 tested). Node.js is *not* required — the script fetches a portable Node.js when a frontend build is needed.

1. **Clone the repository**

   ```bat
   git clone https://github.com/Nekromant3000/Local-AI-Studio.git
   cd Local-AI-Studio
   ```

2. **Create the backend virtualenv (one time)**

   ```bat
   python -m venv backend\.venv
   backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
   ```

3. **Point the app at your chat folder** — a folder containing Google AI Studio JSON chats:

   ```bat
   setx GAS_CHAT_DIR "D:\MyChats\Google AI Studio"
   ```

   (or set it in the current session with `set GAS_CHAT_DIR=...`; without it, a built-in default is used)

4. **Launch**

   ```bat
   start.bat
   ```

   `start.bat` builds the frontend on first run (using the portable `.tools\node\npm.cmd`, deps auto-installed), starts the backend, waits for it to come up and opens **http://127.0.0.1:8000** in your default browser. The backend runs in a minimized window — close it to stop the app.

5. **Connect a local model** — in the right panel, pick a preset (**Strata**, **LM Studio**, **Ollama**, **llama.cpp**) or enter any OpenAI-compatible Base URL, then choose a model from the dropdown (fetched live from `/v1/models`).

### Configuration

| Variable | Purpose | Default |
|---|---|---|
| `GAS_CHAT_DIR` | folder with your GAS JSON chats | built-in default path |
| `LOCAL_AI_STUDIO_HOST` / `LOCAL_AI_STUDIO_PORT` | bind address | `127.0.0.1` / `8000` |
| `LOCAL_AI_STUDIO_RELOAD` | dev auto-reload (`1`/`0`) | `0` |
| `LOCAL_AI_STUDIO_DATA` | app data dir (settings, backups, cache, trash) | `backend/data` |

Interactive API docs: **http://127.0.0.1:8000/api/docs** · Dev server: `.tools\node\npm.cmd run dev` in `frontend/` (Vite on `:5173`, proxied to the backend).

## Roadmap

| Next | Details |
|---|---|
| 🎬 **YouTube / Shorts parser** | transcripts & subtitles for `youtubeVideo` chunks and plain links, injected as timecoded text context |
| 🔎 **Web Search** | provider-native search or a built-in search-API → top-N pages loop; results rendered as GAS `grounding` / `citations` chunks |
| 🐍 **Python sandbox** | local execution of `executableCode` replies (isolated subprocess, CPU/network/tmp limits, import whitelist), results stored as GAS `codeExecutionResult` |
| 🧠 **Hybrid RAG memory + compacting** | vector + BM25 index of chats and attachments, relevance pull near the context limit, and summarization of old frames into thought-compatible digests so long sessions fit without losing facts |

Done recently: Thinking Level & Depth Prompting, `.docx` parsing, URL Context with cache (see [docs/PLAN.md](docs/PLAN.md) for the full architecture and status).

## Data safety

Your chat folder is edited in place — but carefully: every save is **atomic** and preceded by a **backup** (`backend/data/backups/`), deletions are moved to `backend/data/trash/`, and all runtime extras (URL cache, link exclusions, uploads) live **outside** your chat JSON. Still — keep your own backups.

## License

Released under the [MIT License](LICENSE).

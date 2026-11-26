import type {
  AppSettings,
  ChatDocument,
  ChatListResponse,
  GenerateEvent,
  LocalApiSettings,
  ModelInfo,
  SettingsResponse,
  TokenStats,
  UploadedAsset,
  UrlContextItem,
  YoutubeFrame,
  YoutubeMeta,
  YoutubeTranscript,
  YoutubeTranscriptMode,
  YoutubeVideo,
} from "../types";

const API_BASE = "/api";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * FastAPI может вернуть `detail` строкой, объектом ({"message": ...}) или
 * массивом ошибок валидации 422 ([{"loc": [...], "msg": ...}]).
 * Превращаем любой вариант в человекочитаемый текст, без "[object Object]".
 */
export function formatErrorDetail(detail: unknown): string {
  if (detail === null || detail === undefined) return "";
  if (typeof detail === "string") return detail;
  if (typeof detail !== "object") return String(detail);
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          const message =
            typeof record.msg === "string"
              ? record.msg
              : typeof record.message === "string"
                ? record.message
                : "";
          if (!message) return "";
          const location = Array.isArray(record.loc)
            ? record.loc.filter((part) => part !== "body").join(".")
            : "";
          return location ? `${location}: ${message}` : message;
        }
        return "";
      })
      .filter(Boolean);
    return parts.length ? parts.join("; ") : safeStringify(detail);
  }
  const record = detail as Record<string, unknown>;
  for (const key of ["message", "error", "detail"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return safeStringify(detail);
}

/** Извлекает читаемое сообщение из ошибки любой формы (Error, Response-JSON, строка). */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if ("detail" in record) {
      const detail = formatErrorDetail(record.detail);
      if (detail) return detail;
    }
    if (typeof record.message === "string" && record.message.trim()) return record.message;
    return safeStringify(error);
  }
  return String(error);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: requestHeaders(init),
    });
  } catch (error) {
    throw new ApiError(
      error instanceof Error ? error.message : "Не удалось связаться с backend",
    );
  }
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    let detail = "";
    if (payload && typeof payload === "object" && "detail" in payload) {
      detail = formatErrorDetail((payload as { detail?: unknown }).detail);
    } else if (typeof payload === "string") {
      detail = payload;
    }
    throw new ApiError(detail || `HTTP ${response.status}`, response.status);
  }
  return payload as T;
}

/**
 * Заголовок Content-Type важен: для FormData его выставить нельзя, иначе
 * браузер не добавит multipart boundary, и FastAPI вернёт 422
 * «Field required» вместо загрузки файла.
 */
function requestHeaders(init?: RequestInit): Record<string, string> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
  const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === "content-type");
  if (init?.body && !(init.body instanceof FormData) && !hasContentType) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

export const api = {
  listChats(query = "", refresh = false): Promise<ChatListResponse> {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (refresh) params.set("refresh", "true");
    return request<ChatListResponse>(`/chats?${params.toString()}`);
  },

  getChat(id: string): Promise<ChatDocument> {
    return request<ChatDocument>(`/chats/${encodeURIComponent(id)}`);
  },

  createChat(title: string): Promise<ChatDocument> {
    return request<ChatDocument>(`/chats`, {
      method: "POST",
      body: JSON.stringify({ title }),
    });
  },

  saveChat(id: string, chat: ChatDocument["chat"]): Promise<ChatDocument> {
    return request<ChatDocument>(`/chats/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ chat }),
    });
  },

  renameChat(id: string, title: string): Promise<ChatDocument> {
    return request<ChatDocument>(`/chats/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
  },

  getSettings(): Promise<SettingsResponse> {
    return request<SettingsResponse>(`/settings`);
  },

  updateSettings(payload: Partial<AppSettings> & { clearApiKey?: boolean }): Promise<SettingsResponse> {
    return request<SettingsResponse>(`/settings`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  selectChatDir(): Promise<{
    ok: boolean;
    cancelled?: boolean;
    chatDir: string;
    chatDirExists?: boolean;
  }> {
    return request(`/system/select-chat-dir`, { method: "POST" });
  },

  getModels(baseUrl: string, apiKey?: string): Promise<{ models: ModelInfo[]; baseUrl: string }> {
    const params = new URLSearchParams({ baseUrl });
    if (apiKey) params.set("apiKey", apiKey);
    return request<{ models: ModelInfo[]; baseUrl: string; count: number }>(
      `/llm/models?${params.toString()}`,
    );
  },

  countTokens(payload: {
    texts: string[];
    system: string;
    imageCount: number;
    fileCount: number;
    thoughtTexts: string[];
    chatId?: string | null;
    urlContext?: boolean;
  }): Promise<TokenStats> {
    return request<TokenStats>(`/tokens/count`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getUrlContext(chatId: string): Promise<{ items: UrlContextItem[] }> {
    return request<{ items: UrlContextItem[] }>(
      `/chats/${encodeURIComponent(chatId)}/url-context`,
    );
  },

  setUrlExcluded(chatId: string, urlId: string, excluded: boolean): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/chats/${encodeURIComponent(chatId)}/url-context`, {
      method: "PUT",
      body: JSON.stringify({ urlId, excluded }),
    });
  },

  extractUrl(
    url: string,
    force = false,
  ): Promise<{
    ok: boolean;
    error?: string;
    record?: {
      url: string;
      urlId: string;
      title: string;
      domain: string;
      textLength: number;
      truncated?: boolean;
    } | null;
  }> {
    return request(`/assets/extract-url`, {
      method: "POST",
      body: JSON.stringify({ url, force }),
    });
  },

  // ─── YouTube/Shorts (этап 4) ─────────────────────────────────────────────
  // POST /youtube/parse — единственный сетевой вход; GET-эндпоинты читают
  // только локальный кэш data/youtube_cache/ (404 = видео не разобрано).

  parseYoutube(
    url: string,
    mode: YoutubeTranscriptMode = "auto",
    forceRefresh = false,
  ): Promise<{ ok: boolean; videoId: string; meta: YoutubeMeta; transcript: YoutubeTranscript }> {
    return request(`/youtube/parse`, {
      method: "POST",
      body: JSON.stringify({ url, mode, forceRefresh }),
    });
  },

  getYoutubeVideo(videoId: string): Promise<YoutubeVideo> {
    return request<YoutubeVideo>(`/youtube/${encodeURIComponent(videoId)}`);
  },

  extractYoutubeFrames(
    videoId: string,
    maxFrames = 10,
    minIntervalSec = 4,
  ): Promise<{ ok: boolean; videoId: string; frames: YoutubeFrame[]; tokenCount: number | null }> {
    return request(`/youtube/${encodeURIComponent(videoId)}/extract-frames`, {
      method: "POST",
      body: JSON.stringify({ max_frames: maxFrames, min_interval_sec: minIntervalSec }),
    });
  },

  captureYoutubeFrame(
    videoId: string,
    timestampSec: number,
  ): Promise<{ ok: boolean; videoId: string; frame: YoutubeFrame; frames: YoutubeFrame[]; tokenCount: number | null }> {
    return request(`/youtube/${encodeURIComponent(videoId)}/capture-frame`, {
      method: "POST",
      body: JSON.stringify({ timestamp_sec: timestampSec }),
    });
  },

  uploadYoutubeFrame(
    videoId: string,
    file: File,
    timestampSec: number,
  ): Promise<{ ok: boolean; videoId: string; frame: YoutubeFrame; frames: YoutubeFrame[]; tokenCount: number | null }> {
    const form = new FormData();
    form.append("file", file);
    form.append("timestamp_sec", String(timestampSec));
    return request(`/youtube/${encodeURIComponent(videoId)}/upload-frame`, {
      method: "POST",
      body: form,
      headers: {},
    });
  },

  deleteYoutubeFrame(
    videoId: string,
    frameId: string,
  ): Promise<{ ok: boolean; videoId: string; deletedFrameId: string; frames: YoutubeFrame[]; tokenCount: number | null }> {
    return request(`/youtube/${encodeURIComponent(videoId)}/frames/${encodeURIComponent(frameId)}`, {
      method: "DELETE",
    });
  },

  uploadAsset(file: File): Promise<UploadedAsset> {
    const form = new FormData();
    form.append("file", file);
    return request<UploadedAsset>(`/assets/upload`, {
      method: "POST",
      body: form,
      headers: {},
    });
  },

  listLocalAssets(
    query: string,
    kind: "image" | "document" | "video" | "all",
    offset = 0,
    limit = 120,
  ): Promise<{
    items: LocalAssetItem[];
    total: number;
    offset: number;
    limit: number;
    folder: string;
  }> {
    const params = new URLSearchParams({ q: query, kind, offset: String(offset), limit: String(limit) });
    return request(`/assets/local?${params.toString()}`);
  },

  deleteChat(id: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/chats/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
};

export interface LocalAssetItem {
  name: string;
  kind: "image" | "video" | "document";
  mimeType: string;
  size: number;
  sizeLabel: string;
  mtime: string;
  fileUrl: string;
  thumbUrl: string | null;
  isText: boolean;
}

export interface StreamCallbacks {
  onEvent: (event: GenerateEvent) => void;
}

export async function streamGenerate(
  chatId: string,
  payload: { startIndex: number | null; settings: LocalApiSettings },
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/chats/${encodeURIComponent(chatId)}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if ((error as DOMException)?.name === "AbortError") throw error;
    throw new ApiError("Не удалось запустить генерацию. Backend недоступен.");
  }
  if (!response.ok) {
    const text = await response.text();
    let detail = `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(text);
      detail =
        formatErrorDetail(parsed && typeof parsed === "object" ? parsed.detail ?? parsed : parsed) ||
        detail;
    } catch {
      if (text) detail = text.slice(0, 500);
    }
    throw new ApiError(detail, response.status);
  }
  if (!response.body) {
    throw new ApiError("Браузер не поддерживает потоковый ответ");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  const processBlock = (block: string) => {
    if (!block.trim()) return;
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return;
    const raw = dataLines.join("\n");
    if (!raw || raw === "[DONE]") return;
    let event: GenerateEvent;
    try {
      event = JSON.parse(raw) as GenerateEvent;
    } catch {
      return;
    }
    callbacks.onEvent(event);
    if (event.type === "done" || event.type === "error") finished = true;
  };

  try {
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let match: RegExpExecArray | null;
      const separator = /\r?\n\r?\n/g;
      let consumed = 0;
      while ((match = separator.exec(buffer)) !== null) {
        processBlock(buffer.slice(consumed, match.index));
        consumed = match.index + match[0].length;
      }
      if (consumed > 0) buffer = buffer.slice(consumed);
    }
    buffer += decoder.decode();
    if (!finished && buffer.trim()) processBlock(buffer);
  } finally {
    reader.releaseLock();
  }
}

export function chatAssetUrl(
  chatId: string,
  chunkIndex: number,
  slot: string,
  download = false,
): string {
  return `${API_BASE}/chats/${encodeURIComponent(chatId)}/assets/${chunkIndex}/${slot}${
    download ? "?download=true" : ""
  }`;
}

export function localAssetUrl(name: string, download = false): string {
  return `${API_BASE}/assets/local/file?name=${encodeURIComponent(name)}${
    download ? "&download=true" : ""
  }`;
}

export function localThumbUrl(name: string, width = 280): string {
  return `${API_BASE}/assets/local/thumb?name=${encodeURIComponent(name)}&w=${width}`;
}

/**
 * Список PNG-страниц `.docx` по его assetId. Работает всегда, даже если
 * `docxPagesUrl` не дожил до следующей загрузки чата: бэкенд берёт исходный
 * файл из `data/attachments` и дорисовывает страницы по требованию.
 */
export function docxPagesUrl(assetId: string): string {
  return `${API_BASE}/assets/docx-pages/${encodeURIComponent(assetId)}`;
}

/** Оригинальный `.docx` из `data/attachments` по его assetId. */
export function docxFileUrl(assetId: string, download = false): string {
  const base = `${API_BASE}/assets/docx-file/${encodeURIComponent(assetId)}`;
  return download ? `${base}?download=true` : base;
}

/** Локальная копия превью `thumb.jpg` (только для разобранных видео). */
export function youtubeThumbUrl(videoId: string): string {
  return `${API_BASE}/youtube/${encodeURIComponent(videoId)}/thumb`;
}

/** JPEG кадра из кэша `data/youtube_cache/{videoId}/frames/`. */
export function youtubeFrameUrl(videoId: string, filename: string): string {
  return `${API_BASE}/youtube/${encodeURIComponent(videoId)}/frames/${encodeURIComponent(filename)}`;
}

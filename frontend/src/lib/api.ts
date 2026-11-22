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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers || {}),
      },
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
      detail = String((payload as { detail?: unknown }).detail ?? "");
    } else if (typeof payload === "string") {
      detail = payload;
    }
    throw new ApiError(detail || `HTTP ${response.status}`, response.status);
  }
  return payload as T;
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
  }): Promise<TokenStats> {
    return request<TokenStats>(`/tokens/count`, {
      method: "POST",
      body: JSON.stringify(payload),
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
      detail = String(parsed.detail || detail);
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

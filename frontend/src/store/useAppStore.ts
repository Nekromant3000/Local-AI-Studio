import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { api, ApiError, streamGenerate } from "../lib/api";
import {
  findLastUserIndex,
  isThought,
  tokenInputs,
  truncationCutoff,
} from "../lib/frames";
import { estimateTokens } from "../lib/frames";
import { formatBytes } from "../lib/format";
import type {
  AppSettings,
  AttachmentSlot,
  ChatDocument,
  ChatSummary,
  Chunk,
  GenerateDoneEvent,
  GenerateEvent,
  GasChat,
  LocalApiSettings,
  ModelInfo,
  PendingAttachment,
  StreamingState,
  ThinkingLevel,
  TokenStats,
} from "../types";

const LAST_CHAT_KEY = "local-ai-studio:last-chat";

type SaveState = "idle" | "saving" | "saved" | "error";

interface AppState {
  chats: ChatSummary[];
  folder: string;
  chatDir: string;
  activeId: string | null;
  doc: ChatDocument | null;
  settings: AppSettings;
  loadingChats: boolean;
  loadingDoc: boolean;
  error: string | null;
  notice: string | null;
  saveState: SaveState;
  dirty: boolean;
  models: ModelInfo[];
  modelsLoading: boolean;
  modelsError: string | null;
  modelsBaseUrl: string;
  tokenStats: TokenStats | null;
  tokenLoading: boolean;
  streaming: StreamingState | null;
  generating: boolean;
  draftText: string;
  isHistoryOpen: boolean;

  bootstrap: () => Promise<void>;
  loadChats: (refresh?: boolean) => Promise<void>;
  openChat: (id: string) => Promise<void>;
  createChat: (title: string) => Promise<void>;
  renameActive: (title: string) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  setError: (message: string | null) => void;
  setNotice: (message: string | null) => void;
  setHistoryOpen: (open: boolean) => void;
  setDraftText: (text: string) => void;
  refreshTokens: () => Promise<void>;
  saveNow: () => Promise<boolean>;
  scheduleSave: (delay?: number) => void;
  updateChat: (mutator: (chat: GasChat) => void, options?: { save?: boolean }) => void;
  updateChunkText: (index: number, text: string) => void;
  deleteFrames: (indices: number[]) => void;
  deleteAttachment: (index: number, slot: AttachmentSlot) => void;
  bindAttachment: (
    index: number,
    slot: AttachmentSlot,
    localName: string,
    details?: { size?: number; mimeType?: string },
  ) => void;
  setSystemInstruction: (text: string) => void;
  updateLocalApi: (partial: Partial<LocalApiSettings>) => void;
  updateGlobalSettings: (partial: Partial<AppSettings>) => Promise<void>;
  saveApiKey: (key: string) => Promise<boolean>;
  clearApiKey: () => Promise<void>;
  loadModels: (force?: boolean, autoSelectFirst?: boolean) => Promise<void>;
  sendMessage: (
    text: string,
    attachments: PendingAttachment[],
    options?: { generate?: boolean },
  ) => Promise<void>;
  regenerateFrom: (startIndex: number) => Promise<void>;
  stopGeneration: () => void;
  refreshActive: () => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let tokenTimer: ReturnType<typeof setTimeout> | null = null;
let savedTimer: ReturnType<typeof setTimeout> | null = null;
let savePromise: Promise<boolean> | null = null;
let saveQueued = false;
let tokenRequestSeq = 0;
let activeAbort: AbortController | null = null;
let tokenAbort: AbortController | null = null;

const defaultSettings: AppSettings = {
  baseUrl: "http://localhost:1234/v1",
  model: "",
  reasoningMode: false,
  thinkingLevel: "HIGH",
  temperature: 1.0,
  maxOutputTokens: 8192,
  topP: 0.95,
  sendAttachments: true,
  contextWindow: 131072,
  hasApiKey: false,
};

const THINKING_LEVEL_VALUES: ThinkingLevel[] = ["NONE", "LOW", "MEDIUM", "HIGH", "EXTRA_HIGH"];

// Отображение нашего уровня в GAS-поле runSettings.thinkingLevel (обратная совместимость).
const GAS_THINKING_BY_LEVEL: Record<ThinkingLevel, string> = {
  NONE: "THINKING_NONE",
  LOW: "THINKING_LOW",
  MEDIUM: "THINKING_HIGH",
  HIGH: "THINKING_HIGH",
  EXTRA_HIGH: "THINKING_HIGH",
};

// Чтение уровней из старых GAS-чатов.
const GAS_LEVEL_ALIASES: Record<string, ThinkingLevel> = {
  THINKING_NONE: "NONE",
  THINKING_MINIMAL: "LOW",
  THINKING_LOW: "LOW",
  THINKING_HIGH: "HIGH",
};

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return THINKING_LEVEL_VALUES.includes(value as ThinkingLevel);
}

// Цепочка совместимости: localApi.thinkingLevel → legacy localApi.reasoningMode →
// GAS runSettings.thinkingLevel → глобальная настройка → HIGH.
function resolveThinkingLevel(
  doc: ChatDocument | null,
  settings: AppSettings,
): ThinkingLevel {
  const local = doc?.chat.runSettings?.localApi;
  if (isThinkingLevel(local?.thinkingLevel)) return local.thinkingLevel;
  if (typeof local?.reasoningMode === "boolean") {
    return local.reasoningMode ? "HIGH" : "NONE";
  }
  const gas = doc?.chat.runSettings?.thinkingLevel;
  if (gas && GAS_LEVEL_ALIASES[String(gas)]) return GAS_LEVEL_ALIASES[String(gas)];
  if (isThinkingLevel(settings.thinkingLevel)) return settings.thinkingLevel;
  return "HIGH";
}

function cloneChat(chat: GasChat): GasChat {
  return structuredClone(chat);
}

function upsertSummary(chats: ChatSummary[], summary: ChatSummary): ChatSummary[] {
  const next = chats.filter((chat) => chat.id !== summary.id);
  next.unshift(summary);
  return next;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

function localSettingsFor(doc: ChatDocument | null, settings: AppSettings): LocalApiSettings {
  const local = doc?.chat.runSettings?.localApi;
  const thinkingLevel = resolveThinkingLevel(doc, settings);
  const reasoning = thinkingLevel !== "NONE";
  return {
    baseUrl: local?.baseUrl || settings.baseUrl,
    model: local?.model || settings.model || "",
    reasoningMode: reasoning,
    thinkingLevel,
    temperature: local?.temperature ?? settings.temperature,
    maxOutputTokens: reasoning ? 65536 : local?.maxOutputTokens ?? settings.maxOutputTokens,
    topP: local?.topP ?? settings.topP,
    sendAttachments: local?.sendAttachments ?? settings.sendAttachments,
    contextWindow: local?.contextWindow ?? settings.contextWindow,
  };
}

function normalizeLocal(partial: Partial<LocalApiSettings>): Partial<LocalApiSettings> {
  const next = { ...partial };
  if (partial.thinkingLevel) {
    next.reasoningMode = partial.thinkingLevel !== "NONE";
    if (next.reasoningMode) next.maxOutputTokens = 65536;
  } else if (partial.reasoningMode === true) {
    next.maxOutputTokens = 65536;
  }
  return next;
}

function attachmentChunk(
  upload: PendingAttachment,
  createTime: string,
): { chunk: Chunk; slot: AttachmentSlot } {
  const slot: AttachmentSlot = upload.kind === "image" ? "inlineImage" : "inlineFile";
  const chunk: Chunk = {
    role: "user",
    createTime,
    text: "",
    tokenCount: 0,
  };
  chunk[slot] = {
    mimeType: upload.upload.mimeType,
    displayName: upload.upload.name,
    _localAsset: {
      slot,
      kind: upload.kind,
      chunkIndex: -1,
      name: upload.upload.name,
      mimeType: upload.upload.mimeType,
      size: upload.upload.size,
      sizeLabel: upload.upload.sizeLabel,
      hasData: false,
      resolved: true,
      tempId: upload.upload.tempId,
      previewUrl: upload.upload.previewUrl,
    },
  };
  return { chunk, slot };
}

export const useAppStore = create<AppState>()((set, get) => ({
  chats: [],
  folder: "",
  chatDir: "",
  activeId: null,
  doc: null,
  settings: defaultSettings,
  loadingChats: false,
  loadingDoc: false,
  error: null,
  notice: null,
  saveState: "idle",
  dirty: false,
  models: [],
  modelsLoading: false,
  modelsError: null,
  modelsBaseUrl: "",
  tokenStats: null,
  tokenLoading: false,
  streaming: null,
  generating: false,
  draftText: "",
  isHistoryOpen: false,

  bootstrap: async () => {
    set({ loadingChats: true, error: null });
    try {
      const [settingsResponse, chatList] = await Promise.all([
        api.getSettings(),
        api.listChats("", true),
      ]);
      set({
        settings: settingsResponse.settings,
        chatDir: settingsResponse.chatDir,
        chats: chatList.chats,
        folder: chatList.folder,
        loadingChats: false,
      });
      const lastId = localStorage.getItem(LAST_CHAT_KEY);
      const chosen = chatList.chats.find((chat) => chat.id === lastId) ?? chatList.chats[0];
      if (chosen) {
        await get().openChat(chosen.id);
        void get().loadModels(true);
      } else {
        set({ tokenStats: null });
      }
    } catch (error) {
      set({ error: errorMessage(error), loadingChats: false });
    }
  },

  loadChats: async (refresh = false) => {
    set({ loadingChats: true });
    try {
      const response = await api.listChats("", refresh);
      set({ chats: response.chats, folder: response.folder, loadingChats: false });
    } catch (error) {
      set({ error: errorMessage(error), loadingChats: false });
    }
  },

  openChat: async (id) => {
    if (!get().generating && get().dirty) {
      const ok = await get().saveNow();
      if (!ok) return;
    }
    if (activeAbort) {
      activeAbort.abort();
      activeAbort = null;
    }
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    set({
      activeId: id,
      loadingDoc: true,
      doc: null,
      error: null,
      notice: null,
      streaming: null,
      generating: false,
      tokenStats: null,
      draftText: "",
    });
    localStorage.setItem(LAST_CHAT_KEY, id);
    try {
      const doc = await api.getChat(id);
      set({ doc, loadingDoc: false, saveState: "idle", dirty: false });
      localStorage.setItem(LAST_CHAT_KEY, doc.id);
      void get().refreshTokens();
      const local = localSettingsFor(doc, get().settings);
      if (get().modelsBaseUrl !== local.baseUrl) {
        void get().loadModels(false);
      }
    } catch (error) {
      set({ error: errorMessage(error), loadingDoc: false });
    }
  },

  createChat: async (title) => {
    try {
      const doc = await api.createChat(title);
      set((state) => ({
        doc,
        activeId: doc.id,
        chats: upsertSummary(state.chats, doc.summary),
        loadingDoc: false,
        error: null,
        notice: null,
        draftText: "",
        streaming: null,
        generating: false,
        dirty: false,
      }));
      localStorage.setItem(LAST_CHAT_KEY, doc.id);
      void get().refreshTokens();
      void get().loadModels(false);
    } catch (error) {
      set({ error: errorMessage(error) });
      throw error;
    }
  },

  renameActive: async (title) => {
    const doc = get().doc;
    if (!doc) return;
    try {
      const renamed = await api.renameChat(doc.id, title);
      set((state) => ({
        doc: renamed,
        activeId: renamed.id,
        chats: upsertSummary(
          state.chats.filter((chat) => chat.id !== doc.id),
          renamed.summary,
        ),
      }));
      localStorage.setItem(LAST_CHAT_KEY, renamed.id);
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },

  deleteChat: async (id) => {
    if (activeAbort) {
      activeAbort.abort();
      activeAbort = null;
    }
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    try {
      await api.deleteChat(id);
      const remaining = get().chats.filter((chat) => chat.id !== id);
      set({
        chats: remaining,
        generating: false,
        streaming: null,
        error: null,
        notice: "Чат перемещён в корзину",
      });
      if (get().activeId === id) {
        localStorage.removeItem(LAST_CHAT_KEY);
        if (remaining[0]) {
          await get().openChat(remaining[0].id);
        } else {
          set({
            activeId: null,
            doc: null,
            tokenStats: null,
            draftText: "",
            dirty: false,
            saveState: "idle",
          });
        }
      }
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },

  setError: (message) => set({ error: message }),
  setNotice: (message) => set({ notice: message }),
  setHistoryOpen: (open) => set({ isHistoryOpen: open }),

  setDraftText: (text) => {
    set({ draftText: text });
    const doc = get().doc;
    if (doc) {
      if (tokenTimer) clearTimeout(tokenTimer);
      tokenTimer = setTimeout(() => void get().refreshTokens(), 450);
    }
  },

  refreshTokens: async () => {
    const doc = get().doc;
    if (!doc) {
      set({ tokenStats: null, tokenLoading: false });
      return;
    }
    const inputs = tokenInputs(doc.chat, get().draftText);
    const seq = ++tokenRequestSeq;
    if (tokenAbort) tokenAbort.abort();
    tokenAbort = new AbortController();
    set({ tokenLoading: true });
    try {
      const stats = await api.countTokens(inputs);
      if (seq === tokenRequestSeq) set({ tokenStats: stats, tokenLoading: false });
    } catch {
      if (seq === tokenRequestSeq) set({ tokenLoading: false });
    }
  },

  saveNow: async () => {
    if (savePromise) {
      saveQueued = true;
      return savePromise;
    }
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const doc = get().doc;
    if (!doc) return true;
    if (get().generating) return false;

    savePromise = (async () => {
      let ok = true;
      do {
        saveQueued = false;
        const current = get().doc;
        if (!current) return false;
        const snapshot = JSON.stringify(current.chat);
        set({ saveState: "saving" });
        try {
          const saved = await api.saveChat(current.id, current.chat);
          const after = get().doc;
          const unchanged = Boolean(after && JSON.stringify(after.chat) === snapshot);
          set((state) => ({
            doc: unchanged ? saved : state.doc,
            saveState: unchanged ? "saved" : "idle",
            dirty: unchanged ? false : state.dirty,
            chats: upsertSummary(state.chats, saved.summary),
            error: null,
          }));
          if (unchanged) localStorage.setItem(LAST_CHAT_KEY, saved.id);
          if (savedTimer) clearTimeout(savedTimer);
          savedTimer = setTimeout(() => {
            if (get().saveState === "saved") set({ saveState: "idle" });
          }, 1800);
        } catch (error) {
          set({ saveState: "error", dirty: true, error: errorMessage(error) });
          ok = false;
          break;
        }
      } while (saveQueued);
      return ok;
    })();

    try {
      return await savePromise;
    } finally {
      savePromise = null;
    }
  },

  scheduleSave: (delay = 700) => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void get().saveNow();
    }, delay);
  },

  updateChat: (mutator, options) => {
    const doc = get().doc;
    if (!doc) return;
    const chat = cloneChat(doc.chat);
    mutator(chat);
    set({
      doc: { ...doc, chat },
      dirty: true,
      saveState: "idle",
    });
    if (tokenTimer) clearTimeout(tokenTimer);
    tokenTimer = setTimeout(() => void get().refreshTokens(), 500);
    if (options?.save !== false) get().scheduleSave();
  },

  updateChunkText: (index, text) => {
    get().updateChat((chat) => {
      const chunks = chat.chunkedPrompt?.chunks;
      const chunk = chunks?.[index];
      if (!chunk) return;
      chunk.text = text;
      chunk.tokenCount = estimateTokens(text);
      if (isThought(chunk)) {
        chunk.parts = text.trim() ? [{ text, thought: true }] : [];
      } else if (chunk.role === "model") {
        chunk.parts = text.trim() ? [{ text }] : [];
      }
    });
  },

  deleteFrames: (indices) => {
    const remove = new Set(indices);
    get().updateChat((chat) => {
      const chunks = chat.chunkedPrompt?.chunks;
      if (!chunks) return;
      chat.chunkedPrompt!.chunks = chunks.filter((_, index) => !remove.has(index));
    });
  },

  deleteAttachment: (index, slot) => {
    get().updateChat((chat) => {
      const chunks = chat.chunkedPrompt?.chunks;
      const chunk = chunks?.[index];
      if (!chunk) return;
      delete chunk[slot];
      const stillHasAttachment = [
        "driveImage",
        "inlineImage",
        "driveVideo",
        "youtubeVideo",
        "driveDocument",
        "inlineFile",
      ].some((key) => Boolean(chunk[key]));
      const hasOther =
        String(chunk.text || "").trim() ||
        chunk.executableCode ||
        chunk.codeExecutionResult ||
        chunk.errorMessage;
      if (!stillHasAttachment && !hasOther) {
        chat.chunkedPrompt!.chunks = chunks!.filter((_, chunkIndex) => chunkIndex !== index);
      }
    });
  },

  bindAttachment: (index, slot, localName, details) => {
    get().updateChat((chat) => {
      const chunk = chat.chunkedPrompt?.chunks?.[index];
      const attachment = chunk?.[slot];
      if (!attachment) return;
      attachment.localPath = localName;
      attachment.displayName = localName;
      if (attachment._localAsset) {
        attachment._localAsset.localPath = localName;
        attachment._localAsset.name = localName;
        attachment._localAsset.resolved = true;
        if (details?.size) {
          attachment._localAsset.size = details.size;
          attachment._localAsset.sizeLabel = formatBytes(details.size);
        }
        if (details?.mimeType) attachment._localAsset.mimeType = details.mimeType;
      }
    });
  },

  setSystemInstruction: (text) => {
    get().updateChat((chat) => {
      if (!chat.systemInstruction || typeof chat.systemInstruction !== "object") {
        chat.systemInstruction = { text: "" };
      }
      chat.systemInstruction.text = text;
    });
  },

  updateLocalApi: (partial) => {
    const normalized = normalizeLocal(partial);
    get().updateChat((chat) => {
      const runSettings = chat.runSettings ?? {};
      const local = runSettings.localApi ?? {};
      runSettings.localApi = { ...local, ...normalized };
      if (normalized.thinkingLevel) {
        runSettings.thinkingLevel = GAS_THINKING_BY_LEVEL[normalized.thinkingLevel];
      }
      runSettings.temperature = localSettingsFor(
        { ...get().doc!, chat },
        { ...get().settings, ...normalized },
      ).temperature;
      chat.runSettings = runSettings;
    });
    set((state) => ({ settings: { ...state.settings, ...normalized } }));
    void get().updateGlobalSettings(normalized);
    if (partial.baseUrl && partial.baseUrl !== get().modelsBaseUrl) {
      set({ models: [], modelsError: null });
      void get().loadModels(true);
    }
  },

  updateGlobalSettings: async (partial) => {
    set((state) => ({ settings: { ...state.settings, ...partial } }));
    try {
      const response = await api.updateSettings(partial);
      set({ settings: response.settings, chatDir: response.chatDir });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },

  saveApiKey: async (key) => {
    try {
      const response = await api.updateSettings({ apiKey: key });
      set({ settings: response.settings, error: null });
      void get().loadModels(true);
      return true;
    } catch (error) {
      set({ error: errorMessage(error) });
      return false;
    }
  },

  clearApiKey: async () => {
    try {
      const response = await api.updateSettings({ clearApiKey: true });
      set({ settings: response.settings, error: null });
      void get().loadModels(true);
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },

  loadModels: async (force = false, autoSelectFirst = false) => {
    const doc = get().doc;
    const local = localSettingsFor(doc, get().settings);
    if (!force && get().models.length && get().modelsBaseUrl === local.baseUrl) return;
    set({ modelsLoading: true, modelsError: null });
    try {
      const response = await api.getModels(local.baseUrl);
      set({ models: response.models, modelsBaseUrl: response.baseUrl, modelsLoading: false });
      const currentModel = doc?.chat.runSettings?.localApi?.model || get().settings.model;
      const first = response.models[0];
      const missing = Boolean(currentModel) && !response.models.some((m) => m.id === currentModel);
      if (first && (!currentModel || (autoSelectFirst && missing))) {
        if (doc) get().updateLocalApi({ model: first.id });
        else void get().updateGlobalSettings({ model: first.id });
      }
    } catch (error) {
      set({ modelsError: errorMessage(error), modelsLoading: false, models: [] });
    }
  },

  sendMessage: async (text, attachments, options) => {
    const doc = get().doc;
    if (!doc) return;
    const trimmed = text.trim();
    if (!trimmed && !attachments.length) return;

    const chunks = doc.chat.chunkedPrompt?.chunks ?? [];
    const oldLength = chunks.length;
    const now = Date.now();
    const newChunks: Chunk[] = [];

    const first: Chunk = {
      role: "user",
      text: trimmed,
      createTime: new Date(now).toISOString(),
      tokenCount: estimateTokens(trimmed),
    };
    if (attachments[0]) {
      const { slot, chunk } = attachmentChunk(attachments[0], first.createTime!);
      first[slot] = chunk[slot];
    }
    newChunks.push(first);
    for (let index = 1; index < attachments.length; index += 1) {
      const time = new Date(now + index).toISOString();
      const { chunk } = attachmentChunk(attachments[index], time);
      newChunks.push(chunk);
    }

    get().updateChat(
      (chat) => {
        if (!chat.chunkedPrompt) chat.chunkedPrompt = { chunks: [] };
        chat.chunkedPrompt.chunks = [...(chat.chunkedPrompt.chunks ?? []), ...newChunks];
      },
      { save: false },
    );
    set({ draftText: "" });
    const ok = await get().saveNow();
    if (!ok) {
      set({ error: get().error || "Не удалось сохранить сообщение перед генерацией" });
      return;
    }
    if (options?.generate === false) {
      set({ notice: "Сообщение добавлено и сохранено без генерации" });
      void get().refreshTokens();
      return;
    }
    await get().regenerateFrom(oldLength + newChunks.length - 1);
  },

  regenerateFrom: async (startIndex) => {
    const doc = get().doc;
    if (!doc) return;
    if (get().generating) return;
    if (get().dirty) {
      const ok = await get().saveNow();
      if (!ok) return;
    }
    const chunks = get().doc?.chat.chunkedPrompt?.chunks ?? [];
    const cutoff = truncationCutoff(chunks, startIndex);
    const settings = localSettingsFor(get().doc, get().settings);
    if (!settings.model) {
      set({ error: "Выберите модель локального API в правой панели." });
      return;
    }

    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (activeAbort) activeAbort.abort();
    activeAbort = new AbortController();
    const chatId = get().doc!.id;
    set({
      generating: true,
      error: null,
      notice: null,
      streaming: {
        reasoning: "",
        content: "",
        startedAt: Date.now(),
        model: settings.model,
        cutoffIndex: cutoff,
        removedCount: 0,
      },
    });

    try {
      await streamGenerate(
        chatId,
        { startIndex, settings },
        {
          onEvent: (event: GenerateEvent) => {
            if (event.type === "start") {
              set((state) => ({
                streaming: state.streaming
                  ? {
                      ...state.streaming,
                      model: event.model,
                      removedCount: event.removedCount,
                      startedAt: Date.parse(event.startedAt) || state.streaming.startedAt,
                    }
                  : null,
              }));
              return;
            }
            if (event.type === "reasoning_delta") {
              set((state) => ({
                streaming: state.streaming
                  ? { ...state.streaming, reasoning: state.streaming.reasoning + event.text }
                  : null,
              }));
              return;
            }
            if (event.type === "content_delta") {
              set((state) => ({
                streaming: state.streaming
                  ? { ...state.streaming, content: state.streaming.content + event.text }
                  : null,
              }));
              return;
            }
            if (event.type === "error") {
              set({ generating: false, streaming: null });
              void get()
                .openChat(chatId)
                .then(() => set({ error: event.message }));
              return;
            }
            if (event.type === "done") {
              applyDone(event, chatId, set);
              set({ generating: false, streaming: null, notice: event.warning || null });
              void get().refreshTokens();
            }
          },
        },
        activeAbort.signal,
      );
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") {
        set({ generating: false, streaming: null, notice: "Генерация остановлена" });
      } else {
        const message = errorMessage(error);
        set({ generating: false, streaming: null });
        void get()
          .openChat(chatId)
          .then(() => set({ error: message }));
      }
    } finally {
      activeAbort = null;
    }
  },

  stopGeneration: () => {
    if (activeAbort) {
      activeAbort.abort();
      activeAbort = null;
    }
    const chatId = get().activeId;
    set({ generating: false, streaming: null, notice: "Генерация остановлена" });
    if (chatId) {
      setTimeout(() => {
        if (!get().generating) void get().openChat(chatId);
      }, 500);
    }
  },

  refreshActive: async () => {
    const id = get().activeId;
    if (id) await get().openChat(id);
  },
}));

type StoreSetter = (
  partial: Partial<AppState> | ((state: AppState) => Partial<AppState>),
) => void;

function applyDone(event: GenerateDoneEvent, chatId: string, set: StoreSetter) {
  const doc: ChatDocument = {
    id: chatId,
    title: event.title,
    revision: event.revision,
    summary: event.summary,
    chat: event.chat,
  };
  set((state) => ({
    doc,
    activeId: chatId,
    chats: upsertSummary(state.chats, event.summary),
    dirty: false,
    saveState: "saved",
  }));
  localStorage.setItem(LAST_CHAT_KEY, chatId);
}

export function useLocalSettings(): LocalApiSettings {
  return useAppStore(useShallow((state) => localSettingsFor(state.doc, state.settings)));
}

export function useActiveChunks(): Chunk[] {
  return useAppStore((state) => state.doc?.chat.chunkedPrompt?.chunks ?? []);
}

export function useCanRun(): boolean {
  return useAppStore((state) => {
    const chunks = state.doc?.chat.chunkedPrompt?.chunks ?? [];
    return Boolean(findLastUserIndex(chunks) !== null && !state.generating);
  });
}

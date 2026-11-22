export type Role = "user" | "model";

export type AttachmentSlot =
  | "driveImage"
  | "inlineImage"
  | "driveDocument"
  | "inlineFile"
  | "driveVideo"
  | "youtubeVideo";

export type AttachmentKind = "image" | "video" | "document" | "file";

export interface LocalAsset {
  id?: string | null;
  slot: AttachmentSlot;
  kind: AttachmentKind;
  chunkIndex?: number;
  name: string;
  mimeType: string;
  size: number;
  sizeLabel?: string;
  hasData?: boolean;
  driveId?: string | null;
  localPath?: string | null;
  localBound?: boolean;
  resolved?: boolean;
  externalUrl?: string | null;
  youtubeId?: string | null;
  url?: string;
  tempId?: string | null;
  previewUrl?: string | null;
}

export interface AttachmentObject {
  id?: string;
  mimeType?: string;
  displayName?: string;
  data?: string;
  localPath?: string;
  _localAsset?: LocalAsset;
  [key: string]: unknown;
}

export interface Part {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  [key: string]: unknown;
}

export interface ExecutableCode {
  language?: string;
  code?: string;
}

export interface CodeExecutionResult {
  outcome?: string;
  output?: string;
}

export interface Chunk {
  text?: string;
  role: Role;
  tokenCount?: number;
  createTime?: string;
  isThought?: boolean;
  thinkingBudget?: number;
  finishReason?: string;
  parts?: Part[];
  driveImage?: AttachmentObject;
  inlineImage?: AttachmentObject;
  driveDocument?: AttachmentObject;
  inlineFile?: AttachmentObject;
  driveVideo?: AttachmentObject;
  youtubeVideo?: AttachmentObject;
  executableCode?: ExecutableCode;
  codeExecutionResult?: CodeExecutionResult;
  errorMessage?: string;
  grounding?: unknown;
  citations?: unknown[];
  [key: string]: unknown;
}

export interface RunSettings {
  temperature?: number;
  model?: string;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  thinkingLevel?: string;
  localApi?: Partial<LocalApiSettings>;
  [key: string]: unknown;
}

export interface GasChat {
  runSettings?: RunSettings;
  systemInstruction?: { text?: string; [key: string]: unknown };
  chunkedPrompt?: {
    chunks?: Chunk[];
    pendingInputs?: unknown[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ChatSummary {
  id: string;
  title: string;
  preview: string;
  model: string;
  messageCount: number;
  thoughtCount: number;
  attachmentCount: number;
  gasTokens: number;
  systemChars: number;
  createdAt?: string | null;
  updatedAt: string;
  size: number;
}

export interface ChatDocument {
  id: string;
  title: string;
  revision: string;
  summary: ChatSummary;
  chat: GasChat;
}

export type ThinkingLevel = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "EXTRA_HIGH";

export interface LocalApiSettings {
  baseUrl: string;
  model: string;
  reasoningMode: boolean;
  thinkingLevel: ThinkingLevel;
  temperature: number;
  maxOutputTokens: number;
  topP: number;
  sendAttachments: boolean;
  contextWindow: number;
  urlContext: boolean;
}

export interface AppSettings extends LocalApiSettings {
  apiKey?: string;
  hasApiKey?: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  ownedBy?: string;
  contextLength?: number | null;
}

export interface TokenStats {
  total: number;
  system: number;
  messages: number;
  attachments: number;
  images: number;
  files: number;
  attachmentText?: number;
  urls?: number;
  urlItems?: Array<{ url: string; title?: string; tokens: number }>;
  thoughts: number;
  approximate: boolean;
  tokenizer?: string;
}

export interface UrlContextItem {
  url: string;
  urlId: string;
  domain: string;
  title: string;
  cached: boolean;
  tokens: number;
  truncated?: boolean;
  excluded: boolean;
}

export interface UploadedAsset {
  tempId: string;
  name: string;
  mimeType: string;
  size: number;
  sizeLabel: string;
  previewUrl: string;
  convertedFrom?: string;
  originalSize?: number;
}

export interface ChatListResponse {
  chats: ChatSummary[];
  total: number;
  folder: string;
}

export interface SettingsResponse {
  settings: AppSettings;
  chatDir: string;
}

export interface GenerateStartEvent {
  type: "start";
  startedAt: string;
  removedCount: number;
  messages: number;
  model: string;
  reasoningMode: boolean;
  thinkingLevel?: string;
}

export interface GenerateDeltaEvent {
  type: "reasoning_delta" | "content_delta";
  text: string;
}

export interface GenerateDoneEvent {
  type: "done";
  chat: GasChat;
  summary: ChatSummary;
  revision: string;
  title: string;
  removedCount: number;
  finishReason: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
  maxTokens?: number;
  warning?: string | null;
}

export interface GenerateErrorEvent {
  type: "error";
  message: string;
}

export type GenerateEvent =
  | GenerateStartEvent
  | GenerateDeltaEvent
  | GenerateDoneEvent
  | GenerateErrorEvent;

export interface DisplayTurn {
  id: string;
  kind: "user" | "model";
  startIndex: number;
  mainIndex: number;
  endIndex: number;
  thoughtIndices: number[];
  chunks: Array<{ chunk: Chunk; index: number }>;
  thoughts: Array<{ chunk: Chunk; index: number }>;
  attachments: Array<{
    obj: AttachmentObject;
    index: number;
    slot: AttachmentSlot;
    meta: LocalAsset;
  }>;
  text: string;
  timestamp?: string;
}

export interface PendingAttachment {
  upload: UploadedAsset;
  kind: "image" | "file";
  slot: "inlineImage" | "inlineFile";
}

export interface StreamingState {
  reasoning: string;
  content: string;
  startedAt: number;
  model: string;
  cutoffIndex: number;
  removedCount: number;
}

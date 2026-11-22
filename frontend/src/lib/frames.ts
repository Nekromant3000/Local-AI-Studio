import type {
  AttachmentKind,
  AttachmentObject,
  AttachmentSlot,
  Chunk,
  DisplayTurn,
  GasChat,
} from "../types";

export const ATTACHMENT_SLOTS: AttachmentSlot[] = [
  "driveImage",
  "inlineImage",
  "driveVideo",
  "youtubeVideo",
  "driveDocument",
  "inlineFile",
];

export const IMAGE_SLOTS: AttachmentSlot[] = ["driveImage", "inlineImage"];

export function isThought(chunk: Chunk): boolean {
  if (chunk.isThought) return true;
  const parts = chunk.parts;
  return Boolean(
    parts &&
      parts.length > 0 &&
      parts.every((part) => Boolean(part && part.thought)),
  );
}

export function chunkText(chunk: Chunk): string {
  if (chunk.text) return chunk.text;
  if (!chunk.parts?.length) return "";
  return chunk.parts
    .map((part) => (part.thought ? "" : part.text || ""))
    .filter(Boolean)
    .join("\n\n");
}

export function kindForSlot(slot: AttachmentSlot): AttachmentKind {
  if (slot === "driveImage" || slot === "inlineImage") return "image";
  if (slot === "driveVideo" || slot === "youtubeVideo") return "video";
  if (slot === "driveDocument") return "document";
  return "file";
}

export interface ResolvedAttachment {
  obj: AttachmentObject;
  index: number;
  slot: AttachmentSlot;
  meta: NonNullable<AttachmentObject["_localAsset"]>;
}

export function getAttachments(chunk: Chunk, index: number): ResolvedAttachment[] {
  const result: ResolvedAttachment[] = [];
  for (const slot of ATTACHMENT_SLOTS) {
    const obj = chunk[slot];
    if (!obj || typeof obj !== "object") continue;
    const kind = kindForSlot(slot);
    const fallbackName =
      obj.displayName ||
      (slot === "youtubeVideo" ? `YouTube · ${obj.id || ""}` : `Вложение ${index + 1}`);
    const meta = obj._localAsset ?? {
      slot,
      kind,
      chunkIndex: index,
      name: fallbackName,
      mimeType: obj.mimeType || "application/octet-stream",
      size: 0,
      driveId: obj.id ?? null,
      localPath: obj.localPath ?? null,
      resolved: slot === "inlineImage" || slot === "inlineFile",
      externalUrl:
        obj.id && slot.startsWith("drive")
          ? `https://drive.google.com/file/d/${obj.id}/view`
          : obj.id && slot === "youtubeVideo"
            ? `https://www.youtube.com/watch?v=${obj.id}`
            : null,
    };
    result.push({ obj, index, slot, meta });
  }
  return result;
}

export function chunkHasAnyAttachment(chunk: Chunk): boolean {
  return ATTACHMENT_SLOTS.some((slot) => Boolean(chunk[slot]));
}

export function chunkHasRenderableContent(chunk: Chunk): boolean {
  if (String(chunk.text || "").trim()) return true;
  if (chunkHasAnyAttachment(chunk)) return true;
  if (chunk.executableCode?.code) return true;
  if (chunk.codeExecutionResult?.output) return true;
  if (chunk.errorMessage) return true;
  if (chunk.grounding || chunk.citations) return true;
  return false;
}

type TurnEntry = { chunk: Chunk; index: number };

function makeTurn(
  kind: "user" | "model",
  entries: TurnEntry[],
  thoughts: TurnEntry[],
  main: TurnEntry | null,
  orphan = false,
): DisplayTurn {
  const attachments = entries.flatMap(({ chunk, index }) =>
    getAttachments(chunk, index).map(({ obj, index: chunkIndex, slot, meta }) => ({
      obj,
      index: chunkIndex,
      slot,
      meta,
    })),
  );
  const startIndex = entries[0]?.index ?? 0;
  const endIndex = entries[entries.length - 1]?.index ?? startIndex;
  const mainChunk = main?.chunk ?? entries[entries.length - 1]?.chunk;
  return {
    id: `${kind}-${startIndex}-${endIndex}`,
    kind,
    startIndex,
    mainIndex: main?.index ?? startIndex,
    endIndex,
    thoughtIndices: thoughts.map(({ index }) => index),
    chunks: entries,
    thoughts,
    attachments,
    text: orphan || !mainChunk ? "" : chunkText(mainChunk),
    timestamp:
      main?.chunk.createTime ??
      entries[entries.length - 1]?.chunk.createTime ??
      entries[0]?.chunk.createTime,
  };
}

export function groupTurns(chunks: Chunk[]): DisplayTurn[] {
  const turns: DisplayTurn[] = [];
  let pending: TurnEntry[] = [];
  let index = 0;

  const flushOrphanThoughts = () => {
    if (!pending.length) return;
    turns.push(makeTurn("model", pending, pending, null, true));
    pending = [];
  };

  while (index < chunks.length) {
    const chunk = chunks[index];
    if (!chunk) {
      index += 1;
      continue;
    }
    if (isThought(chunk)) {
      pending.push({ chunk, index });
      index += 1;
      continue;
    }

    if (chunk.role === "user") {
      flushOrphanThoughts();
      const entries: TurnEntry[] = [{ chunk, index }];
      let textEntry = chunkText(chunk).trim() ? entries[0] : null;
      let cursor = index + 1;
      // Consecutive user chunks belong to the same prompt: Google AI Studio
      // stores each attachment in its own chunk, usually before the text.
      while (cursor < chunks.length) {
        const next = chunks[cursor];
        if (!next || next.role !== "user" || isThought(next)) break;
        const nextHasText = Boolean(chunkText(next).trim());
        if (nextHasText && textEntry) break;
        const entry = { chunk: next, index: cursor };
        entries.push(entry);
        if (nextHasText) textEntry = entry;
        cursor += 1;
      }
      const main =
        textEntry ??
        entries.find((entry) => chunkHasRenderableContent(entry.chunk)) ??
        entries[0];
      turns.push(makeTurn("user", entries, [], main));
      index = cursor;
      continue;
    }

    const main = { chunk, index };
    turns.push(makeTurn("model", [...pending, main], pending, main));
    pending = [];
    index += 1;
  }

  flushOrphanThoughts();
  return turns;
}

export function truncationCutoff(chunks: Chunk[], startIndex: number | null): number {
  if (startIndex === null) return chunks.length;
  if (startIndex < 0 || startIndex >= chunks.length) return chunks.length;
  const target = chunks[startIndex];
  if (!target) return chunks.length;
  if (target.role === "user") return startIndex + 1;
  let cut = startIndex;
  while (cut > 0 && chunks[cut - 1] && isThought(chunks[cut - 1])) cut -= 1;
  return cut;
}

export function tokenInputs(chat: GasChat, extraText: string) {
  const chunks = chat.chunkedPrompt?.chunks ?? [];
  const system = String(chat.systemInstruction?.text ?? "");
  const texts: string[] = [];
  const thoughtTexts: string[] = [];
  let imageCount = 0;
  let fileCount = 0;

  for (const chunk of chunks) {
    if (!chunk) continue;
    const text = String(chunk.text || "");
    if (isThought(chunk)) {
      if (text) thoughtTexts.push(text);
    } else if (text && (chunk.role === "user" || chunk.role === "model")) {
      texts.push(text);
    }
    if (!isThought(chunk)) {
      if (chunk.driveImage || chunk.inlineImage) imageCount += 1;
      if (chunk.driveDocument || chunk.inlineFile) fileCount += 1;
    }
  }
  if (extraText.trim()) texts.push(extraText.trim());
  return { texts, system, imageCount, fileCount, thoughtTexts };
}

export function countChunks(chat: GasChat): {
  messages: number;
  thoughts: number;
  attachments: number;
} {
  const chunks = chat.chunkedPrompt?.chunks ?? [];
  let messages = 0;
  let thoughts = 0;
  let attachments = 0;
  for (const chunk of chunks) {
    if (!chunk) continue;
    attachments += getAttachments(chunk, 0).length;
    if (isThought(chunk)) thoughts += 1;
    else if (chunkHasRenderableContent(chunk)) messages += 1;
  }
  return { messages, thoughts, attachments };
}

export function thoughtDuration(turn: DisplayTurn): number | null {
  if (!turn.thoughts.length || !turn.timestamp) return null;
  const first = turn.thoughts[0].chunk.createTime;
  if (!first) return null;
  const start = Date.parse(first);
  const end = Date.parse(turn.timestamp);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 1000));
}

export function estimateTokens(text: string): number {
  return Math.max(0, Math.ceil((text || "").length / 4));
}

export function findLastUserIndex(chunks: Chunk[]): number | null {
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    if (chunks[index]?.role === "user" && !isThought(chunks[index])) return index;
  }
  return null;
}

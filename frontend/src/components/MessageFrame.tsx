import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  Loader2,
  Pencil,
  Play,
  Save,
  Trash2,
  User,
  X,
} from "lucide-react";
import clsx from "clsx";
import type { DisplayTurn } from "../types";
import { formatDateTime } from "../lib/format";
import { useAppStore } from "../store/useAppStore";
import AttachmentGrid from "./AttachmentGrid";
import CodeBlock from "./CodeBlock";
import ConfirmDialog from "./ConfirmDialog";
import CopyButton from "./CopyButton";
import MarkdownView from "./MarkdownView";
import ThinkingBlock from "./ThinkingBlock";
import UrlContextChips from "./UrlContextChips";

interface MessageFrameProps {
  turn: DisplayTurn;
  chatId: string;
}

export default function MessageFrame({ turn, chatId }: MessageFrameProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(turn.text);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRun, setConfirmRun] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isUser = turn.kind === "user";
  const updateChunkText = useAppStore((state) => state.updateChunkText);
  const deleteFrames = useAppStore((state) => state.deleteFrames);
  const saveNow = useAppStore((state) => state.saveNow);
  const regenerateFrom = useAppStore((state) => state.regenerateFrom);
  const generating = useAppStore((state) => state.generating);
  const totalChunks = useAppStore(
    (state) => state.doc?.chat.chunkedPrompt?.chunks?.length ?? 0,
  );

  const mainChunk = turn.chunks.find((entry) => entry.index === turn.mainIndex)?.chunk;
  const serviceData: Array<{ label: string; value: unknown }> = [];
  if (mainChunk?.grounding) serviceData.push({ label: "Grounding", value: mainChunk.grounding });
  if (mainChunk?.citations?.length)
    serviceData.push({ label: "Citations", value: mainChunk.citations });
  if (mainChunk?.errorMessage) serviceData.push({ label: "Error", value: mainChunk.errorMessage });

  useEffect(() => {
    setEditing(false);
    setDraft(turn.text);
  }, [turn.mainIndex, turn.text]);

  useEffect(() => {
    if (!editing) return;
    const node = textareaRef.current;
    if (!node) return;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
    node.style.height = "auto";
    node.style.height = `${Math.min(480, Math.max(120, node.scrollHeight))}px`;
  }, [editing]);

  const startEdit = () => {
    setDraft(turn.text);
    setEditing(true);
  };

  const save = async (thenRegenerate = false) => {
    if (saving) return;
    setSaving(true);
    try {
      if (draft !== turn.text) updateChunkText(turn.mainIndex, draft);
      setEditing(false);
      if (thenRegenerate) {
        await regenerateFrom(runIndex);
      } else {
        await saveNow();
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const indices = Array.from(new Set(turn.chunks.map(({ index }) => index)));
    deleteFrames(indices);
    await saveNow();
  };

  const run = () => {
    if (generating) return;
    void regenerateFrom(runIndex);
  };

  const runIndex = isUser ? turn.endIndex : turn.startIndex;
  const laterChunks = Math.max(0, totalChunks - (runIndex + 1));

  return (
    <section
      className={clsx("group/frame animate-fade-up", isUser ? "flex justify-end" : "w-full")}
    >
      <div
        className={clsx(
          "min-w-0",
          isUser
            ? "ml-auto w-full max-w-[min(760px,92%)] rounded-2xl border border-[#293b63]/80 bg-[#101a31]/75 px-4 py-3 shadow-[0_1px_0_rgba(255,255,255,.03)_inset]"
            : "w-full px-0.5",
        )}
      >
        <div className="mb-1.5 flex items-center gap-2">
          <div
            className={clsx(
              "flex h-6 w-6 flex-none items-center justify-center rounded-lg border",
              isUser
                ? "border-sky-300/20 bg-sky-400/10 text-sky-300"
                : "border-violet-300/20 bg-violet-400/10 text-violet-300",
            )}
          >
            {isUser ? <User size={13} /> : <Bot size={13} />}
          </div>
          <span className="text-[11.5px] font-semibold text-ink-100">
            {isUser ? "Вы" : "Модель"}
          </span>
          {turn.timestamp ? (
            <span className="text-[10px] text-ink-500">{formatDateTime(turn.timestamp)}</span>
          ) : null}
          {mainChunk?.finishReason === "MAX_TOKENS" ? (
            <span className="badge border-amber-300/20 bg-amber-300/[0.07] text-amber-200">
              лимит токенов
            </span>
          ) : null}
          {typeof mainChunk?.tokenCount === "number" && mainChunk.tokenCount > 0 ? (
            <span className="hidden text-[9.5px] text-ink-500 sm:inline">
              {mainChunk.tokenCount} ток.
            </span>
          ) : null}
          <span className="ml-auto font-mono text-[9px] text-ink-600">
            #{turn.mainIndex}
          </span>
        </div>

        {!isUser ? <ThinkingBlock turn={turn} /> : null}

        {editing ? (
          <div className="rounded-xl border border-accent-400/30 bg-[#080e1b] p-2">
            <textarea
              ref={textareaRef}
              className="field resize-y border-0 bg-transparent px-2 py-1.5 font-mono text-[13px] leading-relaxed focus:shadow-none"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                const node = event.currentTarget;
                node.style.height = "auto";
                node.style.height = `${Math.min(480, Math.max(120, node.scrollHeight))}px`;
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setEditing(false);
                }
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void save(false);
                }
              }}
              placeholder="Текст сообщения…"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void save(false)}
                disabled={saving}
              >
                {saving ? <Loader2 size={13} className="spin" /> : <Save size={13} />}
                Сохранить
              </button>
              {isUser ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => void save(true)}
                  disabled={saving || generating}
                  title="Сохранить и сгенерировать ответ с этого сообщения"
                >
                  <Play size={13} />
                  Сохранить и ответить
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                <X size={13} />
                Отмена
              </button>
              <span className="ml-auto text-[10px] text-ink-500">
                {draft.length.toLocaleString("ru-RU")} символов · Ctrl+Enter — сохранить
              </span>
            </div>
          </div>
        ) : (
          <>
            {mainChunk?.executableCode?.code ? (
              <CodeBlock
                code={mainChunk.executableCode.code}
                language={mainChunk.executableCode.language}
              />
            ) : null}

            {turn.text.trim() ? (
              <MarkdownView>{turn.text}</MarkdownView>
            ) : !turn.attachments.length &&
              !mainChunk?.executableCode?.code &&
              !mainChunk?.codeExecutionResult?.output ? (
              <div className="py-1 text-[12.5px] italic text-ink-500">Пустой фрейм</div>
            ) : null}

            {mainChunk?.codeExecutionResult?.output ? (
              <div className="mt-2">
                <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-ink-400">
                  <Check size={12} className="text-emerald-300" />
                  Результат выполнения
                  {mainChunk.codeExecutionResult.outcome ? (
                    <span className="badge">{mainChunk.codeExecutionResult.outcome}</span>
                  ) : null}
                </div>
                <CodeBlock code={mainChunk.codeExecutionResult.output} language="text" />
              </div>
            ) : null}

            {mainChunk?.errorMessage ? (
              <div className="mt-2 flex items-start gap-2 rounded-lg border border-rose-400/25 bg-rose-400/[0.07] px-3 py-2 text-[12px] text-rose-200">
                <AlertTriangle size={14} className="mt-0.5 flex-none" />
                <span className="whitespace-pre-wrap">{mainChunk.errorMessage}</span>
              </div>
            ) : null}

            <AttachmentGrid chatId={chatId} attachments={turn.attachments} />

            {isUser ? <UrlContextChips chatId={chatId} text={turn.text} /> : null}

            {serviceData.length ? (
              <details className="mt-3 rounded-lg border border-white/[0.07] bg-white/[0.015]">
                <summary className="cursor-pointer px-3 py-1.5 text-[10.5px] text-ink-400 hover:text-ink-200">
                  Служебные данные ({serviceData.map((entry) => entry.label).join(", ")})
                </summary>
                <div className="border-t border-white/[0.06] p-2">
                  {serviceData.map((entry) => (
                    <div key={entry.label} className="mb-1 last:mb-0">
                      <div className="px-1 py-1 text-[10px] uppercase tracking-wider text-ink-500">
                        {entry.label}
                      </div>
                      <CodeBlock
                        code={
                          typeof entry.value === "string"
                            ? entry.value
                            : JSON.stringify(entry.value, null, 2)
                        }
                        language={typeof entry.value === "string" ? "text" : "json"}
                      />
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </>
        )}

        {!editing ? (
          <div
            className={clsx(
              "mt-2 flex flex-wrap items-center gap-0.5 border-t border-white/[0.05] pt-1.5 transition-opacity",
              "opacity-70 sm:opacity-0 sm:group-hover/frame:opacity-100 sm:focus-within:opacity-100",
            )}
          >
            {turn.text ? (
              <CopyButton
                text={turn.text}
                label="Копировать"
                className="rounded-md px-1.5 py-1 text-[10.5px]"
                iconSize={13}
              />
            ) : null}
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10.5px] text-ink-400 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-40"
              onClick={startEdit}
              disabled={generating}
              title="Редактировать без генерации"
            >
              <Pencil size={13} />
              Изменить
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10.5px] text-accent-300 transition-colors hover:bg-accent-500/10 hover:text-accent-200 disabled:opacity-40"
              onClick={() => setConfirmRun(true)}
              disabled={generating}
              title={
                isUser
                  ? "Сгенерировать ответ с этого сообщения (последующие фреймы будут удалены)"
                  : "Перегенерировать этот ответ и удалить последующие фреймы"
              }
            >
              <Play size={13} />
              {isUser ? "Ответить отсюда" : "Перегенерировать"}
            </button>
            <button
              type="button"
              className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10.5px] text-ink-500 transition-colors hover:bg-rose-400/10 hover:text-rose-300 disabled:opacity-40"
              onClick={() => setConfirmDelete(true)}
              disabled={generating}
              title="Удалить фрейм"
            >
              <Trash2 size={13} />
              Удалить
            </button>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={isUser ? "Удалить сообщение?" : "Удалить ответ модели?"}
        description={
          <div className="space-y-2">
            <p>
              {isUser
                ? "Сообщение пользователя и его вложения будут удалены из JSON чата."
                : "Ответ модели, блок мыслей и вложения этого фрейма будут удалены из JSON чата."}
            </p>
            <p className="text-ink-400">
              Последующие сообщения останутся на месте. Резервная копия файла будет создана
              автоматически.
            </p>
          </div>
        }
        confirmLabel="Удалить фрейм"
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      />

      <ConfirmDialog
        open={confirmRun}
        title={isUser ? "Сгенерировать ответ отсюда?" : "Перегенерировать ответ?"}
        description={
          <div className="space-y-2">
            <p>
              {isUser
                ? "Модель получит контекст до этого сообщения включительно и создаст новый ответ."
                : "Текущий ответ (включая мысли) будет заменён новым."}
            </p>
            {laterChunks > 0 ? (
              <p className="rounded-lg border border-amber-300/20 bg-amber-300/[0.06] px-2.5 py-2 text-amber-200">
                Будут удалены последующие фреймы: {laterChunks}. Текущая версия файла сохранится в
                резервных копиях.
              </p>
            ) : null}
          </div>
        }
        confirmLabel={isUser ? "Сгенерировать" : "Перегенерировать"}
        danger={false}
        onConfirm={run}
        onClose={() => setConfirmRun(false)}
      />
    </section>
  );
}

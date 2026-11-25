import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Brain,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Save,
  Send,
  Square,
  X,
} from "lucide-react";
import clsx from "clsx";
import { api, extractErrorMessage } from "../lib/api";
import { formatBytes } from "../lib/format";
import { useLocalSettings, useAppStore } from "../store/useAppStore";
import type { PendingAttachment } from "../types";

interface ComposerProps {
  onOpenSettings?: () => void;
}

const THINKING_BADGE_LABEL: Record<string, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  EXTRA_HIGH: "Extra High",
};

export default function Composer({ onOpenSettings }: ComposerProps) {
  const draftText = useAppStore((state) => state.draftText);
  const setDraftText = useAppStore((state) => state.setDraftText);
  const sendMessage = useAppStore((state) => state.sendMessage);
  const stopGeneration = useAppStore((state) => state.stopGeneration);
  const generating = useAppStore((state) => state.generating);
  const activeId = useAppStore((state) => state.activeId);
  const tokenStats = useAppStore((state) => state.tokenStats);
  const uploadQueue = useAppStore((state) => state.uploadQueue);
  const clearUploadQueue = useAppStore((state) => state.clearUploadQueue);
  const settings = useLocalSettings();

  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAttachments([]);
    setUploadError(null);
    setUploading(0);
  }, [activeId]);

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(220, Math.max(48, node.scrollHeight))}px`;
  }, [draftText]);

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    const session = activeId;
    setUploadError(null);
    for (const file of list) {
      if (file.size > 50 * 1024 * 1024) {
        setUploadError(`«${file.name}» больше 50 МБ`);
        continue;
      }
      setUploading((value) => value + 1);
      try {
        const uploaded = await api.uploadAsset(file);
        if (!uploaded) continue;
        const kind: "image" | "file" = uploaded.mimeType.startsWith("image/") ? "image" : "file";
        if (useAppStore.getState().activeId !== session) continue;
        setAttachments((current) => [
          ...current,
          {
            upload: uploaded,
            kind,
            slot: kind === "image" ? "inlineImage" : "inlineFile",
          },
        ]);
      } catch (error) {
        // extractErrorMessage разворачивает и FastAPI 422-массивы, и объекты
        // detail — пользователь всегда видит читаемый текст, а не [object Object].
        setUploadError(`«${file.name}»: ${extractErrorMessage(error)}`);
      } finally {
        setUploading((value) => Math.max(0, value - 1));
      }
    }
  };

  useEffect(() => {
    if (!uploadQueue.length) return;
    const files = uploadQueue;
    clearUploadQueue();
    void addFiles(files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadQueue]);

  const submit = (generate: boolean) => {
    const text = draftText;
    const files = attachments;
    if ((!text.trim() && !files.length) || generating) return;
    setAttachments([]);
    setUploadError(null);
    setDraftText("");
    void sendMessage(text, files, { generate });
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const canSend = Boolean(draftText.trim() || attachments.length) && !generating;

  return (
    <div className="relative flex-none px-3 pb-3 pt-1.5 sm:px-5 sm:pb-4">
      <div className="mx-auto w-full max-w-4xl">
        {!settings.model ? (
          <button
            type="button"
            className="mb-2 flex w-full items-center gap-2 rounded-lg border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 text-left text-[11px] text-amber-200 transition-colors hover:bg-amber-300/[0.1]"
            onClick={onOpenSettings}
          >
            <AlertTriangle size={13} className="flex-none" />
            Модель не выбрана. Укажите локальный API и модель в правой панели.
            <span className="ml-auto text-amber-300/80">Настройки →</span>
          </button>
        ) : null}

        <div
          className={clsx(
            "relative rounded-2xl border bg-[#0a1120]/95 shadow-[0_18px_60px_rgba(0,0,0,.4)] transition-all duration-150",
            dragging
              ? "border-accent-400/70 ring-2 ring-accent-500/20"
              : "border-white/[0.11] focus-within:border-accent-400/50 focus-within:ring-2 focus-within:ring-accent-500/10",
          )}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(event) => {
            if (event.currentTarget === event.target) setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (event.dataTransfer.files?.length) void addFiles(event.dataTransfer.files);
          }}
        >
          {attachments.length || uploading ? (
            <div className="flex flex-wrap gap-1.5 border-b border-white/[0.06] px-2.5 pb-2 pt-2.5">
              {attachments.map((attachment) => (
                <div
                  key={attachment.upload.tempId}
                  className="group flex max-w-[240px] items-center gap-2 rounded-lg border border-white/10 bg-white/[0.035] p-1 pr-1.5"
                >
                  {attachment.kind === "image" ? (
                    <img
                      src={attachment.upload.previewUrl}
                      alt={attachment.upload.name}
                      className="h-8 w-8 flex-none rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-8 w-8 flex-none items-center justify-center rounded bg-black/25">
                      <FileText size={15} className="text-amber-300" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-[10.5px] text-ink-200" title={attachment.upload.name}>
                      {attachment.upload.name}
                    </div>
                    <div className="text-[9px] text-ink-500">
                      {formatBytes(attachment.upload.size)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="icon-btn h-6 w-6 flex-none opacity-60 hover:!text-rose-300 group-hover:opacity-100"
                    onClick={() =>
                      setAttachments((current) =>
                        current.filter(
                          (item) => item.upload.tempId !== attachment.upload.tempId,
                        ),
                      )
                    }
                    title="Убрать вложение"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              {uploading > 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.025] px-2.5 py-2 text-[10px] text-ink-300">
                  <Loader2 size={13} className="spin" />
                  Загружаю {uploading}…
                </div>
              ) : null}
            </div>
          ) : null}

          <textarea
            ref={textareaRef}
            className="block max-h-[220px] min-h-[48px] w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-[13.5px] leading-relaxed text-ink-100 outline-none placeholder:text-ink-500"
            placeholder={
              generating
                ? "Модель отвечает… дождитесь завершения или остановите генерацию"
                : "Спросите модель…  Enter — отправить, Shift+Enter — новая строка"
            }
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (canSend) submit(true);
              }
            }}
            onPaste={(event) => {
              const files = event.clipboardData?.files;
              if (files?.length) {
                event.preventDefault();
                void addFiles(files);
              }
            }}
            rows={1}
          />

          {uploadError ? (
            <div className="flex items-center gap-1.5 px-3.5 pb-1 text-[10.5px] text-rose-300">
              <AlertTriangle size={11} />
              {uploadError}
            </div>
          ) : null}

          <div className="flex items-center gap-1 px-2 py-1.5">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files) void addFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files) void addFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              className="icon-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Прикрепить файл"
              disabled={generating}
            >
              <Paperclip size={16} />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => imageInputRef.current?.click()}
              title="Прикрепить изображение"
              disabled={generating}
            >
              <ImageIcon size={16} />
            </button>

            <div className="ml-1 hidden items-center gap-1.5 text-[9.5px] text-ink-500 sm:flex">
              {settings.thinkingLevel !== "NONE" ? (
                <span className="badge border-violet-300/20 bg-violet-300/[0.06] text-violet-200">
                  <Brain size={10} />
                  Мышление · {THINKING_BADGE_LABEL[settings.thinkingLevel] ?? settings.thinkingLevel} · 65536
                </span>
              ) : null}
              {tokenStats ? (
                <span title="Приблизительный размер текущего контекста">
                  {tokenStats.total.toLocaleString("ru-RU")} ток.
                </span>
              ) : null}
              {settings.model ? (
                <span className="max-w-[160px] truncate font-mono" title={settings.model}>
                  {settings.model}
                </span>
              ) : null}
            </div>

            <div className="ml-auto flex items-center gap-1.5">
              {generating ? (
                <button type="button" className="btn btn-danger" onClick={stopGeneration}>
                  <Square size={12} fill="currentColor" />
                  Остановить
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost hidden sm:inline-flex"
                    onClick={() => submit(false)}
                    disabled={!canSend}
                    title="Добавить сообщение в JSON без генерации ответа"
                  >
                    <Save size={13} />
                    Без ответа
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary h-9 px-3.5"
                    onClick={() => submit(true)}
                    disabled={!canSend}
                    title="Отправить и сгенерировать ответ"
                  >
                    <Send size={14} />
                    Отправить
                  </button>
                </>
              )}
            </div>
          </div>

          {dragging ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent-400/60 bg-[#0a1120]/85 text-[12px] text-accent-200 backdrop-blur-sm">
              Отпустите файлы, чтобы прикрепить
            </div>
          ) : null}
        </div>

        <div className="mt-1.5 flex items-center gap-2 px-1 text-[9.5px] text-ink-600">
          <span>Вложения хранятся локально и встраиваются в JSON чата.</span>
          <span className="ml-auto hidden sm:inline">
            Enter — отправить · Shift+Enter — перенос · Ctrl+V — вставить изображение
          </span>
        </div>
      </div>
    </div>
  );
}

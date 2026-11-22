import { useEffect, useMemo, useState } from "react";
import {
  Download,
  ExternalLink,
  Eye,
  File,
  FileText,
  Film,
  HardDrive,
  Image as ImageIcon,
  Link2,
  Trash2,
  Youtube,
} from "lucide-react";
import clsx from "clsx";
import type { DisplayTurn, LocalAsset } from "../types";
import { chatAssetUrl, localAssetUrl } from "../lib/api";
import { formatBytes } from "../lib/format";
import { useAppStore } from "../store/useAppStore";
import AttachmentPicker from "./AttachmentPicker";
import ConfirmDialog from "./ConfirmDialog";
import PreviewModal from "./PreviewModal";

type Attachment = DisplayTurn["attachments"][number];

function isInline(meta: LocalAsset): boolean {
  return meta.slot === "inlineImage" || meta.slot === "inlineFile";
}

function canBind(meta: LocalAsset): boolean {
  return meta.slot === "driveImage" || meta.slot === "driveDocument" || meta.slot === "driveVideo";
}

function previewSource(chatId: string, attachment: Attachment): string | null {
  const { meta, index, slot } = attachment;
  if (isInline(meta)) return chatAssetUrl(chatId, index, slot);
  if (meta.localPath) return localAssetUrl(meta.localPath);
  if (meta.previewUrl) return meta.previewUrl;
  if (meta.slot === "youtubeVideo" && meta.youtubeId)
    return `https://img.youtube.com/vi/${meta.youtubeId}/hqdefault.jpg`;
  return null;
}

function downloadSource(chatId: string, attachment: Attachment): string | null {
  const { meta, index, slot } = attachment;
  if (isInline(meta)) return chatAssetUrl(chatId, index, slot, true);
  if (meta.localPath) return localAssetUrl(meta.localPath, true);
  if (meta.previewUrl) return meta.previewUrl;
  return null;
}

function bindKind(slot: LocalAsset["slot"]): "image" | "document" | "video" {
  if (slot === "driveImage") return "image";
  if (slot === "driveVideo") return "video";
  return "document";
}

function FileIcon({ meta }: { meta: LocalAsset }) {
  if (meta.slot === "youtubeVideo") return <Youtube size={18} className="text-rose-300" />;
  if (meta.kind === "video") return <Film size={18} className="text-sky-300" />;
  if (meta.kind === "document") return <FileText size={18} className="text-amber-300" />;
  return <File size={18} className="text-ink-300" />;
}

interface AttachmentGridProps {
  chatId: string;
  attachments: Attachment[];
  compact?: boolean;
}

export default function AttachmentGrid({ chatId, attachments, compact }: AttachmentGridProps) {
  const deleteAttachment = useAppStore((state) => state.deleteAttachment);
  const bindAttachment = useAppStore((state) => state.bindAttachment);
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [binding, setBinding] = useState<Attachment | null>(null);
  const [deleting, setDeleting] = useState<Attachment | null>(null);

  const images = useMemo(
    () => attachments.filter((attachment) => attachment.meta.kind === "image"),
    [attachments],
  );
  const files = useMemo(
    () => attachments.filter((attachment) => attachment.meta.kind !== "image"),
    [attachments],
  );

  useEffect(() => {
    setBroken({});
  }, [attachments]);

  if (!attachments.length) return null;

  const openPreview = (attachment: Attachment) => {
    setPreview(attachment);
  };

  const openExternal = (attachment: Attachment) => {
    if (attachment.meta.externalUrl) {
      window.open(attachment.meta.externalUrl, "_blank", "noreferrer noopener");
    } else if (attachment.meta.slot === "youtubeVideo" && attachment.meta.youtubeId) {
      window.open(
        `https://www.youtube.com/watch?v=${attachment.meta.youtubeId}`,
        "_blank",
        "noreferrer noopener",
      );
    }
  };

  const handleDelete = () => {
    if (!deleting) return;
    deleteAttachment(deleting.index, deleting.slot);
  };

  const previewUrl = preview ? previewSource(chatId, preview) : null;
  const previewDownload = preview ? downloadSource(chatId, preview) : null;

  return (
    <div className={clsx("space-y-2", compact ? "mt-2" : "mt-3.5")}>
      {images.length ? (
        <div
          className={clsx(
            "grid gap-2",
            images.length === 1
              ? "max-w-[360px] grid-cols-1"
              : "grid-cols-2 sm:grid-cols-3",
          )}
        >
          {images.map((attachment) => {
            const key = `${attachment.index}:${attachment.slot}`;
            const src = previewSource(chatId, attachment);
            const showImage = Boolean(src) && !broken[key];
            return (
              <div
                key={key}
                className="group relative overflow-hidden rounded-xl border border-white/[0.09] bg-[#080d18]"
              >
                <button
                  type="button"
                  className="relative block aspect-[4/3] w-full overflow-hidden bg-gradient-to-br from-[#141d33] via-[#0d1527] to-[#080d18]"
                  onClick={() => (showImage ? openPreview(attachment) : setBinding(attachment))}
                  title={showImage ? "Открыть предпросмотр" : "Привязать локальный файл"}
                >
                  {showImage ? (
                    <img
                      src={src || ""}
                      alt={attachment.meta.name}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                      onError={() =>
                        setBroken((current) => ({ ...current, [key]: true }))
                      }
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
                        {attachment.meta.slot === "driveImage" ? (
                          <HardDrive size={19} className="text-ink-300" />
                        ) : (
                          <ImageIcon size={19} className="text-ink-300" />
                        )}
                      </div>
                      <div className="text-[11px] text-ink-300">
                        {attachment.meta.driveId
                          ? `Drive · ${attachment.meta.driveId.slice(0, 10)}…`
                          : "Нет локальной копии"}
                      </div>
                      <div className="text-[10px] text-accent-300">Привязать файл</div>
                    </div>
                  )}
                  <span className="absolute left-1.5 top-1.5 rounded-md border border-white/10 bg-black/60 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-ink-200 backdrop-blur">
                    {isInline(attachment.meta)
                      ? "Inline"
                      : attachment.meta.localPath
                        ? "Локально"
                        : "Drive"}
                  </span>
                </button>
                <div className="flex items-center gap-2 border-t border-white/[0.06] px-2.5 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] text-ink-200" title={attachment.meta.name}>
                      {attachment.meta.name}
                    </div>
                    <div className="truncate text-[9.5px] text-ink-400">
                      {attachment.meta.size
                        ? formatBytes(attachment.meta.size)
                        : attachment.meta.mimeType}
                    </div>
                  </div>
                  <div className="flex flex-none items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    {showImage ? (
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => openPreview(attachment)}
                        title="Предпросмотр"
                      >
                        <Eye size={13} />
                      </button>
                    ) : null}
                    {canBind(attachment.meta) ? (
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setBinding(attachment)}
                        title="Привязать локальный файл"
                      >
                        <Link2 size={13} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="icon-btn hover:!text-rose-300"
                      onClick={() => setDeleting(attachment)}
                      title="Удалить вложение"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {files.length ? (
        <div className="space-y-1.5">
          {files.map((attachment) => {
            const key = `${attachment.index}:${attachment.slot}`;
            const src = previewSource(chatId, attachment);
            const external = attachment.meta.externalUrl;
            return (
              <div
                key={key}
                className="group flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.022] px-3 py-2.5 transition-colors hover:border-white/[0.14] hover:bg-white/[0.035]"
              >
                <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-white/10 bg-black/25">
                  <FileIcon meta={attachment.meta} />
                </div>
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => (src ? openPreview(attachment) : external && openExternal(attachment))}
                  disabled={!src && !external}
                >
                  <div className="truncate text-[12px] text-ink-100" title={attachment.meta.name}>
                    {attachment.meta.name}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-ink-400">
                    <span>{attachment.meta.mimeType || attachment.meta.kind}</span>
                    {attachment.meta.size ? <span>· {formatBytes(attachment.meta.size)}</span> : null}
                    {attachment.meta.slot === "youtubeVideo" ? (
                      <span className="text-rose-300/90">· YouTube</span>
                    ) : attachment.meta.localPath ? (
                      <span className="text-emerald-300/80">· локальный файл</span>
                    ) : attachment.meta.slot.startsWith("drive") ? (
                      <span className="text-amber-300/80">· Drive</span>
                    ) : null}
                  </div>
                </button>
                <div className="flex flex-none items-center gap-0.5">
                  {src ? (
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => openPreview(attachment)}
                      title="Предпросмотр"
                    >
                      <Eye size={14} />
                    </button>
                  ) : null}
                  {external ? (
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => openExternal(attachment)}
                      title="Открыть оригинал"
                    >
                      <ExternalLink size={14} />
                    </button>
                  ) : null}
                  {canBind(attachment.meta) ? (
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setBinding(attachment)}
                      title="Привязать локальный файл"
                    >
                      <Link2 size={14} />
                    </button>
                  ) : null}
                  {src ? (
                    <a
                      className="icon-btn"
                      href={downloadSource(chatId, attachment) || src}
                      download={attachment.meta.name}
                      title="Скачать"
                    >
                      <Download size={14} />
                    </a>
                  ) : null}
                  <button
                    type="button"
                    className="icon-btn hover:!text-rose-300"
                    onClick={() => setDeleting(attachment)}
                    title="Удалить вложение"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <PreviewModal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        name={preview?.meta.name || ""}
        mimeType={preview?.meta.mimeType}
        kind={preview?.meta.kind}
        src={previewUrl}
        downloadUrl={previewDownload}
        externalUrl={preview?.meta.externalUrl}
        meta={preview?.meta.size ? formatBytes(preview.meta.size) : undefined}
      />

      <AttachmentPicker
        open={Boolean(binding)}
        onClose={() => setBinding(null)}
        initialKind={binding ? bindKind(binding.meta.slot) : "image"}
        title={binding ? `Привязать файл к «${binding.meta.name}»` : "Привязать файл"}
        onSelect={(item) => {
          if (!binding) return;
          bindAttachment(binding.index, binding.slot, item.name, {
            size: item.size,
            mimeType: item.mimeType,
          });
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Удалить вложение?"
        description={
          <div className="space-y-2">
            <p>
              Вложение <span className="text-white">{deleting?.meta.name}</span> будет удалено из
              JSON чата.
            </p>
            <p className="text-ink-400">
              Сам файл в папке Google AI Studio останется. Если во фрейме больше ничего нет, пустой
              фрейм тоже будет удалён.
            </p>
          </div>
        }
        confirmLabel="Удалить вложение"
        onConfirm={handleDelete}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

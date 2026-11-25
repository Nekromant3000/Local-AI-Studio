import { useEffect, useState } from "react";
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
import type { DisplayTurn, LocalAsset } from "../types";
import { chatAssetUrl, docxFileUrl, docxPagesUrl, localAssetUrl } from "../lib/api";
import { formatBytes } from "../lib/format";
import { useAppStore } from "../store/useAppStore";
import AttachmentPicker from "./AttachmentPicker";
import ConfirmDialog from "./ConfirmDialog";
import DocxPreviewModal from "./DocxPreviewModal";
import PreviewModal from "./PreviewModal";

type Attachment = DisplayTurn["attachments"][number];

function isInline(meta: LocalAsset): boolean {
  return meta.slot === "inlineImage" || meta.slot === "inlineFile";
}

function canBind(meta: LocalAsset): boolean {
  return meta.slot === "driveImage" || meta.slot === "driveDocument" || meta.slot === "driveVideo";
}

/** sha1-идентификатор сайдкея .docx в `backend/data/attachments`. */
const DOCX_ASSET_ID_RE = /^[a-f0-9]{40}$/;

/**
 * assetId сайдкея .docx: берём из `_localAsset.id`, а если он не дожил до
 * этой загрузки чата — восстанавливаем из любого известного docx-URL.
 */
function docxAssetId(meta: LocalAsset): string | null {
  const direct = String(meta.id || "").trim();
  if (DOCX_ASSET_ID_RE.test(direct)) return direct;
  for (const url of [meta.docxPagesUrl, meta.docxUrl, meta.thumbUrl]) {
    const match = /\/docx-(?:pages|file|thumb)\/([a-f0-9]{40})/.exec(url || "");
    if (match) return match[1];
  }
  return null;
}

/** Вложение, за которым на диске стоит оригинальный .docx (текст извлечён в Markdown). */
function isDocxBacked(meta: LocalAsset): boolean {
  if (meta.convertedFrom === "docx") return true;
  if (docxAssetId(meta)) return true;
  return meta.name.toLowerCase().endsWith(".docx");
}

/** Страницы запрашиваем по assetId всегда — URL из чата может быть потерян. */
function docxPagesSource(meta: LocalAsset): string | null {
  const assetId = docxAssetId(meta);
  if (assetId) return docxPagesUrl(assetId);
  return meta.docxPagesUrl || null;
}

function docxThumbSource(meta: LocalAsset): string | null {
  if (meta.thumbUrl) return meta.thumbUrl;
  const assetId = docxAssetId(meta);
  return assetId ? `/api/assets/docx-thumb/${assetId}` : null;
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
  if (meta.docxUrl) return `${meta.docxUrl}?download=true`;
  const assetId = docxAssetId(meta);
  if (assetId) return docxFileUrl(assetId, true);
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

/** Компактный бейдж формата (расширение файла или MIME-подтип). */
function formatBadge(meta: LocalAsset): string {
  const dot = meta.name.lastIndexOf(".");
  if (dot > 0 && dot < meta.name.length - 1) {
    return meta.name.slice(dot + 1).slice(0, 4).toUpperCase();
  }
  const sub = meta.mimeType.split("/")[1] || "";
  return (sub || meta.kind).slice(0, 4).toUpperCase();
}

function FileIcon({ meta }: { meta: LocalAsset }) {
  if (meta.slot === "youtubeVideo") return <Youtube size={18} className="text-rose-300" />;
  if (meta.kind === "video") return <Film size={18} className="text-sky-300" />;
  if (meta.kind === "document") return <FileText size={18} className="text-amber-300" />;
  return <File size={18} className="text-ink-300" />;
}

function slotBadge(meta: LocalAsset): string {
  return isInline(meta) ? "Inline" : meta.localPath ? "Локально" : "Drive";
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
  const [docxPreview, setDocxPreview] = useState<Attachment | null>(null);
  const [binding, setBinding] = useState<Attachment | null>(null);
  const [deleting, setDeleting] = useState<Attachment | null>(null);

  useEffect(() => {
    setBroken({});
  }, [attachments]);

  if (!attachments.length) return null;

  const openPreview = (attachment: Attachment) => {
    setPreview(attachment);
  };

  const openDocxPreview = (attachment: Attachment) => {
    setDocxPreview(attachment);
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

  const markBroken = (key: string) => {
    setBroken((current) => ({ ...current, [key]: true }));
  };

  const handleDelete = () => {
    if (!deleting) return;
    deleteAttachment(deleting.index, deleting.slot);
  };

  const previewUrl = preview ? previewSource(chatId, preview) : null;
  const previewDownload = preview ? downloadSource(chatId, preview) : null;

  // Каждое вложение — отдельный самостоятельный блок-фрейм. Никакого
  // горизонтального ряда/скролла: строго вертикальный столбик.
  const renderImageCard = (attachment: Attachment) => {
    const key = `${attachment.index}:${attachment.slot}`;
    const src = previewSource(chatId, attachment);
    const showImage = Boolean(src) && !broken[key];
    return (
      <div
        key={key}
        className="group w-[540px] max-w-full overflow-hidden rounded-2xl border border-white/[0.09] bg-[#080d18] transition-colors hover:border-white/[0.16]"
      >
        <button
          type="button"
          className="relative block w-full bg-gradient-to-br from-[#141d33] via-[#0d1527] to-[#080d18]"
          onClick={() => (showImage ? openPreview(attachment) : setBinding(attachment))}
          title={showImage ? "Открыть предпросмотр" : "Привязать локальный файл"}
        >
          {showImage ? (
            <img
              src={src || ""}
              alt={attachment.meta.name}
              loading="lazy"
              className="block max-h-[560px] w-full object-contain"
              onError={() => markBroken(key)}
            />
          ) : (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 px-4 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
                {attachment.meta.slot === "driveImage" ? (
                  <HardDrive size={26} className="text-ink-300" />
                ) : (
                  <ImageIcon size={26} className="text-ink-300" />
                )}
              </div>
              <div className="text-[12px] text-ink-300">
                {attachment.meta.driveId
                  ? `Drive · ${attachment.meta.driveId.slice(0, 12)}…`
                  : "Нет локальной копии"}
              </div>
              <div className="text-[11px] text-accent-300">Привязать файл</div>
            </div>
          )}
          <span className="absolute left-2 top-2 rounded-md border border-white/10 bg-black/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-200 backdrop-blur">
            {slotBadge(attachment.meta)}
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-3 py-2">
          <span className="flex-none rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-200">
            {formatBadge(attachment.meta)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="break-words text-[12.5px] text-ink-100" title={attachment.meta.name}>
              {attachment.meta.name}
            </div>
            <div className="text-[10.5px] text-ink-400">
              {attachment.meta.size
                ? formatBytes(attachment.meta.size)
                : attachment.meta.mimeType}
            </div>
          </div>
          <div className="flex flex-none items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {showImage ? (
              <button
                type="button"
                className="icon-btn"
                onClick={() => openPreview(attachment)}
                title="Предпросмотр"
              >
                <Eye size={14} />
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
      </div>
    );
  };

  // .docx: крупный лист A4 с миниатюрой первой страницы, реальным именем и кнопками.
  const renderDocxCard = (attachment: Attachment) => {
    const key = `${attachment.index}:${attachment.slot}`;
    const thumb = docxThumbSource(attachment.meta);
    const showThumb = Boolean(thumb) && !broken[key];
    return (
      <div
        key={key}
        className="group w-[360px] max-w-full overflow-hidden rounded-2xl border border-white/[0.09] bg-white/[0.03] transition-colors hover:border-white/[0.16]"
      >
        <button
          type="button"
          className="relative block aspect-[210/297] w-full overflow-hidden bg-white"
          onClick={() => openDocxPreview(attachment)}
          title="Открыть предпросмотр страниц документа"
        >
          {showThumb ? (
            <img
              src={thumb || ""}
              alt={attachment.meta.name}
              loading="lazy"
              className="h-full w-full object-cover object-top"
              onError={() => markBroken(key)}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#2b579a]/25 bg-[#2b579a]/10">
                <FileText size={28} className="text-[#7ea1d4]" />
              </div>
              <div className="text-[11px] text-ink-400">Нет миниатюры</div>
            </div>
          )}
          <span className="absolute left-2 top-2 rounded-md bg-[#2b579a] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white shadow-sm">
            DOCX
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-3 py-2">
          <span className="flex-none rounded-md bg-[#2b579a] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
            DOCX
          </span>
          <div className="min-w-0 flex-1">
            <div className="break-words text-[12.5px] text-ink-100" title={attachment.meta.name}>
              {attachment.meta.name}
            </div>
            <div className="text-[10.5px] text-ink-400">
              {attachment.meta.size ? formatBytes(attachment.meta.size) : "документ"}
            </div>
          </div>
          <div className="flex flex-none items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              className="icon-btn"
              onClick={() => openDocxPreview(attachment)}
              title="Предпросмотр страниц"
            >
              <Eye size={14} />
            </button>
            <a
              className="icon-btn"
              href={downloadSource(chatId, attachment) || undefined}
              download={attachment.meta.name}
              title="Скачать .docx"
            >
              <Download size={14} />
            </a>
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
      </div>
    );
  };

  const renderFileCard = (attachment: Attachment) => {
    const key = `${attachment.index}:${attachment.slot}`;
    const src = previewSource(chatId, attachment);
    const external = attachment.meta.externalUrl;
    return (
      <div
        key={key}
        className="group flex w-[420px] max-w-full items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.022] px-3 py-2.5 transition-colors hover:border-white/[0.14] hover:bg-white/[0.035]"
      >
        <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-white/10 bg-black/25">
          <FileIcon meta={attachment.meta} />
        </div>
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => (src ? openPreview(attachment) : external && openExternal(attachment))}
          disabled={!src && !external}
        >
          <div className="break-words text-[13px] text-ink-100" title={attachment.meta.name}>
            {attachment.meta.name}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-ink-400">
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
        <div className="flex flex-none items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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
  };

  return (
    <div className={compact ? "mt-2 flex flex-col items-start gap-3" : "mt-3.5 flex flex-col items-start gap-3"}>
      {attachments.map((attachment) => {
        if (attachment.meta.kind === "image") return renderImageCard(attachment);
        if (isDocxBacked(attachment.meta)) return renderDocxCard(attachment);
        return renderFileCard(attachment);
      })}

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

      <DocxPreviewModal
        open={Boolean(docxPreview)}
        onClose={() => setDocxPreview(null)}
        name={docxPreview?.meta.name || ""}
        assetId={docxPreview ? docxAssetId(docxPreview.meta) : null}
        pagesUrl={docxPreview ? docxPagesSource(docxPreview.meta) : null}
        markdownUrl={docxPreview ? previewSource(chatId, docxPreview) : null}
        downloadUrl={docxPreview ? downloadSource(chatId, docxPreview) : null}
        meta={docxPreview?.meta.size ? formatBytes(docxPreview.meta.size) : undefined}
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

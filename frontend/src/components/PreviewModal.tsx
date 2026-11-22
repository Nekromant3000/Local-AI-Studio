import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Download,
  ExternalLink,
  FileText,
  Loader2,
} from "lucide-react";
import Modal from "./Modal";
import { fetchText } from "../lib/clipboard";

const TEXT_MIME = /^text\/|application\/(json|xml|javascript|x-yaml|toml)/i;
const TEXT_EXT = /\.(txt|md|markdown|json|csv|xml|html?|css|js|ts|tsx|jsx|py|cs|c|cpp|h|hpp|java|sql|ya?ml|toml|ini|log|sh|ps1|bat|env)$/i;

function isTextual(name: string, mime: string): boolean {
  return TEXT_MIME.test(mime) || TEXT_EXT.test(name);
}

interface PreviewModalProps {
  open: boolean;
  onClose: () => void;
  name: string;
  mimeType?: string;
  kind?: "image" | "video" | "document" | "file";
  src?: string | null;
  downloadUrl?: string | null;
  externalUrl?: string | null;
  meta?: string;
}

export default function PreviewModal({
  open,
  onClose,
  name,
  mimeType = "",
  kind,
  src,
  downloadUrl,
  externalUrl,
  meta,
}: PreviewModalProps) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const effectiveKind =
    kind ||
    (mimeType.startsWith("image/")
      ? "image"
      : mimeType.startsWith("video/")
        ? "video"
        : "file");
  const textual = effectiveKind !== "image" && effectiveKind !== "video" && isTextual(name, mimeType);
  const isPdf = /pdf/i.test(mimeType) || /\.pdf$/i.test(name);

  useEffect(() => {
    if (!open) {
      setText(null);
      setFailed(null);
      return;
    }
    if (!textual || !src) return;
    let cancelled = false;
    setLoading(true);
    setFailed(null);
    setText(null);
    fetchText(src)
      .then((value) => {
        if (!cancelled) setText(value);
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailed(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, src, textual]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={name}
      subtitle={[mimeType, meta].filter(Boolean).join(" · ") || undefined}
      size="full"
      bodyClassName="bg-[#050912]"
      footer={
        <>
          {externalUrl ? (
            <a className="btn" href={externalUrl} target="_blank" rel="noreferrer noopener">
              <ExternalLink size={14} />
              Открыть оригинал
            </a>
          ) : null}
          {downloadUrl ? (
            <a className="btn btn-primary" href={downloadUrl} download={name}>
              <Download size={14} />
              Скачать
            </a>
          ) : null}
        </>
      }
    >
      <div className="flex min-h-[280px] items-center justify-center">
        {src && effectiveKind === "image" ? (
          <img
            src={src}
            alt={name}
            className="max-h-[72vh] max-w-full rounded-lg border border-white/10 object-contain"
          />
        ) : src && effectiveKind === "video" ? (
          <video src={src} controls className="max-h-[72vh] max-w-full rounded-lg" />
        ) : src && isPdf ? (
          <iframe
            src={src}
            title={name}
            className="h-[72vh] w-full rounded-lg border border-white/10 bg-white"
          />
        ) : textual ? (
          <div className="w-full">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-20 text-sm text-ink-300">
                <Loader2 size={18} className="spin" />
                Загружаю предпросмотр…
              </div>
            ) : failed ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <AlertTriangle size={26} className="text-amber-300" />
                <div className="text-sm text-ink-200">Не удалось открыть предпросмотр</div>
                <div className="max-w-xl text-xs text-ink-400">{failed}</div>
              </div>
            ) : (
              <pre className="max-h-[72vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-[#080d18] p-5 font-mono text-[12.5px] leading-relaxed text-ink-200">
                {text}
              </pre>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
              <FileText size={26} className="text-ink-300" />
            </div>
            <div className="text-sm text-ink-200">Предпросмотр недоступен для этого формата</div>
            <div className="text-xs text-ink-400">
              Используйте скачивание или откройте файл в исходном приложении.
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

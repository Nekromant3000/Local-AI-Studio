import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Download,
  FileText,
  Layers,
  Loader2,
  Text,
} from "lucide-react";
import clsx from "clsx";
import Modal from "./Modal";
import MarkdownView from "./MarkdownView";
import { docxPagesUrl } from "../lib/api";
import { fetchText } from "../lib/clipboard";

interface DocxPage {
  index: number;
  url: string;
}

interface DocxPagesResponse {
  count: number;
  source?: string;
  pages: DocxPage[];
}

type Tab = "pages" | "markdown";

interface DocxPreviewModalProps {
  open: boolean;
  onClose: () => void;
  name: string;
  meta?: string;
  /** sha1 сайдкея в `data/attachments` — страницы резолвятся по нему. */
  assetId?: string | null;
  pagesUrl?: string | null;
  markdownUrl?: string | null;
  downloadUrl?: string | null;
}

export default function DocxPreviewModal({
  open,
  onClose,
  name,
  meta,
  assetId,
  pagesUrl,
  markdownUrl,
  downloadUrl,
}: DocxPreviewModalProps) {
  const [tab, setTab] = useState<Tab>("pages");
  const [pages, setPages] = useState<DocxPage[] | null>(null);
  const [pagesSource, setPagesSource] = useState<string | null>(null);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);

  // assetId надёжнее, чем сохранённый URL: docxPagesUrl теряется при
  // сериализации/чтении чата, а страницы всегда доступны по assetId.
  const pagesEndpoint = assetId ? docxPagesUrl(assetId) : pagesUrl || null;

  useEffect(() => {
    if (!open) {
      setTab("pages");
      setPages(null);
      setPagesSource(null);
      setPagesError(null);
      setText(null);
      setTextError(null);
      return;
    }
    let cancelled = false;
    if (pagesEndpoint) {
      setPagesLoading(true);
      setPagesError(null);
      setPages(null);
      fetch(pagesEndpoint)
        .then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return (await response.json()) as DocxPagesResponse;
        })
        .then((data) => {
          if (cancelled) return;
          setPages(Array.isArray(data.pages) ? data.pages : []);
          setPagesSource(data.source || null);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setPages(null);
          setPagesError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          if (!cancelled) setPagesLoading(false);
        });
    }
    if (markdownUrl) {
      setTextLoading(true);
      setTextError(null);
      setText(null);
      fetchText(markdownUrl)
        .then((value) => {
          if (!cancelled) setText(value);
        })
        .catch((error: unknown) => {
          if (!cancelled) setTextError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          if (!cancelled) setTextLoading(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [open, pagesEndpoint, markdownUrl]);

  // Если страницы не отрендерились, автоматически показываем извлечённый текст.
  useEffect(() => {
    if (open && pagesError && markdownUrl) setTab("markdown");
  }, [open, pagesError, markdownUrl]);

  const tabs: Array<{ id: Tab; label: string; icon: typeof Layers }> = [
    { id: "pages", label: "Документ (страницы)", icon: Layers },
    { id: "markdown", label: "Извлечённый текст (Markdown)", icon: Text },
  ];

  const subtitleParts = [meta, pagesSource ? `страниц: ${pages?.length ?? "…"}` : null].filter(
    Boolean,
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={name}
      subtitle={subtitleParts.length ? subtitleParts.join(" · ") : undefined}
      size="full"
      bodyClassName="p-0 bg-[#050912]"
      footer={
        downloadUrl ? (
          <a className="btn btn-primary" href={downloadUrl} download={name}>
            <Download size={14} />
            Скачать .docx
          </a>
        ) : null
      }
    >
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b border-white/[0.07] bg-[#0a101e]/95 px-4 py-2.5 backdrop-blur">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors",
              tab === entry.id
                ? "bg-accent-500/15 text-accent-200"
                : "text-ink-400 hover:bg-white/[0.05] hover:text-ink-200",
            )}
          >
            <entry.icon size={14} />
            {entry.label}
          </button>
        ))}
      </div>

      <div className="px-5 py-4">
        {tab === "pages" ? (
          <div className="flex flex-col items-center gap-5">
            {pagesLoading ? (
              <div className="flex items-center justify-center gap-2 py-20 text-sm text-ink-300">
                <Loader2 size={18} className="spin" />
                Рендерю страницы документа…
              </div>
            ) : pagesError ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <AlertTriangle size={26} className="text-amber-300" />
                <div className="text-sm text-ink-200">Не удалось отрендерить страницы</div>
                <div className="max-w-xl text-xs text-ink-400">{pagesError}</div>
              </div>
            ) : pages && pages.length ? (
              pages.map((page) => (
                <figure key={page.index} className="w-full max-w-[860px]">
                  <img
                    src={page.url}
                    alt={`Страница ${page.index + 1} — ${name}`}
                    loading="lazy"
                    decoding="async"
                    className="mx-auto w-full rounded-lg border border-white/10 bg-white shadow-[0_10px_40px_rgba(0,0,0,.4)]"
                  />
                  <figcaption className="mt-1.5 text-center text-[10.5px] text-ink-500">
                    Страница {page.index + 1}
                  </figcaption>
                </figure>
              ))
            ) : (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <FileText size={26} className="text-ink-300" />
                <div className="text-sm text-ink-200">Для этого документа нет страниц</div>
                {!pagesEndpoint ? (
                  <div className="max-w-xl text-xs text-ink-400">
                    У вложения нет assetId исходного .docx в локальном хранилище — прикрепите
                    документ заново, чтобы получить постраничный предпросмотр.
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[860px]">
            {textLoading ? (
              <div className="flex items-center justify-center gap-2 py-20 text-sm text-ink-300">
                <Loader2 size={18} className="spin" />
                Загружаю извлечённый текст…
              </div>
            ) : textError ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <AlertTriangle size={26} className="text-amber-300" />
                <div className="text-sm text-ink-200">Не удалось загрузить текст</div>
                <div className="max-w-xl text-xs text-ink-400">{textError}</div>
              </div>
            ) : (
              <MarkdownView>{text || ""}</MarkdownView>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

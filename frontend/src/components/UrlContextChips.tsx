import { useMemo, useState } from "react";
import { DownloadCloud, Link2, Loader2, RotateCcw, X } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";
import { domainOf, extractUrls } from "../lib/links";
import { useAppStore } from "../store/useAppStore";

interface UrlContextChipsProps {
  chatId: string;
  text: string;
}

// Компактные чипы ссылок под сообщением пользователя: заголовок/домен,
// число токенов извлечённого текста и кнопка исключения из контекста.
export default function UrlContextChips({ text }: UrlContextChipsProps) {
  const items = useAppStore((state) => state.urlContextItems);
  const urlContext = useAppStore(
    (state) =>
      state.doc?.chat.runSettings?.localApi?.urlContext ?? state.settings.urlContext ?? true,
  );
  const setUrlExcluded = useAppStore((state) => state.setUrlExcluded);
  const refreshUrlContext = useAppStore((state) => state.refreshUrlContext);
  const refreshTokens = useAppStore((state) => state.refreshTokens);
  const [loadingUrl, setLoadingUrl] = useState<string | null>(null);

  const links = useMemo(() => extractUrls(text), [text]);
  if (!links.length) return null;

  const byUrl = new Map(items.map((item) => [item.url, item]));

  const load = async (url: string) => {
    if (loadingUrl) return;
    setLoadingUrl(url);
    try {
      const result = await api.extractUrl(url);
      if (!result.ok && result.error) {
        useAppStore.getState().setError(result.error);
      }
      await refreshUrlContext();
      void refreshTokens();
    } finally {
      setLoadingUrl(null);
    }
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {links.map((url) => {
        const item = byUrl.get(url);
        const excluded = item?.excluded ?? false;
        const title = item?.title?.trim();
        return (
          <span
            key={url}
            className={clsx(
              "inline-flex max-w-[340px] items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px]",
              excluded
                ? "border-white/[0.06] bg-white/[0.02] text-ink-500"
                : item?.cached
                  ? "border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-200"
                  : "border-[#2c3f66] bg-[#111c33] text-ink-300",
            )}
            title={url}
          >
            <Link2 size={11} className="flex-none" />
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className={clsx(
                "min-w-0 truncate hover:underline",
                excluded && "line-through decoration-ink-500",
              )}
            >
              {title || domainOf(url)}
            </a>
            {excluded ? (
              <span className="text-[9.5px] uppercase tracking-wider">искл.</span>
            ) : item?.cached ? (
              <span className="font-mono text-[9.5px] text-emerald-300/80">
                {item.tokens.toLocaleString("ru-RU")} ток.
              </span>
            ) : (
              <span className="text-[9.5px] text-ink-500">не загружен</span>
            )}
            {urlContext && !excluded && !item?.cached ? (
              <button
                type="button"
                className="text-ink-400 transition-colors hover:text-emerald-200"
                onClick={() => void load(url)}
                disabled={Boolean(loadingUrl)}
                title="Скачать страницу и добавить в контекст"
              >
                {loadingUrl === url ? (
                  <Loader2 size={11} className="spin" />
                ) : (
                  <DownloadCloud size={11} />
                )}
              </button>
            ) : null}
            <button
              type="button"
              className={clsx(
                "transition-colors",
                excluded ? "text-ink-400 hover:text-emerald-200" : "text-ink-400 hover:text-rose-300",
              )}
              onClick={() => void setUrlExcluded(item!.urlId, !excluded)}
              disabled={!item}
              title={excluded ? "Вернуть ссылку в контекст" : "Исключить ссылку из контекста"}
            >
              {excluded ? <RotateCcw size={11} /> : <X size={11} />}
            </button>
          </span>
        );
      })}
    </div>
  );
}

import { useEffect, useState } from "react";
import { FileText, Film, Image as ImageIcon, Loader2, RefreshCw, Search } from "lucide-react";
import clsx from "clsx";
import Modal from "./Modal";
import { api, type LocalAssetItem } from "../lib/api";

type PickerKind = "image" | "document" | "video";

const FILTERS: Array<{ id: PickerKind; label: string; icon: typeof ImageIcon }> = [
  { id: "image", label: "Изображения", icon: ImageIcon },
  { id: "document", label: "Документы", icon: FileText },
  { id: "video", label: "Видео", icon: Film },
];

interface AttachmentPickerProps {
  open: boolean;
  onClose: () => void;
  initialKind?: PickerKind;
  title?: string;
  onSelect: (item: LocalAssetItem) => void;
}

export default function AttachmentPicker({
  open,
  onClose,
  initialKind = "image",
  title = "Привязать локальный файл",
  onSelect,
}: AttachmentPickerProps) {
  const [kind, setKind] = useState<PickerKind>(initialKind);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<LocalAssetItem[]>([]);
  const [total, setTotal] = useState(0);
  const [folder, setFolder] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setKind(initialKind);
      setSelected(null);
      setQuery("");
    }
  }, [open, initialKind]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      api
        .listLocalAssets(query, kind, 0, 120)
        .then((response) => {
          if (cancelled) return;
          setItems(response.items);
          setTotal(response.total);
          setFolder(response.folder);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, kind, reloadKey]);

  const select = (item: LocalAssetItem) => {
    setSelected(item.name);
    onSelect(item);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle="Файл останется на месте. В JSON чата сохранится только имя файла из папки Google AI Studio."
      icon={<ImageIcon size={17} />}
      size="xl"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="truncate text-[11px] text-ink-400" title={folder}>
            {folder ? `Папка: ${folder}` : "Папка Google AI Studio"}
          </span>
          <span className="badge">{total} файлов</span>
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            className="field pl-8"
            placeholder="Поиск по имени файла…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/20 p-1">
          {FILTERS.map((filter) => {
            const Icon = filter.icon;
            return (
              <button
                key={filter.id}
                type="button"
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px] transition-colors",
                  kind === filter.id
                    ? "bg-white/10 text-white"
                    : "text-ink-300 hover:bg-white/[0.05] hover:text-white",
                )}
                onClick={() => setKind(filter.id)}
              >
                <Icon size={13} />
                {filter.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setReloadKey((value) => value + 1)}
          title="Обновить список"
        >
          <RefreshCw size={14} className={loading ? "spin" : undefined} />
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-400/20 bg-rose-400/[0.07] px-3 py-4 text-center text-xs text-rose-200">
          {error}
        </div>
      ) : loading && !items.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={index}
              className="h-28 animate-pulse rounded-lg border border-white/[0.06] bg-white/[0.025]"
            />
          ))}
        </div>
      ) : !items.length ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-ink-300">
          <div className="text-base">Ничего не найдено</div>
          <div className="max-w-sm text-xs text-ink-400">
            {query
              ? "Попробуйте изменить запрос или выбрать другой тип файлов."
              : "В папке Google AI Studio нет файлов этого типа."}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {items.map((item) => (
            <button
              key={item.name}
              type="button"
              className={clsx(
                "group overflow-hidden rounded-xl border text-left transition-all",
                selected === item.name
                  ? "border-accent-400/70 bg-accent-500/10"
                  : "border-white/[0.08] bg-white/[0.02] hover:border-accent-400/40 hover:bg-white/[0.045]",
              )}
              onClick={() => select(item)}
              title={item.name}
            >
              <div className="relative flex h-24 items-center justify-center overflow-hidden bg-[#070c17]">
                {item.kind === "image" && item.thumbUrl ? (
                  <img
                    src={item.thumbUrl}
                    alt={item.name}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-ink-400">
                    {item.kind === "video" ? <Film size={26} /> : <FileText size={26} />}
                    <span className="text-[9.5px] uppercase tracking-wider">{item.kind}</span>
                  </div>
                )}
                <span className="absolute bottom-1 right-1 rounded bg-black/65 px-1.5 py-0.5 text-[9.5px] text-ink-200">
                  {item.sizeLabel}
                </span>
              </div>
              <div className="border-t border-white/[0.06] px-2 py-1.5">
                <div className="truncate text-[11px] text-ink-200" title={item.name}>
                  {item.name}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {loading && items.length ? (
        <div className="mt-3 flex items-center justify-center gap-2 text-[11px] text-ink-400">
          <Loader2 size={13} className="spin" /> Обновляю…
        </div>
      ) : null}
    </Modal>
  );
}

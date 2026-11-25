import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Clock,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { groupTurns } from "../lib/frames";
import {
  formatBytes,
  formatDateTime,
  formatNumber,
  stripMarkdown,
  truncate,
} from "../lib/format";
import type { ChatSummary } from "../types";
import { useAppStore } from "../store/useAppStore";
import EmptyState from "./EmptyState";
import MessageFrame from "./MessageFrame";
import StreamingMessage from "./StreamingMessage";

function LoadingSkeleton() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-8">
      <div className="ml-auto h-20 w-2/3 animate-pulse rounded-2xl border border-white/[0.05] bg-white/[0.025]" />
      <div className="space-y-2">
        <div className="h-3.5 w-4/5 animate-pulse rounded bg-white/[0.05]" />
        <div className="h-3.5 w-full animate-pulse rounded bg-white/[0.04]" />
        <div className="h-3.5 w-3/5 animate-pulse rounded bg-white/[0.03]" />
      </div>
      <div className="ml-auto h-16 w-1/2 animate-pulse rounded-2xl border border-white/[0.05] bg-white/[0.025]" />
      <div className="space-y-2">
        <div className="h-3.5 w-2/3 animate-pulse rounded bg-white/[0.04]" />
        <div className="h-3.5 w-5/6 animate-pulse rounded bg-white/[0.03]" />
      </div>
    </div>
  );
}

type HistorySortDir = "asc" | "desc";

function HistoryView() {
  const chats = useAppStore((state) => state.chats);
  const folder = useAppStore((state) => state.folder);
  const activeId = useAppStore((state) => state.activeId);
  const loadingChats = useAppStore((state) => state.loadingChats);
  const openChat = useAppStore((state) => state.openChat);
  const loadChats = useAppStore((state) => state.loadChats);
  const setHistoryOpen = useAppStore((state) => state.setHistoryOpen);

  const [query, setQuery] = useState("");
  const [sortDir, setSortDir] = useState<HistorySortDir>("desc");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => searchRef.current?.focus(), 30);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHistoryOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setHistoryOpen]);

  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru");
    const filtered = needle
      ? chats.filter(
          (chat) =>
            chat.title.toLocaleLowerCase("ru").includes(needle) ||
            stripMarkdown(chat.preview).toLocaleLowerCase("ru").includes(needle),
        )
      : chats;
    return [...filtered].sort((a, b) => {
      const delta = (Date.parse(a.updatedAt) || 0) - (Date.parse(b.updatedAt) || 0);
      return sortDir === "asc" ? delta : -delta;
    });
  }, [chats, query, sortDir]);

  const handleOpen = (chat: ChatSummary) => {
    void openChat(chat.id);
    setHistoryOpen(false);
  };

  return (
    <div className="flex h-full flex-col bg-[#080d19]/60">
      <div className="flex-none border-b border-white/[0.07] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex h-8 w-8 flex-none items-center justify-center rounded-xl border border-accent-300/20 bg-gradient-to-br from-[#26336b] to-[#121a31] shadow-glow">
            <Clock size={15} className="text-accent-300" />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold tracking-tight text-white">
              История чатов
            </div>
            <div className="text-[9.5px] text-ink-500">
              {chats.length} чатов · сортировка по дате изменения
            </div>
          </div>
          <div className="relative ml-auto w-full max-w-xs sm:w-64">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500"
            />
            <input
              ref={searchRef}
              className="field h-8 pl-8 pr-7 text-[11.5px]"
              placeholder="Поиск по названию или тексту…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              spellCheck={false}
            />
            {query ? (
              <button
                type="button"
                className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-ink-500 hover:text-white"
                onClick={() => setQuery("")}
                title="Очистить"
              >
                <X size={12} />
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={() => void loadChats(true)}
            disabled={loadingChats}
            title="Пересканировать папку Google AI Studio"
          >
            <RefreshCw size={13} className={loadingChats ? "spin" : undefined} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setHistoryOpen(false)}
            title="Закрыть историю (Esc)"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length ? (
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-[#0a1120]/95 backdrop-blur">
              <tr className="text-[9.5px] uppercase tracking-[0.12em] text-ink-500">
                <th className="px-4 py-2.5 font-medium">Название</th>
                <th className="px-3 py-2.5 font-medium">Сообщения</th>
                <th className="hidden px-3 py-2.5 font-medium lg:table-cell">Модель</th>
                <th className="hidden px-3 py-2.5 font-medium xl:table-cell">Создан</th>
                <th className="px-3 py-2.5 font-medium">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 uppercase tracking-[0.12em] text-ink-400 transition-colors hover:text-white"
                    onClick={() => setSortDir((dir) => (dir === "asc" ? "desc" : "asc"))}
                    title="Переключить порядок сортировки"
                  >
                    Изменён
                    {sortDir === "asc" ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right font-medium">Размер</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((chat) => (
                <tr
                  key={chat.id}
                  onClick={() => handleOpen(chat)}
                  className={
                    "cursor-pointer border-t border-white/[0.05] transition-colors " +
                    (chat.id === activeId
                      ? "bg-accent-500/[0.07] hover:bg-accent-500/[0.12]"
                      : "hover:bg-white/[0.035]")
                  }
                  title={`Открыть чат: ${chat.title}`}
                >
                  <td className="max-w-[340px] px-4 py-2.5">
                    <div
                      className="truncate text-[12px] font-medium text-ink-100"
                      title={chat.title}
                    >
                      {chat.title}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-ink-500">
                      {stripMarkdown(truncate(chat.preview, 90)) || "Пустой чат"}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-[11px] text-ink-300">
                    {formatNumber(chat.messageCount)}
                  </td>
                  <td className="hidden max-w-[180px] px-3 py-2.5 lg:table-cell">
                    <span className="block truncate font-mono text-[10px] text-ink-400" title={chat.model}>
                      {chat.model || "—"}
                    </span>
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-2.5 text-[11px] text-ink-400 xl:table-cell">
                    {formatDateTime(chat.createdAt) || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-[11px] text-ink-300">
                    {formatDateTime(chat.updatedAt) || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-[11px] text-ink-400">
                    {formatBytes(chat.size)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <MessageSquare size={26} className="text-ink-600" />
            <div className="text-[12px] text-ink-300">
              {query ? "Ничего не найдено" : "В папке нет чатов GAS"}
            </div>
            <div className="mt-1 text-[10.5px] leading-relaxed text-ink-500">
              {query
                ? "Попробуйте другой запрос."
                : "Создайте новый чат или укажите корректную папку."}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-none items-center gap-3 border-t border-white/[0.06] px-4 py-2 text-[9px] text-ink-500">
        <span className="h-1.5 w-1.5 flex-none rounded-full bg-emerald-400/80" />
        <span className="truncate" title={folder}>
          {folder || "Папка не определена"}
        </span>
        <span className="ml-auto flex-none">Клик по строке откроет чат</span>
      </div>
    </div>
  );
}

export default function ChatWorkspace() {
  const doc = useAppStore((state) => state.doc);
  const loadingDoc = useAppStore((state) => state.loadingDoc);
  const generating = useAppStore((state) => state.generating);
  const streaming = useAppStore((state) => state.streaming);
  const isHistoryOpen = useAppStore((state) => state.isHistoryOpen);
  const queueFiles = useAppStore((state) => state.queueFiles);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [showScroll, setShowScroll] = useState(false);
  const [dragging, setDragging] = useState(false);

  const chunks = doc?.chat.chunkedPrompt?.chunks ?? [];
  const visibleChunks = streaming ? chunks.slice(0, streaming.cutoffIndex) : chunks;
  const turns = useMemo(() => groupTurns(visibleChunks), [visibleChunks]);

  const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior });
  };

  useEffect(() => {
    stickRef.current = true;
    setShowScroll(false);
    const frame = requestAnimationFrame(() => scrollToBottom());
    return () => cancelAnimationFrame(frame);
  }, [doc?.id]);

  useEffect(() => {
    if (generating) {
      stickRef.current = true;
      const frame = requestAnimationFrame(() => scrollToBottom());
      return () => cancelAnimationFrame(frame);
    }
  }, [generating]);

  useEffect(() => {
    if (stickRef.current) {
      const frame = requestAnimationFrame(() => scrollToBottom());
      return () => cancelAnimationFrame(frame);
    }
  }, [streaming?.content.length, streaming?.reasoning.length]);

  useEffect(() => {
    if (loadingDoc) stickRef.current = true;
  }, [loadingDoc]);

  const handleScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    stickRef.current = distance < 140;
    setShowScroll(distance > 240);
  };

  return (
    <div className="relative min-h-0 flex-1">
      {isHistoryOpen ? (
        <HistoryView />
      ) : (
        <>
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="h-full overflow-y-auto overscroll-contain"
            onDragOver={(event) => {
              if (!event.dataTransfer?.types?.includes("Files")) return;
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(event) => {
              if (event.currentTarget === event.target) setDragging(false);
            }}
            onDrop={(event) => {
              if (!event.dataTransfer?.files?.length) return;
              event.preventDefault();
              setDragging(false);
              queueFiles(event.dataTransfer.files);
            }}
          >
            {loadingDoc ? (
              <LoadingSkeleton />
            ) : !doc ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-ink-400">
                <MessageSquare size={30} className="text-ink-600" />
                <div className="text-sm">Выберите чат в левой панели</div>
                <div className="text-[11px] text-ink-500">
                  Или создайте новый чат в папке Google AI Studio.
                </div>
              </div>
            ) : turns.length === 0 && !generating ? (
              <EmptyState />
            ) : (
              <div className="mx-auto w-full max-w-4xl px-3 py-5 sm:px-5 sm:py-6">
                <div className="space-y-4 sm:space-y-5">
                  {turns.map((turn) => (
                    <MessageFrame key={turn.id} turn={turn} chatId={doc.id} />
                  ))}
                  {streaming ? <StreamingMessage /> : null}
                </div>
                <div className="h-2" />
              </div>
            )}
          </div>

          {dragging ? (
            <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent-400/60 bg-[#0a1120]/85 text-[12px] text-accent-200 backdrop-blur-sm">
              Отпустите файлы, чтобы прикрепить к сообщению
            </div>
          ) : null}

          {showScroll ? (
            <button
              type="button"
              className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-[#0d1526]/95 text-ink-200 shadow-lg backdrop-blur transition-colors hover:bg-[#16213a] hover:text-white sm:bottom-4 sm:right-5"
              onClick={() => {
                stickRef.current = true;
                scrollToBottom("smooth");
              }}
              title="Прокрутить вниз"
            >
              <ArrowDown size={16} />
            </button>
          ) : null}

          {generating && !streaming ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
              <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#0b1220]/90 px-2.5 py-1 text-[10px] text-ink-300 shadow-lg">
                <Loader2 size={11} className="spin" />
                Подключение к модели…
              </span>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

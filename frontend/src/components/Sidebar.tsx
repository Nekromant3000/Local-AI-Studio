import { useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  Clock,
  FolderOpen,
  Loader2,
  MessageSquare,
  PanelLeftClose,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import clsx from "clsx";
import type { ChatSummary } from "../types";
import { formatRelativeDate, stripMarkdown, truncate } from "../lib/format";
import { useAppStore } from "../store/useAppStore";
import ConfirmDialog from "./ConfirmDialog";
import Modal from "./Modal";

interface SidebarProps {
  onClose?: () => void;
  overlay?: boolean;
}

function ChatRow({
  chat,
  active,
  onOpen,
  onDelete,
}: {
  chat: ChatSummary;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const preview = stripMarkdown(chat.preview);
  return (
    <div
      className={clsx(
        "group relative rounded-xl border transition-all duration-150",
        active
          ? "border-accent-400/30 bg-gradient-to-br from-accent-500/[0.14] to-accent-500/[0.04] shadow-[0_0_0_1px_rgba(124,140,255,.06)_inset]"
          : "border-transparent hover:border-white/[0.07] hover:bg-white/[0.03]",
      )}
    >
      {active ? (
        <span className="absolute bottom-2.5 left-0 top-2.5 w-0.5 rounded-full bg-accent-400" />
      ) : null}
      <button type="button" className="block w-full px-3 py-2.5 text-left" onClick={onOpen}>
        <div className="flex items-center gap-1.5">
          <span
            className={clsx(
              "min-w-0 flex-1 truncate text-[12px] font-medium",
              active ? "text-white" : "text-ink-200",
            )}
            title={chat.title}
          >
            {chat.title}
          </span>
          <span className="flex-none text-[9px] text-ink-500">
            {formatRelativeDate(chat.updatedAt)}
          </span>
        </div>
        {preview ? (
          <div className="mt-0.5 line-clamp-2 text-[10.5px] leading-relaxed text-ink-500">
            {truncate(preview, 150)}
          </div>
        ) : (
          <div className="mt-0.5 text-[10.5px] italic text-ink-600">Пустой чат</div>
        )}
        <div className="mt-1 flex items-center gap-2 text-[9px] text-ink-500">
          <span className="inline-flex items-center gap-0.5">
            <MessageSquare size={9} />
            {chat.messageCount}
          </span>
          {chat.thoughtCount ? (
            <span className="inline-flex items-center gap-0.5 text-violet-300/60">
              <Brain size={9} />
              {chat.thoughtCount}
            </span>
          ) : null}
          {chat.attachmentCount ? (
            <span className="inline-flex items-center gap-0.5">
              <Paperclip size={9} />
              {chat.attachmentCount}
            </span>
          ) : null}
          {chat.model ? (
            <span className="ml-auto max-w-[100px] truncate font-mono opacity-70" title={chat.model}>
              {chat.model}
            </span>
          ) : null}
        </div>
      </button>
      <button
        type="button"
        className="absolute bottom-2 right-2 hidden h-6 w-6 items-center justify-center rounded-md bg-[#0c1322]/90 text-ink-500 shadow transition-colors hover:text-rose-300 group-hover:flex"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        title="Удалить чат (в корзину)"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

export default function Sidebar({ onClose, overlay }: SidebarProps) {
  const chats = useAppStore((state) => state.chats);
  const folder = useAppStore((state) => state.folder);
  const activeId = useAppStore((state) => state.activeId);
  const loadingChats = useAppStore((state) => state.loadingChats);
  const openChat = useAppStore((state) => state.openChat);
  const loadChats = useAppStore((state) => state.loadChats);
  const selectChatDir = useAppStore((state) => state.selectChatDir);
  const createChat = useAppStore((state) => state.createChat);
  const deleteChat = useAppStore((state) => state.deleteChat);
  const setHistoryOpen = useAppStore((state) => state.setHistoryOpen);

  const [query, setQuery] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("Новый чат");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ChatSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const newInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru");
    if (!needle) return chats;
    return chats.filter((chat) => chat.title.toLocaleLowerCase("ru").includes(needle));
  }, [chats, query]);

  useEffect(() => {
    if (!newOpen) return;
    const timer = setTimeout(() => {
      newInputRef.current?.focus();
      newInputRef.current?.select();
    }, 30);
    return () => clearTimeout(timer);
  }, [newOpen]);

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      await createChat(newTitle.trim() || "Новый чат");
      setNewOpen(false);
      setNewTitle("Новый чат");
      if (overlay) onClose?.();
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deleteChat(deleting.id);
    } finally {
      setDeleteBusy(false);
    }
  };

  const handlePickDir = async () => {
    if (picking) return;
    setPicking(true);
    try {
      await selectChatDir();
    } finally {
      setPicking(false);
    }
  };

  return (
    <aside className="flex h-full w-[302px] flex-none flex-col border-r border-white/[0.07] bg-[#080d19]/80 backdrop-blur-xl">
      <div className="flex items-center gap-2.5 px-3.5 pb-3 pt-4">
        <div className="flex h-8 w-8 flex-none items-center justify-center rounded-xl border border-accent-300/20 bg-gradient-to-br from-[#26336b] to-[#121a31] shadow-glow">
          <Sparkles size={16} className="text-accent-300" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-semibold tracking-tight text-white">
            Local AI Studio
          </div>
          <div className="text-[9px] uppercase tracking-[0.14em] text-ink-500">
            Google AI Studio · local
          </div>
        </div>
        {overlay ? (
          <button type="button" className="icon-btn" onClick={onClose} title="Закрыть меню">
            <X size={16} />
          </button>
        ) : onClose ? (
          <button
            type="button"
            className="icon-btn flex-none"
            onClick={onClose}
            title="Свернуть меню"
            aria-label="Свернуть меню"
          >
            <PanelLeftClose size={16} />
          </button>
        ) : null}
      </div>

      <div className="space-y-2 px-3 pb-3">
        <button
          type="button"
          className="btn btn-primary h-9 w-full"
          onClick={() => setNewOpen(true)}
        >
          <Plus size={15} />
          Новый чат
        </button>
        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500"
          />
          <input
            className="field h-8 pl-8 pr-7 text-[11.5px]"
            placeholder="Поиск по названию…"
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
      </div>

      <div className="px-3 pb-3">
        <button
          type="button"
          className="btn btn-ghost h-8 w-full"
          onClick={() => {
            setHistoryOpen(true);
            if (overlay) onClose?.();
          }}
          title="Открыть историю чатов"
        >
          <Clock size={14} />
          История
        </button>
      </div>

      <div className="flex items-center gap-2 px-3.5 pb-1.5">
        <span className="section-title">
          {query ? "Результаты" : "Чаты"}
        </span>
        <span className="text-[9.5px] text-ink-500">
          {query ? `${filtered.length} из ${chats.length}` : chats.length}
        </span>
        <button
          type="button"
          className="icon-btn ml-auto h-6 w-6"
          onClick={() => void loadChats(true)}
          disabled={loadingChats}
          title="Пересканировать папку Google AI Studio"
        >
          <RefreshCw size={12} className={loadingChats ? "spin" : undefined} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loadingChats && !chats.length ? (
          <div className="space-y-1.5 px-1">
            {Array.from({ length: 7 }).map((_, index) => (
              <div
                key={index}
                className="h-16 animate-pulse rounded-xl border border-white/[0.04] bg-white/[0.02]"
              />
            ))}
          </div>
        ) : filtered.length ? (
          <div className="space-y-0.5">
            {filtered.map((chat) => (
              <ChatRow
                key={chat.id}
                chat={chat}
                active={chat.id === activeId}
                onOpen={() => {
                  void openChat(chat.id);
                  if (overlay) onClose?.();
                }}
                onDelete={() => setDeleting(chat)}
              />
            ))}
          </div>
        ) : (
          <div className="px-4 py-14 text-center">
            <MessageSquare size={26} className="mx-auto mb-2 text-ink-600" />
            <div className="text-[11.5px] text-ink-300">
              {query ? "Ничего не найдено" : "В папке нет чатов GAS"}
            </div>
            <div className="mt-1 text-[10px] leading-relaxed text-ink-500">
              {query
                ? "Попробуйте другой запрос."
                : "Создайте новый чат или укажите корректную папку."}
            </div>
          </div>
        )}
      </div>

      <div className="flex-none border-t border-white/[0.06] px-3.5 py-2.5">
        <div className="flex items-center gap-2 text-[9px] text-ink-500">
          <span className="h-1.5 w-1.5 flex-none rounded-full bg-emerald-400/80" />
          <span className="truncate" title={folder}>
            {folder || "Папка не определена"}
          </span>
        </div>
        <button
          type="button"
          className="btn btn-secondary w-full mt-1.5 !py-1.5 text-[10.5px]"
          onClick={() => void handlePickDir()}
          disabled={picking}
          title="Выбрать папку с чатами Google AI Studio"
        >
          {picking ? <Loader2 size={12} className="animate-spin" /> : <FolderOpen size={12} />}
          {picking ? 'Выбор папки…' : 'Выбрать папку'}
        </button>
        <div className="mt-1 flex items-center justify-between text-[9px] text-ink-600">
          <span>Файлы GAS читаются и сохраняются напрямую</span>
          <button
            type="button"
            className="text-ink-500 transition-colors hover:text-ink-200"
            onClick={() => void loadChats(true)}
            disabled={loadingChats}
          >
            обновить
          </button>
        </div>
      </div>

      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="Новый чат"
        subtitle="Будет создан файл в формате Google AI Studio в папке чатов."
        icon={<Plus size={17} />}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setNewOpen(false)}>
              Отмена
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleCreate()}
              disabled={creating}
            >
              {creating ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
              Создать
            </button>
          </>
        }
      >
        <label className="mb-1.5 block text-[10.5px] uppercase tracking-wider text-ink-400">
          Название
        </label>
        <input
          ref={newInputRef}
          className="field"
          value={newTitle}
          onChange={(event) => setNewTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void handleCreate();
            }
          }}
          maxLength={180}
          spellCheck={false}
        />
        <p className="mt-2 text-[10px] leading-relaxed text-ink-500">
          Имя файла будет использовано как название чата. Расширение не добавляется — как в Google
          AI Studio.
        </p>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Удалить чат?"
        description={
          <div className="space-y-2">
            <p>
              Файл <span className="text-white">{deleting?.title}</span> будет перемещён в корзину
              Local AI Studio.
            </p>
            <p className="text-ink-400">
              Это действие можно отменить вручную: файл останется в папке{" "}
              <span className="font-mono text-[10.5px]">data/trash</span>.
            </p>
          </div>
        }
        confirmLabel={deleteBusy ? "Удаляю…" : "Удалить чат"}
        onConfirm={handleDelete}
        onClose={() => setDeleting(null)}
      />
    </aside>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Cloud,
  CloudOff,
  Loader2,
  Menu,
  PanelRight,
  Pencil,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import clsx from "clsx";
import { useAppStore } from "../store/useAppStore";
import ConfirmDialog from "./ConfirmDialog";

interface ChatHeaderProps {
  onToggleSidebar: () => void;
  onToggleRight: () => void;
  rightOpen: boolean;
  sidebarOpen: boolean;
}

function SaveIndicator() {
  const saveState = useAppStore((state) => state.saveState);
  const dirty = useAppStore((state) => state.dirty);
  const generating = useAppStore((state) => state.generating);

  if (generating) {
    return (
      <span className="badge border-accent-400/25 bg-accent-500/[0.08] text-accent-200">
        <Loader2 size={10} className="spin" />
        генерация
      </span>
    );
  }
  if (saveState === "saving") {
    return (
      <span className="badge">
        <Loader2 size={10} className="spin" />
        сохранение
      </span>
    );
  }
  if (saveState === "error") {
    return (
      <span className="badge border-rose-400/25 bg-rose-400/[0.08] text-rose-200">
        <CloudOff size={10} />
        ошибка сохранения
      </span>
    );
  }
  if (dirty) {
    return (
      <span className="badge border-amber-300/20 bg-amber-300/[0.06] text-amber-200">
        <Cloud size={10} />
        не сохранено
      </span>
    );
  }
  if (saveState === "saved") {
    return (
      <span className="badge border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-200">
        <Check size={10} />
        сохранено
      </span>
    );
  }
  return null;
}

export default function ChatHeader({
  onToggleSidebar,
  onToggleRight,
  rightOpen,
  sidebarOpen,
}: ChatHeaderProps) {
  const doc = useAppStore((state) => state.doc);
  const chatDir = useAppStore((state) => state.chatDir);
  const dirty = useAppStore((state) => state.dirty);
  const saveNow = useAppStore((state) => state.saveNow);
  const renameActive = useAppStore((state) => state.renameActive);
  const refreshActive = useAppStore((state) => state.refreshActive);
  const generating = useAppStore((state) => state.generating);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  useEffect(() => {
    setEditing(false);
  }, [doc?.id]);

  const summary = doc?.summary;

  const beginRename = () => {
    if (!doc) return;
    setDraft(doc.title);
    setEditing(true);
  };

  const commitRename = async () => {
    if (!doc) return;
    const value = draft.trim();
    setEditing(false);
    if (!value || value === doc.title) return;
    setSaving(true);
    try {
      await renameActive(value);
    } finally {
      setSaving(false);
    }
  };

  const reload = async () => {
    await refreshActive();
    setEditing(false);
  };

  return (
    <header className="flex-none border-b border-white/[0.07] bg-[#080d19]/65 px-2.5 py-2.5 backdrop-blur-xl sm:px-4">
      <div className="mx-auto flex w-full max-w-[1120px] items-center gap-2">
        {!sidebarOpen ? (
          <button
            type="button"
            className="icon-btn h-8 w-8 flex-none rounded-full border border-white/[0.08] bg-white/[0.03]"
            onClick={onToggleSidebar}
            title="Развернуть меню"
            aria-label="Развернуть меню"
          >
            <Menu size={17} />
          </button>
        ) : null}

        <div className="min-w-0 flex-1">
          {doc && editing ? (
            <div className="flex items-center gap-1.5">
              <input
                ref={inputRef}
                className="field h-8 max-w-xl font-medium"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void commitRename();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setEditing(false);
                  }
                }}
                onBlur={() => {
                  if (!saving) void commitRename();
                }}
                spellCheck={false}
                aria-label="Название чата"
              />
              <button
                type="button"
                className="icon-btn"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void commitRename()}
                title="Сохранить название"
              >
                {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
              </button>
              <button
                type="button"
                className="icon-btn"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setEditing(false)}
                title="Отмена"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              {doc ? (
                <button
                  type="button"
                  className="group flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-white/[0.04]"
                  onClick={beginRename}
                  title={`${doc.title}\nКликните, чтобы переименовать`}
                >
                  <h1 className="truncate text-[13.5px] font-semibold text-ink-100">
                    {doc.title}
                  </h1>
                  <Pencil
                    size={11}
                    className="flex-none text-ink-500 opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </button>
              ) : (
                <h1 className="truncate px-1 text-[13.5px] font-semibold text-ink-100">
                  Local AI Studio
                </h1>
              )}
              {doc ? <span className="badge hidden font-mono md:inline-flex">GAS JSON</span> : null}
              {summary?.model ? (
                <span
                  className="badge hidden max-w-[170px] truncate normal-case lg:inline-flex"
                  title={summary.model}
                >
                  {summary.model}
                </span>
              ) : null}
            </div>
          )}

          <div className="mt-0.5 flex items-center gap-2 overflow-hidden px-1 text-[9.5px] text-ink-500">
            {summary ? (
              <>
                <span>{summary.messageCount} сообщений</span>
                {summary.thoughtCount ? <span>· {summary.thoughtCount} мыслей</span> : null}
                {summary.attachmentCount ? (
                  <span>· {summary.attachmentCount} вложений</span>
                ) : null}
                <span className="hidden sm:inline">
                  · {summary.size ? `${Math.round(summary.size / 1024)} КБ` : ""}
                </span>
              </>
            ) : (
              <span>Выберите чат в меню или создайте новый</span>
            )}
          </div>
        </div>

        <div className="flex flex-none items-center gap-1">
          {doc ? (
            <>
              <SaveIndicator />
              {dirty && !generating ? (
                <button
                  type="button"
                  className="icon-btn hidden sm:inline-flex"
                  onClick={() => void saveNow()}
                  title="Сохранить сейчас"
                >
                  <Save size={15} />
                </button>
              ) : null}
              <button
                type="button"
                className="icon-btn"
                onClick={() => {
                  if (dirty) setConfirmReload(true);
                  else void reload();
                }}
                disabled={generating}
                title={`Перечитать JSON с диска\n${chatDir}`}
              >
                <RefreshCw size={15} />
              </button>
            </>
          ) : null}
          <button
            type="button"
            className={clsx("icon-btn ml-0.5", rightOpen && "bg-white/[0.07] !text-white")}
            onClick={onToggleRight}
            title={rightOpen ? "Скрыть правую панель" : "Показать настройки и токены"}
          >
            <PanelRight size={17} />
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmReload}
        title="Перечитать чат с диска?"
        description="В файле есть несохранённые изменения. При перечитывании они будут потеряны."
        confirmLabel="Перечитать"
        danger={false}
        onConfirm={reload}
        onClose={() => setConfirmReload(false)}
      />
    </header>
  );
}

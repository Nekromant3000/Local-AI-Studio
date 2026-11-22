import { useEffect, useState } from "react";
import { Bot, Brain, ChevronDown, ChevronRight, Square, Timer } from "lucide-react";
import { formatElapsed } from "../lib/format";
import { useAppStore } from "../store/useAppStore";
import MarkdownView from "./MarkdownView";

export default function StreamingMessage() {
  const streaming = useAppStore((state) => state.streaming);
  const stopGeneration = useAppStore((state) => state.stopGeneration);
  const [thinkingOpen, setThinkingOpen] = useState(true);
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!streaming) return null;
  const hasReasoning = Boolean(streaming.reasoning);
  const hasContent = Boolean(streaming.content);

  return (
    <section className="w-full animate-fade-up">
      <div className="rounded-2xl border border-accent-400/20 bg-accent-500/[0.035] px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <div className="relative flex h-6 w-6 items-center justify-center rounded-lg border border-violet-300/25 bg-violet-400/10 text-violet-200">
            <Bot size={13} />
            <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          </div>
          <span className="text-[11.5px] font-semibold text-ink-100">Модель</span>
          <span className="badge border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-200">
            генерация
          </span>
          <span className="hidden items-center gap-1 text-[10px] text-ink-400 sm:inline-flex">
            <Timer size={11} />
            {formatElapsed(streaming.startedAt)}
          </span>
          <span className="truncate font-mono text-[9.5px] text-ink-500">{streaming.model}</span>
          <button
            type="button"
            className="btn btn-danger ml-auto h-7 px-2.5 text-[11px]"
            onClick={stopGeneration}
          >
            <Square size={11} fill="currentColor" />
            Остановить
          </button>
        </div>

        {hasReasoning ? (
          <div className="mb-2 overflow-hidden rounded-xl border border-violet-300/15 bg-violet-400/[0.04]">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-white/[0.03]"
              onClick={() => setThinkingOpen((value) => !value)}
            >
              {thinkingOpen ? (
                <ChevronDown size={13} className="text-violet-300" />
              ) : (
                <ChevronRight size={13} className="text-violet-300" />
              )}
              <Brain size={13} className="text-violet-300" />
              <span className="text-[11px] font-medium text-violet-200">Размышления модели</span>
              <span className="ml-auto text-[9.5px] text-ink-500">
                {streaming.reasoning.length.toLocaleString("ru-RU")} символов
              </span>
            </button>
            {thinkingOpen ? (
              <div className="max-h-64 overflow-y-auto border-t border-violet-300/10 px-3 py-2">
                <MarkdownView compact className="text-ink-300/90">
                  {streaming.reasoning}
                </MarkdownView>
              </div>
            ) : null}
          </div>
        ) : null}

        {hasContent ? (
          <>
            <MarkdownView>{streaming.content}</MarkdownView>
            <span className="stream-caret" />
          </>
        ) : !hasReasoning ? (
          <div className="flex items-center gap-2 py-2 text-[12px] text-ink-400">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="ml-1">Ожидаю ответ модели…</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 py-1 text-[11px] text-ink-400">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="ml-1">Формирую ответ…</span>
          </div>
        )}

        <div className="mt-2 flex items-center gap-2 border-t border-white/[0.05] pt-1.5 text-[9.5px] text-ink-500">
          <span>{formatElapsed(streaming.startedAt)}</span>
          <span>·</span>
          <span>
            {streaming.removedCount > 0
              ? `удалено последующих фреймов: ${streaming.removedCount}`
              : "контекст сохранён"}
          </span>
          <span className="ml-auto">SSE · поток</span>
        </div>
      </div>
    </section>
  );
}

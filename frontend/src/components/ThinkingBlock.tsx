import { useState } from "react";
import { Brain, ChevronDown, ChevronRight, Timer, Trash2 } from "lucide-react";
import clsx from "clsx";
import type { Chunk, DisplayTurn } from "../types";
import { thoughtDuration } from "../lib/frames";
import { formatDateTime, formatDuration } from "../lib/format";
import { useAppStore } from "../store/useAppStore";
import CopyButton from "./CopyButton";
import ConfirmDialog from "./ConfirmDialog";
import MarkdownView from "./MarkdownView";

function thoughtText(chunk: Chunk): string {
  if (chunk.text) return chunk.text;
  return (chunk.parts || [])
    .map((part) => (part.thought && part.text ? part.text : ""))
    .filter(Boolean)
    .join("\n\n");
}

interface ThinkingBlockProps {
  turn: DisplayTurn;
}

export default function ThinkingBlock({ turn }: ThinkingBlockProps) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const deleteFrames = useAppStore((state) => state.deleteFrames);

  if (!turn.thoughts.length) return null;

  const duration = thoughtDuration(turn);
  const allText = turn.thoughts.map(({ chunk }) => thoughtText(chunk)).filter(Boolean).join("\n\n");
  const tokens = turn.thoughts.reduce(
    (sum, { chunk }) => sum + (typeof chunk.tokenCount === "number" ? chunk.tokenCount : 0),
    0,
  );

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-violet-300/12 bg-violet-400/[0.035]">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-white/[0.04]"
        >
          {open ? (
            <ChevronDown size={14} className="flex-none text-violet-300/80" />
          ) : (
            <ChevronRight size={14} className="flex-none text-violet-300/80" />
          )}
          <Brain size={14} className="flex-none text-violet-300" />
          <span className="truncate text-[11.5px] font-medium text-violet-200/90">
            Мысли модели
          </span>
          <span className="badge border-violet-300/15 bg-violet-300/[0.06] text-violet-200/70">
            Thinking
          </span>
          {duration !== null ? (
            <span className="inline-flex items-center gap-1 text-[10.5px] text-ink-400">
              <Timer size={11} />
              {formatDuration(duration)}
            </span>
          ) : null}
          {tokens ? <span className="text-[10px] text-ink-500">{tokens} ток.</span> : null}
          <span className="ml-auto hidden text-[10px] text-ink-500 sm:inline">
            {open ? "Свернуть" : "Развернуть"}
          </span>
        </button>
        {allText ? <CopyButton text={allText} title="Скопировать мысли" /> : null}
      </div>

      {open ? (
        <div className="max-h-[26rem] overflow-y-auto border-t border-violet-300/10 px-4 py-3">
          {turn.thoughts.map(({ chunk, index }, position) => {
            const text = thoughtText(chunk);
            return (
              <div
                key={index}
                className={clsx(
                  "group/thought relative",
                  position > 0 && "mt-3 border-t border-white/[0.06] pt-3",
                )}
              >
                <div className="mb-1 flex items-center gap-2 pr-7 text-[9.5px] uppercase tracking-wider text-ink-500">
                  <span>Мысль {position + 1}</span>
                  {chunk.createTime ? <span>{formatDateTime(chunk.createTime)}</span> : null}
                  {typeof chunk.tokenCount === "number" ? (
                    <span>{chunk.tokenCount} ток.</span>
                  ) : null}
                </div>
                <MarkdownView compact className="text-ink-300/90">
                  {text}
                </MarkdownView>
                <div className="absolute right-0 top-0 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/thought:opacity-100 focus-within:opacity-100">
                  {text ? <CopyButton text={text} title="Скопировать мысль" /> : null}
                  <button
                    type="button"
                    className="icon-btn hover:!text-rose-300"
                    onClick={() => setDeleting(index)}
                    title="Удалить этот блок мыслей"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
          <div className="mt-3 text-[10px] leading-relaxed text-ink-500">
            Мысли не отправляются в контекст локальной модели.
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        title="Удалить блок мыслей?"
        description="Этот фрагмент reasoning будет удалён из JSON чата. Ответ модели останется без изменений."
        confirmLabel="Удалить мысль"
        onConfirm={() => {
          if (deleting !== null) deleteFrames([deleting]);
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

import { Braces, Cpu, Database, Sparkles, Wand2 } from "lucide-react";
import { useAppStore } from "../store/useAppStore";

const SUGGESTIONS = [
  "Объясни этот код и найди в нём ошибки",
  "Составь пошаговый план проекта",
  "Сократи текст, сохранив главный смысл",
  "Проверь JSON и предложи улучшения",
];

export default function EmptyState() {
  const setDraftText = useAppStore((state) => state.setDraftText);
  const folder = useAppStore((state) => state.folder);

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-10 text-center">
      <div className="relative mb-5">
        <div className="absolute inset-0 rounded-3xl bg-accent-500/25 blur-2xl" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-accent-300/25 bg-gradient-to-br from-[#26336b] to-[#10182f] shadow-glow">
          <Sparkles size={28} className="text-accent-300" />
        </div>
      </div>

      <h2 className="text-xl font-semibold tracking-tight text-ink-100">
        Local AI Studio
      </h2>
      <p className="mt-1.5 max-w-md text-[12.5px] leading-relaxed text-ink-400">
        Полноценная работа с чатами Google AI Studio и локальной моделью.
        Всё хранится на вашем компьютере.
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5 text-[10px] text-ink-500">
        <span className="badge">
          <Database size={10} />
          GAS JSON
        </span>
        <span className="badge">
          <Cpu size={10} />
          локальный OpenAI API
        </span>
        <span className="badge">
          <Braces size={10} />
          вложения и мысли
        </span>
      </div>

      <div className="mt-7 grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="group flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.022] px-3 py-2.5 text-left text-[11.5px] leading-snug text-ink-300 transition-all hover:border-accent-400/35 hover:bg-accent-500/[0.06] hover:text-ink-100"
            onClick={() => setDraftText(suggestion)}
          >
            <Wand2
              size={14}
              className="mt-0.5 flex-none text-ink-500 transition-colors group-hover:text-accent-300"
            />
            {suggestion}
          </button>
        ))}
      </div>

      <div className="mt-8 max-w-md text-[9.5px] leading-relaxed text-ink-600">
        {folder ? `Папка чатов: ${folder}` : "Чат пока пуст. Напишите первое сообщение ниже."}
      </div>
    </div>
  );
}

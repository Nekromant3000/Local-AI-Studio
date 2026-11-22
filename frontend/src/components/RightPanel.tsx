import { useEffect, useMemo, useState } from "react";
import {
  Brain,
  Coins,
  Cpu,
  Gauge,
  Info,
  KeyRound,
  Link2,
  Loader2,
  Lock,
  Maximize2,
  PenLine,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import clsx from "clsx";
import { useAppStore, useLocalSettings } from "../store/useAppStore";
import { formatNumber } from "../lib/format";
import type { ThinkingLevel } from "../types";
import Modal from "./Modal";

interface RightPanelProps {
  onClose?: () => void;
  overlay?: boolean;
}

const PRESETS = [
  { id: "strata", label: "Strata", baseUrl: "http://localhost:47831/v1" },
  { id: "lmstudio", label: "LM Studio", baseUrl: "http://localhost:1234/v1" },
  { id: "ollama", label: "Ollama", baseUrl: "http://localhost:11434/v1" },
  { id: "llamacpp", label: "llama.cpp", baseUrl: "http://localhost:8080/v1" },
];

const STRATA_API_KEY = "strata-local";

// 127.0.0.1 и localhost для подсветки активного пресета — один и тот же адрес.
function normalizeUrlForCompare(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\/+$/, "")
    .replace("//127.0.0.1", "//localhost");
}

const THINKING_OPTIONS: Array<{ value: ThinkingLevel; label: string; hint: string }> = [
  { value: "NONE", label: "Off", hint: "Без размышлений: Temperature и Top P доступны, reasoning_effort=none" },
  { value: "LOW", label: "Low", hint: "reasoning_effort=low, Max Output Tokens = 65 536" },
  { value: "MEDIUM", label: "Medium", hint: "reasoning_effort=medium, Max Output Tokens = 65 536" },
  { value: "HIGH", label: "High", hint: "reasoning_effort=high + глубокной разбор сценариев (depth prompting)" },
  { value: "EXTRA_HIGH", label: "Extra High", hint: "Максимально глубокий пошаговый разбор, reasoning_effort=high" },
];

function Section({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-white/[0.06] px-3.5 py-3.5">
      <div className="mb-2.5 flex items-center gap-1.5">
        <span className="section-title">
          {icon}
          {title}
        </span>
        {action ? <div className="ml-auto">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function StatRow({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-[3px] text-[10.5px]">
      <span className="text-ink-400" title={hint}>
        {label}
      </span>
      <span className="font-mono text-[10.5px] text-ink-200">{value}</span>
    </div>
  );
}

export default function RightPanel({ onClose, overlay }: RightPanelProps) {
  const doc = useAppStore((state) => state.doc);
  const tokenStats = useAppStore((state) => state.tokenStats);
  const tokenLoading = useAppStore((state) => state.tokenLoading);
  const refreshTokens = useAppStore((state) => state.refreshTokens);
  const models = useAppStore((state) => state.models);
  const modelsLoading = useAppStore((state) => state.modelsLoading);
  const modelsError = useAppStore((state) => state.modelsError);
  const loadModels = useAppStore((state) => state.loadModels);
  const updateLocalApi = useAppStore((state) => state.updateLocalApi);
  const setSystemInstruction = useAppStore((state) => state.setSystemInstruction);
  const settings = useLocalSettings();
  const hasApiKey = useAppStore((state) => state.settings.hasApiKey);
  const saveApiKey = useAppStore((state) => state.saveApiKey);
  const clearApiKey = useAppStore((state) => state.clearApiKey);
  const setNotice = useAppStore((state) => state.setNotice);

  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [modelDraft, setModelDraft] = useState(settings.model);
  const [modelManual, setModelManual] = useState(false);
  const [temperature, setTemperature] = useState(settings.temperature);
  const [topP, setTopP] = useState(settings.topP);
  const [maxTokens, setMaxTokens] = useState(settings.maxOutputTokens);
  const [contextWindow, setContextWindow] = useState(settings.contextWindow);
  const [systemDraft, setSystemDraft] = useState(
    doc?.chat.systemInstruction?.text ?? "",
  );
  const [keyDraft, setKeyDraft] = useState("");
  const [keySaving, setKeySaving] = useState(false);
  const [instructionModalOpen, setInstructionModalOpen] = useState(false);

  useEffect(() => {
    setBaseUrl(settings.baseUrl);
    setModelDraft(settings.model);
    setModelManual(false);
    setTemperature(settings.temperature);
    setTopP(settings.topP);
    setMaxTokens(settings.maxOutputTokens);
    setContextWindow(settings.contextWindow);
  }, [
    doc?.id,
    settings.baseUrl,
    settings.model,
    settings.temperature,
    settings.topP,
    settings.maxOutputTokens,
    settings.contextWindow,
  ]);

  useEffect(() => {
    setSystemDraft(doc?.chat.systemInstruction?.text ?? "");
  }, [doc?.id]);

  useEffect(() => {
    const current = doc?.chat.systemInstruction?.text ?? "";
    if (systemDraft === current) return;
    const timer = setTimeout(() => setSystemInstruction(systemDraft), 500);
    return () => clearTimeout(timer);
  }, [systemDraft, doc?.id, setSystemInstruction]);

  const currentModel = useMemo(
    () => models.find((item) => item.id === settings.model),
    [models, settings.model],
  );

  const total = tokenStats?.total ?? 0;
  const context = Math.max(2048, settings.contextWindow || 131072);
  const percent = Math.min(100, Math.round((total / context) * 100));
  const overLimit = total > context;
  const nearLimit = percent >= 85;

  const commitBaseUrl = () => {
    const value = baseUrl.trim();
    if (!value || value === settings.baseUrl) {
      setBaseUrl(settings.baseUrl);
      return;
    }
    updateLocalApi({ baseUrl: value });
  };

  const commitModel = () => {
    const value = modelDraft.trim();
    if (value === settings.model) return;
    updateLocalApi({ model: value });
  };

  const commitTemperature = () => {
    const value = Math.min(2, Math.max(0, Number.isFinite(temperature) ? temperature : 1));
    setTemperature(value);
    if (value !== settings.temperature) updateLocalApi({ temperature: value });
  };

  const commitTopP = () => {
    const value = Math.min(1, Math.max(0, Number.isFinite(topP) ? topP : 0.95));
    setTopP(value);
    if (value !== settings.topP) updateLocalApi({ topP: value });
  };

  const thinkingOn = settings.thinkingLevel !== "NONE";

  const commitMaxTokens = () => {
    const value = Math.min(262144, Math.max(1, Math.round(maxTokens || 8192)));
    setMaxTokens(thinkingOn ? 65536 : value);
    if (!thinkingOn && value !== settings.maxOutputTokens) {
      updateLocalApi({ maxOutputTokens: value });
    }
  };

  const commitContextWindow = () => {
    const value = Math.min(2_000_000, Math.max(2048, Math.round(contextWindow || 131072)));
    setContextWindow(value);
    if (value !== settings.contextWindow) updateLocalApi({ contextWindow: value });
  };

  const closeInstructionModal = () => {
    // Мгновенный flush в systemInstruction.text перед закрытием модалки.
    const current = doc?.chat.systemInstruction?.text ?? "";
    if (systemDraft !== current) setSystemInstruction(systemDraft);
    setInstructionModalOpen(false);
  };

  const applyPreset = async (preset: (typeof PRESETS)[number]) => {
    setBaseUrl(preset.baseUrl);
    if (preset.baseUrl !== settings.baseUrl) updateLocalApi({ baseUrl: preset.baseUrl });
    if (preset.id !== "strata") return;
    if (!hasApiKey) {
      setKeyDraft(STRATA_API_KEY);
      await saveApiKey(STRATA_API_KEY);
      setNotice("Strata: ключ strata-local сохранён");
    }
    await loadModels(true, true);
  };

  const handleSaveKey = async () => {
    const key = keyDraft.trim();
    if (!key || keySaving) return;
    setKeySaving(true);
    try {
      const ok = await saveApiKey(key);
      if (ok) {
        setKeyDraft("");
        setNotice("API-ключ сохранён глобально");
      }
    } finally {
      setKeySaving(false);
    }
  };

  return (
    <aside className="flex h-full w-[352px] flex-none flex-col border-l border-white/[0.07] bg-[#080d19]/85 backdrop-blur-xl">
      <div className="flex flex-none items-center gap-2 border-b border-white/[0.06] px-3.5 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.035]">
          <Gauge size={14} className="text-ink-300" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-ink-100">Контекст и модель</div>
          <div className="text-[9px] text-ink-500">токены · system · локальный API</div>
        </div>
        {overlay ? (
          <button type="button" className="icon-btn" onClick={onClose} title="Закрыть">
            <X size={16} />
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section
          title="Токены контекста"
          icon={<Coins size={12} />}
          action={
            <button
              type="button"
              className="icon-btn h-6 w-6"
              onClick={() => void refreshTokens()}
              disabled={tokenLoading || !doc}
              title="Пересчитать токены"
            >
              <RefreshCw size={12} className={tokenLoading ? "spin" : undefined} />
            </button>
          }
        >
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.022] p-3">
            <div className="flex items-end justify-between">
              <div>
                <div className="font-mono text-[24px] font-semibold leading-none text-ink-100">
                  {tokenStats ? formatNumber(total) : "—"}
                </div>
                <div className="mt-1 text-[9.5px] uppercase tracking-wider text-ink-500">
                  токенов в истории
                </div>
              </div>
              <div className="text-right text-[9.5px] text-ink-400">
                <div>
                  окно{" "}
                  <span className="font-mono text-ink-200">{formatNumber(context)}</span>
                </div>
                <div className={clsx(overLimit ? "text-rose-300" : nearLimit ? "text-amber-300" : "")}>
                  {percent}% занято
                </div>
              </div>
            </div>

            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
              <div
                className={clsx(
                  "h-full rounded-full transition-all duration-300",
                  overLimit
                    ? "bg-rose-400"
                    : nearLimit
                      ? "bg-amber-300"
                      : "bg-gradient-to-r from-accent-500 to-sky-400",
                )}
                style={{ width: `${percent}%` }}
              />
            </div>

            <div className="mt-2.5 grid grid-cols-2 gap-x-4">
              <StatRow label="Система" value={tokenStats ? formatNumber(tokenStats.system) : "—"} />
              <StatRow label="Сообщения" value={tokenStats ? formatNumber(tokenStats.messages) : "—"} />
              <StatRow label="Вложения" value={tokenStats ? formatNumber(tokenStats.attachments) : "—"} />
              <StatRow label="Изображения" value={tokenStats ? formatNumber(tokenStats.images) : "—"} />
              <StatRow label="Файлы" value={tokenStats ? formatNumber(tokenStats.files) : "—"} />
              <StatRow
                label="URL"
                value={tokenStats ? formatNumber(tokenStats.urls) : "—"}
                hint="Текст страниц по ссылкам из сообщений; добавляется только в контекст модели"
              />
              <StatRow
                label="Мысли"
                value={tokenStats ? formatNumber(tokenStats.thoughts) : "—"}
                hint="Мысли хранятся в JSON, но не передаются в контекст модели"
              />
            </div>

            <div className="mt-2 flex items-center gap-1.5 border-t border-white/[0.06] pt-2 text-[9px] text-ink-500">
              <Info size={10} />
              {tokenStats?.approximate
                ? `приблизительная оценка${tokenStats.tokenizer ? ` · ${tokenStats.tokenizer}` : ""}`
                : "tiktoken · точный подсчёт"}
              {overLimit ? (
                <span className="ml-auto text-rose-300">превышено окно контекста</span>
              ) : null}
            </div>
          </div>
        </Section>

        <Section
          title="System Instructions"
          icon={<Sparkles size={12} />}
          action={
            <button
              type="button"
              className="icon-btn h-6 w-6"
              onClick={() => setInstructionModalOpen(true)}
              disabled={!doc}
              title="Развернуть редактор системной инструкции"
            >
              <Maximize2 size={12} />
            </button>
          }
        >
          <textarea
            className="field min-h-[92px] resize-y text-[11.5px] leading-relaxed"
            value={systemDraft}
            onChange={(event) => setSystemDraft(event.target.value)}
            placeholder="Системная инструкция для этого чата…"
            spellCheck={false}
            disabled={!doc}
            rows={4}
          />
          <div className="mt-1.5 flex items-center gap-2 text-[9px] text-ink-500">
            <span>{systemDraft.length.toLocaleString("ru-RU")} символов</span>
            <span className="ml-auto">systemInstruction.text · автосохранение</span>
          </div>
        </Section>

        <Section
          title="Локальный API"
          icon={<Cpu size={12} />}
          action={
            <span
              className={clsx(
                "h-1.5 w-1.5 rounded-full",
                modelsError ? "bg-rose-400" : models.length ? "bg-emerald-400" : "bg-ink-600",
              )}
              title={modelsError ? "Нет подключения" : models.length ? "API доступен" : "Нет данных"}
            />
          }
        >
          <div className="space-y-2.5">
            <div>
              <label className="mb-1 block text-[9.5px] uppercase tracking-wider text-ink-500">
                Base URL
              </label>
              <input
                className="field font-mono text-[11px]"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                onBlur={commitBaseUrl}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
                placeholder="http://localhost:1234/v1"
                spellCheck={false}
              />
              <div className="mt-1.5 flex flex-wrap gap-1">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={clsx("chip py-0.5 text-[9.5px]", {
                      "border-accent-400/40 bg-accent-500/10 text-accent-200":
                        normalizeUrlForCompare(preset.baseUrl) ===
                        normalizeUrlForCompare(settings.baseUrl),
                    })}
                    onClick={() => void applyPreset(preset)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-[9.5px] uppercase tracking-wider text-ink-500">Модель</label>
                <div className="flex items-center gap-2">
                  {models.length ? (
                    <button
                      type="button"
                      className={clsx(
                        "inline-flex items-center gap-1 text-[9.5px] text-ink-400 hover:text-white",
                        modelManual && "text-accent-200",
                      )}
                      onClick={() => {
                        if (modelManual) commitModel();
                        setModelManual((value) => !value);
                      }}
                      title={modelManual ? "Выбрать модель из списка" : "Ввести ID модели вручную"}
                    >
                      <PenLine size={10} />
                      вручную
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-[9.5px] text-ink-400 hover:text-white"
                    onClick={() => void loadModels(true)}
                    disabled={modelsLoading}
                  >
                    <RefreshCw size={10} className={modelsLoading ? "spin" : undefined} />
                    обновить
                  </button>
                </div>
              </div>
              {models.length && !modelManual ? (
                <select
                  className="field font-mono text-[11px]"
                  value={settings.model}
                  onChange={(event) => {
                    setModelDraft(event.target.value);
                    updateLocalApi({ model: event.target.value });
                  }}
                >
                  {settings.model &&
                  !models.some((item) => item.id === settings.model) ? (
                    <option value={settings.model}>{settings.model} (текущая)</option>
                  ) : null}
                  {!settings.model ? <option value="">— выберите модель —</option> : null}
                  {models.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name && item.name !== item.id ? `${item.id} — ${item.name}` : item.id}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="field font-mono text-[11px]"
                  value={modelDraft}
                  onChange={(event) => setModelDraft(event.target.value)}
                  onBlur={commitModel}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder="название модели"
                  list="model-options"
                  spellCheck={false}
                />
              )}
              <datalist id="model-options">
                {models.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </datalist>
              <div className="mt-1 flex items-center gap-1.5 text-[9px] text-ink-500">
                {modelsLoading ? (
                  <>
                    <Loader2 size={10} className="spin" /> загружаю список…
                  </>
                ) : modelsError ? (
                  <span className="truncate text-rose-300/90" title={modelsError}>
                    {modelsError}
                  </span>
                ) : models.length ? (
                  <span>
                    {models.length} моделей доступно
                    {currentModel?.contextLength
                      ? ` · контекст ${formatNumber(currentModel.contextLength)}`
                      : ""}
                  </span>
                ) : (
                  <span>список пуст — введите ID вручную</span>
                )}
              </div>
            </div>

            <div>
              <label className="mb-1 flex items-center gap-1 text-[9.5px] uppercase tracking-wider text-ink-500">
                <KeyRound size={10} />
                API Key
                {hasApiKey ? <span className="text-emerald-300/80">· задан</span> : null}
              </label>
              <div className="flex gap-1.5">
                <input
                  type="password"
                  className="field font-mono text-[11px]"
                  value={keyDraft}
                  onChange={(event) => setKeyDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleSaveKey();
                    }
                  }}
                  placeholder={hasApiKey ? "•••••••• (заменить)" : "необязательно"}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="btn h-[34px] px-2"
                  onClick={() => void handleSaveKey()}
                  disabled={!keyDraft.trim() || keySaving}
                  title="Сохранить ключ"
                >
                  {keySaving ? <Loader2 size={12} className="spin" /> : <Save size={12} />}
                </button>
                {hasApiKey ? (
                  <button
                    type="button"
                    className="btn h-[34px] px-2 text-rose-300/90"
                    onClick={() => {
                      void clearApiKey();
                      setNotice("API-ключ удалён");
                    }}
                    title="Удалить ключ"
                  >
                    <X size={12} />
                  </button>
                ) : null}
              </div>
              <div className="mt-1 text-[9px] text-ink-600">
                Ключ хранится глобально в data/settings.json, не в JSON чата.
              </div>
            </div>
          </div>
        </Section>

        <Section title="Параметры генерации" icon={<Brain size={12} />}>
          <div className="space-y-3">
            <div
              className={clsx(
                "rounded-xl border p-2.5 transition-colors",
                thinkingOn
                  ? "border-violet-300/25 bg-violet-400/[0.06]"
                  : "border-white/[0.08] bg-white/[0.02]",
              )}
            >
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink-100">
                <Brain size={12} className="text-violet-300" />
                Thinking Level
              </div>
              <div className="mt-0.5 text-[9.5px] leading-relaxed text-ink-500">
                {thinkingOn
                  ? "Temperature отключается, Max Output Tokens фиксируется на 65 536, в API передаётся reasoning_effort."
                  : "Мышление выключено: Temperature и Top P доступны, в API передаётся reasoning_effort=none."}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {THINKING_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    title={option.hint}
                    className={clsx("chip py-0.5 text-[9.5px]", {
                      "border-violet-300/45 bg-violet-400/15 text-violet-100":
                        settings.thinkingLevel === option.value,
                    })}
                    onClick={() => updateLocalApi({ thinkingLevel: option.value })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {thinkingOn ? (
              <div className="flex items-center gap-2 rounded-lg border border-violet-300/15 bg-violet-400/[0.04] px-2.5 py-2 text-[9.5px] text-violet-200/80">
                <Lock size={11} />
                Temperature скрыта и не отправляется. Max Output Tokens = 65 536.
              </div>
            ) : (
              <div>
                <div className="mb-1 flex items-center justify-between text-[10px]">
                  <span className="text-ink-400">Temperature</span>
                  <span className="font-mono text-ink-200">{temperature.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={temperature}
                  onChange={(event) => setTemperature(Number(event.target.value))}
                  onPointerUp={commitTemperature}
                  onBlur={commitTemperature}
                  onKeyUp={commitTemperature}
                />
              </div>
            )}

            <div>
              <div className="mb-1 flex items-center justify-between text-[10px]">
                <span className="text-ink-400">Top P</span>
                <span className="font-mono text-ink-200">{topP.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={topP}
                onChange={(event) => setTopP(Number(event.target.value))}
                onPointerUp={commitTopP}
                onBlur={commitTopP}
                onKeyUp={commitTopP}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 flex items-center gap-1 text-[9.5px] uppercase tracking-wider text-ink-500">
                  Max Output
                  {thinkingOn ? <Lock size={9} /> : null}
                </label>
                <input
                  type="number"
                  className="field font-mono text-[11px] disabled:opacity-60"
                  value={thinkingOn ? 65536 : maxTokens}
                  min={1}
                  max={262144}
                  step={256}
                  disabled={thinkingOn}
                  onChange={(event) => setMaxTokens(Number(event.target.value))}
                  onBlur={commitMaxTokens}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              </div>
              <div>
                <label className="mb-1 block text-[9.5px] uppercase tracking-wider text-ink-500">
                  Context Window
                </label>
                <input
                  type="number"
                  className="field font-mono text-[11px]"
                  value={contextWindow}
                  min={2048}
                  max={2_000_000}
                  step={1024}
                  onChange={(event) => setContextWindow(Number(event.target.value))}
                  onBlur={commitContextWindow}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-lg border border-white/[0.07] bg-white/[0.018] px-2.5 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[10.5px] text-ink-200">
                  <Send size={11} className="text-ink-400" />
                  Отправлять вложения
                </div>
                <div className="mt-0.5 text-[9px] text-ink-500">
                  Изображения и текстовые файлы попадут в контекст модели.
                </div>
              </div>
              <button
                type="button"
                className="toggle"
                data-on={settings.sendAttachments}
                onClick={() =>
                  updateLocalApi({ sendAttachments: !settings.sendAttachments })
                }
                role="switch"
                aria-checked={settings.sendAttachments}
              />
            </div>

            <div className="flex items-center gap-3 rounded-lg border border-white/[0.07] bg-white/[0.018] px-2.5 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[10.5px] text-ink-200">
                  <Link2 size={11} className="text-ink-400" />
                  URL Context
                </div>
                <div className="mt-0.5 text-[9px] text-ink-500">
                  Ссылки из сообщений загружаются и добавляют текст страниц в контекст модели.
                  JSON чата не меняется; ссылки можно исключать прямо в ленте.
                </div>
              </div>
              <button
                type="button"
                className="toggle"
                data-on={settings.urlContext}
                onClick={() => updateLocalApi({ urlContext: !settings.urlContext })}
                role="switch"
                aria-checked={settings.urlContext}
              />
            </div>
          </div>
        </Section>

        <div className="px-3.5 py-3 text-[9px] leading-relaxed text-ink-600">
          Настройки применяются к текущему чату, сохраняются в{" "}
          <span className="font-mono">runSettings.localApi</span> и дублируются как глобальные
          значения по умолчанию. Мысли модели не отправляются в контекст. Лимит изображений на
          запрос — 12.
        </div>
      </div>

      <Modal
        open={instructionModalOpen}
        onClose={closeInstructionModal}
        icon={<Sparkles size={16} />}
        title="System Instructions"
        subtitle="Системная инструкция этого чата · systemInstruction.text · автосохранение"
        size="full"
        bodyClassName="p-4"
        footer={
          <>
            <span className="mr-auto font-mono text-[11px] text-ink-400">
              {systemDraft.length.toLocaleString("ru-RU")} символов
              <span className="text-ink-600"> · изменения сохраняются автоматически</span>
            </span>
            <button type="button" className="btn btn-primary" onClick={closeInstructionModal}>
              Готово
            </button>
          </>
        }
      >
        <textarea
          autoFocus
          className="field h-[calc(70vh-160px)] min-h-[300px] w-full resize-none text-[13.5px] leading-relaxed"
          value={systemDraft}
          onChange={(event) => setSystemDraft(event.target.value)}
          placeholder="Системная инструкция для этого чата…"
          spellCheck={false}
        />
      </Modal>
    </aside>
  );
}

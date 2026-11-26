import { useEffect, useState } from "react";
import {
  Clock,
  DownloadCloud,
  Eye,
  Film,
  Loader2,
  Play,
  RotateCcw,
  Youtube,
} from "lucide-react";
import clsx from "clsx";
import { youtubeWatchUrl } from "../lib/youtube";
import { useAppStore } from "../store/useAppStore";
import type { YoutubeTranscriptMode } from "../types";
import FrameInspectorModal from "./FrameInspectorModal";
import YouTubePlayerModal from "./YouTubePlayerModal";

interface YouTubeCardProps {
  videoId: string;
}

const MODE_LABELS: Record<YoutubeTranscriptMode, string> = {
  auto: "Субтитры",
  whisper: "Whisper",
  diarize: "Спикеры",
};

// Крупная карточка YouTube-ролика в ленте (над текстом user-сообщения).
// Никакой тяжелой сетевой работы при рендере: только GET-проб локального кэша;
// парсинг (сеть) — исключительно по кнопке «Загрузить в контекст».
export default function YouTubeCard({ videoId }: YouTubeCardProps) {
  const entry = useAppStore((state) => state.youtube[videoId] ?? null);
  const probeYoutube = useAppStore((state) => state.probeYoutube);
  const parseYoutube = useAppStore((state) => state.parseYoutube);
  const setError = useAppStore((state) => state.setError);

  const [mode, setMode] = useState<YoutubeTranscriptMode>("auto");
  const [busy, setBusy] = useState<string | null>(null);
  const [coverBroken, setCoverBroken] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  useEffect(() => {
    probeYoutube(videoId);
  }, [videoId, probeYoutube]);

  const video = entry?.video ?? null;
  const meta = video?.meta ?? null;
  const transcript = video?.transcript ?? null;
  const framesCount = video?.frames.length ?? 0;
  const framesTokens = video?.framesTokenCount ?? 0;
  const watch = youtubeWatchUrl(videoId);

  useEffect(() => {
    if (transcript?.mode) setMode(transcript.mode);
  }, [transcript?.mode]);

  const runParse = async (forceRefresh: boolean) => {
    if (busy) return;
    setBusy(forceRefresh ? "recount" : "parse");
    try {
      await parseYoutube(videoId, mode, forceRefresh);
    } finally {
      setBusy(null);
    }
  };

  // Превью: локальный thumb.jpg из кэша, иначе стандартная картинка ytimg,
  // иначе (нет сети/VPN) — тёмная подложка с иконкой.
  const coverSrc = meta?.thumbUrl ?? video?.thumbUrl ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const showCover = !coverBroken;

  return (
    <div className="w-[540px] max-w-full rounded-2xl border border-[#293b63]/80 bg-[#101a31]/75 p-2.5 shadow-[0_1px_0_rgba(255,255,255,.03)_inset]">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/[0.06] bg-[#0a101e]">
        {showCover ? (
          <img
            src={coverSrc}
            alt={meta?.title || videoId}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={() => setCoverBroken(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#131c33] to-[#0a101e]">
            <Youtube size={44} className="text-rose-400/40" />
          </div>
        )}
        <button
          type="button"
          onClick={() => setPlayerOpen(true)}
          className="group/play absolute inset-0 flex items-center justify-center bg-black/25 transition-colors hover:bg-black/40"
          title="Открыть плеер"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/25 bg-black/60 text-white shadow-xl backdrop-blur transition-transform group-hover/play:scale-110">
            <Play size={22} className="ml-0.5" />
          </span>
        </button>
        {meta?.durationLabel ? (
          <span className="absolute bottom-2 right-2 rounded-md bg-black/75 px-1.5 py-0.5 font-mono text-[10.5px] text-white">
            {meta.durationLabel}
          </span>
        ) : null}
        {meta?.isShort ? (
          <span className="badge absolute left-2 top-2 border-rose-300/25 bg-rose-400/15 text-rose-200">
            Short
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex items-start gap-2 px-1">
        <Youtube size={16} className="mt-0.5 flex-none text-rose-300" />
        <div className="min-w-0 flex-1">
          <a
            href={watch}
            target="_blank"
            rel="noreferrer"
            className="line-clamp-2 text-[13px] font-semibold leading-snug text-white hover:underline"
            title={meta?.title || videoId}
          >
            {meta?.title || `YouTube-ролик ${videoId}`}
          </a>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10.5px] text-ink-400">
            {meta?.channel ? <span>{meta.channel}</span> : null}
            {typeof meta?.viewCount === "number" && meta.viewCount > 0 ? (
              <span>{meta.viewCount.toLocaleString("ru-RU")} просм.</span>
            ) : null}
            <span className="font-mono text-[9.5px] text-ink-600">{videoId}</span>
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1 pb-0.5">
        {entry?.status === "loading" ? (
          <span className="inline-flex items-center gap-1.5 text-[10.5px] text-ink-400">
            <Loader2 size={12} className="spin" />
            Проверяю локальный кэш…
          </span>
        ) : null}

        {entry?.status === "uncached" ? (
          <>
            <span className="badge border-amber-300/20 bg-amber-300/[0.07] text-amber-200">
              Не загружено в контекст
            </span>
            <ModeSwitcher value={mode} onChange={setMode} disabled={Boolean(busy)} />
            <button
              type="button"
              className="btn btn-primary ml-auto !py-1 text-[11px]"
              onClick={() => void runParse(false)}
              disabled={Boolean(busy)}
              title="Скачать субтитры/транскрипт и добавить видео в контекст модели"
            >
              {busy === "parse" ? <Loader2 size={12} className="spin" /> : <DownloadCloud size={12} />}
              {busy === "parse" ? "Разбираю…" : "Загрузить в контекст"}
            </button>
          </>
        ) : null}

        {entry?.status === "cached" ? (
          <>
            <span className="badge border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-200">
              <Clock size={10} />
              В контексте: транскрипт {(transcript?.tokenCount ?? 0).toLocaleString("ru-RU")} ток.
            </span>
            {framesCount > 0 ? (
              <span className="badge border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-200">
                <Film size={10} />
                Кадры {framesCount} · {framesTokens.toLocaleString("ru-RU")} ток.
              </span>
            ) : null}
            {transcript?.sourceNote ? (
              <span className="text-[9.5px] text-ink-500" title={transcript.sourceNote}>
                {transcript.sourceNote}
              </span>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 border-t border-white/[0.05] px-1 pt-2">
        {entry?.status === "cached" ? (
          <>
            <ModeSwitcher value={mode} onChange={setMode} disabled={Boolean(busy)} />
            <button
              type="button"
              className="icon-btn"
              onClick={() => void runParse(true)}
              disabled={Boolean(busy)}
              title={`Пересчитать транскрипт в режиме «${MODE_LABELS[mode]}»`}
            >
              {busy === "recount" ? <Loader2 size={13} className="spin" /> : <RotateCcw size={13} />}
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="btn !py-1 text-[11px]"
          onClick={() => setPlayerOpen(true)}
          title="Полноэкранный плеер с кнопкой «взять кадр»"
        >
          <Play size={12} />
          Смотреть
        </button>
        <button
          type="button"
          className={clsx("btn !py-1 text-[11px]", entry?.status === "cached" && "ml-auto")}
          onClick={() => {
            if (entry?.status !== "cached") {
              setError("Сначала загрузите видео в контекст — кадры берутся из кэша.");
              return;
            }
            setInspectorOpen(true);
          }}
          title="Инспектор кадров: нарезка, вставка скриншотов, удаление"
        >
          <Eye size={12} />
          Кадры{framesCount ? ` (${framesCount})` : ""}
        </button>
      </div>

      <YouTubePlayerModal
        videoId={videoId}
        title={meta?.title ?? undefined}
        open={playerOpen}
        onClose={() => setPlayerOpen(false)}
      />
      <FrameInspectorModal
        videoId={videoId}
        open={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
      />
    </div>
  );
}

function ModeSwitcher({
  value,
  onChange,
  disabled,
}: {
  value: YoutubeTranscriptMode;
  onChange: (mode: YoutubeTranscriptMode) => void;
  disabled: boolean;
}) {
  return (
    <span className="inline-flex overflow-hidden rounded-lg border border-white/[0.08]">
      {(Object.keys(MODE_LABELS) as YoutubeTranscriptMode[]).map((key) => (
        <button
          key={key}
          type="button"
          className={clsx(
            "px-2 py-1 text-[10.5px] transition-colors disabled:opacity-50",
            value === key
              ? "bg-accent-500/20 text-accent-200"
              : "bg-transparent text-ink-400 hover:bg-white/[0.05] hover:text-ink-200",
          )}
          onClick={() => onChange(key)}
          disabled={disabled}
          title={`Режим транскрипции: ${MODE_LABELS[key]}`}
        >
          {MODE_LABELS[key]}
        </button>
      ))}
    </span>
  );
}

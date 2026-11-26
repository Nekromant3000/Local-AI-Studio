import { useEffect, useRef, useState } from "react";
import {
  ClipboardPaste,
  Film,
  ImagePlus,
  Loader2,
  Scissors,
  Trash2,
} from "lucide-react";
import clsx from "clsx";
import { youtubeFrameUrl } from "../lib/api";
import { parseTimecode } from "../lib/youtube";
import { useAppStore } from "../store/useAppStore";
import Modal from "./Modal";

interface FrameInspectorModalProps {
  videoId: string;
  open: boolean;
  onClose: () => void;
}

// Инспектор кадров видео: все кадры в хронологическом порядке с таймкодами,
// умная нарезка, удаление и вставка своих скриншотов (файл или Ctrl+V)
// с обязательным таймкодом ММ:СС — ровно те подписи, что увидит модель.
export default function FrameInspectorModal({ videoId, open, onClose }: FrameInspectorModalProps) {
  const entry = useAppStore((state) => state.youtube[videoId] ?? null);
  const refreshYoutube = useAppStore((state) => state.refreshYoutube);
  const extractYoutubeFrames = useAppStore((state) => state.extractYoutubeFrames);
  const uploadYoutubeFrame = useAppStore((state) => state.uploadYoutubeFrame);
  const deleteYoutubeFrame = useAppStore((state) => state.deleteYoutubeFrame);
  const setError = useAppStore((state) => state.setError);

  const [timecode, setTimecode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const timecodeRef = useRef<HTMLInputElement>(null);

  const frames = entry?.video?.frames ?? [];
  const framesTokens = entry?.video?.framesTokenCount ?? 0;

  useEffect(() => {
    if (!open) return;
    void refreshYoutube(videoId);
  }, [open, videoId, refreshYoutube]);

  const addFile = async (file: File | null | undefined) => {
    if (!file || busy) return;
    const seconds = parseTimecode(timecode);
    if (seconds === null) {
      setError("Укажите таймкод кадра (ММ:СС или Ч:ММ:СС) — с ним модель поймёт, откуда кадр.");
      timecodeRef.current?.focus();
      return;
    }
    setBusy("upload");
    try {
      await uploadYoutubeFrame(videoId, file, seconds);
      setTimecode("");
    } finally {
      setBusy(null);
    }
  };

  // Ctrl+V — скриншот прямо из буфера обмена (пока открыта модалка).
  useEffect(() => {
    if (!open) return;
    const onPaste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files ?? []).find((item) =>
        item.type.startsWith("image/"),
      );
      if (!file) return;
      event.preventDefault();
      void addFile(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, timecode, busy]);

  const cutFrames = async () => {
    if (busy) return;
    setBusy("cut");
    try {
      await extractYoutubeFrames(videoId);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (frameId: string) => {
    if (busy) return;
    setBusy(frameId);
    try {
      await deleteYoutubeFrame(videoId, frameId);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="full"
      icon={<Film size={18} />}
      title="Инспектор кадров"
      subtitle={
        frames.length
          ? `${frames.length} кадр(ов) в контексте · ${framesTokens.toLocaleString("ru-RU")} ток. — порядок строго по таймкоду`
          : "Кадров пока нет — нарежьте умно или вставьте свои скриншоты с таймкодом."
      }
      footer={
        <>
          <span className="mr-auto inline-flex items-center gap-1.5 text-[10.5px] text-ink-400">
            <ClipboardPaste size={12} />
            Ctrl+V — вставить скриншот из буфера
          </span>
          <button
            type="button"
            className="btn text-[11px]"
            onClick={() => fileRef.current?.click()}
            disabled={Boolean(busy)}
            title="Загрузить файл скриншота (до 12 МБ)"
          >
            <ImagePlus size={13} />
            Вставить свой скриншот
          </button>
          <button
            type="button"
            className="btn btn-primary text-[11px]"
            onClick={() => void cutFrames()}
            disabled={Boolean(busy)}
            title="Умная автоматическая нарезка (до 10 кадров): смена сцены + информативность"
          >
            {busy === "cut" ? <Loader2 size={13} className="spin" /> : <Scissors size={13} />}
            {busy === "cut" ? "Нарезаю (скачиваю видео)…" : "Нарезать кадры (умно)"}
          </button>
        </>
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          void addFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2">
        <span className="text-[11px] text-ink-300">Таймкод нового кадра:</span>
        <input
          ref={timecodeRef}
          className="field w-28 !py-1 font-mono text-[12px]"
          placeholder="ММ:СС"
          value={timecode}
          onChange={(event) => setTimecode(event.target.value)}
          title="Например 02:15 или 1:02:03"
        />
        <span className="text-[10px] text-ink-500">
          нужен для скриншотов: подпись «Кадр [ММ:СС]» уходит модели вместе с картинкой
        </span>
      </div>

      {frames.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-ink-500">
          <Film size={28} className="text-ink-600" />
          <div className="text-[12.5px]">Кадров пока нет</div>
          <div className="max-w-sm text-center text-[11px] leading-relaxed">
            «Нарезать кадры (умно)» сама выберет самые содержательные моменты, а плеер
            позволяет взять конкретный кадр на нужной секунде.
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {frames.map((frame) => (
            <div
              key={frame.id}
              className="group/frame relative flex gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-2.5"
            >
              <img
                src={youtubeFrameUrl(videoId, frame.filename)}
                alt={`Кадр ${frame.timecode}`}
                loading="lazy"
                className="max-h-[300px] w-[240px] max-w-[55%] flex-none rounded-lg border border-white/[0.06] bg-black object-contain"
              />
              <div className="min-w-0 flex-1 pr-8">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[13px] font-semibold text-white">
                    [{frame.timecode}]
                  </span>
                  <span
                    className={clsx(
                      "badge",
                      frame.source === "manual"
                        ? "border-sky-300/20 bg-sky-300/[0.06] text-sky-200"
                        : "border-white/[0.08] bg-white/[0.03] text-ink-300",
                    )}
                  >
                    {frame.source === "manual" ? "Вручную" : "Авто"}
                  </span>
                  <span className="font-mono text-[9.5px] text-ink-500">{frame.tokens} ток.</span>
                </div>
                <div className="mt-1 font-mono text-[9.5px] text-ink-600">{frame.filename}</div>
              </div>
              <button
                type="button"
                className="icon-btn absolute right-2 top-2 text-ink-400 hover:!text-rose-300"
                onClick={() => void remove(frame.id)}
                disabled={Boolean(busy)}
                title="Удалить кадр из контекста"
              >
                {busy === frame.id ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

import { useEffect, useRef, useState } from "react";
import { Camera, ExternalLink, Loader2 } from "lucide-react";
import { loadYoutubeIframeApi, type YtPlayer } from "../lib/youtubePlayer";
import { formatTimecode, youtubeWatchUrl } from "../lib/youtube";
import { useAppStore } from "../store/useAppStore";
import Modal from "./Modal";

interface YouTubePlayerModalProps {
  videoId: string;
  title?: string;
  open: boolean;
  onClose: () => void;
}

// Плеер на официальном YouTube IFrame Player API (youtube-nocookie.com):
// `player.getCurrentTime()` даёт точную секунду для «Взять этот кадр».
export default function YouTubePlayerModal({ videoId, title, open, onClose }: YouTubePlayerModalProps) {
  const captureYoutubeFrame = useAppStore((state) => state.captureYoutubeFrame);
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YtPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setReady(false);
    setApiError(null);
    setCurrent(0);
    setDuration(0);
    loadYoutubeIframeApi()
      .then(({ YT }) => {
        if (cancelled || !hostRef.current || !YT.Player) return;
        playerRef.current = new YT.Player(hostRef.current, {
          videoId,
          host: "https://www.youtube-nocookie.com",
          playerVars: { autoplay: 1, rel: 0, playsinline: 1 },
          events: {
            onReady: (event: { target: YtPlayer }) => {
              // YT.Player заменяет host-див своим iframe — растягиваем его на весь контейнер
              try {
                const iframe = event.target.getIframe();
                if (iframe) {
                  iframe.style.position = "absolute";
                  iframe.style.inset = "0";
                  iframe.style.width = "100%";
                  iframe.style.height = "100%";
                }
              } catch {
                /* не критично */
              }
              setReady(true);
            },
            onError: () => setApiError("YouTube отказался показывать это видео (проверьте VPN/доступ)."),
          },
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) setApiError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy();
      } catch {
        /* модалка уже размонтирована */
      }
      playerRef.current = null;
    };
  }, [open, videoId]);

  useEffect(() => {
    if (!open || !ready) return;
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      try {
        setCurrent(player.getCurrentTime());
        setDuration(player.getDuration());
      } catch {
        /* плеер мог быть уже уничтожен */
      }
    }, 400);
    return () => window.clearInterval(timer);
  }, [open, ready]);

  const capture = async () => {
    const player = playerRef.current;
    if (!player || capturing) return;
    setCapturing(true);
    try {
      await captureYoutubeFrame(videoId, player.getCurrentTime());
    } finally {
      setCapturing(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="full"
      title={title || `YouTube ${videoId}`}
      subtitle="Нажмите «Взять этот кадр» на нужной секунде — кадр вырежется точно по таймкоду плеера и попадёт в контекст модели."
      footer={
        <>
          <span className="mr-auto font-mono text-[12px] text-ink-300">
            {formatTimecode(current)}
            {duration ? ` / ${formatTimecode(duration)}` : ""}
          </span>
          <a
            className="btn text-[11px]"
            href={youtubeWatchUrl(videoId)}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={12} />
            YouTube
          </a>
          <button
            type="button"
            className="btn btn-primary text-[11px]"
            onClick={() => void capture()}
            disabled={!ready || capturing}
            title="Вырезать кадр на текущей секунде видео (source: manual)"
          >
            {capturing ? <Loader2 size={13} className="spin" /> : <Camera size={13} />}
            {capturing ? "Вырезаю кадр…" : `Взять этот кадр [${formatTimecode(current)}]`}
          </button>
        </>
      }
      bodyClassName="!px-0 !py-0"
    >
      <div className="flex h-full min-h-[42vh] flex-col">
        {apiError ? (
          <div className="m-4 rounded-lg border border-rose-400/25 bg-rose-400/[0.07] px-3 py-2 text-[12px] text-rose-200">
            {apiError}
          </div>
        ) : null}
        {!apiError ? (
          <div className="relative w-full flex-1 bg-black">
            <div ref={hostRef} className="absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full" />
            {!ready ? (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-[12px] text-ink-400">
                <Loader2 size={14} className="spin" />
                Загружаю YouTube IFrame API…
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

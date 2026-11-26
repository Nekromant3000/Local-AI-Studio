// youtubePlayer.ts — однократная загрузка YouTube IFrame Player API
// (https://www.youtube.com/iframe_api). Промис кешируется: второй вызов ждёт тот же скрипт.

interface YTNS {
  Player?: new (el: HTMLElement | string, opts: Record<string, unknown>) => YtPlayer;
  PlayerApiIsLoaded?: () => boolean;
}

export interface YtPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  cueVideoById(videoId: string): void;
  getIframe(): HTMLIFrameElement;
  destroy(): void;
}

declare global {
  interface Window {
    YT?: YTNS;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_SRC = "https://www.youtube.com/iframe_api";

let loading: Promise<{ YT: YTNS }> | null = null;

export function loadYoutubeIframeApi(): Promise<{ YT: YTNS }> {
  if (window.YT?.PlayerApiIsLoaded?.() && window.YT.Player) {
    return Promise.resolve({ YT: window.YT });
  }
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const fail = () => {
      loading = null;
      reject(new Error("Не удалось загрузить YouTube IFrame API. Проверьте доступ к youtube.com (нужен включённый VPN)."));
    };
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT?.Player) resolve({ YT: window.YT });
      else fail();
    };
    if (!document.querySelector(`script[src="${API_SRC}"]`)) {
      const tag = document.createElement("script");
      tag.src = API_SRC;
      tag.onerror = fail;
      document.head.appendChild(tag);
    }
    // YouTube CDN недоступен (без VPN) — скрипт не придёт никогда: не вешаем пользователя навсегда
    window.setTimeout(() => {
      if (!window.YT?.Player) fail();
    }, 15000);
  });
  return loading;
}

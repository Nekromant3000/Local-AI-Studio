// YouTube/Shorts: выделение video_id из ссылок (зеркало backend/app/youtube_service.py)

const VIDEO_ID_RE = "[0-9A-Za-z_-]{11}";

export interface YouTubeLink {
  id: string;
  url: string;
}

// Хосты: www.youtube.com, m.youtube.com, music.youtube.com, youtu.be, youtube-nocookie.com
const YT_HOST_RE = /^(www\.|m\.|music\.)?((youtube|youtube-nocookie)\.com|youtu\.be)$/i;

/**
 * Если URL ведёт на YouTube, возвращает { id, url } (url — канонический watch),
 * иначе null. Поддерживаются watch?v=, youtu.be/ID, shorts/ID, embed/ID, live/ID.
 */
export function extractYoutubeLink(rawUrl: string): YouTubeLink | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!YT_HOST_RE.test(u.hostname)) return null;

  let id = u.searchParams.get("v") ?? "";
  if (!id) {
    const path = u.pathname.split("/").filter(Boolean);
    if (u.hostname.toLowerCase() === "youtu.be") {
      id = path[0] ?? "";
    } else if (path.length > 0 && ["shorts", "embed", "live", "v"].includes(path[0])) {
      id = path[1] ?? "";
    }
  }
  if (!new RegExp(`^${VIDEO_ID_RE}$`).test(id)) return null;
  return { id, url: `https://www.youtube.com/watch?v=${id}` };
}

/** Из строки (fileData.fileUri/файловый путь архива) — video_id, если он там есть. */
export function extractYoutubeIdFromString(s: string): string | null {
  const m =
    s.match(new RegExp(`(?:v=|youtu\\.be/|shorts/|embed/|live/)(${VIDEO_ID_RE})`)) ??
    s.match(new RegExp(`^${VIDEO_ID_RE}$`));
  return m ? m[1] : null;
}

export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

// ─── Таймкоды ──────────────────────────────────────────────────────────────

/** 125.4 → "02:05" (для подписей кадра). */
export function formatTimecode(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
}

/** "1:02:03" / "12:34" / "89" / "89.5" → секунды; null если не распознано. */
export function parseTimecode(value: string): number | null {
  const t = value.trim().replace(",", ".");
  if (!t) return null;
  if (!/^\d{1,2}(:\d{1,2}){0,2}([.,]\d+)?$/.test(t)) return null;
  const parts = t.split(":").map((p) => Number.parseFloat(p.replace(",", ".")));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

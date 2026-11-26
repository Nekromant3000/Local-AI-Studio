import { useMemo } from "react";
import type { DisplayTurn } from "../types";
import { extractUrls } from "../lib/links";
import { extractYoutubeIdFromString, extractYoutubeLink } from "../lib/youtube";
import YouTubeCard from "./YouTubeCard";

interface YouTubeCardsProps {
  turn: DisplayTurn;
}

// YouTube-видео пользовательского сообщения: ссылки в тексте, слот
// `youtubeVideo` и легаси GAS `fileData.fileUri` — тот же набор источников,
// что в backend `iter_chat_video_ids`. Карточки — отдельным блоком НАД
// текстом сообщения, вертикальным столбиком (без горизонтальных слайдеров).
export default function YouTubeCards({ turn }: YouTubeCardsProps) {
  const videoIds = useMemo(() => collectVideoIds(turn), [turn]);
  if (!videoIds.length) return null;
  return (
    <div className="flex w-full flex-col items-end gap-3">
      {videoIds.map((id) => (
        <YouTubeCard key={id} videoId={id} />
      ))}
    </div>
  );
}

const VIDEO_ID_RE = /^[0-9A-Za-z_-]{11}$/;

function collectVideoIds(turn: DisplayTurn): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  const add = (candidate: string | null | undefined) => {
    if (!candidate || !VIDEO_ID_RE.test(candidate) || seen.has(candidate)) return;
    seen.add(candidate);
    ids.push(candidate);
  };

  for (const attachment of turn.attachments) {
    if (attachment.slot !== "youtubeVideo") continue;
    const rawId = String(attachment.obj.id || attachment.meta?.youtubeId || "");
    add(VIDEO_ID_RE.test(rawId) ? rawId : extractYoutubeLink(rawId)?.id ?? extractYoutubeIdFromString(rawId));
    add(extractYoutubeIdFromString(String(attachment.obj.url || attachment.obj.localPath || "")));
  }

  for (const { chunk } of turn.chunks) {
    const fileData = chunk.fileData as { fileUri?: string; mimeType?: string } | undefined;
    if (fileData && typeof fileData.fileUri === "string") {
      add(extractYoutubeIdFromString(fileData.fileUri));
    }
  }

  for (const url of extractUrls(turn.text)) {
    add(extractYoutubeLink(url)?.id);
  }

  return ids;
}

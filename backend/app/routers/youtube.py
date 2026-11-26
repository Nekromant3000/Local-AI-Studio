"""API YouTube/Shorts парсера: метаданные, превью, транскрипты.

Парсинг (сеть) — только по явному ``POST /api/youtube/parse``; GET-эндпоинты
отдают исключительно локальный кэш ``data/youtube_cache/``.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..youtube_service import (
    TRANSCRIPT_MODES,
    VIDEO_ID_RE,
    YoutubeError,
    cache_dir,
    extract_video_id,
    load_meta,
    load_transcript,
    parse_video,
)

router = APIRouter(prefix="/api", tags=["youtube"])


class ParseRequest(BaseModel):
    model_config = {"populate_by_name": True, "extra": "ignore"}

    url: str
    mode: str = "auto"
    forceRefresh: bool = False


def _validate_video_id(video_id: str) -> None:
    if not VIDEO_ID_RE.fullmatch(video_id or ""):
        raise HTTPException(404, "Видео не найдено")


@router.post("/youtube/parse")
async def parse_youtube(payload: ParseRequest) -> dict[str, Any]:
    """Парсит ссылку: метаданные, превью и транскрипт — всё в локальный кэш.

    Режимы: ``auto`` (ручные субтитры → автосубтитры → Whisper), ``whisper``
    (локальный large-v3-turbo, CPU int8), ``diarize`` (+разметка спикеров).
    """
    if not extract_video_id(payload.url):
        raise HTTPException(
            400,
            "Ожидается ссылка YouTube/Shorts: youtube.com/watch?v=…, youtu.be/… "
            "или youtube.com/shorts/…",
        )
    mode = (payload.mode or "auto").strip().lower()
    if mode not in TRANSCRIPT_MODES:
        raise HTTPException(400, f"mode должен быть одним из: {', '.join(TRANSCRIPT_MODES)}")
    try:
        return await run_in_threadpool(parse_video, payload.url, mode, payload.forceRefresh)
    except YoutubeError as exc:
        raise HTTPException(exc.status_code, exc.message) from exc


@router.get("/youtube/{video_id}")
def get_cached_video(video_id: str) -> dict[str, Any]:
    """Кэшированные метаданные и транскрипт ролика (без сетевых запросов)."""
    _validate_video_id(video_id)
    meta = load_meta(video_id)
    transcript = load_transcript(video_id)
    if meta is None and transcript is None:
        raise HTTPException(404, "Видео ещё не разобрано — вызовите /api/youtube/parse")
    thumb = cache_dir(video_id) / "thumb.jpg"
    if transcript:
        transcript = {
            **transcript,
            "segmentsCount": len(transcript.get("segments") or []),
        }
    return {
        "videoId": video_id,
        "meta": meta,
        "transcript": transcript,
        "thumbUrl": f"/api/youtube/{video_id}/thumb" if thumb.is_file() else None,
    }


@router.get("/youtube/{video_id}/thumb")
def get_cached_thumb(video_id: str) -> FileResponse:
    """Локальная копия превью ``thumb.jpg`` — работает даже без доступа к YouTube."""
    _validate_video_id(video_id)
    path = cache_dir(video_id) / "thumb.jpg"
    if not path.is_file():
        raise HTTPException(404, "Превью не сохранено")
    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=86400"},
    )

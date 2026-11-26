"""API YouTube/Shorts парсера: метаданные, превью, транскрипты и кадры.

Парсинг и нарезка кадров (сеть) — только по явным POST-эндпоинтам; GET-эндпоинты
отдают исключительно локальный кэш ``data/youtube_cache/``.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..youtube_service import (
    DEFAULT_MAX_FRAMES,
    DEFAULT_MIN_INTERVAL_SEC,
    MAX_FRAME_UPLOAD_BYTES,
    TRANSCRIPT_MODES,
    VIDEO_ID_RE,
    YoutubeError,
    add_frame_from_bytes,
    cache_dir,
    capture_frame_at,
    delete_frame,
    extract_smart_frames,
    extract_video_id,
    frame_path,
    load_frames,
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


class ExtractFramesRequest(BaseModel):
    model_config = {"populate_by_name": True, "extra": "ignore"}

    max_frames: int = DEFAULT_MAX_FRAMES
    min_interval_sec: float = DEFAULT_MIN_INTERVAL_SEC


class CaptureFrameRequest(BaseModel):
    model_config = {"populate_by_name": True, "extra": "ignore"}

    timestamp_sec: float


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
    frames_record = load_frames(video_id)
    return {
        "videoId": video_id,
        "meta": meta,
        "transcript": transcript,
        "thumbUrl": f"/api/youtube/{video_id}/thumb" if thumb.is_file() else None,
        "frames": frames_record["frames"],
        "framesTokenCount": frames_record["tokenCount"],
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


# ---------------------------------------------------------------------------
# Кадры: умная нарезка, вырезка по таймкоду, ручная загрузка/удаление
# ---------------------------------------------------------------------------


@router.post("/youtube/{video_id}/extract-frames")
async def extract_frames(video_id: str, payload: ExtractFramesRequest) -> dict[str, Any]:
    """Умная автоматическая нарезка кадров ролика (сеть: yt-dlp mp4 ≤720p, 15 с).

    OpenCV считает смену сцены (разница гистограмм) и «информативность» (Canny
    edge density — приоритет скринкастам/таблицам/коду/субтитрам). Отбираются не
    более ``max_frames`` (4..20, по умолчанию 10) лучших кадра с дистанцией не
    меньше ``min_interval_sec`` (по умолчанию 4 с — защита от «СДВГ-монтажа»).
    Ручные (``manual``) кадры сохраняются, старые ``auto`` заменяются.
    """
    _validate_video_id(video_id)
    try:
        return await run_in_threadpool(
            extract_smart_frames, video_id, payload.max_frames, payload.min_interval_sec
        )
    except YoutubeError as exc:
        raise HTTPException(exc.status_code, exc.message) from exc


@router.post("/youtube/{video_id}/capture-frame")
async def capture_frame(video_id: str, payload: CaptureFrameRequest) -> dict[str, Any]:
    """Вырезает один точный кадр на отметке ``timestamp_sec`` (секунда из плеера):
    прямая ссылка потока через yt-dlp + ``ffmpeg -ss``; кадр добавляется в
    ``frames.json`` с сортировкой по времени (``source: manual``)."""
    _validate_video_id(video_id)
    try:
        return await run_in_threadpool(capture_frame_at, video_id, payload.timestamp_sec)
    except YoutubeError as exc:
        raise HTTPException(exc.status_code, exc.message) from exc


@router.post("/youtube/{video_id}/upload-frame")
async def upload_frame(
    video_id: str,
    file: UploadFile = File(...),
    timestamp_sec: float = Form(...),
) -> dict[str, Any]:
    """Загружает свой скриншот кадра (файл изображения) с привязкой к
    ``timestamp_sec``; вставляется в ``frames.json`` по времени (``manual``)."""
    _validate_video_id(video_id)
    data = await file.read()
    if len(data) > MAX_FRAME_UPLOAD_BYTES:
        raise HTTPException(413, "Изображение слишком большое (максимум 12 МБ)")
    try:
        frame = await run_in_threadpool(add_frame_from_bytes, video_id, data, timestamp_sec)
    except YoutubeError as exc:
        raise HTTPException(exc.status_code, exc.message) from exc
    record = load_frames(video_id)
    return {
        "ok": True,
        "videoId": video_id,
        "frame": frame,
        "frames": record["frames"],
        "tokenCount": record["tokenCount"],
    }


@router.delete("/youtube/{video_id}/frames/{frame_id}")
def remove_frame(video_id: str, frame_id: str) -> dict[str, Any]:
    """Удаляет любой кадр (auto/manual) по ``frame_id`` — запись и JPEG-файл."""
    _validate_video_id(video_id)
    try:
        return delete_frame(video_id, frame_id)
    except YoutubeError as exc:
        raise HTTPException(exc.status_code, exc.message) from exc


@router.get("/youtube/{video_id}/frames/{filename}")
def get_frame_image(video_id: str, filename: str) -> FileResponse:
    """Отдаёт JPEG кадра из локального кэша ``frames/`` (без сетевых запросов)."""
    _validate_video_id(video_id)
    path = frame_path(video_id, filename)
    if path is None:
        raise HTTPException(404, "Кадр не найден")
    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=86400"},
    )

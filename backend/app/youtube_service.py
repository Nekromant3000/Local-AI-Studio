"""YouTube/Shorts parser: метаданные, превью, субтитры и локальный Whisper.

Весь ролик живёт в ``data/youtube_cache/{videoId}/``: ``meta.json``
(title/channel/duration/thumbnail), локальная копия ``thumb.jpg`` (превью
открывается в UI даже без доступа к YouTube) и ``transcript.json``
(готовый текст + количество токенов).

Режимы расшифровки (``mode``):
  * ``auto``     — сначала ручные субтитры ``youtube-transcript-api`` (ru, en),
                   нет ручных — автосубтитры с таймкодами ``[MM:SS] текст``;
                   если субтитров нет вообще — локальный Whisper.
  * ``whisper``  — аудио через yt-dlp (только аудиодорожка, временный файл) →
                   faster-whisper ``large-v3-turbo`` (CPU, int8, без VRAM),
                   строки ``[MM:SS] текст``.
  * ``diarize``  — тот же Whisper + разметка участников диалога
                   ``[MM:SS] [Спикер N]: текст`` по паузам и смене акустических
                   признаков сегментов (эвристика, без pyannote-моделей).

Сетевые запросы: короткий таймаут (15 с), НОЛЬ повторных попыток — при таймауте/
блокировке сразу поднимаем ``YoutubeNetworkError`` с подсказкой про VPN.

ВАЖНО: контекст чата использует только уже готовый кэш. Старые YouTube-ссылки
никогда не скачиваются автоматически — парсинг только по явному
``POST /api/youtube/parse``. Структура GAS-JSON чатов при этом не меняется.
"""

from __future__ import annotations

import io
import json
import logging
import re
import tempfile
import threading
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx

from .config import YOUTUBE_CACHE_DIR
from .tokens import count_tokens
from .url_context import USER_AGENT, extract_urls
from .utils import atomic_write_json, utc_now_iso

logger = logging.getLogger(__name__)

NETWORK_TIMEOUT = 15.0
TRANSCRIPT_MODES = ("auto", "whisper", "diarize")
WHISPER_MODEL = "large-v3-turbo"
PREFERRED_LANGS = ("ru", "en")
MAX_VIDEOS_IN_CONTEXT = 6
MAX_TRANSCRIPT_CHARS = 60_000
MAX_STORED_SEGMENTS = 4000

VIDEO_ID_RE = re.compile(r"[0-9A-Za-z_-]{11}")

YOUTUBE_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "gaming.youtube.com",
    "youtu.be",
    "www.youtu.be",
}


class YoutubeError(RuntimeError):
    """Понятная пользователю ошибка парсера (4xx по умолчанию)."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class YoutubeNetworkError(YoutubeError):
    """Нет сетевого доступа к YouTube/Hugging Face (таймаут, блокировка, бот-проверка)."""

    def __init__(self, message: str):
        super().__init__(
            f"{message}. Нет доступа к YouTube / Hugging Face — включите VPN и повторите",
            504,
        )


# Ключевые слова сетевых сбоев и блокировок YouTube (без повторных попыток).
_NETWORK_MARKERS = (
    "timeout",
    "timed out",
    "connection",
    "connect",
    "getaddrinfo",
    "name resolution",
    "unreachable",
    "proxy",
    "ssl",
    "reset by peer",
    "remote end closed",
    "network",
    "unable to download webpage",
)
_BLOCK_MARKERS = (
    "not a bot",
    "sign in to confirm",
    "http error 403",
    "http error 429",
    "captcha",
    "ip blocked",
    "too many requests",
    "request blocked",
)


def _wrap_network_error(exc: Exception, what: str) -> YoutubeError:
    text = f"{type(exc).__name__} {exc}".lower()
    if any(marker in text for marker in _NETWORK_MARKERS) or any(
        marker in text for marker in _BLOCK_MARKERS
    ):
        return YoutubeNetworkError(f"Сетевой доступ к «{what}» недоступен")
    return YoutubeError(f"{what}: {exc}", 502)


# ---------------------------------------------------------------------------
# Ссылки → video id
# ---------------------------------------------------------------------------


def extract_video_id(url: str) -> str | None:
    """Достаёт 11-символьный id из любого формата ссылок YouTube/Shorts.

    Поддерживает ``watch?v=``, ``youtu.be/``, ``shorts/``, ``embed/``,
    ``live/``, ``v/`` (с www/m/music поддоменами), а также голый id.
    """
    raw = (url or "").strip().rstrip(")]}.,;:!?…«»\"'–—-")
    if not raw:
        return None
    if VIDEO_ID_RE.fullmatch(raw):
        return raw
    candidate = raw if "//" in raw else f"https://{raw}"
    try:
        parsed = urlparse(candidate)
    except ValueError:
        return None
    host = (parsed.netloc or "").lower().partition(":")[0]
    if host not in YOUTUBE_HOSTS:
        return None
    parts = [part for part in (parsed.path or "").split("/") if part]

    video_id = ""
    if host in ("youtu.be", "www.youtu.be"):
        video_id = parts[0] if parts else ""
    elif parts and parts[0] == "watch":
        video_id = (parse_qs(parsed.query).get("v") or [""])[0]
    elif len(parts) >= 2 and parts[0] in ("shorts", "embed", "live", "v"):
        video_id = parts[1]
    elif parts and parts[0] == "attribution":
        video_id = (parse_qs(parsed.query).get("v") or [""])[0]

    if VIDEO_ID_RE.fullmatch(video_id):
        return video_id
    return None


def is_youtube_url(url: str) -> bool:
    return extract_video_id(url) is not None


def watch_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def format_timestamp(seconds: float) -> str:
    total = max(0, int(seconds))
    return f"{total // 60:02d}:{total % 60:02d}"


def format_duration(seconds: int) -> str:
    if not seconds:
        return ""
    hours, rest = divmod(int(seconds), 3600)
    minutes, secs = divmod(rest, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


# ---------------------------------------------------------------------------
# Кэш data/youtube_cache/{video_id}/
# ---------------------------------------------------------------------------


def cache_dir(video_id: str) -> Path:
    if not video_id or not VIDEO_ID_RE.fullmatch(video_id):
        raise YoutubeError("Некорректный id видео")
    folder = YOUTUBE_CACHE_DIR / video_id
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _load_cached_json(video_id: str, filename: str) -> dict[str, Any] | None:
    if not video_id or not VIDEO_ID_RE.fullmatch(video_id):
        return None
    path = YOUTUBE_CACHE_DIR / video_id / filename
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def load_meta(video_id: str) -> dict[str, Any] | None:
    return _load_cached_json(video_id, "meta.json")


def load_transcript(video_id: str) -> dict[str, Any] | None:
    return _load_cached_json(video_id, "transcript.json")


def has_cached_transcript(video_id: str) -> bool:
    record = load_transcript(video_id)
    return bool(record and (record.get("text") or "").strip())


# ---------------------------------------------------------------------------
# Метаданные + превью (yt-dlp без скачивания видео)
# ---------------------------------------------------------------------------


def _ytdlp_base_options() -> dict[str, Any]:
    """Общие опции yt-dlp: таймаут 15 с, ноль ретраев (см. правило сети)."""
    return {
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": NETWORK_TIMEOUT,
        "retries": 0,
        "extractor_retries": 0,
        "fragment_retries": 0,
        "noplaylist": True,
    }


def _download_thumb(url: str, target: Path) -> None:
    """Локальная копия превью (jpeg) — UI рисует карточку даже без YouTube."""
    with httpx.Client(
        timeout=NETWORK_TIMEOUT,
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT, "Accept-Language": "ru,en;q=0.8"},
    ) as client:
        response = client.get(url)
        response.raise_for_status()
        payload = response.content
    if not payload:
        raise YoutubeError("Пустое превью", 502)
    try:
        from PIL import Image

        with Image.open(io.BytesIO(payload)) as image:
            image.convert("RGB").save(target, format="JPEG", quality=85)
    except Exception:  # noqa: BLE001 — сохраняем как есть, если Pillow не смог
        target.write_bytes(payload)


def get_meta(video_id: str, force_refresh: bool = False) -> dict[str, Any]:
    """Метаданные ролика через yt-dlp (без скачивания) + ``thumb.jpg`` в кэш."""
    folder = cache_dir(video_id)
    meta_path = folder / "meta.json"
    if not force_refresh:
        cached = load_meta(video_id)
        if cached:
            return cached

    import yt_dlp

    try:
        with yt_dlp.YoutubeDL(_ytdlp_base_options() | {"skip_download": True}) as ydl:
            info = ydl.extract_info(watch_url(video_id), download=False)
    except YoutubeError:
        raise
    except Exception as exc:  # noqa: BLE001 — классифицируем и поднимаем сразу
        raise _wrap_network_error(exc, "YouTube (yt-dlp)") from exc

    if isinstance(info, dict) and info.get("_type") == "playlist":
        entries = [entry for entry in (info.get("entries") or []) if isinstance(entry, dict)]
        info = entries[0] if entries else {}
    info = info or {}

    duration = int(info.get("duration") or 0)
    meta: dict[str, Any] = {
        "videoId": video_id,
        "url": watch_url(video_id),
        "title": str(info.get("title") or "")[:300],
        "channel": str(info.get("channel") or info.get("uploader") or "")[:200],
        "duration": duration,
        "durationLabel": format_duration(duration),
        "isShort": 0 < duration <= 60,
        "thumbnail": str(info.get("thumbnail") or ""),
        "viewCount": int(info.get("view_count") or 0) or None,
        "uploadDate": str(info.get("upload_date") or ""),
        "fetchedAt": utc_now_iso(),
    }

    thumb_path = folder / "thumb.jpg"
    if meta["thumbnail"]:
        try:
            _download_thumb(meta["thumbnail"], thumb_path)
            meta["thumbUrl"] = f"/api/youtube/{video_id}/thumb"
        except Exception as exc:  # noqa: BLE001 — превью не должно ломать парсинг
            logger.warning("YouTube %s: превью не сохранено: %s", video_id, exc)

    atomic_write_json(meta_path, meta)
    return meta


# ---------------------------------------------------------------------------
# Субтитры через youtube-transcript-api
# ---------------------------------------------------------------------------

_NOT_AVAILABLE_ERRORS = {
    "TranscriptsDisabled",
    "NoTranscriptFound",
    "VideoUnavailable",
    "VideoUnplayable",
    "AgeRestricted",
    "VideoRemoved",
    "PrivateVideo",
}
_BLOCKED_ERRORS = {"RequestBlocked", "IpBlocked", "TooManyRequests"}


def _classify_transcript_error(exc: Exception) -> YoutubeError:
    name = type(exc).__name__
    if name in _NOT_AVAILABLE_ERRORS:
        return YoutubeError(f"Субтитры к видео недоступны ({name})", 422)
    if name in _BLOCKED_ERRORS:
        return YoutubeNetworkError(f"YouTube заблокировал запрос ({name})")
    return _wrap_network_error(exc, "YouTube (субтитры)")


def _segment_fields(seg: Any) -> tuple[float, float, str]:
    """Нормализует сегменты нового/старого API youtube-transcript-api."""
    if isinstance(seg, dict):
        return (
            float(seg.get("start") or 0.0),
            float(seg.get("duration") or 0.0),
            str(seg.get("text") or "").strip(),
        )
    return (
        float(getattr(seg, "start", 0.0) or 0.0),
        float(getattr(seg, "duration", 0.0) or 0.0),
        str(getattr(seg, "text", "") or "").strip(),
    )


def _fetch_subtitles(video_id: str) -> dict[str, Any] | None:
    """Ручные субтитры (ru/en), иначе автосубтитры. None — субтитров нет.

    Результат: {language, kind: manual-subtitles|auto-subtitles, segments}.
    """
    from youtube_transcript_api import YouTubeTranscriptApi

    try:
        api = YouTubeTranscriptApi()
        if hasattr(api, "list"):  # API 1.x
            listing = api.list(video_id)
        else:  # легаси API 0.6.x
            listing = YouTubeTranscriptApi.list_transcripts(video_id)
    except ImportError as exc:
        raise YoutubeError("youtube-transcript-api не установлен", 500) from exc
    except Exception as exc:  # noqa: BLE001
        raise _classify_transcript_error(exc) from exc

    manual: list[Any] = []
    generated: list[Any] = []
    try:
        for item in listing:
            (generated if getattr(item, "is_generated", False) else manual).append(item)
    except Exception as exc:  # noqa: BLE001
        raise _classify_transcript_error(exc) from exc

    def pick(pool: list[Any]) -> Any:
        for lang in PREFERRED_LANGS:
            for item in pool:
                code = str(getattr(item, "language_code", "") or "").lower()
                if code.startswith(lang):
                    return item
        return pool[0] if pool else None

    chosen = pick(manual)
    kind = "manual-subtitles"
    if chosen is None:
        chosen = pick(generated)
        kind = "auto-subtitles"
    if chosen is None:
        return None

    try:
        fetched = chosen.fetch()
    except Exception as exc:  # noqa: BLE001
        raise _classify_transcript_error(exc) from exc

    segments: list[dict[str, Any]] = []
    for raw_seg in fetched:
        start, duration, text = _segment_fields(raw_seg)
        if text:
            segments.append({"start": start, "end": start + duration, "text": text})
    if not segments:
        return None
    return {
        "language": str(getattr(chosen, "language_code", "") or ""),
        "kind": kind,
        "segments": segments,
    }


# ---------------------------------------------------------------------------
# Локальный Whisper (faster-whisper, CPU int8 — без VRAM)
# ---------------------------------------------------------------------------

_whisper_model: Any = None
_whisper_lock = threading.Lock()


def _ensure_av_compat() -> None:
    """faster-whisper 1.2.1 передаёт в ``av.open`` kwarg ``metadata_errors``,
    которого нет в PyAV >= 15 (а av 14 не собирается под Python 3.14). Обёртка
    убирает неподдерживаемый kwarg при TypeError — аргументы bindings'а падают
    мгновенно, до открытия файла, повторный вызов безопасен."""
    import av

    if getattr(av.open, "_lai_av_compat", False):
        return
    original_open = av.open

    def open_compat(*args: Any, **kwargs: Any):
        try:
            return original_open(*args, **kwargs)
        except TypeError as exc:
            if "metadata_errors" not in str(exc):
                raise
            kwargs.pop("metadata_errors", None)
            return original_open(*args, **kwargs)

    open_compat._lai_av_compat = True
    av.open = open_compat


def _get_whisper_model() -> Any:
    global _whisper_model
    if _whisper_model is not None:
        return _whisper_model
    with _whisper_lock:
        if _whisper_model is None:
            try:
                from faster_whisper import WhisperModel

                logger.info("Whisper: загружаю %s (CPU, int8)…", WHISPER_MODEL)
                _whisper_model = WhisperModel(
                    WHISPER_MODEL, device="cpu", compute_type="int8"
                )
            except ImportError as exc:
                raise YoutubeError("faster-whisper не установлен", 500) from exc
            except Exception as exc:  # noqa: BLE001 — HF-весы качаются по сети
                raise _wrap_network_error(
                    exc, "загрузка модели Whisper с Hugging Face"
                ) from exc
    return _whisper_model


def _download_audio(video_id: str, temp_dir: Path) -> Path:
    """Скачивает только аудиодорожку во временный файл (yt-dlp, 0 ретраев)."""
    import yt_dlp

    options = _ytdlp_base_options() | {
        "skip_download": False,
        "format": "bestaudio[ext=m4a]/bestaudio/best",
        "outtmpl": str(temp_dir / "audio.%(ext)s"),
        "nocheckcertificate": False,
    }
    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            ydl.extract_info(watch_url(video_id), download=True)
    except YoutubeError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _wrap_network_error(exc, "YouTube (скачивание аудио)") from exc

    files = [path for path in temp_dir.glob("audio.*") if path.is_file()]
    if not files:
        raise YoutubeError("Не удалось скачать аудиодорожку ролика", 502)
    return max(files, key=lambda path: path.stat().st_size)


def assign_speakers(segments: list[dict[str, Any]]) -> None:
    """Эвристическая диаризация: смена спикера по длинным паузам и сдвигам
    акустических признаков сегментов (avg_logprob). Индекс в ``seg["speaker"]``."""
    speaker = 1
    previous_end: float | None = None
    previous_logprob: float | None = None
    for segment in segments:
        switched = False
        if previous_end is not None:
            gap = segment["start"] - previous_end
            logprob = segment.get("avgLogProb")
            # длинная пауза — почти наверняка смена говорящего;
            # короткая пауза + заметный сдвиг акустических признаков — вероятно тоже
            if gap >= 1.5:
                switched = True
            elif (
                gap >= 0.6
                and logprob is not None
                and previous_logprob is not None
                and abs(logprob - previous_logprob) >= 0.9
            ):
                switched = True
        if switched:
            speaker = min(speaker + 1, 8)  # максимум 8 участников
        segment["speaker"] = speaker
        previous_end = segment["end"]
        previous_logprob = segment.get("avgLogProb")


def _transcribe_with_whisper(video_id: str, diarize: bool) -> dict[str, Any]:
    """Whisper large-v3-turbo (CPU int8): аудио во временный файл → текст.

    Режим ``diarize`` дополнительно размечает реплики ``[Спикер N]``."""
    with tempfile.TemporaryDirectory(prefix="lai-yt-audio-") as raw_dir:
        temp_dir = Path(raw_dir)
        audio_path = _download_audio(video_id, temp_dir)
        model = _get_whisper_model()
        _ensure_av_compat()
        try:
            segment_iter, info = model.transcribe(
                str(audio_path), vad_filter=True, beam_size=5
            )
            raw_segments: list[dict[str, Any]] = []
            for seg in segment_iter:
                text = str(getattr(seg, "text", "") or "").strip()
                if not text:
                    continue
                raw_segments.append(
                    {
                        "start": float(seg.start),
                        "end": float(seg.end),
                        "text": text,
                        "avgLogProb": (
                            float(seg.avg_logprob)
                            if getattr(seg, "avg_logprob", None) is not None
                            else None
                        ),
                    }
                )
        except YoutubeError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise YoutubeError(f"Whisper не смог расшифровать аудио: {exc}", 502) from exc

    if diarize:
        assign_speakers(raw_segments)
        lines = [
            f"[{format_timestamp(seg['start'])}] [Спикер {seg['speaker']}]: {seg['text']}"
            for seg in raw_segments
        ]
    else:
        lines = [
            f"[{format_timestamp(seg['start'])}] {seg['text']}" for seg in raw_segments
        ]
    text = "\n".join(lines)
    duration = int(raw_segments[-1]["end"]) if raw_segments else 0
    return {
        "videoId": video_id,
        "mode": "diarize" if diarize else "whisper",
        "source": "whisper",
        "model": WHISPER_MODEL,
        "device": "cpu/int8",
        "language": str(getattr(info, "language", "") or ""),
        "languageProbability": round(float(getattr(info, "language_probability", 0.0)), 3),
        "duration": duration,
        "createdAt": utc_now_iso(),
        "text": text,
        "tokenCount": count_tokens(text),
        "segments": raw_segments[:MAX_STORED_SEGMENTS],
    }


# ---------------------------------------------------------------------------
# Транскрипт: кэш + три режима
# ---------------------------------------------------------------------------


def _subtitle_record(video_id: str, subs: dict[str, Any], mode: str) -> dict[str, Any]:
    segments = subs["segments"]
    lines = [
        f"[{format_timestamp(seg['start'])}] {seg['text']}" for seg in segments
    ]
    text = "\n".join(lines)
    return {
        "videoId": video_id,
        "mode": mode,
        "source": subs["kind"],
        "language": subs["language"],
        "duration": int(segments[-1]["end"]) if segments else 0,
        "createdAt": utc_now_iso(),
        "text": text,
        "tokenCount": count_tokens(text),
        "segments": segments[:MAX_STORED_SEGMENTS],
    }


def get_transcript(video_id: str, mode: str = "auto", force_refresh: bool = False) -> dict[str, Any]:
    """Готовый транскрипт из кэша или новый (с сохранением в ``transcript.json``)."""
    if mode not in TRANSCRIPT_MODES:
        raise YoutubeError("mode: auto | whisper | diarize", 400)
    cached = load_transcript(video_id)
    if cached and cached.get("mode") == mode and not force_refresh:
        return cached

    record: dict[str, Any] | None = None
    if mode == "auto":
        try:
            subs = _fetch_subtitles(video_id)
        except YoutubeError as exc:
            # субтитров нет вообще — авто-режим уходит в локальный Whisper;
            # сетевые ошибки YouTube поднимаем сразу (без зацикливания)
            if isinstance(exc, YoutubeNetworkError) or exc.status_code != 422:
                raise
            subs = None
        if subs:
            record = _subtitle_record(video_id, subs, mode="auto")
        else:
            record = _transcribe_with_whisper(video_id, diarize=False)
            record["mode"] = "auto"
            record["sourceNote"] = "Субтитры не найдены — использован локальный Whisper"
    else:
        record = _transcribe_with_whisper(video_id, diarize=(mode == "diarize"))

    folder = cache_dir(video_id)
    atomic_write_json(folder / "transcript.json", record)
    return record


def _transcript_summary(record: dict[str, Any]) -> dict[str, Any]:
    """Ответ парсера: поля + первые строки; полный текст — через GET кэша."""
    text = str(record.get("text") or "")
    summary = {
        key: record.get(key)
        for key in (
            "mode",
            "source",
            "sourceNote",
            "model",
            "language",
            "duration",
            "tokenCount",
            "createdAt",
        )
        if record.get(key) is not None
    }
    summary["textLength"] = len(text)
    summary["preview"] = text[:600]
    return summary


def parse_video(url: str, mode: str = "auto", force_refresh: bool = False) -> dict[str, Any]:
    """Полный цикл: метаданные + превью + транскрипт, всё в кэш."""
    video_id = extract_video_id(url)
    if not video_id:
        raise YoutubeError(
            "Ожидается ссылка YouTube/Shorts: youtube.com/watch?v=…, youtu.be/… или youtube.com/shorts/…",
            400,
        )
    meta = get_meta(video_id, force_refresh)
    transcript = get_transcript(video_id, mode, force_refresh)
    return {
        "ok": True,
        "videoId": video_id,
        "meta": meta,
        "transcript": _transcript_summary(transcript),
    }


# ---------------------------------------------------------------------------
# Интеграция с контекстом чата (только чтение кэша, НИКОГДА не качает)
# ---------------------------------------------------------------------------


def _is_thought_chunk(chunk: dict[str, Any]) -> bool:
    if chunk.get("isThought"):
        return True
    parts = chunk.get("parts")
    return bool(parts) and isinstance(parts, list) and all(
        isinstance(part, dict) and part.get("thought") for part in parts
    )


def iter_chat_video_ids(raw: dict[str, Any]) -> list[str]:
    """YouTube-видео из пользовательских сообщений чата.

    Источники: слот ``youtubeVideo``, обычный текст с ссылками и легаси GAS
    ``fileData.fileUri``. Только разбор текста — файлы чата не меняются.
    """
    chunks = raw.get("chunkedPrompt", {}).get("chunks") or []
    seen: set[str] = set()
    ordered: list[str] = []

    def add(video_id: str | None) -> None:
        if video_id and video_id not in seen:
            seen.add(video_id)
            ordered.append(video_id)

    for chunk in chunks:
        if not isinstance(chunk, dict) or chunk.get("role") != "user":
            continue
        if _is_thought_chunk(chunk):
            continue
        slot = chunk.get("youtubeVideo")
        if isinstance(slot, dict):
            video = str(slot.get("id") or "")
            add(video if VIDEO_ID_RE.fullmatch(video) else extract_video_id(video))
        file_data = chunk.get("fileData")
        if isinstance(file_data, dict):
            add(extract_video_id(str(file_data.get("fileUri") or "")))
        texts = [str(chunk.get("text") or "")]
        parts = chunk.get("parts")
        if isinstance(parts, list):
            for part in parts:
                if isinstance(part, dict) and not part.get("thought"):
                    texts.append(str(part.get("text") or ""))
        for text in texts:
            for normalized in extract_urls(text):
                add(extract_video_id(normalized))
    return ordered


def gather_youtube_context(
    raw: dict[str, Any], max_videos: int = MAX_VIDEOS_IN_CONTEXT
) -> list[dict[str, Any]]:
    """КЭШИРОВАННЫЕ транскрипты видео из чата. Сетевых запросов не делает никогда."""
    records: list[dict[str, Any]] = []
    for video_id in iter_chat_video_ids(raw):
        if len(records) >= max_videos:
            break
        transcript = load_transcript(video_id)
        text = str((transcript or {}).get("text") or "").strip()
        if not text:
            continue
        meta = load_meta(video_id) or {}
        records.append(
            {
                "videoId": video_id,
                "url": watch_url(video_id),
                "title": str(meta.get("title") or video_id),
                "channel": str(meta.get("channel") or ""),
                "duration": int(meta.get("duration") or transcript.get("duration") or 0),
                "mode": str(transcript.get("mode") or ""),
                "source": str(transcript.get("source") or ""),
                "text": text,
                "tokenCount": int(transcript.get("tokenCount") or count_tokens(text)),
            }
        )
    return records


def build_youtube_context_blocks(records: list[dict[str, Any]]) -> list[str]:
    """Блоки транскриптов для runtime-инъекции в контекст модели."""
    blocks: list[str] = []
    for record in records:
        text = str(record.get("text") or "").strip()
        if not text:
            continue
        if len(text) > MAX_TRANSCRIPT_CHARS:
            text = text[:MAX_TRANSCRIPT_CHARS] + "\n\n[…транскрипт обрезан…]"
        header = f"Транскрипт видео «{record.get('title') or record.get('videoId')}» ({record.get('url')})"
        channel = str(record.get("channel") or "").strip()
        if channel:
            header += f", канал {channel}"
        blocks.append(f"{header}:\n```\n{text}\n```")
    return blocks

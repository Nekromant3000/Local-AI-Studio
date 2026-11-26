"""URL Context: скачивание страниц, извлечение текста, кэш и учёт в контексте.

Ссылки остаются в JSON чата как обычный текст (GAS-совместимость): в кэш и в
контекст модели уходит только извлечённый текст, привязанный к id ссылки.
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any
from urllib.parse import urldefrag, urlparse

import httpx
import trafilatura

from .config import CHAT_META_DIR, URL_CACHE_DIR
from .utils import atomic_write_json, sha1_hex

logger = logging.getLogger(__name__)

MAX_URLS_PER_CHAT = 12
MAX_URL_TEXT_CHARS = 20000
FETCH_TIMEOUT_SECONDS = 20.0
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# https://... , www.example.com/a , example.com/a (только с / или ? или #)
_URL_RE = re.compile(
    r"(?:https?://[^\s<>\[\]()\"']+"
    r"|www\.[^\s<>\[\]()\"']+\.[^\s<>\[\]()\"']*"
    r"|[a-z0-9][a-z0-9\-]*(?:\.[a-z0-9][a-z0-9\-]*)+\.[a-z]{2,}/[^\s<>\[\]()\"']*)",
    re.IGNORECASE,
)

_TRAILING_PUNCT = ")]}.,;:!?…«»\"'–—-"


def normalize_url(url: str) -> str:
    """Канонический вид ссылки: https по умолчанию, без фрагмента и хвостовой пунктуации."""
    candidate = (url or "").strip().rstrip(_TRAILING_PUNCT)
    if not candidate:
        return ""
    if not re.match(r"^https?://", candidate, re.IGNORECASE):
        candidate = "https://" + candidate
    try:
        parsed = urldefrag(candidate)
        parts = urlparse(parsed[0])
    except ValueError:
        return ""
    if not parts.netloc or "." not in parts.netloc:
        return ""
    path = parts.path or "/"
    normalized = parts._replace(scheme="https", netloc=parts.netloc.lower(), path=path, params="", query=parts.query, fragment="")
    return normalized.geturl()


def url_id(normalized: str) -> str:
    return sha1_hex(normalized)


def extract_urls(text: str) -> list[str]:
    """Находит и нормализует http/www-ссылки в тексте сообщения."""
    found: list[str] = []
    seen: set[str] = set()
    for match in _URL_RE.finditer(text or ""):
        normalized = normalize_url(match.group(0))
        if normalized and normalized not in seen:
            seen.add(normalized)
            found.append(normalized)
    return found


def _chat_urls_filename(chat_name: str) -> str:
    return sha1_hex(chat_name)[:24] + ".json"


def load_chat_meta(chat_name: str) -> dict[str, Any]:
    path = CHAT_META_DIR / _chat_urls_filename(chat_name)
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
        except (OSError, json.JSONDecodeError):
            pass
    return {"excludedUrlIds": []}


def save_chat_meta(chat_name: str, meta: dict[str, Any]) -> None:
    CHAT_META_DIR.mkdir(parents=True, exist_ok=True)
    atomic_write_json(CHAT_META_DIR / _chat_urls_filename(chat_name), meta)


def set_url_excluded(chat_name: str, target_id: str, excluded: bool) -> list[str]:
    meta = load_chat_meta(chat_name)
    excluded_ids = [str(x) for x in meta.get("excludedUrlIds") or []]
    if excluded:
        if target_id not in excluded_ids:
            excluded_ids.append(target_id)
    else:
        excluded_ids = [x for x in excluded_ids if x != target_id]
    meta["excludedUrlIds"] = excluded_ids
    save_chat_meta(chat_name, meta)
    return excluded_ids


def _cache_path(target_id: str):
    return URL_CACHE_DIR / (target_id + ".json")


def load_cached_url(target_id: str) -> dict[str, Any] | None:
    path = _cache_path(target_id)
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
        except (OSError, json.JSONDecodeError):
            pass
    return None


def _fallback_extract(html: str) -> str:
    """Запасной вариант: BeautifulSoup4 + текстовые блоки без script/style."""
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return ""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "header", "footer", "nav"]):
        tag.decompose()
    lines = [line.strip() for line in soup.get_text("\n").splitlines()]
    return "\n".join(line for line in lines if line)


def fetch_url_page(normalized: str, force: bool = False) -> dict[str, Any]:
    """Скачивает страницу, извлекает основной текст и кладёт в кэш.

    Синхронная функция — вызывается из пула потоков (run_in_threadpool).
    """
    target_id = url_id(normalized)
    if not force:
        cached = load_cached_url(target_id)
        if cached is not None:
            return cached

    error: str | None = None
    text = ""
    title = ""
    try:
        with httpx.Client(
            timeout=FETCH_TIMEOUT_SECONDS,
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT, "Accept-Language": "ru,en;q=0.8"},
        ) as client:
            response = client.get(normalized)
            response.raise_for_status()
            html = response.text
    except httpx.HTTPError as exc:
        logger.warning("URL Context: не удалось загрузить %s: %s", normalized, exc)
        html = ""
        error = f"Не удалось загрузить страницу: {exc.__class__.__name__}"

    if html:
        extracted = trafilatura.extract(
            html, include_links=False, include_tables=True, favor_precision=True
        )
        metadata = trafilatura.extract_metadata(html)
        title = (metadata.title or "") if metadata else ""
        if extracted:
            text = extracted
        else:
            text = _fallback_extract(html)

    if not text and not error:
        error = "На странице не найден читаемый текст"

    record: dict[str, Any] = {
        "url": normalized,
        "urlId": target_id,
        "title": (title or "").strip()[:200],
        "domain": urlparse(normalized).netloc,
        "fetchedAt": int(time.time()),
        "text": text[:MAX_URL_TEXT_CHARS],
        "truncated": len(text) > MAX_URL_TEXT_CHARS,
    }
    if error:
        record["error"] = error
        return record  # ошибку не кэшируем

    URL_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    atomic_write_json(_cache_path(target_id), record)
    return record


def _is_thought_chunk(chunk: dict[str, Any]) -> bool:
    if chunk.get("isThought"):
        return True
    parts = chunk.get("parts")
    return bool(parts) and isinstance(parts, list) and all(
        isinstance(part, dict) and part.get("thought") for part in parts
    )


# YouTube-ссылки обслуживает отдельный парсер (app.youtube_service): generic
# загрузка страниц их не трогает — иначе каждое поколение дергал бы youtube.com.
# Хосты дублируются из youtube_service намеренно (там импорт url_context —
# обратный импорт создал бы цикл).
_YOUTUBE_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "gaming.youtube.com",
    "youtu.be",
    "www.youtu.be",
}


def _is_youtube_url(url: str) -> bool:
    host = urlparse(url).netloc.lower().partition(":")[0]
    return host in _YOUTUBE_HOSTS


def urls_in_chat(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Все ссылки из пользовательских сообщений чата (без мыслей модели)."""
    seen: set[str] = set()
    ordered: list[dict[str, Any]] = []
    chunks = data.get("chunkedPrompt", {}).get("chunks") or []
    for chunk in chunks:
        if not isinstance(chunk, dict) or chunk.get("role") != "user":
            continue
        if _is_thought_chunk(chunk):
            continue
        texts = [str(chunk.get("text") or "")]
        parts = chunk.get("parts")
        if isinstance(parts, list):
            for part in parts:
                if isinstance(part, dict) and not part.get("thought"):
                    texts.append(str(part.get("text") or ""))
        for text in texts:
            for normalized in extract_urls(text):
                if normalized not in seen:
                    seen.add(normalized)
                    ordered.append({"url": normalized, "urlId": url_id(normalized)})
    return ordered


def gather_url_context(
    data: dict[str, Any], chat_name: str | None, *, fetch_missing: bool = False
) -> list[dict[str, Any]]:
    """Закешированные тексты ссылок чата без исключённых пользователем.

    fetch_missing=True скачает недостающие страницы (только из пула потоков).
    """
    excluded: set[str] = set()
    if chat_name:
        excluded = {str(x) for x in load_chat_meta(chat_name).get("excludedUrlIds") or []}
    records: list[dict[str, Any]] = []
    for item in urls_in_chat(data):
        if item["urlId"] in excluded:
            continue
        if _is_youtube_url(item["url"]):
            continue  # YouTube обрабатывает youtube_service (только по явному parse)
        if len(records) >= MAX_URLS_PER_CHAT:
            break
        cached = load_cached_url(item["urlId"])
        if cached is None and fetch_missing:
            cached = fetch_url_page(item["url"])
        if cached and cached.get("text"):
            records.append(cached)
    return records


def build_context_blocks(records: list[dict[str, Any]]) -> list[str]:
    """Готовит блоки текста для системного впрыска в контекст модели."""
    blocks: list[str] = []
    for record in records:
        text = str(record.get("text") or "").strip()
        if not text:
            continue
        header = f"Содержимое страницы {record.get('url')}"
        title = str(record.get("title") or "").strip()
        if title:
            header += f" ({title})"
        blocks.append(f"{header}:\n```\n{text}\n```")
    return blocks

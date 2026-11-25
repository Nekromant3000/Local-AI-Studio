"""Read and write Google AI Studio chat JSON files."""

from __future__ import annotations

import gzip
import json
import os
import shutil
import threading
import time
from pathlib import Path
from typing import Any

from .attachments import (
    ATTACHMENT_SLOTS,
    AttachmentError,
    rehydrate_chat,
    sanitize_chat,
)
from .config import (
    BACKUP_DIR,
    CHAT_DIR,
    DEFAULT_CHAT_RUN_SETTINGS,
    chat_local_defaults,
    ensure_dirs,
)
from .tokens import count_tokens
from .utils import (
    InvalidNameError,
    atomic_write_json,
    chat_id_decode,
    chat_id_encode,
    natural_key,
    safe_title,
    utc_now_iso,
)

SKIP_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif", ".tif", ".tiff",
    ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".rtf",
    ".txt", ".md", ".html", ".css", ".js", ".ts", ".jsx", ".tsx", ".py", ".cs",
    ".zip", ".rar", ".7z", ".bin", ".apk", ".mp4", ".webm", ".mov", ".mkv",
    ".json", ".xml", ".csv", ".log", ".tmp", ".db", ".sqlite",
}

_meta_cache: dict[str, tuple[int, int, dict[str, Any]]] = {}
_list_cache: tuple[float, list[dict[str, Any]]] | None = None
_cache_lock = threading.Lock()
_CACHE_TTL = 1.5


class ChatNotFoundError(FileNotFoundError):
    pass


class ChatValidationError(ValueError):
    pass


def _is_gas_chat(data: Any) -> bool:
    if not isinstance(data, dict):
        return False
    chunked = data.get("chunkedPrompt")
    return isinstance(chunked, dict) and isinstance(chunked.get("chunks"), list)


def _read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8-sig") as handle:
        data = json.load(handle)
    if not _is_gas_chat(data):
        raise ChatValidationError(f"{path.name}: это не чат Google AI Studio")
    return data


def _preview(text: str, limit: int = 160) -> str:
    text = (text or "").strip()
    if not text:
        return ""
    text = text.replace("\r", " ")
    text = __import__("re").sub(r"```.*?```", " ", text, flags=__import__("re").S)
    text = __import__("re").sub(r"[#*_>`~\[\]()!|]", " ", text)
    text = __import__("re").sub(r"\s+", " ", text).strip()
    return text[:limit] + ("…" if len(text) > limit else "")


def _chunk_is_thought(chunk: dict[str, Any]) -> bool:
    if chunk.get("isThought"):
        return True
    parts = chunk.get("parts")
    if isinstance(parts, list) and parts:
        return all(isinstance(part, dict) and part.get("thought") for part in parts)
    return False


def _chunk_has_content(chunk: dict[str, Any]) -> bool:
    if str(chunk.get("text") or "").strip():
        return True
    if any(slot in chunk for slot in ATTACHMENT_SLOTS):
        return True
    return any(
        key in chunk
        for key in ("executableCode", "codeExecutionResult", "errorMessage", "grounding", "citations")
    )


def _meta_from_raw(name: str, path: Path, raw: dict[str, Any], mtime_ns: int) -> dict[str, Any]:
    chunks = raw.get("chunkedPrompt", {}).get("chunks", [])
    run_settings = raw.get("runSettings") if isinstance(raw.get("runSettings"), dict) else {}
    local_api = run_settings.get("localApi") if isinstance(run_settings.get("localApi"), dict) else {}
    model = str(local_api.get("model") or run_settings.get("model") or "")
    if model.startswith("models/"):
        model = model[len("models/"):]

    message_count = 0
    thought_count = 0
    attachment_count = 0
    gas_tokens = 0
    preview = ""
    created_at = None
    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        for slot in ATTACHMENT_SLOTS:
            if isinstance(chunk.get(slot), dict):
                attachment_count += 1
        if isinstance(chunk.get("tokenCount"), (int, float)):
            gas_tokens += int(chunk["tokenCount"])
        if created_at is None and chunk.get("createTime"):
            created_at = chunk.get("createTime")
        if _chunk_is_thought(chunk):
            thought_count += 1
            continue
        if chunk.get("role") in ("user", "model") and _chunk_has_content(chunk):
            message_count += 1
            if not preview and chunk.get("text"):
                preview = _preview(str(chunk["text"]))

    system = raw.get("systemInstruction") if isinstance(raw.get("systemInstruction"), dict) else {}
    return {
        "id": chat_id_encode(name),
        "title": name,
        "preview": preview,
        "model": model,
        "messageCount": message_count,
        "thoughtCount": thought_count,
        "attachmentCount": attachment_count,
        "gasTokens": gas_tokens,
        "systemChars": len(str(system.get("text") or "")),
        "createdAt": created_at,
        "updatedAt": __import__("datetime").datetime.fromtimestamp(
            mtime_ns / 1_000_000_000, tz=__import__("datetime").timezone.utc
        ).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "size": path.stat().st_size,
    }


def _scan_chats() -> list[dict[str, Any]]:
    if not CHAT_DIR.is_dir():
        return []
    results: list[dict[str, Any]] = []
    now = time.monotonic()
    with _cache_lock:
        cache = dict(_meta_cache)
    for entry in os.scandir(CHAT_DIR):
        try:
            if not entry.is_file(follow_symlinks=False):
                continue
        except OSError:
            continue
        name = entry.name
        if name.startswith("."):
            continue
        suffix = Path(name).suffix.lower()
        if suffix in SKIP_EXTENSIONS:
            continue
        try:
            stat = entry.stat()
            if stat.st_size < 3:
                continue
            with open(entry.path, "rb") as handle:
                head = handle.read(256).lstrip()
            if not head.startswith(b"{"):
                continue
            cached = cache.get(name)
            if cached and cached[0] == stat.st_mtime_ns and cached[1] == stat.st_size:
                results.append(cached[2])
                continue
            raw = _read_json(Path(entry.path))
            meta = _meta_from_raw(name, Path(entry.path), raw, stat.st_mtime_ns)
            with _cache_lock:
                _meta_cache[name] = (stat.st_mtime_ns, stat.st_size, meta)
            results.append(meta)
        except (OSError, json.JSONDecodeError, ChatValidationError, UnicodeDecodeError):
            continue
    results.sort(key=lambda item: item.get("updatedAt") or "", reverse=True)
    return results


def invalidate_cache(*, full: bool = False) -> None:
    """Сбрасывает кэш списка чатов; ``full=True`` — также кэш метаданных
    (нужно при смене активной папки чатов)."""
    global _list_cache
    with _cache_lock:
        _list_cache = None
        if full:
            _meta_cache.clear()


def list_chats(query: str | None = None, *, force: bool = False) -> list[dict[str, Any]]:
    global _list_cache
    now = time.monotonic()
    with _cache_lock:
        cached = _list_cache
    if force or cached is None or now - cached[0] > _CACHE_TTL:
        chats = _scan_chats()
        with _cache_lock:
            _list_cache = (now, chats)
        cached = _list_cache
    chats = cached[1]
    if query:
        needle = query.casefold().strip()
        if needle:
            chats = [chat for chat in chats if needle in chat["title"].casefold()]
    return chats


def resolve_path(chat_id: str) -> Path:
    name = chat_id_decode(chat_id)
    path = CHAT_DIR / name
    try:
        resolved = path.resolve(strict=True)
    except OSError as exc:
        raise ChatNotFoundError(f"Чат «{name}» не найден") from exc
    if resolved.parent != CHAT_DIR or not resolved.is_file():
        raise ChatNotFoundError(f"Чат «{name}» не найден")
    return resolved


def load_raw(chat_id: str) -> dict[str, Any]:
    path = resolve_path(chat_id)
    try:
        return _read_json(path)
    except json.JSONDecodeError as exc:
        raise ChatValidationError(f"Повреждённый JSON: {exc}") from exc


def revision_for(chat_id: str) -> str:
    path = resolve_path(chat_id)
    stat = path.stat()
    return f"{stat.st_mtime_ns}:{stat.st_size}"


def _summary_by_name(name: str) -> dict[str, Any] | None:
    for chat in list_chats(force=True):
        if chat["title"] == name:
            return chat
    return None


def get_document(chat_id: str) -> dict[str, Any]:
    raw = load_raw(chat_id)
    path = resolve_path(chat_id)
    meta = _summary_by_name(path.name)
    if meta is None:
        stat = path.stat()
        meta = _meta_from_raw(path.name, path, raw, stat.st_mtime_ns)
    return {
        "id": chat_id,
        "title": path.name,
        "revision": revision_for(chat_id),
        "summary": meta,
        "chat": sanitize_chat(raw, chat_id),
    }


def default_chat(settings: dict[str, Any]) -> dict[str, Any]:
    return {
        "runSettings": {
            **DEFAULT_CHAT_RUN_SETTINGS,
            "localApi": chat_local_defaults(settings),
        },
        "systemInstruction": {"text": ""},
        "chunkedPrompt": {
            "chunks": [],
            "pendingInputs": [{"text": "", "role": "user"}],
        },
    }


def create_chat(title: str | None, settings: dict[str, Any]) -> dict[str, Any]:
    ensure_dirs()
    CHAT_DIR.mkdir(parents=True, exist_ok=True)
    base = safe_title(title)
    candidate = base
    counter = 2
    while (CHAT_DIR / candidate).exists():
        candidate = f"{base} ({counter})"
        counter += 1
    path = CHAT_DIR / candidate
    atomic_write_json(path, default_chat(settings))
    invalidate_cache()
    chat_id = chat_id_encode(candidate)
    return get_document(chat_id)


def _backup(path: Path, chat_id: str) -> None:
    try:
        raw = path.read_bytes()
    except OSError:
        return
    folder = BACKUP_DIR / chat_id
    folder.mkdir(parents=True, exist_ok=True)
    stamp = utc_now_iso().replace(":", "-").replace(".", "-")
    target = folder / f"{stamp}.json.gz"
    try:
        with gzip.open(target, "wb", compresslevel=6) as handle:
            handle.write(raw)
    except OSError:
        return
    try:
        backups = sorted(folder.glob("*.json.gz"), key=lambda item: item.name, reverse=True)
        for old in backups[24:]:
            old.unlink(missing_ok=True)
    except OSError:
        pass


def save_document(chat_id: str, incoming_chat: dict[str, Any]) -> dict[str, Any]:
    path = resolve_path(chat_id)
    original = _read_json(path)
    chat, _temp_ids = rehydrate_chat(incoming_chat, original)

    chunks = chat["chunkedPrompt"]["chunks"]
    if len(chunks) > 100_000:
        raise ChatValidationError("Слишком много фреймов в чате")
    for index, chunk in enumerate(chunks):
        if not isinstance(chunk, dict):
            raise ChatValidationError("Каждый фрейм должен быть объектом")
        if chunk.get("role") not in ("user", "model"):
            raise ChatValidationError(f"Фрейм {index}: роль должна быть user или model")
        if "text" in chunk and not isinstance(chunk["text"], str):
            chunk["text"] = str(chunk["text"] or "")

    _backup(path, chat_id)
    atomic_write_json(path, chat)
    # Uploaded payloads are embedded into the chat JSON above. Temporary files
    # are kept for a while so a queued save with the same tempId can still be
    # replayed safely; old uploads are pruned on startup.
    invalidate_cache()
    return get_document(chat_id)


def rename_chat(chat_id: str, title: str) -> dict[str, Any]:
    path = resolve_path(chat_id)
    old_name = path.name
    base = safe_title(title)
    if base == old_name:
        return get_document(chat_id)
    candidate = base
    counter = 2
    while (CHAT_DIR / candidate).exists():
        candidate = f"{base} ({counter})"
        counter += 1
    target = CHAT_DIR / candidate
    try:
        path.rename(target)
    except OSError as exc:
        raise ChatValidationError(f"Не удалось переименовать чат: {exc}") from exc
    with _cache_lock:
        _meta_cache.pop(old_name, None)
    invalidate_cache()
    new_id = chat_id_encode(candidate)
    return get_document(new_id)


def delete_chat(chat_id: str, *, move_to_trash: bool = True) -> None:
    path = resolve_path(chat_id)
    if move_to_trash:
        trash = BACKUP_DIR.parent / "trash"
        trash.mkdir(parents=True, exist_ok=True)
        stamp = utc_now_iso().replace(":", "-").replace(".", "-")
        target = trash / f"{path.name} {stamp}"
        shutil.move(str(path), str(target))
    else:
        path.unlink()
    with _cache_lock:
        _meta_cache.pop(path.name, None)
    invalidate_cache()


def build_summary_for_raw(name: str, raw: dict[str, Any], mtime_ns: int | None = None) -> dict[str, Any]:
    path = CHAT_DIR / name
    mtime = mtime_ns or (path.stat().st_mtime_ns if path.exists() else int(time.time() * 1e9))
    return _meta_from_raw(name, path, raw, mtime)


def estimate_chat_tokens(raw: dict[str, Any]) -> dict[str, int]:
    chunks = raw.get("chunkedPrompt", {}).get("chunks", [])
    system = raw.get("systemInstruction", {})
    system_text = str(system.get("text") or "") if isinstance(system, dict) else ""
    texts: list[str] = []
    thoughts: list[str] = []
    images = 0
    files = 0
    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        text = str(chunk.get("text") or "")
        if _chunk_is_thought(chunk):
            thoughts.append(text)
        elif text:
            texts.append(text)
        for slot in ("driveImage", "inlineImage"):
            if isinstance(chunk.get(slot), dict):
                images += 1
        for slot in ("driveDocument", "inlineFile"):
            if isinstance(chunk.get(slot), dict):
                files += 1
    from .tokens import count_request

    return count_request(
        texts=texts,
        system=system_text,
        image_count=images,
        file_count=files,
        thought_texts=thoughts,
    )


def list_chat_files() -> list[str]:
    if not CHAT_DIR.is_dir():
        return []
    return sorted(
        [
            entry.name
            for entry in os.scandir(CHAT_DIR)
            if entry.is_file(follow_symlinks=False) and not entry.name.startswith(".")
        ],
        key=natural_key,
    )

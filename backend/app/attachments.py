"""Attachment metadata, sanitization and rehydration.

The browser must never receive inline base64 payloads.  Existing payloads are
replaced with a small ``_localAsset`` descriptor; on save the descriptor is
resolved back to bytes from the original JSON file or a temporary upload.
"""

from __future__ import annotations

import base64
import binascii
import copy
import json
import mimetypes
import re
from pathlib import Path
from typing import Any

from .config import ATTACHMENTS_DIR, CHAT_DIR, UPLOAD_DIR
from .utils import human_size, is_within, sha1_hex

ATTACHMENT_SLOTS = (
    "driveImage",
    "inlineImage",
    "driveVideo",
    "driveDocument",
    "inlineFile",
    "youtubeVideo",
)
INLINE_SLOTS = {"inlineImage", "inlineFile"}
IMAGE_SLOTS = {"driveImage", "inlineImage"}
VIDEO_SLOTS = {"driveVideo", "youtubeVideo"}
DRIVE_SLOTS = {"driveImage", "driveVideo", "driveDocument"}

IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif", ".tif", ".tiff")
VIDEO_EXTENSIONS = (".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v")
DOCUMENT_EXTENSIONS = (
    ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".rtf",
    ".txt", ".md", ".json", ".csv", ".xml", ".html", ".py", ".js", ".ts",
    ".cs", ".css", ".zip", ".rar", ".7z", ".bin", ".apk",
)
TEXT_EXTENSIONS = {
    ".txt", ".md", ".json", ".csv", ".xml", ".html", ".css", ".js", ".ts",
    ".tsx", ".jsx", ".py", ".cs", ".c", ".cpp", ".h", ".hpp", ".java",
    ".sql", ".yaml", ".yml", ".toml", ".ini", ".log", ".sh", ".ps1", ".bat",
    ".env", ".gitignore",
}

MIME_BY_EXT = {
    **{ext: "image/png" for ext in (".png",)},
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".avif": "image/avif",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".csv": "text/csv",
    ".html": "text/html",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
}

MAX_INLINE_BYTES = 60 * 1024 * 1024
MAX_TEMP_ID = 64


class AttachmentError(ValueError):
    """Raised when an attachment cannot be preserved safely."""


def kind_for_slot(slot: str) -> str:
    if slot in IMAGE_SLOTS:
        return "image"
    if slot in VIDEO_SLOTS:
        return "video"
    if slot == "driveDocument":
        return "document"
    return "file"


def _mime_for(name: str | None, explicit: str | None = None) -> str:
    if explicit:
        return explicit
    if name:
        ext = Path(name).suffix.lower()
        if ext in MIME_BY_EXT:
            return MIME_BY_EXT[ext]
        guessed, _ = mimetypes.guess_type(name)
        if guessed:
            return guessed
    return "application/octet-stream"


def _inline_size(data: str | None) -> int:
    if not data:
        return 0
    padding = data.count("=")
    return max(0, (len(data) * 3) // 4 - padding)


def _ext_for_mime(mime: str) -> str:
    for ext, value in MIME_BY_EXT.items():
        if value == mime:
            return ext
    return ""


def resolve_local_name(name: str | None) -> str | None:
    """Return a safe top-level filename inside the GAS folder, or None."""
    if not name or not isinstance(name, str):
        return None
    name = name.strip()
    if not name or name in (".", ".."):
        return None
    if "/" in name or "\\" in name:
        return None
    path = CHAT_DIR / name
    try:
        resolved = path.resolve(strict=True)
    except (OSError, RuntimeError):
        return None
    if not resolved.is_file() or not is_within(resolved, CHAT_DIR):
        return None
    if resolved.parent != CHAT_DIR.resolve():
        return None
    return resolved.name


def _auto_local_candidate(drive_id: str | None, slot: str) -> str | None:
    if not drive_id:
        return None
    extensions = (
        IMAGE_EXTENSIONS if slot == "driveImage"
        else VIDEO_EXTENSIONS if slot == "driveVideo"
        else DOCUMENT_EXTENSIONS
    )
    for stem in (drive_id, f"drive-{drive_id}", f"{slot}-{drive_id}"):
        for ext in extensions:
            candidate = resolve_local_name(f"{stem}{ext}")
            if candidate:
                return candidate
    return None


DOCX_ASSET_ID_RE = re.compile(r"[a-f0-9]{40}")


def is_docx_asset_id(value: Any) -> bool:
    """assetId сайдкея .docx — sha1 от base64 извлечённого Markdown."""
    return bool(value) and bool(DOCX_ASSET_ID_RE.fullmatch(str(value)))


def docx_assets_present(asset_id: str) -> bool:
    """Есть ли для assetId хоть один артефакт в data/attachments."""
    if not is_docx_asset_id(asset_id):
        return False
    folder = ATTACHMENTS_DIR
    return any(
        (folder / f"{asset_id}{suffix}").is_file()
        for suffix in (".docx", ".thumb.png", ".pages.json", ".page0.png")
    )


def docx_sidecar(asset_id: str | None) -> dict[str, Any]:
    """Сайдкей-информация о .docx в data/attachments (оригинал + миниатюра + страницы).

    Сайдкей-файлы живут только на диске: в JSON чата GAS не пишется ничего
    нестандартного — ``thumbUrl``/``docxUrl``/``docxPagesUrl`` вычисляются на
    лету при санитизации и вырезаются ``rehydrate_chat`` при сохранении.

    ``docxPagesUrl`` отдаётся всегда, пока на диске есть хоть один артефакт:
    страницы дорисовываются эндпоинтом по требованию, поэтому предпросмотр не
    зависит от того, сохранился ли URL где-то в чате.
    """
    if not is_docx_asset_id(asset_id):
        return {}
    assert asset_id is not None
    if not docx_assets_present(asset_id):
        return {}
    info: dict[str, Any] = {
        "docxPagesUrl": f"/api/assets/docx-pages/{asset_id}",
        "convertedFrom": "docx",
    }
    docx_path = ATTACHMENTS_DIR / f"{asset_id}.docx"
    if docx_path.is_file() or (ATTACHMENTS_DIR / f"{asset_id}.thumb.png").is_file():
        info["thumbUrl"] = f"/api/assets/docx-thumb/{asset_id}"
    if docx_path.is_file():
        info["docxUrl"] = f"/api/assets/docx-file/{asset_id}"
    try:
        raw = json.loads((ATTACHMENTS_DIR / f"{asset_id}.meta.json").read_text(encoding="utf-8"))
        if isinstance(raw, dict) and raw.get("name"):
            info["docxName"] = str(raw["name"])
    except (OSError, json.JSONDecodeError):
        pass
    return info


def attachment_meta(slot: str, obj: dict[str, Any], chunk_index: int) -> dict[str, Any]:
    drive_id = str(obj.get("id") or "").strip() or None
    data = obj.get("data") if isinstance(obj.get("data"), str) else None
    mime = _mime_for(obj.get("displayName"), obj.get("mimeType"))
    kind = kind_for_slot(slot)
    explicit_local = resolve_local_name(obj.get("localPath"))
    auto_local = _auto_local_candidate(drive_id, slot) if slot in DRIVE_SLOTS else None
    local_name = explicit_local or auto_local
    size = _inline_size(data) if slot in INLINE_SLOTS else 0
    if size == 0 and local_name:
        try:
            size = (CHAT_DIR / local_name).stat().st_size
        except OSError:
            size = 0

    asset_id = sha1_hex(data) if data else None
    docx_info = docx_sidecar(asset_id) if slot in INLINE_SLOTS else {}

    name = obj.get("displayName")
    if not name:
        if slot == "driveImage":
            name = f"Изображение Drive {drive_id[:8] if drive_id else chunk_index}"
        elif slot == "driveDocument":
            name = f"Документ Drive {drive_id[:8] if drive_id else chunk_index}"
        elif slot == "driveVideo":
            name = f"Видео Drive {drive_id[:8] if drive_id else chunk_index}"
        elif slot == "youtubeVideo":
            name = f"YouTube · {drive_id or chunk_index}"
        elif slot == "inlineFile":
            name = f"Файл {chunk_index}"
        else:
            name = f"Изображение {chunk_index}"
        if slot in INLINE_SLOTS and mime:
            name += _ext_for_mime(mime)
    if docx_info.get("docxName"):
        # для .docx показываем оригинальное имя файла, а не сгенерированный .md
        name = str(docx_info["docxName"])

    external_url = None
    if slot in DRIVE_SLOTS and drive_id:
        external_url = f"https://drive.google.com/file/d/{drive_id}/view"
    elif slot == "youtubeVideo" and drive_id:
        external_url = f"https://www.youtube.com/watch?v={drive_id}"

    return {
        "id": asset_id,
        "slot": slot,
        "kind": kind,
        "chunkIndex": chunk_index,
        "name": name,
        "mimeType": mime,
        "size": size,
        "sizeLabel": human_size(size),
        "hasData": bool(data),
        "driveId": drive_id,
        "localPath": local_name,
        "localBound": bool(explicit_local),
        "resolved": bool(local_name or (slot in INLINE_SLOTS and data)),
        "externalUrl": external_url,
        "youtubeId": drive_id if slot == "youtubeVideo" else None,
        "docxUrl": docx_info.get("docxUrl"),
        "thumbUrl": docx_info.get("thumbUrl"),
        # страницы всегда резолвятся по assetId (id выше) — фронтенд не должен
        # зависеть от того, дожил ли URL до следующей загрузки чата
        "docxPagesUrl": docx_info.get("docxPagesUrl"),
        "convertedFrom": docx_info.get("convertedFrom"),
    }


def sanitize_chat(raw: dict[str, Any], chat_id: str | None = None) -> dict[str, Any]:
    chat = copy.deepcopy(raw)
    chunks = chat.get("chunkedPrompt", {}).get("chunks", [])
    if not isinstance(chunks, list):
        return chat
    for index, chunk in enumerate(chunks):
        if not isinstance(chunk, dict):
            continue
        for slot in ATTACHMENT_SLOTS:
            obj = chunk.get(slot)
            if not isinstance(obj, dict):
                continue
            meta = attachment_meta(slot, obj, index)
            if slot in INLINE_SLOTS:
                obj.pop("data", None)
            if chat_id:
                meta["url"] = f"/api/chats/{chat_id}/assets/{index}/{slot}"
            obj["_localAsset"] = meta
    return chat


def _collect_inline(original: dict[str, Any]) -> tuple[dict[str, str], list[dict[str, Any]]]:
    by_id: dict[str, str] = {}
    chunks = original.get("chunkedPrompt", {}).get("chunks", [])
    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        for slot in INLINE_SLOTS:
            obj = chunk.get(slot)
            if isinstance(obj, dict) and isinstance(obj.get("data"), str):
                by_id[sha1_hex(obj["data"])] = obj["data"]
    return by_id, chunks if isinstance(chunks, list) else []


def _temp_path(temp_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{16,64}", temp_id or ""):
        raise AttachmentError("Некорректный идентификатор загруженного файла")
    path = UPLOAD_DIR / f"{temp_id}.bin"
    try:
        resolved = path.resolve(strict=True)
    except OSError as exc:
        raise AttachmentError("Загруженный файл не найден, повторите загрузку") from exc
    if not is_within(resolved, UPLOAD_DIR):
        raise AttachmentError("Некорректный путь загруженного файла")
    return resolved


def rehydrate_chat(
    incoming: dict[str, Any], original: dict[str, Any]
) -> tuple[dict[str, Any], list[str]]:
    """Restore inline base64 payloads and validate local paths.

    ``_localAsset`` вырезается у каждого вложения, поэтому служебные поля
    сайдкея .docx (``docxUrl``/``thumbUrl``/``docxPagesUrl``/``convertedFrom``)
    никогда не попадают в файл чата GAS: при следующем чтении их заново
    считает ``docx_sidecar`` по ``sha1`` от base64-вложения.
    """
    if not isinstance(incoming, dict):
        raise AttachmentError("Чат должен быть JSON-объектом")
    chat = copy.deepcopy(incoming)
    chunks = chat.get("chunkedPrompt", {}).get("chunks")
    if not isinstance(chunks, list):
        raise AttachmentError("chunkedPrompt.chunks должен быть массивом")

    inline_by_id, original_chunks = _collect_inline(original)
    used_temp_ids: list[str] = []

    for index, chunk in enumerate(chunks):
        if not isinstance(chunk, dict):
            raise AttachmentError("Каждый фрейм должен быть объектом")
        for slot in ATTACHMENT_SLOTS:
            obj = chunk.get(slot)
            if obj is None:
                continue
            if not isinstance(obj, dict):
                raise AttachmentError(f"Вложение {slot} должно быть объектом")
            meta = obj.pop("_localAsset", None)
            meta = meta if isinstance(meta, dict) else {}

            if slot in INLINE_SLOTS:
                temp_id = meta.get("tempId")
                if temp_id:
                    path = _temp_path(str(temp_id))
                    raw_bytes = path.read_bytes()
                    if len(raw_bytes) > MAX_INLINE_BYTES:
                        raise AttachmentError("Вложение слишком большое (лимит 60 МБ)")
                    obj["data"] = base64.b64encode(raw_bytes).decode("ascii")
                    obj["mimeType"] = _mime_for(
                        meta.get("name") or obj.get("displayName"),
                        meta.get("mimeType") or obj.get("mimeType"),
                    )
                    if meta.get("name"):
                        obj["displayName"] = meta["name"]
                    used_temp_ids.append(str(temp_id))
                elif not isinstance(obj.get("data"), str) or not obj.get("data"):
                    original_id = meta.get("id")
                    if original_id and original_id in inline_by_id:
                        obj["data"] = inline_by_id[original_id]
                    elif index < len(original_chunks):
                        candidate = original_chunks[index]
                        if (
                            isinstance(candidate, dict)
                            and candidate.get("createTime") == chunk.get("createTime")
                            and candidate.get("role") == chunk.get("role")
                            and isinstance(candidate.get(slot), dict)
                        ):
                            data = candidate[slot].get("data")
                            if isinstance(data, str) and data:
                                obj["data"] = data
                    if not isinstance(obj.get("data"), str) or not obj.get("data"):
                        raise AttachmentError(
                            "Не удалось восстановить данные вложения. Перезагрузите чат."
                        )
                encoded = obj.get("data", "")
                if len(encoded) > MAX_INLINE_BYTES * 4 // 3 + 8:
                    raise AttachmentError("Вложение слишком большое (лимит 60 МБ)")

            local_path = obj.get("localPath")
            if local_path is not None:
                safe = resolve_local_name(str(local_path))
                if safe:
                    obj["localPath"] = safe
                    if not obj.get("displayName"):
                        obj["displayName"] = safe
                else:
                    obj.pop("localPath", None)

    system = chat.get("systemInstruction")
    if not isinstance(system, dict):
        chat["systemInstruction"] = {"text": ""}
    elif not isinstance(system.get("text", ""), str):
        system["text"] = str(system.get("text") or "")
    if not isinstance(chat.get("runSettings"), dict):
        chat["runSettings"] = {}
    return chat, used_temp_ids


def cleanup_temp_files(temp_ids: list[str]) -> None:
    for temp_id in temp_ids:
        try:
            path = _temp_path(temp_id)
            path.unlink(missing_ok=True)
        except (OSError, AttachmentError):
            pass


def get_attachment_bytes(
    raw: dict[str, Any], chunk_index: int, slot: str
) -> tuple[bytes, str, str] | None:
    chunks = raw.get("chunkedPrompt", {}).get("chunks", [])
    if not isinstance(chunks, list) or not (0 <= chunk_index < len(chunks)):
        return None
    chunk = chunks[chunk_index]
    if not isinstance(chunk, dict):
        return None
    obj = chunk.get(slot)
    if not isinstance(obj, dict):
        return None

    if slot in INLINE_SLOTS:
        data = obj.get("data")
        if not isinstance(data, str) or not data:
            return None
        try:
            raw_bytes = base64.b64decode(data)
        except (binascii.Error, ValueError):
            return None
        name = obj.get("displayName") or f"{slot}-{chunk_index}"
        return raw_bytes, _mime_for(name, obj.get("mimeType")), name

    drive_id = obj.get("id")
    local = resolve_local_name(obj.get("localPath")) or _auto_local_candidate(
        str(drive_id or ""), slot
    )
    if not local:
        return None
    path = CHAT_DIR / local
    try:
        raw_bytes = path.read_bytes()
    except OSError:
        return None
    return raw_bytes, _mime_for(local), obj.get("displayName") or local


def is_text_attachment(name: str, mime: str) -> bool:
    if mime.startswith("text/") or mime in {"application/json", "application/xml"}:
        return True
    return Path(name).suffix.lower() in TEXT_EXTENSIONS


DOCX_MIMES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def looks_like_docx(data: bytes) -> bool:
    """OOXML .docx: ZIP-магия и каталог word/ в начале архива."""
    return data[:4] == b"PK\x03\x04" and b"word/" in data[:8192]


def is_docx_attachment(name: str, mime: str, raw_bytes: bytes | None = None) -> bool:
    if Path(name).suffix.lower() == ".docx":
        return True
    if mime in DOCX_MIMES:
        return True
    return bool(raw_bytes) and looks_like_docx(raw_bytes)


def drive_public_url(drive_id: str, kind: str) -> str:
    if kind == "youtube":
        return f"https://www.youtube.com/watch?v={drive_id}"
    return f"https://drive.google.com/file/d/{drive_id}/view"

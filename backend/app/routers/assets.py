"""Local asset browser, thumbnails and temporary uploads."""

from __future__ import annotations

import io
import mimetypes
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from ..attachments import (
    DOCUMENT_EXTENSIONS,
    IMAGE_EXTENSIONS,
    MIME_BY_EXT,
    TEXT_EXTENSIONS,
    VIDEO_EXTENSIONS,
    is_docx_attachment,
    resolve_local_name,
)
from ..config import ATTACHMENTS_DIR, CHAT_DIR, THUMB_DIR, UPLOAD_DIR
from ..docx import docx_bytes_to_markdown
from ..url_context import fetch_url_page, normalize_url
from ..utils import human_size, natural_key

router = APIRouter(prefix="/api", tags=["assets"])

MAX_UPLOAD_BYTES = 50 * 1024 * 1024


def _mime_for_path(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in MIME_BY_EXT:
        return MIME_BY_EXT[ext]
    guessed, _ = mimetypes.guess_type(path.name)
    return guessed or "application/octet-stream"


def _asset_kind(ext: str) -> str:
    if ext in IMAGE_EXTENSIONS:
        return "image"
    if ext in VIDEO_EXTENSIONS:
        return "video"
    return "document"


@router.post("/assets/upload")
async def upload_asset(file: UploadFile = File(...)) -> dict[str, Any]:
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Файл больше 50 МБ")
    if not raw:
        raise HTTPException(400, "Пустой файл")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    temp_id = uuid.uuid4().hex
    target = UPLOAD_DIR / f"{temp_id}.bin"
    name = Path(file.filename or "file").name
    name = "".join(char for char in name if ord(char) >= 32)[:200] or "file"
    mime = file.content_type or _mime_for_path(Path(name))
    converted_from: str | None = None
    original_size = len(raw)

    if is_docx_attachment(name, mime, raw):
        # В JSON чата кладём только извлечённый Markdown (GAS-совместимость);
        # исходный .docx храним локально в data/attachments.
        try:
            markdown = await run_in_threadpool(docx_bytes_to_markdown, raw)
        except Exception as exc:
            raise HTTPException(400, f"Не удалось прочитать документ .docx: {exc}") from exc
        if not markdown:
            raise HTTPException(400, "В документе .docx не найдено текста")
        ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)
        (ATTACHMENTS_DIR / f"{temp_id}.docx").write_bytes(raw)
        raw = markdown.encode("utf-8")
        stem = name[: -len(Path(name).suffix)] if Path(name).suffix else name
        name = f"{stem}.md"
        mime = "text/markdown"
        converted_from = "docx"

    try:
        target.write_bytes(raw)
    except OSError as exc:
        raise HTTPException(500, f"Не удалось сохранить файл: {exc}") from exc
    result: dict[str, Any] = {
        "tempId": temp_id,
        "name": name,
        "mimeType": mime,
        "size": len(raw),
        "sizeLabel": human_size(len(raw)),
        "previewUrl": f"/api/uploads/{temp_id}",
    }
    if converted_from:
        result["convertedFrom"] = converted_from
        result["originalSize"] = original_size
    return result


class ExtractUrlRequest(BaseModel):
    url: str
    force: bool = False


@router.post("/assets/extract-url")
async def extract_url(payload: ExtractUrlRequest) -> dict[str, Any]:
    normalized = normalize_url(payload.url)
    if not normalized:
        raise HTTPException(400, "Некорректный URL")
    record = await run_in_threadpool(fetch_url_page, normalized, payload.force)
    if record.get("error"):
        return {"ok": False, "error": record["error"], "record": None}
    record.pop("textFull", None)
    return {"ok": True, "record": {**record, "textLength": len(record.get("text") or "")}}


@router.get("/uploads/{temp_id}")
def get_upload(temp_id: str) -> FileResponse:
    if not re.fullmatch(r"[a-f0-9]{32}", temp_id):
        raise HTTPException(404, "Файл не найден")
    path = (UPLOAD_DIR / f"{temp_id}.bin").resolve()
    if not path.is_file():
        raise HTTPException(404, "Файл не найден")
    return FileResponse(path, media_type=_mime_for_path(path), headers={"Cache-Control": "no-store"})


@router.get("/assets/local")
def list_local_assets(
    q: str = "",
    kind: str = Query(default="image", pattern="^(image|document|video|all)$"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=120, ge=1, le=240),
) -> dict[str, Any]:
    if not CHAT_DIR.is_dir():
        return {"items": [], "total": 0, "offset": offset, "limit": limit, "folder": str(CHAT_DIR)}

    needle = q.casefold().strip()
    items: list[dict[str, Any]] = []
    for entry in os.scandir(CHAT_DIR):
        try:
            if not entry.is_file(follow_symlinks=False) or entry.name.startswith("."):
                continue
        except OSError:
            continue
        path = Path(entry.path)
        ext = path.suffix.lower()
        item_kind = _asset_kind(ext)
        if kind != "all" and item_kind != kind:
            continue
        if not ext or ext == ".tmp":
            continue
        if needle and needle not in entry.name.casefold():
            continue
        try:
            stat = entry.stat()
        except OSError:
            continue
        encoded = quote(entry.name, safe="")
        items.append(
            {
                "name": entry.name,
                "kind": item_kind,
                "mimeType": _mime_for_path(path),
                "size": stat.st_size,
                "sizeLabel": human_size(stat.st_size),
                "mtime": datetime.fromtimestamp(
                    stat.st_mtime, tz=timezone.utc
                ).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                "fileUrl": f"/api/assets/local/file?name={encoded}",
                "thumbUrl": f"/api/assets/local/thumb?name={encoded}&w=280"
                if item_kind == "image"
                else None,
                "isText": ext in TEXT_EXTENSIONS,
            }
        )
    items.sort(key=lambda item: natural_key(item["name"]))
    total = len(items)
    return {
        "items": items[offset : offset + limit],
        "total": total,
        "offset": offset,
        "limit": limit,
        "folder": str(CHAT_DIR),
    }


@router.get("/assets/local/file")
def get_local_file(name: str, download: bool = False) -> FileResponse:
    safe = resolve_local_name(name)
    if not safe:
        raise HTTPException(404, "Файл не найден в папке GAS")
    path = CHAT_DIR / safe
    return FileResponse(
        path,
        media_type=_mime_for_path(path),
        filename=path.name if download else None,
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.get("/assets/local/thumb")
def get_local_thumb(name: str, w: int = Query(default=280, ge=80, le=800)) -> Response:
    safe = resolve_local_name(name)
    if not safe:
        raise HTTPException(404, "Файл не найден")
    path = CHAT_DIR / safe
    if path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise HTTPException(415, "Это не изображение")
    stat = path.stat()
    key = f"{abs(hash((safe, stat.st_mtime_ns, w)))}-{w}.jpg"
    cache = THUMB_DIR / key
    if cache.is_file():
        return FileResponse(cache, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})
    try:
        from PIL import Image, ImageOps

        with Image.open(path) as image:
            image = ImageOps.exif_transpose(image)
            image.thumbnail((w, w), Image.Resampling.LANCZOS)
            if image.mode in ("RGBA", "LA", "P"):
                background = Image.new("RGB", image.size, (255, 255, 255))
                converted = image.convert("RGBA")
                background.paste(converted, mask=converted.getchannel("A"))
                image = background
            else:
                image = image.convert("RGB")
            THUMB_DIR.mkdir(parents=True, exist_ok=True)
            temp = THUMB_DIR / f".{uuid.uuid4().hex}.tmp"
            image.save(temp, format="JPEG", quality=82, optimize=True)
            os.replace(temp, cache)
    except Exception:
        return FileResponse(path, media_type=_mime_for_path(path))
    return FileResponse(cache, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})

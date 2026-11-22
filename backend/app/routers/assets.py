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
from fastapi.responses import FileResponse, Response

from ..attachments import (
    DOCUMENT_EXTENSIONS,
    IMAGE_EXTENSIONS,
    MIME_BY_EXT,
    TEXT_EXTENSIONS,
    VIDEO_EXTENSIONS,
    resolve_local_name,
)
from ..config import CHAT_DIR, THUMB_DIR, UPLOAD_DIR
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
    try:
        target.write_bytes(raw)
    except OSError as exc:
        raise HTTPException(500, f"Не удалось сохранить файл: {exc}") from exc
    name = Path(file.filename or "file").name
    name = "".join(char for char in name if ord(char) >= 32)[:200] or "file"
    mime = file.content_type or _mime_for_path(Path(name))
    return {
        "tempId": temp_id,
        "name": name,
        "mimeType": mime,
        "size": len(raw),
        "sizeLabel": human_size(len(raw)),
        "previewUrl": f"/api/uploads/{temp_id}",
    }


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

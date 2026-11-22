"""Shared helpers: ids, safe filenames, atomic JSON writes."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

INVALID_FILENAME_CHARS = set('<>:"/\\|?*')
WINDOWS_RESERVED = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}


class InvalidNameError(ValueError):
    pass


def utc_now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def parse_iso(value: str | None) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def sha1_hex(value: str | bytes) -> str:
    data = value.encode("utf-8") if isinstance(value, str) else value
    return hashlib.sha1(data).hexdigest()


def chat_id_encode(name: str) -> str:
    return base64.urlsafe_b64encode(name.encode("utf-8")).decode("ascii").rstrip("=")


def validate_chat_name(name: str) -> str:
    if not name or name in (".", ".."):
        raise InvalidNameError("Некорректное имя чата")
    if name.startswith("."):
        raise InvalidNameError("Скрытые файлы не являются чатами")
    if "/" in name or "\\" in name:
        raise InvalidNameError("Имя чата не может содержать разделители пути")
    if "\x00" in name:
        raise InvalidNameError("Некорректное имя чата")
    if Path(name).name != name:
        raise InvalidNameError("Некорректное имя чата")
    return name


def chat_id_decode(chat_id: str) -> str:
    try:
        padded = chat_id + "=" * (-len(chat_id) % 4)
        raw = base64.urlsafe_b64decode(padded.encode("ascii"))
        name = raw.decode("utf-8")
    except (ValueError, binascii.Error, UnicodeDecodeError) as exc:
        raise InvalidNameError("Некорректный id чата") from exc
    return validate_chat_name(name)


def safe_title(title: str | None) -> str:
    text = (title or "").strip()
    text = "".join(
        "_" if char in INVALID_FILENAME_CHARS or ord(char) < 32 else char
        for char in text
    )
    text = re.sub(r"\s+", " ", text).strip(" .")
    if not text:
        text = "Новый чат"
    if text.split(".")[0].upper() in WINDOWS_RESERVED:
        text = f"_{text}"
    if len(text) > 120:
        text = text[:120].rstrip(" .")
    return text or "Новый чат"


def natural_key(value: str) -> list[Any]:
    return [int(part) if part.isdigit() else part.casefold() for part in re.split(r"(\d+)", value)]


def atomic_write_json(path: Path, data: Any, *, indent: int = 2) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent)
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=indent)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    except BaseException:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise


def is_within(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def human_size(value: int | float | None) -> str:
    if not value:
        return "0 Б"
    size = float(value)
    for unit in ("Б", "КБ", "МБ", "ГБ"):
        if size < 1024 or unit == "ГБ":
            return f"{size:.0f} {unit}" if unit == "Б" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} ГБ"

"""Application paths and persisted defaults."""

from __future__ import annotations

import copy
import json
import os
from pathlib import Path
from typing import Any

from .utils import atomic_write_json

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
BASE_DIR = Path(__file__).resolve().parent.parent

DEFAULT_CHAT_DIR = Path(
    os.getenv(
        "GAS_CHAT_DIR",
        str(Path.home() / "Documents" / "Google AI Studio"),
    )
).expanduser()

DATA_DIR = Path(os.getenv("LOCAL_AI_STUDIO_DATA", str(BASE_DIR / "data"))).expanduser()
DATA_DIR = DATA_DIR.resolve()

UPLOAD_DIR = DATA_DIR / "uploads"
BACKUP_DIR = DATA_DIR / "backups"
THUMB_DIR = DATA_DIR / "thumbnails"
ATTACHMENTS_DIR = DATA_DIR / "attachments"
URL_CACHE_DIR = DATA_DIR / "url_cache"
CHAT_META_DIR = DATA_DIR / "chat_meta"
SETTINGS_FILE = DATA_DIR / "settings.json"
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"


def _stored_chat_dir() -> str | None:
    """Активная папка чатов из settings.json (выбор через UI), если задана."""
    try:
        if SETTINGS_FILE.is_file():
            raw = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                stored = str(raw.get("chatDir") or "").strip()
                if stored:
                    return stored
    except (OSError, json.JSONDecodeError):
        return None
    return None


# Приоритет: выбор пользователя (settings.json) → GAS_CHAT_DIR → Documents\Google AI Studio.
CHAT_DIR = Path(_stored_chat_dir() or DEFAULT_CHAT_DIR).expanduser().resolve()

# Уровни мышления (Thinking Level) — наш внутренний канон.
THINKING_LEVELS = ("NONE", "LOW", "MEDIUM", "HIGH", "EXTRA_HIGH")
DEFAULT_THINKING_LEVEL = "HIGH"
THINKING_MAX_OUTPUT_TOKENS = 65536

# Отображение в аргумент reasoning_effort OpenAI-совместимых API.
REASONING_EFFORT_BY_LEVEL: dict[str, str] = {
    "NONE": "none",
    "LOW": "low",
    "MEDIUM": "medium",
    "HIGH": "high",
    "EXTRA_HIGH": "high",
}

# Запись в GAS-поле runSettings.thinkingLevel (обратная совместимость с GAS).
GAS_THINKING_BY_LEVEL: dict[str, str] = {
    "NONE": "THINKING_NONE",
    "LOW": "THINKING_LOW",
    "MEDIUM": "THINKING_HIGH",
    "HIGH": "THINKING_HIGH",
    "EXTRA_HIGH": "THINKING_HIGH",
}

# Чтение устаревших GAS-значений.
GAS_LEVEL_ALIASES: dict[str, str] = {
    "THINKING_NONE": "NONE",
    "THINKING_MINIMAL": "LOW",
    "THINKING_LOW": "LOW",
    "THINKING_HIGH": "HIGH",
}


def normalize_thinking_level(value: Any, fallback: str = DEFAULT_THINKING_LEVEL) -> str:
    """Приводит значение уровня мышления к канону THINKING_LEVELS."""
    text = str(value or "").strip().upper()
    if text in THINKING_LEVELS:
        return text
    if text in GAS_LEVEL_ALIASES:
        return GAS_LEVEL_ALIASES[text]
    return fallback


DEFAULT_SETTINGS: dict[str, Any] = {
    "baseUrl": "http://localhost:1234/v1",
    "apiKey": "",
    "model": "",
    "reasoningMode": False,
    "thinkingLevel": DEFAULT_THINKING_LEVEL,
    "temperature": 1.0,
    "maxOutputTokens": 8192,
    "topP": 0.95,
    "sendAttachments": True,
    "contextWindow": 131072,
    "urlContext": True,
    "chatDir": str(DEFAULT_CHAT_DIR),
}

DEFAULT_CHAT_RUN_SETTINGS: dict[str, Any] = {
    "temperature": 1.0,
    "model": "models/gemini-3.7-flash",
    "topP": 0.95,
    "topK": 64,
    "maxOutputTokens": 8192,
    "thinkingLevel": "THINKING_HIGH",
    "enableCodeExecution": False,
    "enableSearchAsATool": False,
    "enableBrowseAsATool": False,
    "enableImageSearch": False,
    "enableGoogleMaps": False,
}


def ensure_dirs() -> None:
    for path in (DATA_DIR, UPLOAD_DIR, BACKUP_DIR, THUMB_DIR, ATTACHMENTS_DIR, URL_CACHE_DIR, CHAT_META_DIR):
        path.mkdir(parents=True, exist_ok=True)


def load_settings() -> dict[str, Any]:
    ensure_dirs()
    stored: dict[str, Any] = {}
    if SETTINGS_FILE.is_file():
        try:
            raw = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                stored = raw
        except (OSError, json.JSONDecodeError):
            stored = {}

    settings = copy.deepcopy(DEFAULT_SETTINGS)
    for key, value in stored.items():
        if key in settings:
            settings[key] = value
    if "thinkingLevel" not in stored and "reasoningMode" in stored:
        settings["thinkingLevel"] = "HIGH" if stored.get("reasoningMode") else "NONE"
    settings["thinkingLevel"] = normalize_thinking_level(settings.get("thinkingLevel"))
    return settings


def save_settings(settings: dict[str, Any]) -> dict[str, Any]:
    ensure_dirs()
    current = load_settings()
    for key in DEFAULT_SETTINGS:
        if key in settings:
            current[key] = settings[key]
    atomic_write_json(SETTINGS_FILE, current)
    return current


def public_settings(settings: dict[str, Any]) -> dict[str, Any]:
    result = {key: settings.get(key, DEFAULT_SETTINGS[key]) for key in DEFAULT_SETTINGS}
    result["apiKey"] = ""
    result["hasApiKey"] = bool(settings.get("apiKey"))
    return result


def chat_local_defaults(settings: dict[str, Any]) -> dict[str, Any]:
    thinking_level = normalize_thinking_level(settings.get("thinkingLevel"))
    return {
        "baseUrl": settings.get("baseUrl", DEFAULT_SETTINGS["baseUrl"]),
        "model": settings.get("model", ""),
        "reasoningMode": thinking_level != "NONE",
        "thinkingLevel": thinking_level,
        "temperature": settings.get("temperature", 1.0),
        "maxOutputTokens": settings.get("maxOutputTokens", 8192),
        "topP": settings.get("topP", 0.95),
        "sendAttachments": bool(settings.get("sendAttachments", True)),
        "contextWindow": settings.get("contextWindow", 131072),
        "urlContext": bool(settings.get("urlContext", True)),
    }


class ChatDirError(ValueError):
    """Ошибка смены активной папки чатов."""


def _rebind_chat_dir(new_dir: Path) -> None:
    """Модули пакета делают ``from .config import CHAT_DIR`` и держат копию
    ссылки; обновляем их модульные глобалы, чтобы смена папки действовала
    сразу, без перезапуска сервера."""
    import sys

    package = __package__ or "app"
    for name, module in list(sys.modules.items()):
        if module is None:
            continue
        if name != package and not name.startswith(package + "."):
            continue
        if getattr(module, "CHAT_DIR", None) is not None:
            module.CHAT_DIR = new_dir


def set_chat_dir(path: str | Path) -> Path:
    """Меняет активную папку чатов: валидация, ребинг CHAT_DIR во всех
    модулях, сохранение в settings.json, сброс кэшей индексатора."""
    raw_path = str(path or "").strip()
    if not raw_path:
        raise ChatDirError("Папка не выбрана")
    candidate = Path(raw_path).expanduser()
    try:
        resolved = candidate.resolve()
    except OSError as exc:
        raise ChatDirError(f"Некорректный путь к папке: {exc}") from exc
    if not resolved.is_dir():
        raise ChatDirError(f"Папка не существует: {resolved}")

    global CHAT_DIR
    CHAT_DIR = resolved
    _rebind_chat_dir(resolved)

    settings = load_settings()
    settings["chatDir"] = str(resolved)
    save_settings(settings)

    from .gas_store import invalidate_cache

    invalidate_cache(full=True)
    return resolved

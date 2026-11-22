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
        r"C:\Users\Nekromant\Documents\Google AI Studio",
    )
).expanduser()

DATA_DIR = Path(os.getenv("LOCAL_AI_STUDIO_DATA", str(BASE_DIR / "data"))).expanduser()
CHAT_DIR = DEFAULT_CHAT_DIR.resolve()
DATA_DIR = DATA_DIR.resolve()

UPLOAD_DIR = DATA_DIR / "uploads"
BACKUP_DIR = DATA_DIR / "backups"
THUMB_DIR = DATA_DIR / "thumbnails"
SETTINGS_FILE = DATA_DIR / "settings.json"
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"

DEFAULT_SETTINGS: dict[str, Any] = {
    "baseUrl": "http://localhost:1234/v1",
    "apiKey": "",
    "model": "",
    "reasoningMode": False,
    "temperature": 1.0,
    "maxOutputTokens": 8192,
    "topP": 0.95,
    "sendAttachments": True,
    "contextWindow": 131072,
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
    for path in (DATA_DIR, UPLOAD_DIR, BACKUP_DIR, THUMB_DIR):
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
    return {
        "baseUrl": settings.get("baseUrl", DEFAULT_SETTINGS["baseUrl"]),
        "model": settings.get("model", ""),
        "reasoningMode": bool(settings.get("reasoningMode", False)),
        "temperature": settings.get("temperature", 1.0),
        "maxOutputTokens": settings.get("maxOutputTokens", 8192),
        "topP": settings.get("topP", 0.95),
        "sendAttachments": bool(settings.get("sendAttachments", True)),
        "contextWindow": settings.get("contextWindow", 131072),
    }

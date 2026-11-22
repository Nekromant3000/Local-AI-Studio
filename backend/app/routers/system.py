"""System, settings and token endpoints."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from ..config import (
    CHAT_DIR,
    normalize_thinking_level,
    public_settings,
    load_settings,
    save_settings,
)
from ..tokens import count_request
from ..utils import utc_now_iso

router = APIRouter(prefix="/api", tags=["system"])


class SettingsUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    baseUrl: str | None = None
    apiKey: str | None = None
    clearApiKey: bool = False
    model: str | None = None
    reasoningMode: bool | None = None
    thinkingLevel: str | None = None
    temperature: float | None = None
    maxOutputTokens: int | None = None
    topP: float | None = None
    sendAttachments: bool | None = None
    contextWindow: int | None = None


class TokenCountRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    texts: list[str] = Field(default_factory=list)
    system: str = ""
    imageCount: int = 0
    fileCount: int = 0
    thoughtTexts: list[str] = Field(default_factory=list)


@router.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "time": utc_now_iso(),
        "chatDir": str(CHAT_DIR),
        "chatDirExists": CHAT_DIR.is_dir(),
    }


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    return {
        "settings": public_settings(load_settings()),
        "chatDir": str(CHAT_DIR),
    }


@router.put("/settings")
def update_settings(payload: SettingsUpdate) -> dict[str, Any]:
    current = load_settings()
    changed = payload.model_dump(exclude_unset=True)

    base_url = changed.get("baseUrl")
    if base_url is not None:
        parsed = urlparse(base_url.strip())
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise HTTPException(400, "Base URL должен начинаться с http:// или https://")
        current["baseUrl"] = base_url.strip()

    if "apiKey" in changed and changed["apiKey"] is not None:
        key = str(changed["apiKey"]).strip()
        if key:
            current["apiKey"] = key
    if payload.clearApiKey:
        current["apiKey"] = ""

    for key in ("model", "reasoningMode", "thinkingLevel", "temperature", "maxOutputTokens", "topP", "sendAttachments", "contextWindow"):
        if key in changed and changed[key] is not None:
            current[key] = changed[key]

    current["thinkingLevel"] = normalize_thinking_level(current.get("thinkingLevel"))
    current["reasoningMode"] = current["thinkingLevel"] != "NONE"

    current["temperature"] = min(2.0, max(0.0, float(current.get("temperature", 1.0))))
    current["topP"] = min(1.0, max(0.0, float(current.get("topP", 0.95))))
    current["maxOutputTokens"] = min(262144, max(1, int(current.get("maxOutputTokens", 8192))))
    current["contextWindow"] = min(2_000_000, max(2048, int(current.get("contextWindow", 131072))))

    saved = save_settings(current)
    return {"settings": public_settings(saved), "chatDir": str(CHAT_DIR)}


@router.post("/tokens/count")
def token_count(payload: TokenCountRequest) -> dict[str, Any]:
    return count_request(
        texts=payload.texts,
        system=payload.system,
        image_count=payload.imageCount,
        file_count=payload.fileCount,
        thought_texts=payload.thoughtTexts,
    )

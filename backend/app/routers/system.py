"""System, settings and token endpoints."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from .. import gas_store
from ..attachments import get_attachment_bytes, is_docx_attachment, is_text_attachment
from ..config import (
    CHAT_DIR,
    normalize_thinking_level,
    public_settings,
    load_settings,
    save_settings,
)
from ..docx import docx_bytes_to_markdown
from ..llm import MAX_TEXT_ATTACHMENT_CHARS
from ..tokens import FILE_TOKEN_ESTIMATE, count_request, count_tokens
from ..url_context import gather_url_context
from ..utils import InvalidNameError, chat_id_decode, utc_now_iso

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
    urlContext: bool | None = None


class TokenCountRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    texts: list[str] = Field(default_factory=list)
    system: str = ""
    imageCount: int = 0
    fileCount: int = 0
    thoughtTexts: list[str] = Field(default_factory=list)
    chatId: str | None = None
    urlContext: bool = True


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

    for key in ("model", "reasoningMode", "thinkingLevel", "temperature", "maxOutputTokens", "topP", "sendAttachments", "contextWindow", "urlContext"):
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
async def token_count(payload: TokenCountRequest) -> dict[str, Any]:
    attachment_text_tokens = 0
    embedded_text_files = 0
    url_tokens = 0
    url_items: list[dict[str, Any]] = []

    if payload.chatId:
        try:
            raw = await run_in_threadpool(gas_store.load_raw, payload.chatId)
        except (HTTPException, InvalidNameError, FileNotFoundError):
            raw = None
        if isinstance(raw, dict):
            chunks = raw.get("chunkedPrompt", {}).get("chunks") or []
            for index, chunk in enumerate(chunks):
                if not isinstance(chunk, dict):
                    continue
                for slot in ("inlineFile", "driveDocument"):
                    if not isinstance(chunk.get(slot), dict):
                        continue
                    attachment = get_attachment_bytes(raw, index, slot)
                    if not attachment:
                        continue
                    raw_bytes, mime, name = attachment
                    text: str | None = None
                    if is_docx_attachment(name, mime, raw_bytes):
                        try:
                            text = await run_in_threadpool(docx_bytes_to_markdown, raw_bytes)
                        except Exception:
                            text = None
                    elif is_text_attachment(name, mime):
                        try:
                            text = raw_bytes.decode("utf-8", errors="replace")
                        except OSError:
                            text = None
                    if text:
                        if len(text) > MAX_TEXT_ATTACHMENT_CHARS:
                            text = text[:MAX_TEXT_ATTACHMENT_CHARS]
                        attachment_text_tokens += count_tokens(text)
                        embedded_text_files += 1

            if payload.urlContext:
                chat_name = chat_id_decode(payload.chatId) if payload.chatId else None
                if chat_name:
                    try:
                        records = await run_in_threadpool(
                            gather_url_context, raw, chat_name
                        )
                    except Exception:
                        records = []
                    for record in records:
                        text = str(record.get("text") or "")
                        tokens = count_tokens(text)
                        url_tokens += tokens
                        url_items.append(
                            {
                                "url": record.get("url"),
                                "title": record.get("title"),
                                "tokens": tokens,
                            }
                        )

    return count_request(
        texts=payload.texts,
        system=payload.system,
        image_count=payload.imageCount,
        file_count=max(0, payload.fileCount - embedded_text_files),
        thought_texts=payload.thoughtTexts,
        attachment_text_tokens=attachment_text_tokens,
        url_tokens=url_tokens,
        urls=url_items,
    )

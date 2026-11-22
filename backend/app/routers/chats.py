"""Chat CRUD, attachment streaming and generation endpoint."""

from __future__ import annotations

import asyncio
import copy
import json
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, ConfigDict
from starlette.concurrency import run_in_threadpool

from .. import gas_store
from ..attachments import ATTACHMENT_SLOTS, get_attachment_bytes
from ..config import (
    DEFAULT_THINKING_LEVEL,
    GAS_THINKING_BY_LEVEL,
    load_settings,
    normalize_thinking_level,
    THINKING_MAX_OUTPUT_TOKENS,
)
from ..llm import (
    LLMError,
    build_messages,
    make_generated_chunks,
    prepare_truncation,
    stream_completion,
)
from ..tokens import count_tokens
from ..utils import utc_now_iso

router = APIRouter(prefix="/api/chats", tags=["chats"])


class ChatCreateBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str | None = None


class ChatSaveBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    chat: dict[str, Any]
    baseRevision: str | None = None


class ChatRenameBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str


class LocalApiSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")

    baseUrl: str = "http://localhost:1234/v1"
    model: str = ""
    reasoningMode: bool = False
    thinkingLevel: str = DEFAULT_THINKING_LEVEL
    temperature: float = 1.0
    maxOutputTokens: int = 8192
    topP: float = 0.95
    sendAttachments: bool = True
    contextWindow: int = 131072


class GenerateBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    startIndex: int | None = None
    settings: LocalApiSettings | None = None


def _sse(event: dict[str, Any]) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


def _merged_settings(raw: dict[str, Any], body: GenerateBody | None = None) -> LocalApiSettings:
    global_settings = load_settings()
    values: dict[str, Any] = {
        "baseUrl": global_settings.get("baseUrl") or "http://localhost:1234/v1",
        "model": global_settings.get("model") or "",
        "reasoningMode": bool(global_settings.get("reasoningMode", False)),
        "thinkingLevel": normalize_thinking_level(global_settings.get("thinkingLevel")),
        "temperature": float(global_settings.get("temperature", 1.0)),
        "maxOutputTokens": int(global_settings.get("maxOutputTokens", 8192)),
        "topP": float(global_settings.get("topP", 0.95)),
        "sendAttachments": bool(global_settings.get("sendAttachments", True)),
        "contextWindow": int(global_settings.get("contextWindow", 131072)),
    }
    run_settings = raw.get("runSettings") if isinstance(raw.get("runSettings"), dict) else {}
    local = run_settings.get("localApi") if isinstance(run_settings.get("localApi"), dict) else {}
    for key in values:
        if key in local and local[key] is not None:
            values[key] = local[key]
    # Обратная совместимость старых чатов: thinkingLevel в localApi мог отсутствовать.
    if "thinkingLevel" not in local or local.get("thinkingLevel") is None:
        if "reasoningMode" in local and local.get("reasoningMode") is not None:
            values["thinkingLevel"] = "HIGH" if local["reasoningMode"] else "NONE"
        elif run_settings.get("thinkingLevel"):
            values["thinkingLevel"] = normalize_thinking_level(run_settings["thinkingLevel"])
        else:
            values["thinkingLevel"] = global_settings.get("thinkingLevel", DEFAULT_THINKING_LEVEL)
    if body and body.settings:
        sent = body.settings.model_dump(exclude_unset=True)
        for key, value in sent.items():
            values[key] = value
        if "thinkingLevel" not in sent and "reasoningMode" in sent:
            values["thinkingLevel"] = "HIGH" if body.settings.reasoningMode else "NONE"
    values["thinkingLevel"] = normalize_thinking_level(values["thinkingLevel"])
    # reasoningMode остаётся производным флагом «мышление включено» для старых клиентов.
    values["reasoningMode"] = values["thinkingLevel"] != "NONE"
    values["temperature"] = min(2.0, max(0.0, float(values["temperature"])))
    values["topP"] = min(1.0, max(0.0, float(values["topP"])))
    values["maxOutputTokens"] = min(262144, max(1, int(values["maxOutputTokens"])))
    values["contextWindow"] = min(2_000_000, max(2048, int(values["contextWindow"])))
    return LocalApiSettings(**values)


@router.get("")
def list_chats(
    q: str | None = None,
    refresh: bool = Query(default=False),
) -> dict[str, Any]:
    chats = gas_store.list_chats(q, force=refresh)
    return {
        "chats": chats,
        "total": len(chats),
        "folder": str(gas_store.CHAT_DIR),
    }


@router.post("", status_code=201)
def create_chat(payload: ChatCreateBody) -> dict[str, Any]:
    return gas_store.create_chat(payload.title, load_settings())


@router.get("/{chat_id}")
def get_chat(chat_id: str) -> dict[str, Any]:
    return gas_store.get_document(chat_id)


@router.put("/{chat_id}")
def save_chat(chat_id: str, payload: ChatSaveBody) -> dict[str, Any]:
    return gas_store.save_document(chat_id, payload.chat)


@router.patch("/{chat_id}")
def rename_chat(chat_id: str, payload: ChatRenameBody) -> dict[str, Any]:
    return gas_store.rename_chat(chat_id, payload.title)


@router.delete("/{chat_id}")
def delete_chat(chat_id: str) -> dict[str, Any]:
    gas_store.delete_chat(chat_id, move_to_trash=True)
    return {"ok": True}


@router.get("/{chat_id}/assets/{chunk_index}/{slot}")
def chat_asset(
    chat_id: str,
    chunk_index: int,
    slot: str,
    download: bool = Query(default=False),
) -> Response:
    if slot not in ATTACHMENT_SLOTS:
        raise HTTPException(404, "Неизвестный тип вложения")
    raw = gas_store.load_raw(chat_id)
    attachment = get_attachment_bytes(raw, chunk_index, slot)
    if attachment is None:
        raise HTTPException(
            404,
            "Вложение недоступно локально. Привяжите файл из папки Google AI Studio.",
        )
    raw_bytes, mime, name = attachment
    from urllib.parse import quote

    disposition = "attachment" if download else "inline"
    headers = {
        "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(name)}",
        "Cache-Control": "private, max-age=600",
    }
    return Response(content=raw_bytes, media_type=mime, headers=headers)


@router.post("/{chat_id}/generate")
async def generate(chat_id: str, payload: GenerateBody) -> StreamingResponse:
    raw = await run_in_threadpool(gas_store.load_raw, chat_id)
    settings = _merged_settings(raw, payload)
    if not settings.model.strip():
        raise HTTPException(
            400,
            "Модель не выбрана. Укажите модель локального API в правой панели.",
        )
    try:
        kept, removed_count = prepare_truncation(raw, payload.startIndex)
    except LLMError as exc:
        raise HTTPException(exc.status_code, exc.message) from exc

    context_raw = copy.copy(raw)
    chunked = raw.get("chunkedPrompt") if isinstance(raw.get("chunkedPrompt"), dict) else {}
    context_raw["chunkedPrompt"] = {**chunked, "chunks": kept}
    try:
        messages = await run_in_threadpool(
            lambda: build_messages(
                context_raw,
                send_attachments=settings.sendAttachments,
                thinking_level=settings.thinkingLevel,
            )
        )
    except LLMError as exc:
        raise HTTPException(exc.status_code, exc.message) from exc
    except Exception as exc:
        raise HTTPException(500, f"Не удалось собрать контекст: {exc}") from exc

    async def event_stream():
        started_at = utc_now_iso()
        yield _sse(
            {
                "type": "start",
                "startedAt": started_at,
                "removedCount": removed_count,
                "messages": len(messages),
                "model": settings.model,
                "reasoningMode": settings.reasoningMode,
                "thinkingLevel": settings.thinkingLevel,
            }
        )
        final: dict[str, Any] | None = None
        try:
            async for event in stream_completion(
                base_url=settings.baseUrl,
                api_key=str(load_settings().get("apiKey") or ""),
                model=settings.model,
                messages=messages,
                thinking_level=settings.thinkingLevel,
                temperature=settings.temperature,
                top_p=settings.topP,
                max_output_tokens=settings.maxOutputTokens,
            ):
                if event.get("type") == "final":
                    final = event
                    continue
                yield _sse(event)
        except asyncio.CancelledError:
            raise
        except LLMError as exc:
            yield _sse({"type": "error", "message": exc.message})
            return
        except Exception as exc:
            yield _sse({"type": "error", "message": f"Ошибка генерации: {exc}"})
            return

        if final is None:
            yield _sse({"type": "error", "message": "Поток завершился без результата"})
            return
        reasoning = str(final.get("reasoning") or "")
        content = str(final.get("content") or "")
        warning = None
        if not reasoning.strip() and not content.strip():
            yield _sse(
                {
                    "type": "error",
                    "message": "Модель вернула пустой ответ. Проверьте модель и настройки.",
                }
            )
            return
        if not content.strip() and reasoning.strip():
            warning = "Модель вернула только reasoning, без финального текста."
        try:
            new_chunks = make_generated_chunks(
                reasoning,
                content,
                started_at=final.get("startedAt") or started_at,
                finished_at=final.get("finishedAt") or utc_now_iso(),
                finish_reason=str(final.get("finishReason") or "STOP"),
            )
            raw["chunkedPrompt"]["chunks"] = kept + new_chunks
            run_settings = raw.get("runSettings") if isinstance(raw.get("runSettings"), dict) else {}
            run_settings["temperature"] = settings.temperature
            run_settings["topP"] = settings.topP
            run_settings["maxOutputTokens"] = (
                THINKING_MAX_OUTPUT_TOKENS
                if settings.thinkingLevel != "NONE"
                else settings.maxOutputTokens
            )
            run_settings["localApi"] = settings.model_dump()
            run_settings["thinkingLevel"] = GAS_THINKING_BY_LEVEL.get(
                settings.thinkingLevel, "THINKING_HIGH"
            )
            raw["runSettings"] = run_settings
            doc = await run_in_threadpool(gas_store.save_document, chat_id, raw)
        except Exception as exc:
            yield _sse({"type": "error", "message": f"Не удалось сохранить ответ: {exc}"})
            return

        yield _sse(
            {
                "type": "done",
                "chat": doc["chat"],
                "summary": doc["summary"],
                "revision": doc["revision"],
                "title": doc["title"],
                "removedCount": removed_count,
                "finishReason": final.get("finishReason") or "STOP",
                "usage": final.get("usage"),
                "maxTokens": final.get("maxTokens"),
                "warning": warning,
            }
        )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )

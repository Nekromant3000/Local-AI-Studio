"""Local OpenAI-compatible model discovery."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from ..config import load_settings
from ..llm import LLMError, list_models

router = APIRouter(prefix="/api/llm", tags=["llm"])


@router.get("/models")
async def models(
    base_url: str | None = Query(default=None, alias="baseUrl"),
    api_key: str | None = Query(default=None, alias="apiKey"),
) -> dict[str, Any]:
    settings = load_settings()
    effective_key = api_key if api_key is not None else str(settings.get("apiKey") or "")
    effective_url = base_url or str(settings.get("baseUrl") or "http://localhost:1234/v1")
    try:
        items = await list_models(effective_url, effective_key)
    except LLMError as exc:
        raise HTTPException(exc.status_code, exc.message) from exc
    return {
        "models": items,
        "baseUrl": effective_url,
        "count": len(items),
    }


@router.get("/presets")
def presets() -> dict[str, Any]:
    return {
        "presets": [
            {
                "id": "lmstudio",
                "name": "LM Studio",
                "baseUrl": "http://localhost:1234/v1",
                "hint": "Local Server → Start Server",
            },
            {
                "id": "ollama",
                "name": "Ollama",
                "baseUrl": "http://localhost:11434/v1",
                "hint": "ollama serve",
            },
            {
                "id": "llamacpp",
                "name": "llama.cpp",
                "baseUrl": "http://localhost:8080/v1",
                "hint": "server --port 8080",
            },
        ]
    }

"""Token counting with tiktoken and a deterministic fallback."""

from __future__ import annotations

import math
import threading
from functools import lru_cache
from typing import Any

IMAGE_TOKEN_ESTIMATE = 1101
FILE_TOKEN_ESTIMATE = 500

_encoding: Any = None
_encoding_lock = threading.Lock()
_encoding_failed = False


def _get_encoding() -> Any:
    global _encoding, _encoding_failed
    if _encoding is not None or _encoding_failed:
        return _encoding
    with _encoding_lock:
        if _encoding is not None or _encoding_failed:
            return _encoding
        try:
            import tiktoken

            _encoding = tiktoken.get_encoding("cl100k_base")
        except Exception:
            _encoding = None
            _encoding_failed = True
    return _encoding


@lru_cache(maxsize=1024)
def _count_cached(text: str) -> int:
    if not text:
        return 0
    encoding = _get_encoding()
    if encoding is not None:
        try:
            return len(encoding.encode(text, disallowed_special=()))
        except Exception:
            pass
    return max(1, math.ceil(len(text) / 4))


def count_tokens(text: str | None) -> int:
    return _count_cached(text or "")


def count_request(
    texts: list[str] | None = None,
    system: str | None = None,
    image_count: int = 0,
    file_count: int = 0,
    thought_texts: list[str] | None = None,
) -> dict[str, Any]:
    system_tokens = count_tokens(system)
    message_tokens = sum(count_tokens(text) for text in (texts or []))
    thought_tokens = sum(count_tokens(text) for text in (thought_texts or []))
    images = max(0, int(image_count)) * IMAGE_TOKEN_ESTIMATE
    files = max(0, int(file_count)) * FILE_TOKEN_ESTIMATE
    total = system_tokens + message_tokens + images + files
    return {
        "total": total,
        "system": system_tokens,
        "messages": message_tokens,
        "attachments": images + files,
        "images": images,
        "files": files,
        "thoughts": thought_tokens,
        "approximate": True,
        "tokenizer": "cl100k_base" if _get_encoding() is not None else "chars/4",
    }

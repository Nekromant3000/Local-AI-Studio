"""OpenAI-compatible local LLM client and GAS context builder."""

from __future__ import annotations

import asyncio
import base64
import io
import json
import re
from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import urlparse

import httpx

from .attachments import (
    ATTACHMENT_SLOTS,
    get_attachment_bytes,
    is_docx_attachment,
    is_text_attachment,
)
from .config import (
    CHAT_DIR,
    REASONING_EFFORT_BY_LEVEL,
    THINKING_MAX_OUTPUT_TOKENS,
    normalize_thinking_level,
)
from .docx import docx_bytes_to_markdown
from .tokens import count_tokens
from .url_context import build_context_blocks, gather_url_context
from .youtube_service import (
    build_youtube_context_blocks,
    gather_video_frames,
    gather_youtube_context,
)
from .utils import utc_now_iso

MAX_IMAGES = 12
MAX_TEXT_ATTACHMENT_CHARS = 30_000
MAX_IMAGE_BYTES = 12 * 1024 * 1024

OPEN_TAG_RE = re.compile(r"<\s*(think|thinking|reasoning)\b[^>]*>", re.IGNORECASE)
CLOSE_TAG_RE = re.compile(r"</\s*(think|thinking|reasoning)\s*>", re.IGNORECASE)


class LLMError(RuntimeError):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def normalize_base_url(value: str) -> str:
    url = (value or "").strip()
    if not url:
        raise LLMError("Укажите Base URL локального API", 400)
    if "://" not in url:
        url = f"http://{url}"
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise LLMError("Base URL должен начинаться с http:// или https://", 400)
    url = url.rstrip("/")
    path = urlparse(url).path.rstrip("/")
    if path and re.search(r"/v\d+[a-z]*$", path, re.IGNORECASE):
        return url
    return f"{url}/v1"


def _headers(api_key: str | None) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


async def list_models(base_url: str, api_key: str | None = None) -> list[dict[str, Any]]:
    base = normalize_base_url(base_url)
    timeout = httpx.Timeout(20.0, connect=10.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(f"{base}/models", headers=_headers(api_key))
    except httpx.ConnectError as exc:
        raise LLMError(
            f"Не удалось подключиться к {base}. Запущен ли LM Studio / Ollama?", 502
        ) from exc
    except httpx.TimeoutException as exc:
        raise LLMError(f"Локальный API не ответил за 20 секунд: {base}", 504) from exc
    except httpx.HTTPError as exc:
        raise LLMError(f"Ошибка подключения к {base}: {exc}", 502) from exc

    if response.status_code >= 400:
        raise LLMError(_http_error_message(response), response.status_code)

    try:
        payload = response.json()
    except ValueError as exc:
        raise LLMError("Локальный API вернул не JSON. Проверьте Base URL.", 502) from exc

    entries = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(entries, list):
        entries = payload.get("models") if isinstance(payload, dict) else None
    models: list[dict[str, Any]] = []
    seen: set[str] = set()
    for entry in entries or []:
        if isinstance(entry, str):
            model_id = entry
            extra: dict[str, Any] = {}
        elif isinstance(entry, dict):
            model_id = str(entry.get("id") or entry.get("name") or entry.get("model") or "")
            extra = entry
        else:
            continue
        if not model_id or model_id in seen:
            continue
        seen.add(model_id)
        models.append(
            {
                "id": model_id,
                "name": str(extra.get("name") or model_id),
                "ownedBy": str(extra.get("owned_by") or extra.get("ownedBy") or ""),
                "contextLength": extra.get("context_length") or extra.get("contextLength"),
            }
        )
    models.sort(key=lambda item: item["id"].casefold())
    return models


def _http_error_message(response: httpx.Response) -> str:
    body = ""
    try:
        body = response.text[:800]
        payload = json.loads(body)
        if isinstance(payload, dict):
            error = payload.get("error")
            if isinstance(error, dict) and error.get("message"):
                body = str(error["message"])
            elif isinstance(error, str):
                body = error
            elif payload.get("message"):
                body = str(payload["message"])
    except ValueError:
        pass
    return f"Локальный API вернул {response.status_code}: {body or response.reason_phrase}"


class ThinkTagFilter:
    """Routes text inside <think>...</think> to the reasoning channel."""

    def __init__(self) -> None:
        self.buffer = ""
        self.in_think = False

    def feed(self, text: str) -> list[tuple[str, str]]:
        if not text:
            return []
        self.buffer += text
        output: list[tuple[str, str]] = []
        while self.buffer:
            if self.in_think:
                match = CLOSE_TAG_RE.search(self.buffer)
                if match:
                    if match.start() > 0:
                        output.append(("reasoning", self.buffer[: match.start()]))
                    self.buffer = self.buffer[match.end() :]
                    self.in_think = False
                    continue
                keep = 12
                safe = max(0, len(self.buffer) - keep)
                if not safe:
                    break
                output.append(("reasoning", self.buffer[:safe]))
                self.buffer = self.buffer[safe:]
                continue

            match = OPEN_TAG_RE.search(self.buffer)
            if match:
                if match.start() > 0:
                    output.append(("content", self.buffer[: match.start()]))
                self.buffer = self.buffer[match.end() :]
                self.in_think = True
                continue
            keep = 12
            safe = max(0, len(self.buffer) - keep)
            if not safe:
                break
            output.append(("content", self.buffer[:safe]))
            self.buffer = self.buffer[safe:]
        return output

    def flush(self) -> list[tuple[str, str]]:
        if not self.buffer:
            return []
        channel = "reasoning" if self.in_think else "content"
        text = self.buffer
        self.buffer = ""
        self.in_think = False
        return [(channel, text)]


def _is_thought(chunk: dict[str, Any]) -> bool:
    if chunk.get("isThought"):
        return True
    parts = chunk.get("parts")
    return bool(parts) and isinstance(parts, list) and all(
        isinstance(part, dict) and part.get("thought") for part in parts
    )


def _content_to_parts(content: str | list[dict[str, Any]]) -> list[dict[str, Any]]:
    if isinstance(content, str):
        return [{"type": "text", "text": content}] if content else []
    return content


def _merge_content(
    left: str | list[dict[str, Any]], right: str | list[dict[str, Any]]
) -> str | list[dict[str, Any]]:
    if isinstance(left, str) and isinstance(right, str):
        if not left:
            return right
        if not right:
            return left
        return f"{left}\n\n{right}"
    return _content_to_parts(left) + _content_to_parts(right)


def _extract_delta_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        pieces: list[str] = []
        for item in value:
            if isinstance(item, str):
                pieces.append(item)
            elif isinstance(item, dict):
                if isinstance(item.get("text"), str):
                    pieces.append(item["text"])
                elif isinstance(item.get("content"), str):
                    pieces.append(item["content"])
        return "".join(pieces)
    return ""


def _prepare_image(raw_bytes: bytes, mime: str, name: str) -> str | None:
    if not raw_bytes or len(raw_bytes) > MAX_IMAGE_BYTES:
        return None
    final_mime = mime
    final_bytes = raw_bytes
    try:
        from PIL import Image, ImageOps

        with Image.open(io.BytesIO(raw_bytes)) as image:
            image = ImageOps.exif_transpose(image)
            width, height = image.size
            needs_resize = max(width, height) > 1600 or len(raw_bytes) > 1_500_000
            if needs_resize:
                image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
                if image.mode in ("RGBA", "LA", "P"):
                    background = Image.new("RGB", image.size, (255, 255, 255))
                    converted = image.convert("RGBA")
                    background.paste(converted, mask=converted.getchannel("A"))
                    image = background
                else:
                    image = image.convert("RGB")
                output = io.BytesIO()
                image.save(output, format="JPEG", quality=85, optimize=True)
                final_bytes = output.getvalue()
                final_mime = "image/jpeg"
            elif image.mode not in ("RGB", "RGBA", "L", "P"):
                image = image.convert("RGB")
                output = io.BytesIO()
                image.save(output, format="PNG", optimize=True)
                final_bytes = output.getvalue()
                final_mime = "image/png"
    except Exception:
        pass
    encoded = base64.b64encode(final_bytes).decode("ascii")
    return f"data:{final_mime};base64,{encoded}"


def _attachment_text(raw_bytes: bytes, name: str) -> str | None:
    try:
        text = raw_bytes.decode("utf-8")
    except UnicodeDecodeError:
        try:
            text = raw_bytes.decode("utf-8-sig")
        except UnicodeDecodeError:
            return None
    if len(text) > MAX_TEXT_ATTACHMENT_CHARS:
        text = text[:MAX_TEXT_ATTACHMENT_CHARS] + "\n\n[…файл обрезан…]"
    return text


MAX_SYSTEM_REMINDER_RULES_CHARS = 1200


def build_depth_reminder(system_text: str, thinking_level: str) -> str:
    """Служебный блок <system_reminder> для защиты от затухания системного промпта."""
    level = normalize_thinking_level(thinking_level)
    parts: list[str] = []
    if system_text.strip():
        rules = system_text.strip()
        if len(rules) > MAX_SYSTEM_REMINDER_RULES_CHARS:
            rules = rules[:MAX_SYSTEM_REMINDER_RULES_CHARS].rstrip() + " […]"
        parts.append(
            "Неукоснительно соблюдай ключевые правила системной инструкции этого чата:\n"
            + rules
        )
    if level in ("HIGH", "EXTRA_HIGH"):
        parts.append(
            "Перед ответом рассмотри 3–4 альтернативных сценария решения — от самого простого "
            "к самому сложному; сравни их, явно отметь подводные камни, риски и ограничения "
            "каждого варианта; выбери лучший и укажи запасной план (fallback) на случай, "
            "если он не сработает."
        )
    if level == "EXTRA_HIGH":
        parts.append(
            "Дополнительно: сделай максимально глубокий пошаговый разбор — декомпозируй задачу, "
            "проверь каждую гипотезу, приведи расчёты и промежуточные проверки, зафиксируй "
            "принятые допущения."
        )
    if not parts:
        return ""
    return "<system_reminder>\n" + "\n\n".join(parts) + "\n</system_reminder>"


def inject_depth_reminder(
    messages: list[dict[str, Any]], system_text: str, thinking_level: str
) -> None:
    """Вставляет <system_reminder> перед последним сообщением пользователя (в памяти,
    исходный JSON чата на диске не изменяется)."""
    reminder = build_depth_reminder(system_text, thinking_level)
    if not reminder:
        return
    for index in range(len(messages) - 1, -1, -1):
        message = messages[index]
        if message.get("role") != "user":
            continue
        content = message.get("content")
        if isinstance(content, list):
            content.insert(0, {"type": "text", "text": reminder})
        else:
            message["content"] = f"{reminder}\n\n{content or ''}".strip()
        return
    messages.append({"role": "user", "content": reminder})


def append_to_last_user(messages: list[dict[str, Any]], text: str) -> None:
    """Дописывает текстовый блок к последнему сообщению пользователя (в памяти
    запроса; JSON чата на диске не меняется)."""
    for index in range(len(messages) - 1, -1, -1):
        if messages[index].get("role") != "user":
            continue
        content = messages[index].get("content")
        if isinstance(content, list):
            content.append({"type": "text", "text": text})
        else:
            messages[index]["content"] = f"{content or ''}\n\n{text}".strip()
        return
    messages.append({"role": "user", "content": text})


def append_parts_to_last_user(
    messages: list[dict[str, Any]], parts: list[dict[str, Any]]
) -> None:
    """Дописывает части (текст/изображения) к последнему сообщению пользователя,
    переводя content в мультимодальный список (только в памяти запроса)."""
    if not parts:
        return
    for index in range(len(messages) - 1, -1, -1):
        if messages[index].get("role") != "user":
            continue
        content = messages[index].get("content")
        messages[index]["content"] = _content_to_parts(content) + parts
        return
    messages.append({"role": "user", "content": list(parts)})


def build_messages(
    raw: dict[str, Any],
    *,
    send_attachments: bool = True,
    thinking_level: str = "NONE",
    url_context: bool = False,
    chat_name: str | None = None,
) -> list[dict[str, Any]]:
    chunks = raw.get("chunkedPrompt", {}).get("chunks", [])
    system = raw.get("systemInstruction", {})
    system_text = str(system.get("text") or "") if isinstance(system, dict) else ""

    messages: list[dict[str, Any]] = []
    images_used = 0
    notes: list[str] = []

    def append(role: str, content: str | list[dict[str, Any]]) -> None:
        if not content:
            return
        if messages and messages[-1]["role"] == role:
            messages[-1]["content"] = _merge_content(messages[-1]["content"], content)
        else:
            messages.append({"role": role, "content": content})

    for index, chunk in enumerate(chunks):
        if not isinstance(chunk, dict) or _is_thought(chunk):
            continue
        role = chunk.get("role")
        text = str(chunk.get("text") or "")

        if role == "model":
            content = text
            executable = chunk.get("executableCode")
            if isinstance(executable, dict) and executable.get("code"):
                language = str(executable.get("language") or "").lower()
                block = f"```{language}\n{executable['code']}\n```"
                content = f"{content}\n\n{block}".strip()
            result = chunk.get("codeExecutionResult")
            if isinstance(result, dict) and result.get("output"):
                content = f"{content}\n\nРезультат выполнения:\n```\n{result['output']}\n```".strip()
            if content.strip():
                append("assistant", content.strip())
            continue

        if role != "user":
            continue

        parts: list[dict[str, Any]] = []
        if text.strip():
            parts.append({"type": "text", "text": text.strip()})
        has_media = False

        if send_attachments:
            for slot in ATTACHMENT_SLOTS:
                obj = chunk.get(slot)
                if not isinstance(obj, dict):
                    continue
                meta_name = str(obj.get("displayName") or f"вложение {index}")
                attachment = get_attachment_bytes(raw, index, slot)
                if slot in ("inlineImage", "driveImage"):
                    if images_used >= MAX_IMAGES:
                        notes.append(f"Изображение «{meta_name}» пропущено (лимит {MAX_IMAGES}).")
                        continue
                    if attachment:
                        raw_bytes, mime, name = attachment
                        data_url = _prepare_image(raw_bytes, mime, name)
                        if data_url:
                            parts.append({"type": "image_url", "image_url": {"url": data_url}})
                            has_media = True
                            images_used += 1
                        else:
                            notes.append(f"Изображение «{name}» не удалось прочитать.")
                    else:
                        drive_id = obj.get("id") or ""
                        notes.append(
                            f"Изображение Drive {drive_id} не привязано к локальному файлу."
                        )
                elif slot in ("inlineFile", "driveDocument"):
                    if attachment:
                        raw_bytes, mime, name = attachment
                        if is_docx_attachment(name, mime, raw_bytes):
                            try:
                                extracted = docx_bytes_to_markdown(raw_bytes)
                            except Exception:
                                extracted = ""
                            if extracted:
                                if len(extracted) > MAX_TEXT_ATTACHMENT_CHARS:
                                    extracted = (
                                        extracted[:MAX_TEXT_ATTACHMENT_CHARS]
                                        + "\n\n[…файл обрезан…]"
                                    )
                                parts.append(
                                    {
                                        "type": "text",
                                        "text": f"Содержимое документа «{name}»:\n{extracted}",
                                    }
                                )
                                has_media = True
                            else:
                                notes.append(
                                    f"Из документа «{name}» не удалось извлечь текст."
                                )
                        elif is_text_attachment(name, mime):
                            extracted = _attachment_text(raw_bytes, name)
                            if extracted:
                                parts.append(
                                    {
                                        "type": "text",
                                        "text": f"Содержимое файла «{name}»:\n```\n{extracted}\n```",
                                    }
                                )
                                has_media = True
                            else:
                                notes.append(f"Файл «{name}» не удалось декодировать как текст.")
                        else:
                            notes.append(
                                f"Документ «{name}» ({mime}) не извлекается автоматически; "
                                "при необходимости приложите текст."
                            )
                    else:
                        notes.append(f"Документ Drive {obj.get('id') or ''} не привязан локально.")
                elif slot == "youtubeVideo":
                    video_id = obj.get("id") or ""
                    parts.append(
                        {
                            "type": "text",
                            "text": f"Видео YouTube: https://www.youtube.com/watch?v={video_id}",
                        }
                    )
                    has_media = True
                elif slot == "driveVideo":
                    notes.append(f"Видео Drive {obj.get('id') or ''} не передаётся в контекст.")
        else:
            for slot in ATTACHMENT_SLOTS:
                if isinstance(chunk.get(slot), dict):
                    notes.append("Вложения не передаются (режим отправки вложений выключен).")
                    break

        if not parts and notes and len(messages) == 0:
            parts.append({"type": "text", "text": "Проанализируй приложенные материалы."})

        if not parts:
            continue
        if len(parts) == 1 and parts[0].get("type") == "text":
            append("user", parts[0]["text"])
        else:
            append("user", parts)

    if notes:
        note_text = "\n".join(f"- {note}" for note in notes[:20])
        if messages and messages[-1]["role"] == "user":
            messages[-1]["content"] = _merge_content(
                messages[-1]["content"], f"Примечания к вложениям:\n{note_text}"
            )
        else:
            messages.append({"role": "user", "content": f"Примечания к вложениям:\n{note_text}"})

    if not messages:
        raise LLMError("В контексте нет сообщений для генерации", 400)

    if url_context:
        records = gather_url_context(raw, chat_name, fetch_missing=True)
        blocks = build_context_blocks(records)
        if blocks:
            url_block = (
                "Контекст ссылок из переписки (автоматически извлечённый текст страниц):\n\n"
                + "\n\n".join(blocks)
            )
            append_to_last_user(messages, url_block)

    # Транскрипты и кадры YouTube-видео подставляются ТОЛЬКО если они уже есть в
    # локальном кэше (загружены явным POST /api/youtube/parse и /extract-frames) —
    # никаких сетевых запросов при обычном открытии чатов и генерации.
    youtube_records = gather_youtube_context(raw)
    youtube_blocks = build_youtube_context_blocks(youtube_records)
    if youtube_blocks:
        youtube_block = (
            "Транскрипты YouTube-видео из переписки (расшифрованы локально):\n\n"
            + "\n\n".join(youtube_blocks)
        )
        append_to_last_user(messages, youtube_block)

    # Кадры из кэша (умная нарезка auto / capture-frame manual) — мультимодальное
    # дополнение к транскриптам: каждый кадр подписан таймкодом [MM:SS].
    frame_parts: list[dict[str, Any]] = []
    frame_notes: list[str] = []
    frame_groups = gather_video_frames(
        [str(record.get("videoId") or "") for record in youtube_records]
    )
    if frame_groups:
        frame_parts.append(
            {
                "type": "text",
                "text": "Кадры YouTube-видео из переписки (по таймкодам, см. транскрипты выше):",
            }
        )
    for group in frame_groups:
        for frame in group["frames"]:
            caption = f"Кадр [{frame['timecode']}] видео «{group['title']}»:"
            if images_used >= MAX_IMAGES:
                frame_notes.append(
                    f"Кадр {caption} пропущен (лимит {MAX_IMAGES} изображений)."
                )
                continue
            try:
                frame_bytes = frame["path"].read_bytes()
            except OSError:
                frame_notes.append(f"Кадр {caption} не удалось прочитать с диска.")
                continue
            data_url = _prepare_image(frame_bytes, "image/jpeg", frame["filename"])
            if not data_url:
                frame_notes.append(f"Кадр {caption} не удалось подготовить к отправке.")
                continue
            frame_parts.append({"type": "text", "text": caption})
            frame_parts.append({"type": "image_url", "image_url": {"url": data_url}})
            images_used += 1
    if len(frame_parts) > 1:
        append_parts_to_last_user(messages, frame_parts)
    if frame_notes:
        append_to_last_user(
            messages,
            "Примечания к кадрам:\n" + "\n".join(f"- {note}" for note in frame_notes[:20]),
        )

    if system_text.strip():
        messages.insert(0, {"role": "system", "content": system_text.strip()})
    inject_depth_reminder(messages, system_text, thinking_level)
    return messages


def prepare_truncation(
    raw: dict[str, Any], start_index: int | None
) -> tuple[list[dict[str, Any]], int]:
    chunks = raw.get("chunkedPrompt", {}).get("chunks", [])
    if not isinstance(chunks, list) or not chunks:
        raise LLMError("Чат пуст: сначала добавьте сообщение пользователя", 400)
    total = len(chunks)

    if start_index is None:
        last = chunks[-1]
        if not isinstance(last, dict):
            raise LLMError("Повреждённый последний фрейм", 400)
        if last.get("role") == "user" and not _is_thought(last):
            cut = total
        else:
            cut = total - 1
            while cut > 0 and _is_thought(chunks[cut - 1]):
                cut -= 1
    else:
        if not 0 <= start_index < total:
            raise LLMError("Индекс фрейма вне диапазона", 400)
        target = chunks[start_index]
        if not isinstance(target, dict):
            raise LLMError("Повреждённый фрейм", 400)
        if target.get("role") == "user":
            cut = start_index + 1
        else:
            cut = start_index
            while cut > 0 and _is_thought(chunks[cut - 1]):
                cut -= 1

    kept = chunks[:cut]
    if not any(
        isinstance(chunk, dict)
        and chunk.get("role") == "user"
        and not _is_thought(chunk)
        for chunk in kept
    ):
        raise LLMError("Нет сообщения пользователя для генерации", 400)
    return kept, total - cut


def make_generated_chunks(
    reasoning: str,
    content: str,
    *,
    started_at: str,
    finished_at: str,
    finish_reason: str = "STOP",
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    if reasoning.strip():
        text = reasoning.strip()
        result.append(
            {
                "text": text,
                "role": "model",
                "tokenCount": count_tokens(text),
                "isThought": True,
                "thinkingBudget": -1,
                "parts": [{"text": text, "thought": True}],
                "createTime": started_at,
            }
        )
    if content.strip():
        text = content.strip()
        result.append(
            {
                "text": text,
                "role": "model",
                "finishReason": finish_reason or "STOP",
                "tokenCount": count_tokens(text),
                "parts": [{"text": text}],
                "createTime": finished_at,
            }
        )
    return result


async def stream_completion(
    *,
    base_url: str,
    api_key: str | None,
    model: str,
    messages: list[dict[str, Any]],
    thinking_level: str,
    temperature: float,
    top_p: float,
    max_output_tokens: int,
) -> AsyncIterator[dict[str, Any]]:
    base = normalize_base_url(base_url)
    if not model:
        raise LLMError("Выберите модель локального API", 400)

    level = normalize_thinking_level(thinking_level)
    thinking_on = level != "NONE"
    effective_max = THINKING_MAX_OUTPUT_TOKENS if thinking_on else max(1, int(max_output_tokens))
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": True,
        "max_tokens": effective_max,
        "reasoning_effort": REASONING_EFFORT_BY_LEVEL.get(level, "none"),
    }
    if not thinking_on:
        payload["temperature"] = float(temperature)
        payload["top_p"] = float(top_p)

    timeout = httpx.Timeout(connect=15.0, read=900.0, write=120.0, pool=15.0)
    filter_ = ThinkTagFilter()
    reasoning_parts: list[str] = []
    content_parts: list[str] = []
    usage: dict[str, Any] | None = None
    finish_reason = "STOP"
    started_at = utc_now_iso()

    def emit(channel: str, text: str) -> dict[str, Any]:
        if channel == "reasoning":
            reasoning_parts.append(text)
            return {"type": "reasoning_delta", "text": text}
        content_parts.append(text)
        return {"type": "content_delta", "text": text}

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                f"{base}/chat/completions",
                headers=_headers(api_key),
                json=payload,
            ) as response:
                if response.status_code >= 400:
                    await response.aread()
                    raise LLMError(_http_error_message(response), response.status_code)

                content_type = response.headers.get("content-type", "")
                if "application/json" in content_type:
                    data = await response.json()
                    choice = (data.get("choices") or [{}])[0] if isinstance(data, dict) else {}
                    message = choice.get("message") or {}
                    reasoning = _extract_delta_text(message.get("reasoning_content"))
                    content = _extract_delta_text(message.get("content"))
                    usage = data.get("usage") if isinstance(data, dict) else None
                    finish_reason = _map_finish_reason(choice.get("finish_reason"))
                    for channel, text in filter_.feed(content):
                        yield emit(channel, text)
                    if reasoning:
                        yield emit("reasoning", reasoning)
                else:
                    async for line in response.aiter_lines():
                        line = line.strip()
                        if not line or line.startswith(":") or line.startswith("event:"):
                            continue
                        if line.startswith("data:"):
                            line = line[5:].strip()
                        if not line or line == "[DONE]":
                            if line == "[DONE]":
                                break
                            continue
                        try:
                            event = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if not isinstance(event, dict):
                            continue
                        if isinstance(event.get("error"), (dict, str)):
                            error = event["error"]
                            message = error.get("message") if isinstance(error, dict) else str(error)
                            raise LLMError(str(message or "Ошибка стриминга"), 502)
                        if isinstance(event.get("usage"), dict):
                            usage = event["usage"]
                        choices = event.get("choices")
                        if not isinstance(choices, list) or not choices:
                            continue
                        choice = choices[0] if isinstance(choices[0], dict) else {}
                        if choice.get("finish_reason"):
                            finish_reason = _map_finish_reason(choice.get("finish_reason"))
                        delta = choice.get("delta") or choice.get("message") or {}
                        reasoning = _extract_delta_text(
                            delta.get("reasoning_content")
                            or delta.get("reasoning")
                            or delta.get("thinking")
                            or delta.get("analysis")
                        )
                        if reasoning:
                            yield emit("reasoning", reasoning)
                        content = _extract_delta_text(delta.get("content"))
                        if content:
                            for channel, text in filter_.feed(content):
                                yield emit(channel, text)
    except httpx.ConnectError as exc:
        raise LLMError(
            f"Не удалось подключиться к {base}. Проверьте, что LM Studio / Ollama запущен.", 502
        ) from exc
    except httpx.TimeoutException as exc:
        raise LLMError("Локальный API не ответил вовремя (таймаут чтения).", 504) from exc
    except httpx.HTTPError as exc:
        raise LLMError(f"Ошибка локального API: {exc}", 502) from exc

    for channel, text in filter_.flush():
        yield emit(channel, text)

    yield {
        "type": "final",
        "content": "".join(content_parts),
        "reasoning": "".join(reasoning_parts),
        "usage": usage,
        "finishReason": finish_reason,
        "startedAt": started_at,
        "finishedAt": utc_now_iso(),
        "maxTokens": effective_max,
    }


def _map_finish_reason(value: Any) -> str:
    if not value:
        return "STOP"
    text = str(value).lower()
    if text in ("length", "max_tokens", "max_output_tokens"):
        return "MAX_TOKENS"
    if text in ("content_filter", "safety"):
        return "SAFETY"
    if text in ("tool_calls", "function_call"):
        return "STOP"
    return "STOP"


def get_attachment_context_summary(raw: dict[str, Any]) -> dict[str, int]:
    images = 0
    documents = 0
    for chunk in raw.get("chunkedPrompt", {}).get("chunks", []):
        if not isinstance(chunk, dict):
            continue
        for slot in ("inlineImage", "driveImage"):
            if isinstance(chunk.get(slot), dict):
                images += 1
        for slot in ("inlineFile", "driveDocument"):
            if isinstance(chunk.get(slot), dict):
                documents += 1
    return {"images": images, "documents": documents}

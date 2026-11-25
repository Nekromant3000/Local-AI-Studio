"""PNG-миниатюра первой страницы .docx (ширина ~360px, пропорции A4).

Сначала пробуем отрендерить настоящую первую страницу через установленный
MS Word: COM ``Word.Application`` (pywin32) экспортует документ в PDF во
временной папке, затем PyMuPDF (``fitz``) растеризует первую страницу в PNG.

Если Word/COM/PDF недоступны или выдали ошибку — рисуем через Pillow
аккуратное превью белого листа A4 с реальным заголовком, первыми строками
текста и таблицами, извлечёнными из .docx (python-docx).
"""

from __future__ import annotations

import io
import logging
import shutil
import tempfile
import uuid
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from .docx import _heading_level, _is_list, _iter_body_items, _table_to_markdown

log = logging.getLogger(__name__)

THUMB_WIDTH = 360
A4_RATIO = 297 / 210  # высота/ширина портретного листа A4
_RENDER_SCALE = 2  # рендерим PDF с 2x запасом и сглаживаем до 360px

_FONT_CANDIDATES_REGULAR = (
    "calibri.ttf",
    "segoeui.ttf",
    "arial.ttf",
    "tahoma.ttf",
    "verdana.ttf",
)
_FONT_CANDIDATES_BOLD = (
    "calibrib.ttf",
    "segoeuib.ttf",
    "arialbd.ttf",
    "tahoma.ttf",
    "verdanab.ttf",
)


def _load_font(candidates: tuple[str, ...], size: int) -> ImageFont.ImageFont:
    for name in candidates:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    try:
        return ImageFont.load_default(size)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


def _pdf_first_page_png(pdf_bytes: bytes) -> bytes | None:
    """Рендер 1-й страницы PDF в PNG через PyMuPDF (fitz)."""
    try:
        import pymupdf as fitz  # PyMuPDF >= 1.24: новое имя модуля (fitz — устаревший алиас)
    except ImportError:
        try:
            import fitz
        except ImportError:
            log.debug("PyMuPDF (fitz) не установлен — пропускаем PDF-рендер")
            return None
    try:
        with fitz.open("pdf", pdf_bytes) as pdf:
            if pdf.page_count == 0:
                return None
            page = pdf.load_page(0)
            rect = page.rect
            if rect.width <= 0 or rect.height <= 0:
                return None
            zoom = (THUMB_WIDTH * _RENDER_SCALE) / rect.width
            pixmap = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
            image = Image.open(io.BytesIO(pixmap.tobytes("png")))
            image.thumbnail((THUMB_WIDTH, THUMB_WIDTH * 4), Image.Resampling.LANCZOS)
            out = io.BytesIO()
            image.save(out, format="PNG", optimize=True)
            return out.getvalue()
    except Exception as exc:  # noqa: BLE001 — любой сбой PDF-пути ведёт на Pillow-fallback
        log.debug("PDF-рендер первой страницы не удался: %s", exc)
        return None


def _render_via_word(data: bytes) -> bytes | None:
    """Реальная первая страница: MS Word (COM) → PDF → PyMuPDF → PNG."""
    try:
        import pythoncom
        import win32com.client
    except ImportError:
        log.debug("pywin32 недоступен — Word COM не используется")
        return None

    tmp_dir = Path(tempfile.mkdtemp(prefix="docx_thumb_"))
    source = tmp_dir / f"source-{uuid.uuid4().hex}.docx"
    target = tmp_dir / "preview.pdf"
    word = None
    document = None
    co_initialized = False
    try:
        source.write_bytes(data)
        pythoncom.CoInitialize()
        co_initialized = True
        word = win32com.client.DispatchEx("Word.Application")
        word.Visible = False
        try:
            word.DisplayAlerts = 0
        except Exception:  # noqa: BLE001
            pass
        document = word.Documents.Open(
            str(source), ReadOnly=True, AddToRecentFiles=False, Visible=False
        )
        document.ExportAsFixedFormat(str(target), 17)  # wdExportFormatPDF
        document.Close(False)
        document = None
        word.Quit()
        word = None
        return _pdf_first_page_png(target.read_bytes())
    except Exception as exc:  # noqa: BLE001 — нет Word/COM/офисных ошибок: нужен fallback
        log.debug("Рендер через MS Word недоступен: %s", exc)
        return None
    finally:
        for closer in (
            lambda: document is not None and document.Close(False),
            lambda: word is not None and word.Quit(),
        ):
            try:
                closer()
            except Exception:  # noqa: BLE001
                pass
        if co_initialized:
            try:
                pythoncom.CoUninitialize()
            except Exception:  # noqa: BLE001
                pass
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _extract_blocks(data: bytes) -> list[tuple[str, str]]:
    """Пары (вид, текст): 'h' — заголовок, 'li' — список, 'p' — абзац, 'table' — таблица."""
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    document = Document(io.BytesIO(data))
    blocks: list[tuple[str, str]] = []
    for item in _iter_body_items(document):
        if isinstance(item, Paragraph):
            text = item.text.strip()
            if not text:
                continue
            try:
                style_name = item.style.name if item.style is not None else ""
            except Exception:  # noqa: BLE001
                style_name = ""
            if _heading_level(style_name):
                blocks.append(("h", text))
            elif _is_list(style_name):
                blocks.append(("li", text))
            else:
                blocks.append(("p", text))
        elif isinstance(item, Table):
            table_md = _table_to_markdown(item)
            if table_md:
                blocks.append(("table", table_md))
    return blocks


def _wrap_text(
    draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int
) -> list[str]:
    """Перенос строки по ширине листа."""
    words = text.split()
    if not words:
        return []
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if not current or draw.textlength(candidate, font=font) <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
            # очень длинное слово режем по символам
            while draw.textlength(current, font=font) > max_width and len(current) > 1:
                cut = len(current)
                while cut > 1 and draw.textlength(current[:cut], font=font) > max_width:
                    cut -= 1
                lines.append(current[:cut])
                current = current[cut:]
    if current:
        lines.append(current)
    return lines


def _draw_table(
    draw: ImageDraw.ImageDraw,
    table_md: str,
    font: ImageFont.ImageFont,
    x: int,
    y: int,
    width: int,
) -> int:
    """Рисует сетку таблицы (не более 5 строк × 4 колонок); возвращает новую Y."""
    rows: list[list[str]] = []
    for line in table_md.splitlines():
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if all(set(cell) <= {"-", ":", " "} and cell for cell in cells):
            continue  # разделитель markdown-таблицы
        rows.append(cells[:4])
        if len(rows) >= 5:
            break
    if not rows:
        return y
    columns = max(len(row) for row in rows)
    column_width = max(24, width // max(columns, 1))
    row_height = 18
    for row_index, row in enumerate(rows):
        top = y + row_index * row_height
        for col_index in range(columns):
            left = x + col_index * column_width
            draw.rectangle(
                [left, top, left + column_width, top + row_height],
                outline="#b9c2cf",
                width=1,
            )
            cell = row[col_index] if col_index < len(row) else ""
            if cell:
                clipped = _wrap_text(draw, cell, font, column_width - 6)[:1]
                for text in clipped:
                    draw.text((left + 3, top + 4), text, font=font, fill="#2f3a4d")
    return y + len(rows) * row_height


def _render_via_pillow(data: bytes) -> bytes | None:
    """Pillow-превью: белый лист A4 с реальным заголовком, первыми строками и таблицами."""
    try:
        blocks = _extract_blocks(data)
    except Exception as exc:  # noqa: BLE001
        log.debug("Не удалось разобрать .docx для Pillow-превью: %s", exc)
        return None

    width = THUMB_WIDTH
    height = round(width * A4_RATIO)
    image = Image.new("RGB", (width, height), "#f4f6f9")
    draw = ImageDraw.Draw(image)
    margin_x = 14
    page_top = 10
    page_rect = [margin_x, page_top, width - margin_x, height - page_top]
    draw.rectangle(page_rect, fill="#ffffff", outline="#d7dde6", width=1)

    font_title = _load_font(_FONT_CANDIDATES_BOLD, 15)
    font_heading = _load_font(_FONT_CANDIDATES_BOLD, 12)
    font_body = _load_font(_FONT_CANDIDATES_REGULAR, 10)
    font_small = _load_font(_FONT_CANDIDATES_REGULAR, 9)
    font_badge = _load_font(_FONT_CANDIDATES_BOLD, 9)

    left = page_rect[0] + 16
    right = page_rect[2] - 16
    max_text_width = right - left
    y = page_top + 18

    title_done = False
    drawn_lines = 0
    for kind, text in blocks:
        if y > page_rect[3] - 34:
            break
        if kind == "table":
            y = _draw_table(draw, text, font_small, left, y, max_text_width) + 10
            continue
        if kind == "h" and not title_done:
            for line in _wrap_text(draw, text, font_title, max_text_width)[:3]:
                draw.text((left, y), line, font=font_title, fill="#17233b")
                y += 20
            draw.line([left, y - 6, left + 56, y - 6], fill="#7c8cff", width=2)
            y += 8
            title_done = True
            continue
        if kind == "h":
            for line in _wrap_text(draw, text, font_heading, max_text_width)[:2]:
                draw.text((left, y), line, font=font_heading, fill="#22304f")
                y += 16
            y += 3
            continue
        prefix = "•  " if kind == "li" else ""
        body_lines = _wrap_text(draw, f"{prefix}{text}", font_body, max_text_width)
        for line in body_lines[:8]:
            if y > page_rect[3] - 26 or drawn_lines >= 18:
                break
            draw.text((left, y), line, font=font_body, fill="#3d4a61")
            y += 14
            drawn_lines += 1
        y += 4

    # аккуратная подпись листа внизу
    footer = "Предпросмотр первой страницы"
    try:
        text_width = draw.textlength(footer, font=font_badge)
    except AttributeError:
        text_width = len(footer) * 5
    draw.text(
        (page_rect[2] - 16 - text_width, page_rect[3] - 18),
        footer,
        font=font_badge,
        fill="#93a0b4",
    )

    out = io.BytesIO()
    image.save(out, format="PNG", optimize=True)
    return out.getvalue()


def generate_docx_thumbnail(data: bytes) -> bytes | None:
    """PNG миниатюра первой страницы .docx (~360px по ширине, пропорции A4).

    Word COM → PDF → PyMuPDF; при недоступности/ошибке — Pillow-превью по
    содержимому документа. ``None`` возвращается только если не сработал ни
    один путь (например, повреждённый файл).
    """
    png = _render_via_word(data)
    if png:
        return png
    return _render_via_pillow(data)

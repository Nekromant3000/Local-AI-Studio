"""Извлечение текста из .docx в читаемый Markdown (python-docx)."""

from __future__ import annotations

import io
import re

from docx import Document
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph

_HEADING_RE = re.compile(r"^(?:heading|заголовок)\s*(\d)", re.IGNORECASE)
_LIST_RE = re.compile(r"^(list paragraph|listbullet|абзац списка|списочн)", re.IGNORECASE)


def _heading_level(style_name: str) -> int | None:
    """Уровень заголовка по имени стиля (в т.ч. русских сборок Word)."""
    if not style_name:
        return None
    match = _HEADING_RE.match(style_name)
    if match:
        level = int(match.group(1))
        return min(max(level, 1), 6)
    if style_name.lower() in ("title", "título", "заголовок"):
        return 1
    return None


def _is_list(style_name: str) -> bool:
    return bool(style_name) and bool(_LIST_RE.match(style_name))


def _table_to_markdown(table: Table) -> str:
    rows: list[list[str]] = []
    for row in table.rows:
        cells = []
        for cell in row.cells:
            text = " ".join(p.text.strip() for p in cell.paragraphs if p.text.strip())
            cells.append(text.replace("|", "\\|").replace("\n", " "))
        rows.append(cells)
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    lines: list[str] = []
    for index, row in enumerate(rows):
        padded = row + [""] * (width - len(row))
        lines.append("| " + " | ".join(padded) + " |")
        if index == 0:
            lines.append("|" + " --- |" * width)
    return "\n".join(lines)


def _iter_body_items(document: Document):
    """Абзацы и таблицы в исходном порядке тела документа."""
    body = document.element.body
    for child in body.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, document)
        elif child.tag == qn("w:tbl"):
            yield Table(child, document)


def docx_bytes_to_markdown(data: bytes) -> str:
    """Конвертирует .docx (байты) в Markdown: заголовки, списки, таблицы."""
    document = Document(io.BytesIO(data))
    blocks: list[str] = []
    for item in _iter_body_items(document):
        if isinstance(item, Paragraph):
            text = item.text.strip()
            if not text:
                continue
            try:
                style_name = item.style.name if item.style is not None else ""
            except Exception:
                style_name = ""
            level = _heading_level(style_name)
            if level:
                blocks.append("#" * level + " " + text)
            elif _is_list(style_name):
                blocks.append("- " + text)
            else:
                blocks.append(text)
        elif isinstance(item, Table):
            table_md = _table_to_markdown(item)
            if table_md:
                blocks.append(table_md)
    return "\n\n".join(blocks).strip()

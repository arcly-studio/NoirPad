"""Single-note TXT/HTML export and the bulk HTML zip."""

import io
from datetime import datetime

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..export import attachment, build_html_zip, build_note_html, safe_filename
from ..storage import read_data
from ..tree import find_item_by_id, note_exists

router = APIRouter()


def _note_for_export(note_id: str) -> tuple[dict, str, str]:
    data = read_data()
    content = data.get("notes", {}).get(note_id)
    if content is None or not note_exists(data, note_id):
        raise HTTPException(404, "Note not found")
    item = find_item_by_id(data["tree"], note_id)
    return data, (item["name"] if item else note_id), content


def _download(body: bytes, media_type: str, filename: str) -> StreamingResponse:
    return StreamingResponse(io.BytesIO(body), media_type=media_type,
                             headers={"Content-Disposition": attachment(filename)})


@router.get("/api/export/{note_id}/txt")
async def export_txt(note_id: str):
    _, name, content = _note_for_export(note_id)
    return _download(content.encode("utf-8"), "text/plain; charset=utf-8",
                     safe_filename(name) + ".txt")


@router.get("/api/export/{note_id}/html")
async def export_html(note_id: str):
    data, name, content = _note_for_export(note_id)
    doc = build_note_html(name, content, data.get("font_family", "Cascadia Code"),
                          data.get("font_size", 12))
    return _download(doc.encode("utf-8"), "text/html; charset=utf-8",
                     safe_filename(name) + ".html")


@router.get("/api/notes/export")
async def export_all_notes():
    """Every plain note as .html in one zip (encrypted ones are listed)."""
    filename = f"noirpad-notes-{datetime.now().strftime('%Y-%m-%d')}.zip"
    return _download(build_html_zip(read_data()), "application/zip", filename)

"""Single-note TXT/HTML export, bulk HTML / Markdown zips, Markdown import."""

import io
from datetime import datetime

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import StreamingResponse

from .. import config
from ..errors import ApiError
from ..export import (attachment, build_html_zip, build_note_html, image_data_uri,
                      safe_filename)
from ..markdown_io import build_markdown_zip, import_files
from ..storage import read_data
from ..tree import find_item_by_id, note_exists
from ..uploads import read_upload_limited

router = APIRouter()


def _note_for_export(note_id: str) -> tuple[dict, str, str]:
    data = read_data()
    content = data.get("notes", {}).get(note_id)
    if content is None or not note_exists(data, note_id):
        raise ApiError(404, "note_not_found")
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
                          data.get("font_size", 12), image_data_uri)   # one file: images inline
    return _download(doc.encode("utf-8"), "text/html; charset=utf-8",
                     safe_filename(name) + ".html")


@router.get("/api/notes/export")
async def export_all_notes():
    """Every plain note as .html in one zip (encrypted ones are listed)."""
    filename = f"noirpad-notes-{datetime.now().strftime('%Y-%m-%d')}.zip"
    return _download(build_html_zip(read_data()), "application/zip", filename)


@router.get("/api/notes/export-md")
async def export_markdown():
    """Every plain note as .md in one zip; X-NoirPad-Skipped = locked notes left out."""
    body, skipped = build_markdown_zip(read_data())
    response = _download(body, "application/zip",
                         f"noirpad-markdown-{datetime.now().strftime('%Y-%m-%d')}.zip")
    response.headers["X-NoirPad-Skipped"] = str(skipped)
    return response


@router.post("/api/notes/import-md")
async def import_markdown(files: list[UploadFile] = File(...)):
    """Add notes from .md files or a zip of them. Never changes existing notes."""
    blobs = [(f.filename or "", await read_upload_limited(f, config.MAX_BACKUP_BYTES))
             for f in files]
    return import_files(blobs)

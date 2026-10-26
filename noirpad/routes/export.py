"""Single-note TXT/HTML export, bulk HTML / Markdown zips, Markdown import."""

from datetime import datetime

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from .. import config
from ..crypto import is_encrypted_content
from ..errors import ApiError
from ..export import (attachment, build_html_zip, build_note_html, image_data_uri,
                      safe_filename)
from ..markdown_io import build_markdown_zip, build_note_markdown, import_files
from ..storage import read_data
from ..tree import find_item_by_id, note_exists
from ..uploads import read_upload_limited

router = APIRouter()

# R8: handlers that only read / build files are plain `def`: FastAPI runs
# them in its thread pool, so a big export never stalls the other requests.


def _note_for_export(note_id: str) -> tuple[dict, str, str]:
    data = read_data()
    content = data.get("notes", {}).get(note_id)
    if content is None or not note_exists(data, note_id):
        raise ApiError(404, "note_not_found")
    # E9: a locked note is never exported as its cipher envelope (TXT, HTML
    # and Markdown alike) — the user removes the lock first.
    if is_encrypted_content(content):
        raise ApiError(409, "export_locked_note")
    item = find_item_by_id(data["tree"], note_id)
    return data, (item["name"] if item else note_id), content


def _download(body: bytes, media_type: str, filename: str) -> Response:
    """The whole file in one response. R1: StreamingResponse(BytesIO) sent it
    line by line – tens of thousands of tiny chunks, ~20 s for 20 MB."""
    return Response(body, media_type=media_type,
                    headers={"Content-Disposition": attachment(filename)})


@router.get("/api/export/{note_id}/txt")
def export_txt(note_id: str):
    _, name, content = _note_for_export(note_id)
    return _download(content.encode("utf-8"), "text/plain; charset=utf-8",
                     safe_filename(name) + ".txt")


@router.get("/api/export/{note_id}/html")
def export_html(note_id: str):
    data, name, content = _note_for_export(note_id)
    doc = build_note_html(name, content, data.get("font_family", "Cascadia Code"),
                          data.get("font_size", 12), image_data_uri)   # one file: images inline
    return _download(doc.encode("utf-8"), "text/html; charset=utf-8",
                     safe_filename(name) + ".html")


@router.get("/api/export/{note_id}/md")
def export_md(note_id: str):
    _, name, content = _note_for_export(note_id)
    body, media_type, filename = build_note_markdown(name, content)
    return _download(body, media_type, filename)


@router.get("/api/notes/export")
def export_all_notes():
    """Every plain note as .html in one zip (encrypted ones are listed)."""
    filename = f"noirpad-notes-{datetime.now().strftime('%Y-%m-%d')}.zip"
    return _download(build_html_zip(read_data()), "application/zip", filename)


@router.get("/api/notes/export-md")
def export_markdown():
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
    return await run_in_threadpool(import_files, blobs)   # R8: not on the event loop

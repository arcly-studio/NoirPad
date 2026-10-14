"""Desktop app: exports are saved through a native "Save as" dialog (N6).

In WebView2 a download opens Edge's "Downloads" panel. Instead the
frontend (api.js download()) sends X-NoirPad-Save-As: 1 with the export
request. In the desktop app the HTTP guard (app.py) hands the finished
response to save_response(): the dialog is pre-filled with the name from
Content-Disposition, the backend writes the file and the page gets JSON
({"saved": false} after Cancel) instead of the bytes. "Open folder" in the
page's toast then shows the file in Explorer through a token, so the page
never handles file-system paths.

Web / self-host mode never gets here: the browser downloads as usual.
"""

import logging
import os
import re
import secrets
import subprocess
from pathlib import Path
from typing import Optional
from urllib.parse import unquote

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from .runtime import RUNTIME

log = logging.getLogger("noirpad")

SAVE_HEADER = "x-noirpad-save-as"
MAX_REMEMBERED = 50          # tokens for "Open folder" kept per run


def wants_native_save(request: Request) -> bool:
    return (RUNTIME.mode == "desktop" and RUNTIME.save_dialog is not None
            and request.headers.get(SAVE_HEADER) == "1")


def filename_from(disposition: str) -> str:
    """'attachment; filename="a.zip"; filename*=UTF-8''%C3%A1.zip' → 'á.zip'."""
    star = re.search(r"filename\*=UTF-8''([^;]+)", disposition, re.I)
    if star:
        return unquote(star.group(1).strip())
    plain = re.search(r'filename="([^"]*)"', disposition, re.I)
    return plain.group(1) if plain else ""


def _write(path: Path, body: bytes) -> None:
    """Write next to the target and rename, so a failed write never leaves a
    half file under the chosen name (or destroys the file it replaces)."""
    tmp = path.with_name(f".{path.name}.{secrets.token_hex(4)}.tmp")
    try:
        tmp.write_bytes(body)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def _remember(path: Path) -> str:
    token = secrets.token_urlsafe(16)
    RUNTIME.saved_files[token] = path
    while len(RUNTIME.saved_files) > MAX_REMEMBERED:
        RUNTIME.saved_files.pop(next(iter(RUNTIME.saved_files)))
    return token


async def save_response(response: Response) -> Response:
    """Turn a finished download response into a saved file + JSON."""
    disposition = response.headers.get("content-disposition", "")
    if response.status_code != 200 or "attachment" not in disposition.lower():
        return response
    chunks = [chunk async for chunk in response.body_iterator]
    body = b"".join(c.encode("utf-8") if isinstance(c, str) else c for c in chunks)
    # The page still needs X-NoirPad-Skipped & co.
    extra = {k: v for k, v in response.headers.items() if k.lower().startswith("x-noirpad-")}

    chosen = await run_in_threadpool(RUNTIME.save_dialog, filename_from(disposition) or "noirpad")
    if not chosen:
        return JSONResponse({"saved": False}, headers=extra)
    path = Path(chosen)
    try:
        await run_in_threadpool(_write, path, body)
    except OSError as exc:
        log.error("Saving an export failed: %s", exc)
        return JSONResponse({"detail": {"code": "save_failed", "params": {"error": exc.strerror or str(exc)}}},
                            status_code=500)
    log.info("Export saved (%d bytes)", len(body))   # never the path: it can name the user
    return JSONResponse({"saved": True, "name": path.name, "token": _remember(path)}, headers=extra)


def saved_file(token: str) -> Optional[Path]:
    path = RUNTIME.saved_files.get(token)
    return path if path is not None and path.exists() else None


def reveal(path: Path) -> None:
    """Open Explorer on the folder with *path* selected."""
    # A string, not a list: explorer.exe wants /select,"<path>" exactly.
    subprocess.Popen(f'explorer.exe /select,"{path}"')

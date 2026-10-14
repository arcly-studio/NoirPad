"""Desktop app only: files saved through the native "Save as" dialog."""

from fastapi import APIRouter

from .. import desktop_save
from ..errors import ApiError
from ..models import SavedFileReq
from ..runtime import RUNTIME

router = APIRouter()


@router.post("/api/desktop/fullscreen")
def toggle_fullscreen():
    """F11 / :fullscreen in the desktop app: the real window, not just the page."""
    if RUNTIME.mode != "desktop" or RUNTIME.toggle_fullscreen is None:
        raise ApiError(404, "not_desktop")
    RUNTIME.toggle_fullscreen()
    return {"ok": True}


@router.post("/api/desktop/reveal")
def reveal_saved_file(req: SavedFileReq):
    """Show a file this run saved (export toast → "Open folder") in Explorer."""
    path = desktop_save.saved_file(req.token) if RUNTIME.mode == "desktop" else None
    if path is None:
        raise ApiError(404, "file_not_found")
    try:
        desktop_save.reveal(path)
    except OSError as exc:
        raise ApiError(500, "open_folder_failed", error=exc.strerror or str(exc))
    return {"ok": True}

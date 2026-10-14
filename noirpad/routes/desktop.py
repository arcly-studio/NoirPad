"""Desktop app only: files saved through the native "Save as" dialog."""

from fastapi import APIRouter

from .. import desktop_save
from ..errors import ApiError
from ..models import SavedFileReq
from ..runtime import RUNTIME

router = APIRouter()


@router.post("/api/desktop/reveal")
def reveal_saved_file(req: SavedFileReq):
    """Show a file this run saved (export toast → "Open folder") in Explorer."""
    path = desktop_save.saved_file(req.token) if RUNTIME.mode == "desktop" else None
    if path is None:
        raise ApiError(404, "file_not_found")
    desktop_save.reveal(path)
    return {"ok": True}

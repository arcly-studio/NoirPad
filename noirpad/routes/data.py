"""Whole-profile reads: data (with ETag) and disk usage."""

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

from .. import storage

router = APIRouter()


@router.get("/api/data")
def get_data(request: Request):
    """The whole profile. Polling clients send If-None-Match → 304 (D13)."""
    known = request.headers.get("if-none-match")
    if known and known == storage.data_etag():
        return Response(status_code=304, headers={"ETag": known})
    data, etag = storage.read_data_with_etag()
    return JSONResponse(storage.public_view(data), headers={"ETag": etag})


def _folder_size(folder) -> int:
    size = 0
    if folder.exists():
        for f in folder.rglob("*"):
            if f.is_file():
                try:
                    size += f.stat().st_size
                except OSError:
                    pass
    return size


@router.get("/api/storage")
def get_storage():
    """On-disk size of notes_data.json, the images and the automatic
    backups (R11: snapshots and pre-import zips count too)."""
    notes_size = storage.DATA_FILE.stat().st_size if storage.DATA_FILE.exists() else 0
    images_size = _folder_size(storage.IMAGES_DIR)
    backups_size = _folder_size(storage.backups_dir())
    return {
        "notes_size": notes_size,
        "images_size": images_size,
        "backups_size": backups_size,
        "total_size": notes_size + images_size + backups_size,
    }

"""Whole-profile reads: data (with ETag) and disk usage."""

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

from .. import storage

router = APIRouter()


@router.get("/api/data")
async def get_data(request: Request):
    """The whole profile. Polling clients send If-None-Match → 304 (D13)."""
    known = request.headers.get("if-none-match")
    if known and known == storage.data_etag():
        return Response(status_code=304, headers={"ETag": known})
    data, etag = storage.read_data_with_etag()
    return JSONResponse(storage.public_view(data), headers={"ETag": etag})


@router.get("/api/storage")
async def get_storage():
    """On-disk size of notes_data.json and the images folder."""
    notes_size = storage.DATA_FILE.stat().st_size if storage.DATA_FILE.exists() else 0
    images_size = 0
    if storage.IMAGES_DIR.exists():
        for f in storage.IMAGES_DIR.rglob("*"):
            if f.is_file():
                try:
                    images_size += f.stat().st_size
                except OSError:
                    pass
    return {
        "notes_size": notes_size,
        "images_size": images_size,
        "total_size": notes_size + images_size,
    }

"""Image upload and serving."""

import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from .. import config
from ..images import IMAGE_MEDIA_TYPES, IMAGE_NAME_RE, safe_image_path, sniff_image
from ..storage import file_lock
from ..uploads import read_upload_limited

router = APIRouter()


@router.post("/api/images/upload")
async def upload_image(file: UploadFile = File(...)):
    contents = await read_upload_limited(file, config.MAX_IMAGE_BYTES)
    client_ext = Path(file.filename or "").suffix.lower().lstrip(".")
    kind = sniff_image(contents)
    if kind is None or (client_ext and client_ext not in IMAGE_MEDIA_TYPES):
        raise HTTPException(415, "Only PNG, JPEG, GIF and WebP images are allowed")
    name = f"{uuid.uuid4()}.{kind}"
    with file_lock:
        with open(safe_image_path(name), "wb") as f:
            f.write(contents)
    return {"filename": name, "url": f"/images/{name}"}


@router.get("/images/{filename:path}")
async def get_image(filename: str):
    # `..%2F..%2Fnotes_data.json` reaches this handler through the :path
    # converter. Only names the upload endpoint can produce are served —
    # anything else (e.g. an .html file an old version accepted) is a 404.
    if not IMAGE_NAME_RE.match(filename):
        raise HTTPException(404, "Image not found")
    path = safe_image_path(filename)
    if path is None or not path.is_file():
        raise HTTPException(404, "Image not found")
    return FileResponse(path, media_type=IMAGE_MEDIA_TYPES[filename.rsplit(".", 1)[1].lower()])

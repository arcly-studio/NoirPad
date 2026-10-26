"""Image upload and serving."""

import os
import uuid
from pathlib import Path

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from .. import config
from ..errors import ApiError
from ..images import IMAGE_MEDIA_TYPES, IMAGE_NAME_RE, image_complete, safe_image_path, sniff_image
from ..storage import file_lock
from ..uploads import read_upload_limited

router = APIRouter()


@router.post("/api/images/upload")
async def upload_image(file: UploadFile = File(...)):
    contents = await read_upload_limited(file, config.MAX_IMAGE_BYTES)
    # R8: the checks and the write (under file_lock) off the event loop.
    return await run_in_threadpool(_store_image, file.filename, contents)


def _store_image(filename: str, contents: bytes) -> dict:
    client_ext = Path(filename or "").suffix.lower().lstrip(".")
    kind = sniff_image(contents)
    if kind is None or (client_ext and client_ext not in IMAGE_MEDIA_TYPES):
        raise ApiError(415, "image_type_not_allowed")
    if not image_complete(kind, contents):
        raise ApiError(415, "image_incomplete")
    name = f"{uuid.uuid4()}.{kind}"
    dest = safe_image_path(name)
    tmp = dest.with_name(dest.name + ".part")
    # Next to the target, then renamed: a failed write (full disk) never
    # leaves a cut-off image under a real name (C10).
    try:
        with file_lock:
            tmp.write_bytes(contents)
            os.replace(tmp, dest)
    except OSError as exc:
        tmp.unlink(missing_ok=True)
        raise ApiError(507, "image_write_failed", error=exc.strerror or type(exc).__name__)
    return {"filename": name, "url": f"/images/{name}"}


@router.get("/images/{filename:path}")
def get_image(filename: str):
    # `..%2F..%2Fnotes_data.json` reaches this handler through the :path
    # converter. Only names the upload endpoint can produce are served —
    # anything else (e.g. an .html file an old version accepted) is a 404.
    if not IMAGE_NAME_RE.match(filename):
        raise ApiError(404, "image_not_found")
    path = safe_image_path(filename)
    if path is None or not path.is_file():
        raise ApiError(404, "image_not_found")
    return FileResponse(path, media_type=IMAGE_MEDIA_TYPES[filename.rsplit(".", 1)[1].lower()])

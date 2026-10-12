"""Bounded reading of multipart uploads and zip archives."""

import zipfile

from fastapi import UploadFile

from . import config
from .errors import ApiError


async def read_upload_limited(file: UploadFile, max_bytes: int) -> bytes:
    """Read an upload in chunks; HTTP 413 once it exceeds *max_bytes*."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise ApiError(413, "file_too_large", max_mb=max_bytes // (1024 * 1024))
        chunks.append(chunk)
    return b"".join(chunks)


def check_archive_size(zf: zipfile.ZipFile) -> None:
    """D15: refuse archives that would unpack to something huge."""
    infos = zf.infolist()
    if (len(infos) > config.MAX_BACKUP_FILES
            or sum(i.file_size for i in infos) > config.MAX_BACKUP_UNCOMPRESSED):
        raise ApiError(413, "archive_too_large")

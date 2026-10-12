"""Bounded reading of multipart uploads."""

from fastapi import HTTPException, UploadFile


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
            raise HTTPException(413, f"File too large (max {max_bytes // (1024 * 1024)} MB)")
        chunks.append(chunk)
    return b"".join(chunks)

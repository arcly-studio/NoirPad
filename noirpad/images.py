"""Image files under DATA_DIR/images: validation, references, deletion."""

import logging
import os
import re
import time
from pathlib import Path
from typing import Iterable, Optional

from . import storage
from .crypto import is_encrypted_content

log = logging.getLogger("noirpad")

# Raster formats only (never SVG/HTML). Stored as <uuid4>.<ext>, with the
# extension taken from the file's magic bytes, not its name.
IMAGE_MEDIA_TYPES = {
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
    "gif": "image/gif", "webp": "image/webp",
}
IMAGE_NAME_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
    r"\.(png|jpe?g|gif|webp)$", re.IGNORECASE)

# Image references in PLAINTEXT note content: rich-text markers
# `<<IMG:name>>` / `<<IMG:name|w=300>>` (zoomed), legacy desktop
# `\x00IMG:name\x00`, and `/images/<name>` URLs (markdown `![](…)`, links).
_IMG_RE = re.compile(r"<<IMG:([^|>\x00]+)(?:\|[^>\x00]*)?>>|\x00IMG:([^\x00]+)\x00")
_IMG_URL_RE = re.compile(
    r"/images/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
    r"\.(?:png|jpe?g|gif|webp))", re.IGNORECASE)


def sniff_image(data: bytes) -> Optional[str]:
    """Image type from magic bytes ('png'/'jpg'/'gif'/'webp') or None."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def image_ext_ok(name: str, data: bytes) -> bool:
    """Stored image name + content agree and are an allowed format."""
    if not IMAGE_NAME_RE.match(name):
        return False
    ext = name.rsplit(".", 1)[1].lower()
    kind = sniff_image(data)
    return kind is not None and (kind == ext or (kind == "jpg" and ext == "jpeg"))


def extract_image_names(content: Optional[str]) -> list[str]:
    """Return image filenames referenced in *plaintext* note content."""
    out: list[str] = []
    if not content:
        return out
    for m in _IMG_RE.finditer(content):
        fname = m.group(1) or m.group(2)
        if fname:
            out.append(fname)
    out.extend(m.group(1) for m in _IMG_URL_RE.finditer(content))
    return out


def safe_image_path(filename: str) -> Optional[Path]:
    """Resolve *filename* inside IMAGES_DIR, or None if it would escape it."""
    candidate = (storage.IMAGES_DIR / filename).resolve()
    if not candidate.is_relative_to(storage.IMAGES_DIR_R):
        return None
    return candidate


def delete_images(filenames: Iterable[str]) -> None:
    """Delete the given image files, ignoring anything outside IMAGES_DIR."""
    for fname in set(filenames):
        path = safe_image_path(fname)
        if path is not None and path.is_file():
            try:
                path.unlink()
            except OSError as exc:
                log.warning("Could not delete image %s: %s", fname, exc)


def referenced_images(data: dict) -> set[str]:
    """Every image name any note (active or trashed) refers to.

    Encrypted notes can't be parsed; their images come from note_images,
    which is captured from the plaintext on every save.
    """
    names: set[str] = set()
    for listed in (data.get("note_images") or {}).values():
        if listed:
            names.update(listed)
    for content in (data.get("notes") or {}).values():
        names.update(extract_image_names(content))
    for content in ((data.get("trash") or {}).get("notes") or {}).values():
        names.update(extract_image_names(content))
    return names


# ---------------------------------------------------------------------------
# Orphan cleanup (D14)
# ---------------------------------------------------------------------------
#
# Deleting an image from a note's text leaves the file behind. At startup,
# files no note refers to and older than ORPHAN_MIN_AGE go to images/.trash/
# (not deleted: a backup restored later may still need them); files there
# for TRASH_KEEP are deleted. A trashed file that is referenced again is
# moved back.

ORPHAN_MIN_AGE = 24 * 60 * 60
TRASH_KEEP = 30 * 24 * 60 * 60


def _has_untracked_encrypted_note(data: dict) -> bool:
    """An encrypted note without a note_images entry (very old data): its
    references are unknown, so nothing may be treated as an orphan."""
    tracked = data.get("note_images") or {}
    pools = [data.get("notes") or {}, (data.get("trash") or {}).get("notes") or {}]
    return any(nid not in tracked and is_encrypted_content(content)
               for pool in pools for nid, content in pool.items())


def collect_orphans(now: Optional[float] = None) -> dict[str, int]:
    """Move old orphans to images/.trash, purge expired ones, restore
    referenced ones. Returns counts; never raises for a single file."""
    now = time.time() if now is None else now
    counts = {"trashed": 0, "purged": 0, "restored": 0}
    data = storage.read_data()
    if _has_untracked_encrypted_note(data):
        log.info("Image cleanup skipped: encrypted notes without an image list")
        return counts
    referenced = referenced_images(data)
    trash = storage.IMAGES_DIR / ".trash"

    def _move(src: Path, dst: Path, key: str) -> None:
        try:
            os.replace(src, dst)
            os.utime(dst, (now, now))   # mtime = when it was moved
            counts[key] += 1
        except OSError as exc:
            log.warning("Image cleanup: could not move %s: %s", src.name, exc)

    if trash.is_dir():
        for f in trash.iterdir():
            if not f.is_file():
                continue
            if f.name in referenced and not (storage.IMAGES_DIR / f.name).exists():
                _move(f, storage.IMAGES_DIR / f.name, "restored")
            elif now - f.stat().st_mtime > TRASH_KEEP:
                try:
                    f.unlink()
                    counts["purged"] += 1
                except OSError as exc:
                    log.warning("Image cleanup: could not delete %s: %s", f.name, exc)

    for f in storage.IMAGES_DIR.iterdir():
        if (f.is_file() and IMAGE_NAME_RE.match(f.name) and f.name not in referenced
                and now - f.stat().st_mtime > ORPHAN_MIN_AGE):
            trash.mkdir(exist_ok=True)
            _move(f, trash / f.name, "trashed")

    if any(counts.values()):
        log.info("Image cleanup: %(trashed)d to trash, %(purged)d purged, "
                 "%(restored)d restored", counts)
    return counts

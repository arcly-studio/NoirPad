"""Backup zip (notes_data.json + images): download and replacing import."""

import copy
import io
import json
import os
import zipfile
import zlib
from typing import Any

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import StreamingResponse

from .. import config, storage
from ..errors import ApiError
from ..images import IMAGE_NAME_RE, image_ext_ok, referenced_images, safe_image_path
from ..tree import collect_note_ids, strip_user_ids
from ..uploads import check_archive_size, read_upload_limited

router = APIRouter()


def build_backup_zip(data: dict[str, Any]) -> bytes:
    """notes_data.json + every image referenced by the notes, as a zip."""
    image_names = referenced_images(data)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("notes_data.json",
                    json.dumps(storage.public_view(data), ensure_ascii=False,
                               indent=2).encode("utf-8"))
        if storage.IMAGES_DIR.exists():
            for img in storage.IMAGES_DIR.iterdir():
                if img.is_file() and img.name in image_names:
                    zf.write(img, f"images/{img.name}")
    return buf.getvalue()


@router.get("/api/backup")
async def backup_download():
    """Backup zip: the whole notes_data.json plus every referenced image."""
    return StreamingResponse(
        io.BytesIO(build_backup_zip(storage.read_data())),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="noirpad_backup.zip"'},
    )


def _bad_data() -> ApiError:
    return ApiError(400, "backup_corrupt_data")


def _check_items(items: Any) -> None:
    """A tree: a list of notes and folders (with list children)."""
    if not isinstance(items, list):
        raise _bad_data()
    for item in items:
        if (not isinstance(item, dict) or not isinstance(item.get("id"), str)
                or item.get("type") not in ("note", "folder")
                or not isinstance(item.get("name", ""), str)
                or not isinstance(item.get("tags", []), list)
                or not all(isinstance(t, str) for t in item.get("tags", []))):  # S3
            raise _bad_data()
        if "children" in item:
            _check_items(item["children"])


def _check_map(value: Any, kind: type, inner: type = None) -> None:
    """None, or {str: kind} (lists of `inner` when given)."""
    if value is None:
        return
    if not isinstance(value, dict):
        raise _bad_data()
    for key, val in value.items():
        if not isinstance(key, str) or not isinstance(val, kind):
            raise _bad_data()
        if inner is not None and not all(isinstance(v, inner) for v in val):
            raise _bad_data()


def validate_backup_data(imported: Any) -> None:
    """D4: everything the import copies must have the shape the app
    expects; anything else would be written and break exports later."""
    if not isinstance(imported, dict):
        raise _bad_data()
    trash = imported.get("trash")
    if trash is None:
        trash = {}
    elif not isinstance(trash, dict):
        raise _bad_data()
    _check_items(imported.get("tree") or [])
    _check_items(trash.get("tree") or [])
    for notes in (imported.get("notes"), trash.get("notes")):
        _check_map(notes, str)
    for formats in (imported.get("note_formats"), trash.get("note_formats")):
        _check_map(formats, list)
    _check_map(imported.get("note_modes"), str)
    _check_map(imported.get("note_images"), list, str)
    favorites = imported.get("favorites") or []
    if not isinstance(favorites, list) or not all(isinstance(f, str) for f in favorites):
        raise _bad_data()


def _read_backup(contents: bytes) -> tuple[Any, dict[str, bytes]]:
    """notes_data.json and the images of a backup zip, fully read and
    checked before anything is changed."""
    with zipfile.ZipFile(io.BytesIO(contents), "r") as zf:
        check_archive_size(zf)
        names = zf.namelist()
        if "notes_data.json" not in names:
            raise ApiError(400, "backup_missing_data")
        try:
            imported = json.loads(zf.read("notes_data.json"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise _bad_data()
        validate_backup_data(imported)

        # K5: every images/ entry must be a real image under a name the
        # upload endpoint could have produced. D6: and no bigger than an
        # upload may be.
        images: dict[str, bytes] = {}
        for name in names:
            if not name.startswith("images/") or name.endswith("/"):
                continue
            rel = name.split("/", 1)[1]
            # A path (subfolder, drive, UNC "//host/…") is unsafe; a plain
            # name that is no stored image name is simply not an image.
            if any(c in rel for c in "/\\:") or rel in ("", ".", ".."):
                raise ApiError(400, "backup_unsafe_path", name=name)
            if safe_image_path(rel) is None:
                raise ApiError(415, "backup_not_image", name=name)
            if zf.getinfo(name).file_size > config.MAX_IMAGE_BYTES:
                raise ApiError(413, "backup_image_too_large", name=name)
            data = zf.read(name)
            if len(data) > config.MAX_IMAGE_BYTES:
                raise ApiError(413, "backup_image_too_large", name=name)
            if not image_ext_ok(rel, data[:16]):
                raise ApiError(415, "backup_not_image", name=name)
            images[rel] = data
    return imported, images


def _write_images(images: dict[str, bytes]) -> list:
    """D5: write the new images (tmp + rename) before the notes change;
    on failure remove what was written and leave everything as it was."""
    written = []
    try:
        for rel, data in images.items():
            dest = safe_image_path(rel)
            if dest.exists():
                continue  # D15: never overwrite an existing image
            tmp = dest.with_name(dest.name + ".part")
            with storage.file_lock:
                tmp.write_bytes(data)
                os.replace(tmp, dest)
            written.append(dest)
    except OSError as exc:
        _remove(written)
        raise ApiError(507, "backup_write_failed", error=exc.strerror or str(exc))
    return written


def _remove(paths) -> None:
    for path in paths:
        try:
            path.unlink()
        except OSError:
            pass
        try:
            path.with_name(path.name + ".part").unlink()
        except OSError:
            pass


@router.post("/api/backup/import")
async def backup_import(file: UploadFile = File(...)):
    """Replace all notes, folders, trash and favorites with a backup zip.

    Settings are left as they are. Legacy multi-user backups are accepted;
    their `user_id` stamps are dropped. A bad archive changes nothing.
    """
    contents = await read_upload_limited(file, config.MAX_BACKUP_BYTES)
    try:
        imported, images = _read_backup(contents)
    except (zipfile.BadZipFile, zlib.error, EOFError, RuntimeError, NotImplementedError):
        # Not a zip, damaged data, password-protected, unknown compression.
        raise ApiError(400, "not_a_zip")

    imp_trash = imported.get("trash") or {}
    imp_tree = strip_user_ids(copy.deepcopy(imported.get("tree") or []))
    imp_trash_tree = strip_user_ids(copy.deepcopy(imp_trash.get("tree") or []))

    # Only keep notes/formats/etc that are actually referenced by
    # the imported tree (defends against trash-stuffed payloads).
    imp_note_ids: set = set()
    for root_item in imp_tree + imp_trash_tree:
        imp_note_ids.update(collect_note_ids(root_item))

    def _pick(src: dict) -> dict:
        src = src or {}
        return {nid: src[nid] for nid in imp_note_ids if nid in src}

    def _mut(data: dict) -> None:
        data["tree"] = imp_tree
        data["trash"] = {
            "tree": imp_trash_tree,
            "notes": _pick(imp_trash.get("notes")),
            "note_formats": _pick(imp_trash.get("note_formats")),
        }
        data["notes"] = _pick(imported.get("notes"))
        data["note_formats"] = _pick(imported.get("note_formats"))
        data["note_modes"] = _pick(imported.get("note_modes"))
        # S1: only stored-image names; anything else would reach the disk later.
        data["note_images"] = {nid: [n for n in names if IMAGE_NAME_RE.match(n)]
                               for nid, names in _pick(imported.get("note_images")).items()}
        data["favorites"] = [nid for nid in dict.fromkeys(imported.get("favorites") or [])
                             if nid in imp_note_ids]

    # D15: a safety copy of the current state before replacing it.
    with storage.file_lock:
        bdir = storage.backups_dir()
        bdir.mkdir(exist_ok=True)
        safety = bdir / f"pre-import-{storage.stamp()}.zip"
        safety.write_bytes(build_backup_zip(storage.read_data_unlocked()))
        storage.rotate("pre-import-*.zip", storage.BACKUP_KEEP)

    written = _write_images(images)
    try:
        storage.update_data(_mut)
    except BaseException:
        _remove(written)
        raise
    return {"ok": True}

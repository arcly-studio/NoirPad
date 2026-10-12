"""Backup zip (notes_data.json + images): download and replacing import."""

import copy
import io
import json
import zipfile
from typing import Any

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import StreamingResponse

from .. import config, storage
from ..errors import ApiError
from ..images import image_ext_ok, referenced_images, safe_image_path
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


@router.post("/api/backup/import")
async def backup_import(file: UploadFile = File(...)):
    """Replace all notes, folders, trash and favorites with a backup zip.

    Settings are left as they are. Legacy multi-user backups are accepted;
    their `user_id` stamps are dropped.
    """
    contents = await read_upload_limited(file, config.MAX_BACKUP_BYTES)
    try:
        with zipfile.ZipFile(io.BytesIO(contents), "r") as zf:
            check_archive_size(zf)
            names = zf.namelist()
            if "notes_data.json" not in names:
                raise ApiError(400, "backup_missing_data")
            try:
                imported = json.loads(zf.read("notes_data.json"))
            except json.JSONDecodeError:
                raise ApiError(400, "backup_corrupt_data")

            # K5: every images/ entry must be a real image under a name the
            # upload endpoint could have produced. Checked before anything
            # is changed, so a bad archive leaves the profile untouched.
            image_entries = [n for n in names
                             if n.startswith("images/") and not n.endswith("/")]
            for name in image_entries:
                rel = name.split("/", 1)[1]
                if safe_image_path(rel) is None:
                    raise ApiError(400, "backup_unsafe_path", name=name)
                if not image_ext_ok(rel, zf.read(name)[:16]):
                    raise ApiError(415, "backup_not_image", name=name)

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
                data["note_images"] = _pick(imported.get("note_images"))
                data["favorites"] = [nid for nid in dict.fromkeys(imported.get("favorites") or [])
                                     if nid in imp_note_ids]

            # D15: a safety copy of the current state before replacing it.
            with storage.file_lock:
                bdir = storage.backups_dir()
                bdir.mkdir(exist_ok=True)
                safety = bdir / f"pre-import-{storage.stamp()}.zip"
                safety.write_bytes(build_backup_zip(storage.read_data_unlocked()))
                storage.rotate("pre-import-*.zip", storage.BACKUP_KEEP)

            storage.update_data(_mut)

            for name in image_entries:
                dest = safe_image_path(name.split("/", 1)[1])
                if dest.exists():
                    continue  # D15: never overwrite an existing image
                with storage.file_lock:
                    dest.write_bytes(zf.read(name))
    except zipfile.BadZipFile:
        raise ApiError(400, "not_a_zip")

    return {"ok": True}

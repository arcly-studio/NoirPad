"""Note content, favorites, tags and the trash."""

from fastapi import APIRouter

from ..crypto import is_encrypted_content
from ..errors import ApiError
from ..images import delete_images, extract_image_names
from ..models import IdReq, NoteBody, TagsBody
from ..storage import read_data, update_data
from ..tree import (collect_note_ids, find_item_by_id, find_parent_list, note_exists,
                    restore_from_trash)

router = APIRouter()


# ---- Notes ----


@router.get("/api/note/{note_id}")
async def get_note(note_id: str):
    data = read_data()
    content = data.get("notes", {}).get(note_id)
    if content is None or not note_exists(data, note_id):
        raise ApiError(404, "note_not_found")
    return {
        "content": content,
        "formats": data.get("note_formats", {}).get(note_id, []),
        "mode": data.get("note_modes", {}).get(note_id, "rich-text"),
    }


def set_mode(data: dict, note_id: str, mode) -> None:
    """Only the non-default mode ("markdown") is stored; None = unchanged."""
    if mode is None:
        return
    if mode == "markdown":
        data.setdefault("note_modes", {})[note_id] = "markdown"
    else:
        data.get("note_modes", {}).pop(note_id, None)


@router.put("/api/note/{note_id}")
async def put_note(note_id: str, body: NoteBody):
    def _mut(data: dict) -> None:
        if not note_exists(data, note_id):
            raise ApiError(404, "note_not_found")
        # A locked note is only ever written encrypted (/api/save-encrypted,
        # /api/decrypt): never let a stale window or a mode switch put its
        # plaintext on disk (K2).
        if (is_encrypted_content(data.get("notes", {}).get(note_id, ""))
                and not is_encrypted_content(body.content)):
            raise ApiError(409, "note_is_encrypted")
        data.setdefault("notes", {})[note_id] = body.content
        if body.formats:
            data.setdefault("note_formats", {})[note_id] = body.formats
        else:
            data.get("note_formats", {}).pop(note_id, None)
        set_mode(data, note_id, body.mode)
        data.setdefault("note_images", {})[note_id] = extract_image_names(body.content)

    update_data(_mut)
    return {"ok": True}


# ---- Favorites ----


@router.post("/api/favorites/toggle")
async def toggle_favorite(req: IdReq):
    def _mut(data: dict) -> bool:
        if not note_exists(data, req.id):
            raise ApiError(404, "note_not_found")
        favs: list[str] = data.setdefault("favorites", [])
        if req.id in favs:
            favs.remove(req.id)
            return False
        favs.append(req.id)
        return True

    return {"favorite": update_data(_mut)}


# ---- Tags ----


@router.get("/api/tags")
async def list_tags():
    data = read_data()
    tags: set = set()

    def _walk(items: list) -> None:
        for item in items:
            tags.update(item.get("tags", []))
            _walk(item.get("children") or [])

    _walk(data.get("tree") or [])
    _walk(data.get("trash", {}).get("tree") or [])
    return {"tags": sorted(tags)}


@router.put("/api/tags/{item_id}")
async def set_tags(item_id: str, body: TagsBody):
    def _mut(data: dict) -> None:
        item = find_item_by_id(data["tree"], item_id)
        if item is None:
            raise ApiError(404, "item_not_found")
        item["tags"] = body.tags

    update_data(_mut)
    return {"ok": True}


# ---- Trash ----


def _purge(data: dict, trash: dict, note_ids) -> None:
    """Drop trashed notes for good, with their images.

    Images come from the tracked map (encrypted notes) + a regex over the
    plaintext content.
    """
    note_images: dict = data.get("note_images", {})
    to_delete: set[str] = set()
    for nid in note_ids:
        to_delete.update(note_images.get(nid, []))
        to_delete.update(extract_image_names(trash.get("notes", {}).get(nid)))
    delete_images(to_delete)
    for nid in note_ids:
        trash.get("notes", {}).pop(nid, None)
        trash.get("note_formats", {}).pop(nid, None)
        note_images.pop(nid, None)


@router.get("/api/trash")
async def get_trash():
    trash = read_data().get("trash") or {}
    return {"tree": trash.get("tree") or [], "notes": trash.get("notes") or {}}


@router.post("/api/trash/restore")
async def trash_restore(req: IdReq):
    def _mut(data: dict) -> None:
        try:
            restore_from_trash(data, req.id)
        except ValueError:
            raise ApiError(404, "trash_item_not_found")

    update_data(_mut)
    return {"ok": True}


@router.post("/api/trash/empty")
async def trash_empty():
    def _mut(data: dict) -> None:
        trash = data.setdefault("trash", {"tree": [], "notes": {}})
        trashed_ids: set[str] = set()
        for root_item in trash.get("tree") or []:
            trashed_ids.update(collect_note_ids(root_item))
        _purge(data, trash, trashed_ids)
        trash["tree"] = []

    update_data(_mut)
    return {"ok": True}


@router.post("/api/trash/delete")
async def trash_delete_item(req: IdReq):
    """Permanently delete a single item from trash."""
    def _mut(data: dict) -> None:
        trash = data.setdefault("trash", {"tree": [], "notes": {}})
        parent_list = find_parent_list(trash.get("tree") or [], req.id)
        if parent_list is None:
            raise ApiError(404, "trash_item_not_found")
        item = next(i for i in parent_list if i["id"] == req.id)
        parent_list.remove(item)
        _purge(data, trash, collect_note_ids(item))

    update_data(_mut)
    return {"ok": True}

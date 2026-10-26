"""Folder/note tree: create, rename, move, delete (to trash)."""

import uuid

from fastapi import APIRouter

from ..errors import ApiError
from ..models import IdReq, MoveReq, NewItemReq, RenameReq
from ..storage import update_data
from ..tree import collect_all_ids, find_item_by_id, find_parent_list, move_to_trash

router = APIRouter()


def _insert(data: dict, parent_id, item: dict) -> None:
    if parent_id:
        parent = find_item_by_id(data["tree"], parent_id)
        if parent is None or parent.get("type") != "folder":
            raise ApiError(400, "parent_not_found")
        parent.setdefault("children", []).append(item)
    else:
        data["tree"].append(item)


@router.post("/api/tree/new-note")
def new_note(req: NewItemReq):
    note_id = str(uuid.uuid4())
    item = {"id": note_id, "name": req.name, "type": "note"}

    def _mut(data: dict) -> None:
        _insert(data, req.parent_id, item)
        data.setdefault("notes", {})[note_id] = ""

    update_data(_mut)
    return {"id": note_id, "item": item}


@router.post("/api/tree/new-folder")
def new_folder(req: NewItemReq):
    folder_id = str(uuid.uuid4())
    item = {"id": folder_id, "name": req.name, "type": "folder", "children": []}
    update_data(lambda data: _insert(data, req.parent_id, item))
    return {"id": folder_id, "item": item}


@router.post("/api/tree/rename")
def rename_item(req: RenameReq):
    def _mut(data: dict) -> None:
        item = find_item_by_id(data["tree"], req.id)
        if item is None:
            raise ApiError(404, "item_not_found")
        item["name"] = req.name

    update_data(_mut)
    return {"ok": True}


@router.post("/api/tree/move")
def move_item(req: MoveReq):
    def _mut(data: dict) -> None:
        source_list = find_parent_list(data["tree"], req.id)
        if source_list is None:
            raise ApiError(404, "item_not_found")
        item = next(i for i in source_list if i["id"] == req.id)

        # Moving an item into itself or its own subtree would detach the
        # whole branch. collect_all_ids includes `item` itself.
        if req.target_id in set(collect_all_ids(item)):
            raise ApiError(400, "move_into_itself")

        source_list.remove(item)

        if req.position == "inside":
            target = find_item_by_id(data["tree"], req.target_id)
            if target is None or target.get("type") != "folder":
                raise ApiError(400, "target_not_found")
            target.setdefault("children", []).append(item)
        else:
            target_list = find_parent_list(data["tree"], req.target_id)
            if target_list is None:
                raise ApiError(404, "target_not_found")
            idx = next(i for i, x in enumerate(target_list) if x["id"] == req.target_id)
            if req.position == "after":
                idx += 1
            target_list.insert(idx, item)

    update_data(_mut)
    return {"ok": True}


@router.post("/api/tree/delete")
def delete_item(req: IdReq):
    def _mut(data: dict) -> None:
        try:
            move_to_trash(data, req.id)
        except ValueError:
            raise ApiError(404, "item_not_found")

    update_data(_mut)
    return {"ok": True}

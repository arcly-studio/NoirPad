"""Pure helpers over the note tree (nested folder/note dicts)."""

from typing import Optional


def find_item_by_id(tree: list[dict], item_id: str) -> Optional[dict]:
    """Recursively search *tree* for an item with the given id."""
    for item in tree:
        if item["id"] == item_id:
            return item
        children = item.get("children")
        if children:
            found = find_item_by_id(children, item_id)
            if found is not None:
                return found
    return None


def find_parent_list(tree: list[dict], item_id: str) -> Optional[list[dict]]:
    """Return the list that directly contains the item with *item_id*."""
    for item in tree:
        if item["id"] == item_id:
            return tree
        children = item.get("children")
        if children:
            found = find_parent_list(children, item_id)
            if found is not None:
                return found
    return None


def collect_note_ids(item: dict) -> list[str]:
    """Return all note IDs under *item* (including itself if it is a note)."""
    ids: list[str] = []
    if item.get("type") == "note":
        ids.append(item["id"])
    for child in item.get("children", []):
        ids.extend(collect_note_ids(child))
    return ids


def collect_all_ids(item: dict) -> list[str]:
    """Every id under *item* (folders AND notes, *item* included) — used
    for the cycle check when moving."""
    ids: list[str] = [item["id"]]
    for child in item.get("children", []):
        ids.extend(collect_all_ids(child))
    return ids


def note_exists(data: dict, note_id: str) -> bool:
    """True if *note_id* is a note in the tree or in the trash."""
    for root in (data.get("tree") or [], (data.get("trash") or {}).get("tree") or []):
        item = find_item_by_id(root, note_id)
        if item is not None and item.get("type") == "note":
            return True
    return False


def strip_user_ids(items: list) -> list:
    """Remove legacy `user_id` stamps from *items* (recursively, in place)."""
    for item in items:
        item.pop("user_id", None)
        children = item.get("children")
        if children:
            strip_user_ids(children)
    return items


def has_user_ids(items: list) -> bool:
    for item in items:
        if "user_id" in item or has_user_ids(item.get("children") or []):
            return True
    return False


def move_to_trash(data: dict, item_id: str) -> None:
    """Move an item (and its notes) from the active tree into trash."""
    parent_list = find_parent_list(data["tree"], item_id)
    if parent_list is None:
        raise ValueError("Item not found in tree")
    item = next(i for i in parent_list if i["id"] == item_id)
    parent_list.remove(item)

    note_ids = collect_note_ids(item)
    trash_notes: dict[str, str] = {}
    for nid in note_ids:
        if nid in data.get("notes", {}):
            trash_notes[nid] = data["notes"].pop(nid)

    data.setdefault("trash", {"tree": [], "notes": {}})
    data["trash"]["tree"].append(item)
    data["trash"]["notes"].update(trash_notes)

    favs: list[str] = data.get("favorites", [])
    for nid in note_ids:
        if nid in favs:
            favs.remove(nid)

    # Formats go to a trash sub-key so a restore brings them back.
    for nid in note_ids:
        fmt = data.get("note_formats", {}).pop(nid, None)
        if fmt is not None:
            data["trash"].setdefault("note_formats", {})[nid] = fmt


def restore_from_trash(data: dict, item_id: str) -> None:
    """Restore an item from trash back to the root of the active tree."""
    trash_tree: list[dict] = data.get("trash", {}).get("tree", [])
    parent_list = find_parent_list(trash_tree, item_id)
    if parent_list is None:
        raise ValueError("Item not found in trash")
    item = next(i for i in parent_list if i["id"] == item_id)
    parent_list.remove(item)

    note_ids = collect_note_ids(item)
    trash_notes: dict[str, str] = data.get("trash", {}).get("notes", {})
    for nid in note_ids:
        if nid in trash_notes:
            data.setdefault("notes", {})[nid] = trash_notes.pop(nid)

    trash_formats: dict = data.get("trash", {}).get("note_formats", {})
    for nid in note_ids:
        fmt = trash_formats.pop(nid, None)
        if fmt is not None:
            data.setdefault("note_formats", {})[nid] = fmt

    data["tree"].append(item)

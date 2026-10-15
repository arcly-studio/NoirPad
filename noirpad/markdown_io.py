"""Export every note as Markdown files (zip) and import .md files / such zips.

Export layout: folders = directories, one `<name>.md` per note, images in
`assets/` at the zip root, linked relatively (`../assets/x.png`). Locked
notes are skipped (their count is reported). Rich-text formatting runs
(colours, fonts) are not part of the text and are not exported.

Import only ever ADDS notes; nothing existing is changed or deleted.
"""

import io
import posixpath
import re
import uuid
import zipfile
from pathlib import PurePosixPath
from typing import Optional


from . import config, storage
from .crypto import is_encrypted_content
from .errors import ApiError
from .export import UniqueNames, safe_filename
from .images import IMAGE_NAME_RE, safe_image_path, sniff_image
from .tree import find_item_by_id
from .uploads import check_archive_size

MD_SUFFIXES = (".md", ".markdown", ".txt")

_MARKER_RE = re.compile(r"<<IMG:([^|>\x00]+)(?:\|[^>\x00]*)?>>|\x00IMG:([^\x00]+)\x00")
_URL_RE = re.compile(r"/images/([0-9a-fA-F-]{36}\.(?:png|jpe?g|gif|webp))")
# ![alt](target) or ![alt](<target>) — targets without spaces, or in <…>.
_MD_IMAGE_RE = re.compile(r"(!\[[^\]\n]*\]\()(<[^>\n]+>|[^)\s]+)(\))")


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------


def _to_markdown(content: str, depth: int, used_images: set[str]) -> str:
    """Note text with image references rewritten to relative assets/ links."""
    prefix = "../" * depth + "assets/"

    def marker(m: re.Match) -> str:
        name = m.group(1) or m.group(2)
        if not IMAGE_NAME_RE.match(name):
            return m.group(0)
        used_images.add(name)
        return f"![]({prefix}{name})"

    def url(m: re.Match) -> str:
        used_images.add(m.group(1))
        return prefix + m.group(1)

    return _URL_RE.sub(url, _MARKER_RE.sub(marker, content))


def build_markdown_zip(data: dict) -> tuple[bytes, int]:
    """(zip bytes, number of locked notes skipped)."""
    notes = data.get("notes") or {}
    names = UniqueNames()
    used_images: set[str] = set()
    skipped = 0
    buf = io.BytesIO()

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        def visit(items: list, parts: list[str]) -> None:
            nonlocal skipped
            for item in items:
                name = item.get("name") or "untitled"
                if item.get("type") == "folder":
                    folder = names.take("/".join(parts), safe_filename(name), "")
                    zf.writestr("/".join(parts + [folder]) + "/", b"")
                    visit(item.get("children") or [], parts + [folder])
                elif item.get("type") == "note":
                    content = notes.get(item.get("id"), "")
                    if is_encrypted_content(content):
                        skipped += 1
                        continue
                    filename = names.take("/".join(parts), safe_filename(name), ".md")
                    text = _to_markdown(content, len(parts), used_images)
                    zf.writestr("/".join(parts + [filename]), text.encode("utf-8"))

        visit(data.get("tree") or [], [])
        for name in sorted(used_images):
            path = safe_image_path(name)
            if path is not None and path.is_file():
                zf.write(path, f"assets/{name}")

    return buf.getvalue(), skipped


def build_note_markdown(name: str, content: str) -> tuple[bytes, str, str]:
    """One note as Markdown → (body, media type, file name).

    A plain `<name>.md`; a note that shows pictures becomes a zip with the
    .md and its images in `assets/` (the same layout as the full export).
    """
    if is_encrypted_content(content):
        raise ApiError(409, "export_locked_note")
    used_images: set[str] = set()
    text = _to_markdown(content, 0, used_images)
    filename = safe_filename(name) + ".md"
    files = [(n, p) for n in sorted(used_images)
             if (p := safe_image_path(n)) is not None and p.is_file()]
    if not files:
        return text.encode("utf-8"), "text/markdown; charset=utf-8", filename
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(filename, text.encode("utf-8"))
        for image, path in files:
            zf.write(path, f"assets/{image}")
    return buf.getvalue(), "application/zip", safe_filename(name) + ".zip"


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------


def _decode(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1250"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1")


def _note_name(path: str) -> str:
    stem = PurePosixPath(path).stem.strip() or "untitled"
    return stem[:config.MAX_NAME_LEN]


def _store_image(raw: bytes) -> Optional[str]:
    """Save an imported image under a fresh upload-style name."""
    kind = sniff_image(raw[:16])
    if kind is None or len(raw) > config.MAX_IMAGE_BYTES:
        return None
    name = f"{uuid.uuid4()}.{kind}"
    with storage.file_lock:
        safe_image_path(name).write_bytes(raw)
    return name


class _Importer:
    """Collects folders/notes first, then adds them in one data update."""

    def __init__(self) -> None:
        self.items: list[tuple[list[str], str, str]] = []   # (folders, name, text)
        self.images = 0
        self.skipped = 0

    def add_note(self, folders: list[str], name: str, text: str) -> None:
        if len(text) > config.MAX_NOTE_CHARS:
            self.skipped += 1
            return
        self.items.append((folders, name, text))

    def add_zip(self, raw: bytes, zip_name: str) -> None:
        try:
            zf = zipfile.ZipFile(io.BytesIO(raw))
        except zipfile.BadZipFile:
            raise ApiError(400, "not_a_zip")
        with zf:
            check_archive_size(zf)
            entries = [n for n in zf.namelist()
                       if not n.endswith("/") and not n.startswith("__MACOSX/")]
            md_entries = [n for n in entries if n.lower().endswith(MD_SUFFIXES)]
            # Zips of a single folder: that folder becomes the import root.
            tops = {n.split("/", 1)[0] for n in entries}
            strip_top = len(tops) == 1 and all("/" in n for n in entries)
            root = next(iter(tops)) if strip_top else PurePosixPath(zip_name).stem
            stored: dict[str, Optional[str]] = {}

            def image_link(md_dir: str, target: str) -> Optional[str]:
                bare = target[1:-1] if target.startswith("<") else target
                if re.match(r"^[a-z][a-z0-9+.-]*:|^/|^#", bare, re.I):
                    return None                     # URL, /images/…, anchor
                path = posixpath.normpath(posixpath.join(md_dir, bare))
                if path not in stored:
                    stored[path] = None
                    if path in entries and zf.getinfo(path).file_size <= config.MAX_IMAGE_BYTES:
                        stored[path] = _store_image(zf.read(path))
                        self.images += bool(stored[path])
                return stored[path] and f"/images/{stored[path]}"

            for entry in md_entries:
                md_dir = posixpath.dirname(entry)
                text = _decode(zf.read(entry))
                text = _MD_IMAGE_RE.sub(
                    lambda m: m.group(1) + (image_link(md_dir, m.group(2)) or m.group(2))
                    + m.group(3), text)
                parts = entry.split("/")[1 if strip_top else 0:-1]
                self.add_note([root] + [p[:config.MAX_NAME_LEN] for p in parts],
                              _note_name(entry), text)

    def apply(self) -> dict:
        created = {"notes": 0, "folders": 0}

        def _mut(data: dict) -> None:
            folder_ids: dict[tuple[str, ...], str] = {}

            def folder_for(path: list[str]) -> Optional[dict]:
                parent = None
                for depth in range(1, len(path) + 1):
                    key = tuple(path[:depth])
                    if key not in folder_ids:
                        item = {"id": str(uuid.uuid4()), "name": key[-1],
                                "type": "folder", "children": []}
                        siblings = parent["children"] if parent else data["tree"]
                        siblings.append(item)
                        folder_ids[key] = item["id"]
                        created["folders"] += 1
                    parent = find_item_by_id(data["tree"], folder_ids[key])
                return parent

            for folders, name, text in self.items:
                note_id = str(uuid.uuid4())
                parent = folder_for(folders)
                (parent["children"] if parent else data["tree"]).append(
                    {"id": note_id, "name": name, "type": "note"})
                data.setdefault("notes", {})[note_id] = text
                data.setdefault("note_modes", {})[note_id] = "markdown"
                data.setdefault("note_images", {})[note_id] = _URL_RE.findall(text)
                created["notes"] += 1

        if self.items:
            storage.update_data(_mut)
        return {**created, "images": self.images, "skipped": self.skipped}


def import_files(files: list[tuple[str, bytes]]) -> dict:
    """Add notes from .md files and zips of them. Returns counts."""
    importer = _Importer()
    for filename, raw in files:
        lower = (filename or "").lower()
        if lower.endswith(".zip"):
            importer.add_zip(raw, filename)
        elif lower.endswith(MD_SUFFIXES):
            importer.add_note([], _note_name(filename), _decode(raw))
        else:
            raise ApiError(415, "import_unsupported_file")
    return importer.apply()

"""Export helpers: download headers, file names, note → HTML, bulk zip."""

import html as html_lib
import io
import re
import unicodedata
import zipfile
from datetime import datetime
from typing import Any
from urllib.parse import quote

from .crypto import is_encrypted_content


def attachment(filename: str) -> str:
    """Content-Disposition for *filename*: RFC 5987 UTF-8 name + ASCII fallback.

    HTTP headers are latin-1; a raw Czech name used to crash with HTTP 500
    (K7). Browsers use filename*, old clients the ASCII approximation.
    """
    ascii_name = unicodedata.normalize("NFKD", filename).encode("ascii", "ignore").decode()
    ascii_name = re.sub(r"[^A-Za-z0-9._() -]", "_", ascii_name).strip(" .") or "note"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename, safe='')}"


# CON, NUL, COM1 … are devices on Windows, also with an extension (NUL.md).
_RESERVED_NAMES = re.compile(r"^(CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])$", re.IGNORECASE)


def safe_filename(name: str) -> str:
    """A file / zip entry name for a note or folder called *name*.

    Note names may contain anything; only the exported file name is fixed
    up: the characters Windows forbids (and control bytes) become "-",
    leading/trailing dots and spaces go, a reserved device name gets a "-"
    appended. Capped at 200 chars; empty → 'untitled'.
    "Re: porada?" → "Re- porada-".
    """
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", name or "")
    cleaned = cleaned.strip(" .")[:200].rstrip(" .")
    if _RESERVED_NAMES.match(cleaned.split(".", 1)[0].rstrip(" ")):
        cleaned += "-"
    return cleaned or "untitled"


def build_note_html(name: str, content: str, font: str, size: Any) -> str:
    """Render a single note as a standalone HTML5 document.

    Name and body are HTML-escaped; the font name is reduced to characters
    that are safe inside the CSS string.
    """
    escaped_name = html_lib.escape(name)
    escaped_body = html_lib.escape(content, quote=False).replace("\n", "<br>\n")
    safe_font = re.sub(r"[^\w \-]", "", str(font or "")) or "monospace"
    try:
        safe_size = max(6, min(200, int(size)))
    except (TypeError, ValueError):
        safe_size = 12
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{escaped_name}</title>
<style>
  body {{
    background: #0a0a0a;
    color: #00ff00;
    font-family: '{safe_font}', monospace;
    font-size: {safe_size}px;
    padding: 2rem;
    white-space: pre-wrap;
  }}
</style>
</head>
<body>
{escaped_body}
</body>
</html>"""


class UniqueNames:
    """Per-folder de-duplication of file names: a, a (2), a (3), …"""

    def __init__(self) -> None:
        self._used: dict[str, set[str]] = {}

    def take(self, folder: str, base: str, ext: str) -> str:
        seen = self._used.setdefault(folder, set())
        name, n = f"{base}{ext}", 2
        while name.lower() in seen:
            name = f"{base} ({n}){ext}"
            n += 1
        seen.add(name.lower())
        return name


def build_html_zip(data: dict) -> bytes:
    """Every plain note as readable .html inside a zip.

    Folder hierarchy is reproduced as zip directories. Encrypted notes are
    skipped and listed in `_EXCLUDED.txt` so the user knows what is missing.
    """
    notes: dict[str, str] = data.get("notes", {}) or {}
    font = data.get("font_family", "Cascadia Code")
    size = data.get("font_size", 12)
    excluded: list[str] = []
    included = 0
    names = UniqueNames()

    def visit(items: list[dict], path_parts: list[str], zf: zipfile.ZipFile) -> None:
        nonlocal included
        for item in items:
            kind = item.get("type")
            name = item.get("name") or "untitled"
            if kind == "folder":
                visit(item.get("children") or [], path_parts + [safe_filename(name)], zf)
                continue
            if kind != "note":
                continue
            content = notes.get(item.get("id"), "")
            if is_encrypted_content(content):
                excluded.append("/".join(path_parts + [name]))
                continue
            filename = names.take("/".join(path_parts), safe_filename(name), ".html")
            zf.writestr("/".join(path_parts + [filename]), build_note_html(name, content, font, size))
            included += 1

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        visit(data.get("tree") or [], [], zf)
        if excluded:
            info_lines = [
                f"NoirPad Export — {datetime.now().strftime('%Y-%m-%d %H:%M')}",
                f"Notes exported: {included}",
                f"Notes skipped (encrypted): {len(excluded)}",
                "",
                "The following encrypted notes were SKIPPED:",
                *(f"  - {p}" for p in excluded),
                "",
                "To include them, unlock and remove encryption first, then re-export.",
            ]
            zf.writestr("_EXCLUDED.txt", "\n".join(info_lines))
    return buf.getvalue()

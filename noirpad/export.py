"""Export helpers: download headers, file names, note → HTML, bulk zip."""

import base64
import html as html_lib
import io
import re
import unicodedata
import zipfile
from datetime import datetime
from typing import Any, Callable, Optional
from urllib.parse import quote

from .crypto import is_encrypted_content
from .images import safe_image_path


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


# A picture in a note: rich-text <<IMG:file|w=300>> (or the older \0IMG:file\0)
# or Markdown ![alt](/images/file).
_HTML_IMG_RE = re.compile(
    r"<<IMG:([^|>\x00]+)((?:\|[^>\x00]*)?)>>|\x00IMG:([^\x00]+)\x00"
    r"|!\[([^\]\n]*)\]\(/images/([0-9a-fA-F-]{36}\.(?:png|jpe?g|gif|webp))\)")
_MIME = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
         "gif": "image/gif", "webp": "image/webp"}


def image_data_uri(filename: str) -> Optional[str]:
    """data: URI of a stored image (single-file HTML export), None if gone."""
    path = safe_image_path(filename)
    if path is None or not path.is_file():
        return None
    mime = _MIME.get(filename.rsplit(".", 1)[-1].lower(), "application/octet-stream")
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def _html_body(content: str, image_src: Optional[Callable[[str], Optional[str]]]) -> str:
    """Escaped note text; pictures become <img> where image_src finds them (D7)."""
    out: list[str] = []
    pos = 0
    for m in _HTML_IMG_RE.finditer(content):
        out.append(html_lib.escape(content[pos:m.start()], quote=False))
        pos = m.end()
        fname = m.group(1) or m.group(3) or m.group(5)
        src = image_src(fname) if image_src else None
        if not src:
            out.append(html_lib.escape(m.group(0), quote=False))
            continue
        width = re.search(r"\bw=(\d{1,4})\b", m.group(2) or "")
        alt = html_lib.escape(m.group(4) or "", quote=True)
        size = f' width="{width.group(1)}"' if width else ""
        out.append(f'<img src="{html_lib.escape(src, quote=True)}" alt="{alt}"{size}>')
    out.append(html_lib.escape(content[pos:], quote=False))
    return "".join(out).replace("\n", "<br>\n")


def build_note_html(name: str, content: str, font: str, size: Any,
                    image_src: Optional[Callable[[str], Optional[str]]] = None) -> str:
    """Render a single note as a standalone HTML5 document.

    Name and body are HTML-escaped; the font name is reduced to characters
    that are safe inside the CSS string. image_src(filename) gives the src
    of each picture (data URI or a relative assets/ path); without it, or
    for a missing file, the reference stays as text.
    """
    escaped_name = html_lib.escape(name)
    escaped_body = _html_body(content, image_src)
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
  img {{ max-width: 100%; height: auto; vertical-align: top; }}
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
    assets: set[str] = set()   # images the exported pages show (D7)

    def visit(items: list[dict], path_parts: list[str], zf: zipfile.ZipFile) -> None:
        nonlocal included
        for item in items:
            kind = item.get("type")
            name = item.get("name") or "untitled"
            if kind == "folder":
                folder = names.take("/".join(path_parts), safe_filename(name), "")   # "a", "a (2)" (C11)
                visit(item.get("children") or [], path_parts + [folder], zf)
                continue
            if kind != "note":
                continue
            content = notes.get(item.get("id"), "")
            if is_encrypted_content(content):
                excluded.append("/".join(path_parts + [name]))
                continue
            filename = names.take("/".join(path_parts), safe_filename(name), ".html")
            prefix = "../" * len(path_parts) + "assets/"

            def image_src(fname: str, prefix=prefix) -> Optional[str]:
                path = safe_image_path(fname)
                if path is None or not path.is_file():
                    return None
                assets.add(fname)
                return prefix + fname

            zf.writestr("/".join(path_parts + [filename]),
                        build_note_html(name, content, font, size, image_src))
            included += 1

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        visit(data.get("tree") or [], [], zf)
        for fname in sorted(assets):
            zf.write(safe_image_path(fname), f"assets/{fname}")
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

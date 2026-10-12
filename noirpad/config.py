"""Paths and limits.

Two separate roots:
  * resource root — read-only frontend assets (static/). In dev that's the
    project directory; in a PyInstaller bundle it's sys._MEIPASS.
  * data root — writable user data (notes_data.json, backups/, images/).
    The NOIRPAD_DATA_DIR env var if set (tests, portable setups), else the
    platformdirs user_data_dir, so web mode and NoirPad.exe share notes.
"""

import os
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent  # repo root in dev / _MEIPASS in frozen


def is_frozen() -> bool:
    """True when running inside a PyInstaller bundle."""
    return getattr(sys, "frozen", False)


def resource_path(rel: str) -> Path:
    """Path to a bundled READ-ONLY resource (never write there)."""
    if is_frozen():
        return Path(getattr(sys, "_MEIPASS", PROJECT_DIR)) / rel
    return PROJECT_DIR / rel


def get_data_dir() -> Path:
    """Return the WRITABLE user-data directory (created on demand)."""
    override = os.environ.get("NOIRPAD_DATA_DIR")
    if override:
        path = Path(override)
    else:
        from platformdirs import user_data_dir
        path = Path(user_data_dir("NoirPad", appauthor=False))
    path.mkdir(parents=True, exist_ok=True)
    return path


STATIC_DIR = resource_path("static")

# Upload size limits.
MAX_IMAGE_BYTES = 10 * 1024 * 1024     # 10 MB
MAX_BACKUP_BYTES = 100 * 1024 * 1024   # 100 MB

# Request field limits.
MAX_NAME_LEN = 300                 # note / folder name
MAX_NOTE_CHARS = 5_000_000         # one note's text (images are separate files)
MAX_FORMATS = 20_000               # format runs per note
MAX_TAGS = 50
MAX_TAG_LEN = 100

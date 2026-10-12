"""notes_data.json: locked read-modify-write, backups, recovery, migrations.

The data paths are module globals so tests (and set_data_dir) can repoint
them; other modules read them at call time as ``storage.DATA_FILE``.
"""

import copy
import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import IO, Any, Callable, Optional

from . import config
from .runtime import RUNTIME
from .tree import has_user_ids, strip_user_ids

log = logging.getLogger("noirpad")

DATA_DIR: Path
DATA_FILE: Path
DATA_BAK: Path
DATA_TMP: Path
IMAGES_DIR: Path
IMAGES_DIR_R: Path

# A plain Lock: helpers called while it is held use the *_unlocked variants.
file_lock = threading.Lock()

DEFAULT_DATA: dict[str, Any] = {
    "tree": [],
    "notes": {},
    "favorites": [],
    "trash": {"tree": [], "notes": {}},
    "note_formats": {},
    # note_id -> [image filename, ...]. Lets us clean images of encrypted
    # notes (whose content can't be regex-parsed) from the trash.
    "note_images": {},
    # Per-note rendering mode. Absence == "rich-text" (default for legacy
    # notes); explicit "markdown" enables block-level MD syntax rendering.
    # Only non-default values are stored, keeping the data file small.
    "note_modes": {},
    "theme": "matrix",
    "ui_font": "orbitron",
    "font_family": "Cascadia Code",
    "font_size": 12,
    "autosave": False,
    "page_orientation": "landscape",
    "matrix_rain_enabled": True,
    "show_splash": True,
    "autosave_interval": 5,
    "spellcheck": True,
    "glitch_effect": True,
    "confirm_delete": True,
    "show_shortcut_hints": True,
    "idle_lock_minutes": "off",
    "default_encrypted": False,
    "glow_intensity": 100,  # 0-150 percent
    "custom_shortcuts": {},  # id -> "Ctrl+Shift+X" (only non-default)
}


def set_data_dir(path: Path) -> None:
    """Point the backend at *path* and run the one-time data migrations."""
    global DATA_DIR, DATA_FILE, DATA_BAK, DATA_TMP, IMAGES_DIR, IMAGES_DIR_R
    DATA_DIR = Path(path)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DATA_FILE = DATA_DIR / "notes_data.json"
    DATA_BAK = DATA_DIR / "notes_data.json.bak"
    DATA_TMP = DATA_DIR / "notes_data.json.tmp"
    IMAGES_DIR = DATA_DIR / "images"
    IMAGES_DIR.mkdir(exist_ok=True)
    IMAGES_DIR_R = IMAGES_DIR.resolve()
    RUNTIME.data_notice = None
    _migrate_legacy_data_if_needed(DATA_DIR)
    _migrate_to_single_profile()
    RUNTIME.app_lock = read_data().get("app_lock") or None
    RUNTIME.app_lock_tokens.clear()


def _migrate_legacy_data_if_needed(target_dir: Path) -> None:
    """Seed an empty *target_dir* from a project-directory database, once.

    Very old builds kept notes_data.json + images/ next to the code. Only
    runs when the data dir has no notes_data.json yet; never overwrites.
    """
    base = config.PROJECT_DIR
    target_data = target_dir / "notes_data.json"
    legacy_data = base / "notes_data.json"
    if target_data.exists() or not legacy_data.is_file():
        return
    if base.resolve() == target_dir.resolve():
        return
    try:
        target_data.write_bytes(legacy_data.read_bytes())
    except OSError as exc:
        log.error("Failed to migrate notes_data.json: %s", exc)
        return

    legacy_images = base / "images"
    target_images = target_dir / "images"
    if legacy_images.is_dir():
        target_images.mkdir(exist_ok=True)
        for src in legacy_images.iterdir():
            dst = target_images / src.name
            if not src.is_file() or dst.exists():
                continue
            try:
                dst.write_bytes(src.read_bytes())
            except OSError as exc:
                log.warning("Could not migrate image %s: %s", src.name, exc)

    log.warning("Migrated legacy NoirPad data from %s -> %s", base, target_dir)


# ---------------------------------------------------------------------------
# Rotating backups
# ---------------------------------------------------------------------------
#
# Snapshots of notes_data.json live in DATA_DIR/backups/: at most one per
# BACKUP_MIN_INTERVAL seconds, the newest BACKUP_KEEP are kept.

BACKUP_MIN_INTERVAL = 10 * 60
BACKUP_KEEP = 7


def backups_dir() -> Path:
    return DATA_DIR / "backups"


def stamp() -> str:
    """Sortable timestamp, unique enough for several files per second."""
    now = time.time()
    return time.strftime("%Y%m%d-%H%M%S", time.localtime(now)) + f"-{int(now * 1e6) % 1_000_000:06d}"


def rotate(pattern: str, keep: int) -> None:
    for old in sorted(backups_dir().glob(pattern))[:-keep]:
        try:
            old.unlink()
        except OSError as exc:
            log.warning("Could not remove old backup %s: %s", old.name, exc)


def make_backup(force: bool = False) -> Optional[Path]:
    """Snapshot the current notes_data.json into backups/ (throttled).

    Callers writing the data file hold file_lock; the file being copied
    was just read successfully, so a snapshot is always a valid file.
    """
    if not DATA_FILE.exists():
        return None
    bdir = backups_dir()
    bdir.mkdir(exist_ok=True)
    existing = sorted(bdir.glob("notes_data-*.json"))
    if (not force and existing
            and time.time() - existing[-1].stat().st_mtime < BACKUP_MIN_INTERVAL):
        return None
    dest = bdir / f"notes_data-{stamp()}.json"
    try:
        dest.write_bytes(DATA_FILE.read_bytes())
    except OSError as exc:
        log.warning("Could not write backup %s: %s", dest.name, exc)
        return None
    rotate("notes_data-*.json", BACKUP_KEEP)
    return dest


# ---------------------------------------------------------------------------
# Reading and writing
# ---------------------------------------------------------------------------


def _load_json_file(path: Path) -> dict[str, Any]:
    """Parse a data file. ValueError (bad UTF-8 / JSON / shape) = corrupt."""
    data = json.loads(path.read_bytes().decode("utf-8"))
    if not isinstance(data, dict):
        raise ValueError("top level is not an object")
    return data


def _atomic_write_json(path: Path, data: dict[str, Any]) -> None:
    """tmp file + fsync + os.replace: a crash never leaves a half file."""
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def _recover_corrupt_data(reason: Exception) -> dict[str, Any]:
    """notes_data.json is unreadable: keep it aside, fall back to a backup.

    The damaged file is never overwritten — it is renamed to
    notes_data.corrupt-<timestamp>.json. The newest backup that parses is
    restored; the UI shows RUNTIME.data_notice to the user.
    """
    corrupt = DATA_DIR / f"notes_data.corrupt-{stamp()}.json"
    os.replace(DATA_FILE, corrupt)
    log.error("notes_data.json is corrupt (%s); moved to %s", reason, corrupt.name)

    candidates = sorted(backups_dir().glob("notes_data-*.json"), reverse=True)
    if DATA_BAK.exists():           # single .bak written by older versions
        candidates.append(DATA_BAK)
    for candidate in candidates:
        try:
            data = _load_json_file(candidate)
        except (OSError, ValueError):
            continue
        _atomic_write_json(DATA_FILE, data)
        when = time.strftime("%Y-%m-%d %H:%M", time.localtime(candidate.stat().st_mtime))
        RUNTIME.data_notice = (
            f"Your notes file was corrupt. It was kept as {corrupt.name} and the "
            f"latest good backup ({when}) was restored. Changes made after that "
            "backup may be missing.")
        return data

    RUNTIME.data_notice = (
        f"Your notes file was corrupt and no usable backup was found. The "
        f"damaged file was kept as {corrupt.name}; NoirPad started empty.")
    return copy.deepcopy(DEFAULT_DATA)


def read_data_unlocked() -> dict[str, Any]:
    """Read notes_data.json WITHOUT taking the lock (caller must hold it)."""
    if not DATA_FILE.exists():
        return copy.deepcopy(DEFAULT_DATA)
    try:
        return _load_json_file(DATA_FILE)
    except ValueError as exc:  # includes UnicodeDecodeError / JSONDecodeError
        return _recover_corrupt_data(exc)


def write_data_unlocked(data: dict[str, Any]) -> None:
    """Write notes_data.json WITHOUT taking the lock (caller must hold it)."""
    make_backup()
    _atomic_write_json(DATA_FILE, data)


# Kept in notes_data.json but never sent to the browser or put in a backup.
PRIVATE_KEYS = ("app_lock",)


def public_view(data: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in data.items() if k not in PRIVATE_KEYS}


def read_data() -> dict[str, Any]:
    """Locked read — for read-only endpoints."""
    with file_lock:
        return read_data_unlocked()


def update_data(mutator: Callable[[dict[str, Any]], Any]) -> Any:
    """Hold the lock across the WHOLE read-modify-write sequence.

    `mutator(data)` mutates `data` in place and may return a value that is
    forwarded to the caller. If the mutator raises (e.g. HTTPException for a
    validation failure), the lock is released and NO write happens.
    """
    with file_lock:
        data = read_data_unlocked()
        result = mutator(data)
        write_data_unlocked(data)
    return result


def _etag_unlocked() -> str:
    try:
        st = DATA_FILE.stat()
    except FileNotFoundError:
        return '"0"'
    return f'"{st.st_mtime_ns:x}-{st.st_size:x}"'


def data_etag() -> str:
    """Changes whenever notes_data.json is rewritten (D13)."""
    with file_lock:
        return _etag_unlocked()


def read_data_with_etag() -> tuple[dict[str, Any], str]:
    """The data and the ETag of exactly that state, read under one lock."""
    with file_lock:
        data = read_data_unlocked()
        return data, _etag_unlocked()


# ---------------------------------------------------------------------------
# Single local profile
# ---------------------------------------------------------------------------
#
# NoirPad has one profile per data directory. Data written by the old
# multi-user build (top-level `users`/`sessions`, `user_id` on every tree
# item) is flattened once at startup.


def _migrate_to_single_profile() -> None:
    """Flatten a legacy multi-user notes_data.json into the single profile.

    The original file is kept as
    `notes_data.pre-single-profile-<timestamp>.json` next to it.
    """
    with file_lock:
        if not DATA_FILE.exists():
            return
        try:
            data = read_data_unlocked()
        except OSError:  # corrupt content is recovered inside read_data_unlocked
            return
        legacy = (
            "users" in data
            or "sessions" in data
            or has_user_ids(data.get("tree") or [])
            or has_user_ids((data.get("trash") or {}).get("tree") or [])
        )
        if not legacy:
            return
        snapshot = DATA_FILE.with_name(
            f"notes_data.pre-single-profile-{time.strftime('%Y%m%d-%H%M%S')}.json")
        snapshot.write_bytes(DATA_FILE.read_bytes())
        data.pop("users", None)
        data.pop("sessions", None)
        strip_user_ids(data.get("tree") or [])
        strip_user_ids((data.get("trash") or {}).get("tree") or [])
        write_data_unlocked(data)
        log.warning("Converted multi-user data to a single profile (snapshot: %s)",
                    snapshot.name)


def acquire_instance_lock(data_dir: Optional[Path] = None) -> Optional[IO]:
    """Lock DATA_DIR/noirpad.lock so only one NoirPad uses this data dir.

    Two processes doing read-modify-write on the same notes_data.json would
    silently drop each other's changes (D7). Returns the open lock handle
    (keep it alive for the process lifetime) or None if another NoirPad —
    desktop or web — already holds it. The OS releases it on exit/crash.
    """
    path = Path(data_dir or DATA_DIR) / "noirpad.lock"
    handle = open(path, "a+")
    try:
        if os.name == "nt":
            import msvcrt
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        return None
    return handle

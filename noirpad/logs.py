"""Log file: <data dir>/logs/noirpad.log (1 MB × 3 rotations).

%LOCALAPPDATA%\\NoirPad\\logs\\noirpad.log for the installed app. Only
start-up facts, ports, versions and errors are logged — never note
content, names or passwords (uvicorn's access log stays off).
"""

import logging
import os
import re
import sys
import threading
from logging.handlers import RotatingFileHandler
from pathlib import Path

LOG_FORMAT = "%(asctime)s %(levelname)-7s %(name)s: %(message)s"
MAX_BYTES = 1024 * 1024
BACKUP_COUNT = 3

log = logging.getLogger("noirpad")


def _home_dirs() -> list[str]:
    """The user's profile folder as it may appear in a path (S5)."""
    homes = {os.environ.get("USERPROFILE") or "", os.environ.get("HOME") or ""}
    try:
        homes.add(str(Path.home()))
    except RuntimeError:
        pass
    return sorted((h.rstrip("\\/") for h in homes if len(h.rstrip("\\/")) > 3), key=len, reverse=True)


def anonymize(text: str) -> str:
    """C:\\Users\\<name>\\… → ~\\… in any spelling (\\, /, doubled \\\\ from
    repr(), any case): a log attached to an issue must not name the user."""
    for home in _home_dirs():
        parts = [re.escape(p) for p in re.split(r"[\\/]+", home) if p]
        lead = r"[\\/]+" if home[:1] in "\\/" else r"(?<!\w)"     # /home/x vs C:\Users\x
        pattern = lead + r"[\\/]+".join(parts) + r"(?![\w.-])"
        text = re.sub(pattern, "~", text, flags=re.IGNORECASE)
    return text


class PrivateFormatter(logging.Formatter):
    """Every line (message and traceback) without the user's profile path."""

    def format(self, record: logging.LogRecord) -> str:
        return anonymize(super().format(record))


def log_path(data_dir: Path) -> Path:
    return Path(data_dir) / "logs" / "noirpad.log"


def setup_logging(data_dir: Path) -> Path:
    """Send the root logger (noirpad + uvicorn) to the rotating log file
    and record uncaught exceptions from any thread. Returns the path."""
    path = log_path(data_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(path, maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT,
                                  encoding="utf-8")
    handler.setFormatter(PrivateFormatter(LOG_FORMAT))
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    if not any(isinstance(h, RotatingFileHandler) and Path(h.baseFilename) == path
               for h in root.handlers):
        root.addHandler(handler)

    def _excepthook(exc_type, exc, tb):
        if not issubclass(exc_type, KeyboardInterrupt):
            log.critical("Uncaught exception", exc_info=(exc_type, exc, tb))
        sys.__excepthook__(exc_type, exc, tb)

    def _thread_excepthook(args):
        if not issubclass(args.exc_type, SystemExit):
            log.critical("Uncaught exception in thread %s",
                         args.thread.name if args.thread else "?",
                         exc_info=(args.exc_type, args.exc_value, args.exc_traceback))

    sys.excepthook = _excepthook
    threading.excepthook = _thread_excepthook
    return path

"""Log file: <data dir>/logs/noirpad.log (1 MB × 3 rotations).

%LOCALAPPDATA%\\NoirPad\\logs\\noirpad.log for the installed app. Only
start-up facts, ports, versions and errors are logged — never note
content, names or passwords (uvicorn's access log stays off).
"""

import logging
import sys
import threading
from logging.handlers import RotatingFileHandler
from pathlib import Path

LOG_FORMAT = "%(asctime)s %(levelname)-7s %(name)s: %(message)s"
MAX_BYTES = 1024 * 1024
BACKUP_COUNT = 3

log = logging.getLogger("noirpad")


def log_path(data_dir: Path) -> Path:
    return Path(data_dir) / "logs" / "noirpad.log"


def setup_logging(data_dir: Path) -> Path:
    """Send the root logger (noirpad + uvicorn) to the rotating log file
    and record uncaught exceptions from any thread. Returns the path."""
    path = log_path(data_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(path, maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT,
                                  encoding="utf-8")
    handler.setFormatter(logging.Formatter(LOG_FORMAT))
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

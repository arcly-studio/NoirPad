"""
NoirPad desktop launcher.

Wraps the existing FastAPI app (NoirPad-web.py) in a native window using
pywebview + WebView2 (EdgeChromium) on Windows. The FastAPI server runs in
a background thread on a free loopback port; the webview points at it.

This file is the PyInstaller entrypoint. Running `python desktop.py` in dev
gives the same desktop experience without bundling. The plain web mode
(`python NoirPad-web.py`) is unaffected — desktop.py is purely additive.
"""

from __future__ import annotations

import sys, os
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

import importlib.util
import socket
import sys
import threading
import time
from pathlib import Path

import uvicorn


# ---------------------------------------------------------------------------
# Locate + import NoirPad-web.py
# ---------------------------------------------------------------------------
#
# The backend module's filename has a dash, so a plain `import NoirPad_web`
# won't work. We resolve it relative to:
#   * sys._MEIPASS in a PyInstaller bundle (where --add-data puts it), or
#   * this file's directory in dev.
# Then load it via importlib so PyInstaller still sees a real Python script
# and the FastAPI `app` object is reachable.

def _backend_path() -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base / "NoirPad-web.py"


def _load_backend():
    path = _backend_path()
    if not path.is_file():
        raise FileNotFoundError(f"Backend module not found at {path}")
    spec = importlib.util.spec_from_file_location("noirpad_web", str(path))
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot build module spec for {path}")
    module = importlib.util.module_from_spec(spec)
    # Register before exec so any "from noirpad_web import X" inside the
    # module (none today, but cheap to be safe) resolves to the same object.
    sys.modules["noirpad_web"] = module
    spec.loader.exec_module(module)
    return module


# ---------------------------------------------------------------------------
# Networking helpers
# ---------------------------------------------------------------------------

def _pick_free_port() -> int:
    """Ask the kernel for a free loopback port. Closing the socket
    immediately releases it; uvicorn will rebind a moment later. Race
    window is tiny on a desktop machine and the alternative (a fixed
    port) breaks if two NoirPad windows run concurrently."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_for_server(port: int, timeout: float = 10.0) -> bool:
    """Poll TCP connect until the server accepts, or *timeout* elapses."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            try:
                s.connect(("127.0.0.1", port))
                return True
            except (ConnectionRefusedError, OSError):
                time.sleep(0.1)
    return False


# ---------------------------------------------------------------------------
# Uvicorn lifecycle
# ---------------------------------------------------------------------------

class _ServerHandle:
    """Owns the uvicorn.Server + its thread so we can stop both on exit."""

    def __init__(self, app, port: int):
        config = uvicorn.Config(
            app=app,
            host="127.0.0.1",
            port=port,
            log_level="info",
            access_log=False,
            workers=1,
            reload=False,
        )
        self.server = uvicorn.Server(config)
        # Uvicorn installs its own SIGINT/SIGTERM handlers when run on the
        # main thread; we're in a worker thread so we suppress that install
        # to keep the main thread (pywebview) responsive to Ctrl+C / close.
        self.server.install_signal_handlers = lambda: None
        self.thread = threading.Thread(
            target=self.server.run, name="noirpad-uvicorn", daemon=True
        )

    def start(self) -> None:
        self.thread.start()

    def stop(self, join_timeout: float = 5.0) -> None:
        self.server.should_exit = True
        self.thread.join(timeout=join_timeout)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

WINDOW_TITLE = "NoirPad"
WINDOW_MIN_WIDTH = 720
WINDOW_MIN_HEIGHT = 480
WINDOW_INITIAL_WIDTH = 1280
WINDOW_INITIAL_HEIGHT = 800


def main() -> int:
    backend = _load_backend()
    port = _pick_free_port()
    handle = _ServerHandle(backend.app, port)
    handle.start()

    if not _wait_for_server(port, timeout=10.0):
        handle.stop()
        print(
            f"NoirPad backend did not become ready on 127.0.0.1:{port} "
            "within 10s — aborting.",
            file=sys.stderr,
        )
        return 1

    url = f"http://127.0.0.1:{port}"
    print(f"NoirPad desktop: backend ready at {url}", flush=True)

    # Import pywebview lazily so the FastAPI process can boot even on a
    # machine where pywebview install is broken — useful for diagnostics.
    import webview

    webview.create_window(
        WINDOW_TITLE,
        url=url,
        width=WINDOW_INITIAL_WIDTH,
        height=WINDOW_INITIAL_HEIGHT,
        min_size=(WINDOW_MIN_WIDTH, WINDOW_MIN_HEIGHT),
        resizable=True,
        confirm_close=False,
    )
    try:
        # gui="edgechromium" forces WebView2 on Windows, which is what we
        # ship for. On other platforms pywebview picks the system default.
        gui = "edgechromium" if sys.platform == "win32" else None
        webview.start(gui=gui)
    finally:
        handle.stop()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""
NoirPad desktop launcher (PyInstaller entry point).

Wraps the FastAPI app (noirpad.app) in a native window using pywebview +
WebView2 (EdgeChromium) on Windows. The server runs in a background thread
on a free loopback port; the webview points at it. `python desktop.py` in
dev gives the same experience without bundling.
"""

from __future__ import annotations

import os
import sys

# PyInstaller windowed builds have no console: give print() somewhere to go.
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

import secrets
import socket
import threading
import time

import uvicorn


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
            log_level="warning",
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


def _focus_running_instance() -> None:
    """Bring the already-open NoirPad window to front, or explain why not."""
    if sys.platform != "win32":
        print("NoirPad is already running.", file=sys.stderr)
        return
    import ctypes

    user32 = ctypes.windll.user32
    hwnd = user32.FindWindowW(None, WINDOW_TITLE)
    if hwnd:
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
        user32.SetForegroundWindow(hwnd)
        return
    user32.MessageBoxW(
        None,
        "NoirPad is already running (maybe as the web version in a terminal).\n\n"
        "Close the other instance first; two NoirPads on the same notes would "
        "overwrite each other's changes.",
        WINDOW_TITLE,
        0x40,  # MB_ICONINFORMATION
    )


def main() -> int:
    from noirpad import app as backend_app, server_auth, storage

    # One NoirPad per data directory (desktop or web), see D7 in the audit.
    instance_lock = storage.acquire_instance_lock()
    if instance_lock is None:
        _focus_running_instance()
        return 0

    # Random per-launch token: every /api/ request must carry it, so other
    # local processes (or web pages) that find the port can't use the API.
    token = secrets.token_urlsafe(32)
    server_auth.configure(mode="desktop", password=None, desktop_token=token)
    port = _pick_free_port()
    handle = _ServerHandle(backend_app.app, port)
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
    # The fragment never reaches the server or its logs; api.js reads it
    # and removes it from the address bar.
    window_url = f"{url}/#token={token}"

    # Import pywebview lazily so the FastAPI process can boot even on a
    # machine where pywebview install is broken — useful for diagnostics.
    import webview

    # links.js opens external links with window.open(); pywebview must hand
    # those to the system browser, never load them in the app window.
    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
    # Exports and backups are downloads; pywebview cancels them by default.
    # With this on, WebView2 shows a "Save as" dialog.
    webview.settings["ALLOW_DOWNLOADS"] = True

    webview.create_window(
        WINDOW_TITLE,
        url=window_url,
        width=WINDOW_INITIAL_WIDTH,
        height=WINDOW_INITIAL_HEIGHT,
        min_size=(WINDOW_MIN_WIDTH, WINDOW_MIN_HEIGHT),
        resizable=True,
        confirm_close=False,
    )
    # Persistent WebView2 profile so localStorage (open folders, CRT
    # toggle) survives restarts; it lives next to the notes.
    storage_path = storage.DATA_DIR / "webview"
    storage_path.mkdir(parents=True, exist_ok=True)
    try:
        # gui="edgechromium" forces WebView2 on Windows, which is what we
        # ship for. On other platforms pywebview picks the system default.
        gui = "edgechromium" if sys.platform == "win32" else None
        webview.start(
            gui=gui,
            private_mode=False,
            storage_path=str(storage_path),
        )
    finally:
        handle.stop()
        instance_lock.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

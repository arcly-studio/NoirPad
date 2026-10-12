"""
NoirPad desktop launcher (PyInstaller entry point).

Wraps the FastAPI app (noirpad.app) in a native window using pywebview +
WebView2 (EdgeChromium) on Windows. The server runs in a background thread
on a free loopback port; the webview points at it. `python desktop.py` in
dev gives the same experience without bundling.

Failures never vanish silently: everything goes to the log file
(%LOCALAPPDATA%\\NoirPad\\logs\\noirpad.log) and start-up problems — no
WebView2 runtime, a crash — are shown in a Windows message box with the
path to that log.
"""

from __future__ import annotations

import os
import sys

# PyInstaller windowed builds have no console: give print() somewhere to go.
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

import json
import logging
import secrets
import socket
import threading
import time
import webbrowser
from pathlib import Path
from typing import Optional

import uvicorn

from noirpad import config, logs
from noirpad.__version__ import __version__

log = logging.getLogger("noirpad.desktop")

WINDOW_TITLE = "NoirPad"
WINDOW_MIN_WIDTH = 720
WINDOW_MIN_HEIGHT = 480
WINDOW_INITIAL_WIDTH = 1280
WINDOW_INITIAL_HEIGHT = 800

# Held while NoirPad runs; installer.iss AppMutex uses the same name so
# setup/uninstall can ask the user to close the app first.
APP_MUTEX = "NoirPad-B6F2E7C0-AppMutex"

WEBVIEW2_GUID = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
WEBVIEW2_DOWNLOAD = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"  # Evergreen bootstrapper

MB_OK, MB_YESNO = 0x0, 0x4
MB_ICONERROR, MB_ICONWARNING, MB_ICONINFORMATION = 0x10, 0x30, 0x40
IDYES = 6

MESSAGES = {
    "en": {
        "running": "NoirPad is already running (maybe as the web version in a terminal).\n\n"
                   "Close the other instance first; two NoirPads on the same notes would "
                   "overwrite each other's changes.",
        "webview2": "NoirPad needs the Microsoft Edge WebView2 Runtime, which is not "
                    "installed on this computer.\n\nOpen the Microsoft download page now?\n\n"
                    "Details are in the log:\n{log}",
        "no_server": "NoirPad could not start its local server.\n\nDetails are in the log:\n{log}",
        "crash": "NoirPad could not start: {error}\n\nDetails are in the log:\n{log}",
    },
    "cs": {
        "running": "NoirPad už běží (možná jako webová verze v terminálu).\n\n"
                   "Nejdřív ho zavřete: dva NoirPady nad stejnými poznámkami by si navzájem "
                   "přepisovaly změny.",
        "webview2": "NoirPad potřebuje Microsoft Edge WebView2 Runtime, který na tomto "
                    "počítači není nainstalovaný.\n\nOtevřít stránku Microsoftu ke stažení?\n\n"
                    "Podrobnosti jsou v logu:\n{log}",
        "no_server": "NoirPadu se nepodařilo spustit místní server.\n\n"
                     "Podrobnosti jsou v logu:\n{log}",
        "crash": "NoirPad se nepodařilo spustit: {error}\n\nPodrobnosti jsou v logu:\n{log}",
    },
}


# ---------------------------------------------------------------------------
# Windows helpers
# ---------------------------------------------------------------------------


def _language(data_dir: Path) -> str:
    """The UI language setting, else Windows' display language."""
    try:
        setting = json.loads((data_dir / "notes_data.json").read_text(encoding="utf-8")).get("language")
    except (OSError, ValueError, AttributeError):
        setting = None
    if setting in MESSAGES:
        return setting
    if sys.platform == "win32":
        import ctypes
        return "cs" if ctypes.windll.kernel32.GetUserDefaultUILanguage() & 0x3FF == 0x05 else "en"
    return "en"


def _message_box(text: str, flags: int) -> int:
    if sys.platform != "win32":
        print(text, file=sys.stderr)
        return 0
    import ctypes
    return ctypes.windll.user32.MessageBoxW(None, text, WINDOW_TITLE, flags | 0x10000)  # MB_SETFOREGROUND


def _webview2_version() -> Optional[str]:
    """Installed WebView2 Runtime version, per Microsoft's documented
    registry keys (machine-wide 64/32-bit view, then per-user)."""
    if sys.platform != "win32":
        return "n/a"
    import winreg
    keys = [
        (winreg.HKEY_LOCAL_MACHINE, rf"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{WEBVIEW2_GUID}"),
        (winreg.HKEY_LOCAL_MACHINE, rf"SOFTWARE\Microsoft\EdgeUpdate\Clients\{WEBVIEW2_GUID}"),
        (winreg.HKEY_CURRENT_USER, rf"Software\Microsoft\EdgeUpdate\Clients\{WEBVIEW2_GUID}"),
    ]
    for hive, path in keys:
        try:
            with winreg.OpenKey(hive, path) as key:
                version = winreg.QueryValueEx(key, "pv")[0]
        except OSError:
            continue
        if version and version != "0.0.0.0":
            return version
    return None


def _hold_app_mutex():
    if sys.platform != "win32":
        return None
    import ctypes
    return ctypes.windll.kernel32.CreateMutexW(None, False, APP_MUTEX)


def _find_app_window() -> int:
    """The running NoirPad window: title "NoirPad" and a WinForms class
    (pywebview), so an Explorer folder called NoirPad never matches."""
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def _visit(hwnd, _lparam):
        title = ctypes.create_unicode_buffer(64)
        cls = ctypes.create_unicode_buffer(128)
        user32.GetWindowTextW(hwnd, title, 64)
        user32.GetClassNameW(hwnd, cls, 128)
        if title.value == WINDOW_TITLE and cls.value.startswith("WindowsForms10."):
            found.append(hwnd)
            return False
        return True

    user32.EnumWindows(_visit, 0)
    return found[0] if found else 0


def _focus_running_instance(lang: str) -> None:
    """Bring the already-open NoirPad window to front, or explain why not."""
    if sys.platform == "win32":
        import ctypes
        hwnd = _find_app_window()
        if hwnd:
            user32 = ctypes.windll.user32
            user32.ShowWindow(hwnd, 9)  # SW_RESTORE
            user32.SetForegroundWindow(hwnd)
            return
    _message_box(MESSAGES[lang]["running"], MB_OK | MB_ICONINFORMATION)


# ---------------------------------------------------------------------------
# Networking helpers
# ---------------------------------------------------------------------------

def _pick_free_port() -> int:
    """Ask the kernel for a free loopback port. Closing the socket
    immediately releases it; uvicorn will rebind a moment later."""
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
        config_ = uvicorn.Config(
            app=app,
            host="127.0.0.1",
            port=port,
            log_level="info",
            log_config=None,     # uvicorn logs go to our log file (root logger)
            access_log=False,    # never log requests (URLs carry note ids)
            workers=1,
            reload=False,
        )
        self.server = uvicorn.Server(config_)
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


def _run(data_dir: Path, log_file: Path, lang: str) -> int:
    from noirpad import app as backend_app, server_auth, storage

    # One NoirPad per data directory (desktop or web), see D7 in the audit.
    instance_lock = storage.acquire_instance_lock()
    if instance_lock is None:
        log.info("Another NoirPad uses %s; focusing it", data_dir)
        _focus_running_instance(lang)
        return 0
    mutex = _hold_app_mutex()

    webview2 = _webview2_version()
    log.info("WebView2 runtime: %s", webview2 or "MISSING")
    if webview2 is None:
        answer = _message_box(MESSAGES[lang]["webview2"].format(log=log_file),
                              MB_YESNO | MB_ICONWARNING)
        if answer == IDYES:
            webbrowser.open(WEBVIEW2_DOWNLOAD)
        return 2

    # Random per-launch token: every /api/ request must carry it, so other
    # local processes (or web pages) that find the port can't use the API.
    token = secrets.token_urlsafe(32)
    server_auth.configure(mode="desktop", password=None, desktop_token=token)
    port = _pick_free_port()
    handle = _ServerHandle(backend_app.app, port)
    handle.start()

    if not _wait_for_server(port, timeout=10.0):
        handle.stop()
        log.error("Backend did not become ready on 127.0.0.1:%d within 10 s", port)
        _message_box(MESSAGES[lang]["no_server"].format(log=log_file), MB_OK | MB_ICONERROR)
        return 1
    log.info("Backend ready on 127.0.0.1:%d", port)

    # The fragment never reaches the server or its logs; api.js reads it
    # and removes it from the address bar.
    window_url = f"http://127.0.0.1:{port}/#token={token}"

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
        webview.start(gui=gui, private_mode=False, storage_path=str(storage_path))
    finally:
        handle.stop()
        instance_lock.close()
        if mutex:
            import ctypes
            ctypes.windll.kernel32.CloseHandle(mutex)
    log.info("NoirPad closed")
    return 0


def main() -> int:
    data_dir = config.get_data_dir()
    log_file = logs.setup_logging(data_dir)
    lang = _language(data_dir)
    log.info("NoirPad %s starting (desktop, %s, Python %s, data dir %s)",
             __version__, "installed" if config.is_frozen() else "dev",
             sys.version.split()[0], data_dir)
    try:
        return _run(data_dir, log_file, lang)
    except Exception as exc:
        log.exception("NoirPad failed to start")
        _message_box(MESSAGES[lang]["crash"].format(error=exc, log=log_file),
                     MB_OK | MB_ICONERROR)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

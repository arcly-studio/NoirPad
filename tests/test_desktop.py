"""Step E: desktop start-up never fails silently (log file + message box)."""

import json
import logging
import os
import subprocess
import sys
import threading
import time
import types
from logging.handlers import RotatingFileHandler
from pathlib import Path

import pytest
import uvicorn

import desktop
from noirpad import app as noirpad_app, logs
from noirpad.runtime_imports import RUNTIME_IMPORTS, UVICORN_OPTIONS

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def desk(np_backend, monkeypatch):
    """desktop.main() against the per-test data dir, with message boxes captured."""
    monkeypatch.setenv("NOIRPAD_DATA_DIR", str(np_backend.DATA_DIR))
    boxes = []
    monkeypatch.setattr(desktop, "_message_box", lambda text, flags: boxes.append(text) or 0)
    root = logging.getLogger()
    before = list(root.handlers)
    yield boxes
    for handler in root.handlers[:]:
        if handler not in before:
            root.removeHandler(handler)
            handler.close()


def log_text(np_backend):
    return logs.log_path(np_backend.DATA_DIR).read_text(encoding="utf-8")


def test_missing_webview2_explains_and_points_to_log(desk, np_backend, monkeypatch):
    monkeypatch.setattr(desktop, "_webview2_version", lambda: None)
    assert desktop.main() == 2
    assert len(desk) == 1 and "WebView2" in desk[0]
    assert str(logs.log_path(np_backend.DATA_DIR)) in desk[0]
    text = log_text(np_backend)
    assert "NoirPad 1.0.0 starting" in text and "WebView2 runtime: MISSING" in text


def test_crash_at_start_is_logged_and_shown(desk, np_backend, monkeypatch):
    def boom(*_args):
        raise RuntimeError("boom")

    monkeypatch.setattr(desktop, "_run", boom)
    assert desktop.main() == 1
    assert "boom" in desk[0] and "noirpad.log" in desk[0]
    assert "Traceback" in log_text(np_backend)


def test_second_instance_focuses_the_first(desk, np_backend, monkeypatch):
    focused = []
    monkeypatch.setattr(desktop, "_focus_running_instance", focused.append)
    held = np_backend.acquire_instance_lock()
    try:
        assert desktop.main() == 0
    finally:
        held.close()
    assert focused == ["en"] or focused == ["cs"]


def test_czech_messages_follow_the_language_setting(desk, client, np_backend, monkeypatch):
    client.put("/api/settings", json={"language": "cs"})
    monkeypatch.setattr(desktop, "_webview2_version", lambda: None)
    desktop.main()
    assert "není nainstalovaný" in desk[0]


def test_message_boxes_use_the_install_language_until_one_is_picked(desk, client, np_backend, monkeypatch):
    (np_backend.DATA_DIR / "install-language.txt").write_text("cs", encoding="ascii")
    assert desktop._language(np_backend.DATA_DIR) == "cs"
    client.put("/api/settings", json={"language": "en"})
    assert desktop._language(np_backend.DATA_DIR) == "en"


def test_log_rotates_and_never_contains_note_content(desk, client, np_backend, monkeypatch):
    monkeypatch.setattr(desktop, "_webview2_version", lambda: None)
    desktop.main()
    handler = next(h for h in logging.getLogger().handlers if isinstance(h, RotatingFileHandler))
    assert handler.maxBytes == 1024 * 1024 and handler.backupCount == 3

    secret = "TAJNY-OBSAH-123"
    r = client.post("/api/tree/new-note", json={"name": secret})
    client.put(f"/api/note/{r.json()['id']}", json={"content": secret})
    client.post("/api/encrypt", json={"id": r.json()["id"], "password": secret})
    logging.getLogger("noirpad").error("an error without user data")
    assert secret not in log_text(np_backend)


# ---- 1.0.0 regression: the installed app died on `import websockets.legacy` --


def _uvicorn_config():
    """The uvicorn.Config desktop.py runs, unloaded."""
    return desktop._ServerHandle(noirpad_app.app, 0).server.config


def test_uvicorn_config_imports_no_optional_packages(monkeypatch):
    # A half-present websockets (importable, without .legacy) is what the
    # 1.0.0 bundle had; uvicorn's ws="auto" then crashed at start-up.
    monkeypatch.setitem(sys.modules, "websockets", types.ModuleType("websockets"))
    for name in ("wsproto", "httptools", "uvloop"):
        monkeypatch.setitem(sys.modules, name, None)
    for name in [n for n in sys.modules if n.startswith("uvicorn.protocols.websockets")]:
        monkeypatch.delitem(sys.modules, name)

    config_ = _uvicorn_config()
    config_.load()

    assert config_.ws_protocol_class is None
    assert config_.http_protocol_class.__module__ == "uvicorn.protocols.http.h11_impl"
    assert not [n for n in sys.modules if n.startswith("uvicorn.protocols.websockets")]


def test_runtime_imports_cover_what_uvicorn_loads_by_name():
    """Every implementation our uvicorn options select is in the list the
    spec bundles and `NoirPad.exe --smoke-test` imports."""
    from uvicorn import config as uc

    picked = [uc.HTTP_PROTOCOLS[UVICORN_OPTIONS["http"]],
              uc.LIFESPAN[UVICORN_OPTIONS["lifespan"]],
              uc.LOOP_FACTORIES[UVICORN_OPTIONS["loop"]]]
    assert UVICORN_OPTIONS["ws"] == "none"
    for target in picked:
        assert target.split(":")[0] in RUNTIME_IMPORTS


def test_runtime_imports_are_importable():
    assert desktop._missing_runtime_imports() == []


def test_spec_bundles_the_runtime_imports():
    spec = (ROOT / "noirpad.spec").read_text(encoding="utf-8")
    assert '_imports["RUNTIME_IMPORTS"]' in spec and '_imports["WINDOWS_IMPORTS"]' in spec


# ---- a crashing server: one message, at once, data lock released -----------


def test_server_crash_fails_fast_with_one_message(desk, np_backend, monkeypatch):
    def crash(_self, *args, **kwargs):
        raise ModuleNotFoundError("No module named 'websockets.legacy'")

    monkeypatch.setattr(desktop, "_webview2_version", lambda: "test")
    monkeypatch.setattr(uvicorn.Server, "run", crash)
    started = time.monotonic()
    assert desktop.main() == 1
    assert time.monotonic() - started < 5          # not the old 10 s timeout
    no_server = {m["no_server"].split("\n")[0] for m in desktop.MESSAGES.values()}
    assert len(desk) == 1 and desk[0].split("\n")[0] in no_server
    assert "Local server crashed" in log_text(np_backend)
    held = np_backend.acquire_instance_lock()      # lock released before the box
    assert held is not None
    held.close()


def test_second_instance_stays_quiet_when_first_gives_up(desk, np_backend, monkeypatch):
    monkeypatch.setattr(desktop, "_find_app_window", lambda: 0)
    held = np_backend.acquire_instance_lock()
    threading.Timer(0.5, held.close).start()       # the first NoirPad exits
    desktop._focus_running_instance("en")
    assert desk == []


def test_second_instance_explains_when_no_window_appears(desk, np_backend, monkeypatch):
    monkeypatch.setattr(desktop, "_find_app_window", lambda: 0)
    monkeypatch.setattr(desktop, "FOCUS_WAIT_SECONDS", 0.3)
    held = np_backend.acquire_instance_lock()
    try:
        desktop._focus_running_instance("en")
    finally:
        held.close()
    assert len(desk) == 1 and "already running" in desk[0]


# ---- --smoke-test: what build.ps1 runs against the built NoirPad.exe --------


def test_smoke_test_mode_serves_api_version_and_stops(tmp_path):
    import httpx

    env = {**os.environ, "NOIRPAD_DATA_DIR": str(tmp_path)}
    proc = subprocess.Popen([sys.executable, str(ROOT / "desktop.py"), desktop.SMOKE_FLAG],
                            env=env, cwd=ROOT)
    info = tmp_path / desktop.SMOKE_FILE
    try:
        deadline = time.monotonic() + 30
        while not info.exists() and proc.poll() is None and time.monotonic() < deadline:
            time.sleep(0.1)
        assert info.exists(), (tmp_path / "logs" / "noirpad.log").read_text(encoding="utf-8")
        smoke = json.loads(info.read_text(encoding="utf-8"))
        url = f"http://127.0.0.1:{smoke['port']}/api/version"
        assert httpx.get(url).status_code == 403                       # token still required
        r = httpx.get(url, headers={"X-NoirPad-Token": smoke["token"]})
        assert r.status_code == 200 and r.json()["version"] == smoke["version"]
        info.unlink()
        assert proc.wait(timeout=15) == 0
    finally:
        if proc.poll() is None:
            proc.kill()


def test_installer_removes_the_previous_build_first():
    r"""Leftover packages from an older build in {app}\_internal shadowed
    missing modules (stale websockets 16 → "No module named
    'websockets.legacy'"), so an upgrade starts from an empty _internal."""
    iss = (ROOT / "installer.iss").read_text(encoding="utf-8")
    section = iss.split("[InstallDelete]", 1)[1].split("\n[", 1)[0]
    assert r'Type: filesandordirs; Name: "{app}\_internal"' in section


@pytest.mark.skipif(sys.platform != "win32", reason="Windows mutex")
def test_installer_mutex_stays_held_until_the_process_ends(desk, np_backend, monkeypatch):
    """B8: releasing AppMutex when the window closed let the uninstaller
    start while NoirPad.exe was still shutting down and locking its files."""
    import ctypes
    monkeypatch.setattr(desktop, "_webview2_version", lambda: None)
    assert desktop.main([]) == 2
    handle = ctypes.windll.kernel32.OpenMutexW(0x00100000, False, desktop.APP_MUTEX)  # SYNCHRONIZE
    assert handle, "AppMutex was released before the process ended"
    ctypes.windll.kernel32.CloseHandle(handle)


def test_webview_profile_lives_in_the_data_dir(tmp_path, monkeypatch):
    """B8: nothing NoirPad writes at run time may land in the install dir."""
    calls = {}
    fake = types.SimpleNamespace(
        settings={},
        create_window=lambda *a, **kw: None,
        start=lambda **kw: calls.update(kw),
    )
    monkeypatch.setitem(sys.modules, "webview", fake)
    desktop._show_window(1234, "tok", tmp_path)
    assert Path(calls["storage_path"]) == tmp_path / "webview"
    assert calls["private_mode"] is False


def _installer_section(name):
    iss = (ROOT / "installer.iss").read_text(encoding="utf-8-sig")
    return iss.split(f"[{name}]", 1)[1].split("\n[", 1)[0]


def test_uninstaller_removes_the_whole_install_dir():
    """B8: the uninstall left NoirPad.exe, python314.dll, … behind."""
    section = _installer_section("UninstallDelete")
    assert 'Type: filesandordirs; Name: "{app}"' in section
    entries = [line for line in section.splitlines() if line.startswith("Type:")]
    assert not any("localappdata" in line.lower() for line in entries)   # notes: only on "Yes"


def test_installer_closes_noirpad_processes_first():
    code = _installer_section("Code")
    assert "function InitializeUninstall(): Boolean;" in code
    assert "Result := CloseAppProcesses(UninstallSilent());" in code
    assert "function PrepareToInstall(" in code
    # Only processes started from {app} or using NoirPad's WebView2 profile.
    assert "StartsWithText(VarText(Item.ExecutablePath), AppDir)" in code
    assert "'msedgewebview2.exe'" in code
    # The data folder is deleted only after the user said Yes.
    assert "MB_YESNO or MB_DEFBUTTON2) = IDYES then\n    DelTree(DataDir()" in code

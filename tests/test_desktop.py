"""Step E: desktop start-up never fails silently (log file + message box)."""

import logging
from logging.handlers import RotatingFileHandler

import pytest

import desktop
from noirpad import logs


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

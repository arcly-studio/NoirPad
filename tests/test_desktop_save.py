"""N6: in the desktop app exports are saved via a native "Save as" dialog
(no WebView2 Downloads panel); web mode keeps browser downloads."""

import io
import re
import zipfile

import pytest
from fastapi.testclient import TestClient

from noirpad import desktop_save
from noirpad.runtime import RUNTIME

from conftest import new_note

TOKEN = "tok-desktop"
SAVE = {"X-NoirPad-Save-As": "1"}


@pytest.fixture
def desk(np_backend, client, tmp_path, monkeypatch):
    """Desktop mode with a scripted "Save as" dialog."""
    note = new_note(client, name="Nákup: mléko", content="# Seznam\n- mléko")
    asked = []
    target = {"path": str(tmp_path / "out" / "export.zip")}
    (tmp_path / "out").mkdir()
    monkeypatch.setattr(RUNTIME, "save_dialog", lambda name: asked.append(name) or target["path"])
    monkeypatch.setattr(RUNTIME, "saved_files", {})
    np_backend.configure(mode="desktop", desktop_token=TOKEN)
    c = TestClient(np_backend.app, base_url="http://127.0.0.1:8000",
                   headers={"X-NoirPad-Request": "1", "X-NoirPad-Token": TOKEN})
    return c, asked, target, note


def test_export_is_written_by_the_backend_after_the_dialog(desk, tmp_path):
    c, asked, target, _ = desk
    r = c.get("/api/notes/export-md", headers=SAVE)
    assert r.status_code == 200
    info = r.json()
    assert info["saved"] is True and info["name"] == "export.zip" and info["token"]
    assert r.headers["x-noirpad-skipped"] == "0"            # settings.js still reads it
    assert len(asked) == 1 and re.fullmatch(r"noirpad-markdown-\d{4}-\d\d-\d\d\.zip", asked[0])
    with zipfile.ZipFile(tmp_path / "out" / "export.zip") as zf:
        assert any(n.endswith(".md") for n in zf.namelist())
    assert [p.name for p in (tmp_path / "out").iterdir()] == ["export.zip"]   # no temp file left


def test_single_note_export_prefills_the_note_name(desk, tmp_path):
    c, asked, target, note = desk
    target["path"] = str(tmp_path / "out" / "poznamka.txt")
    r = c.get(f"/api/export/{note}/txt", headers=SAVE)
    assert r.json()["saved"] is True
    assert asked == ["Nákup- mléko.txt"]
    assert (tmp_path / "out" / "poznamka.txt").read_text(encoding="utf-8") == "# Seznam\n- mléko"


def test_cancel_saves_nothing(desk, tmp_path):
    c, asked, target, _ = desk
    target["path"] = None
    r = c.get("/api/backup", headers=SAVE)
    assert r.status_code == 200 and r.json() == {"saved": False}
    assert list((tmp_path / "out").iterdir()) == []


def test_without_the_header_or_on_error_nothing_changes(desk):
    c, asked, _, _ = desk
    r = c.get("/api/notes/export-md")
    assert r.headers["content-type"] == "application/zip"
    r = c.get("/api/export/nope/txt", headers=SAVE)
    assert r.status_code == 404 and r.json()["detail"]["code"] == "note_not_found"
    assert asked == []


def test_web_mode_keeps_browser_downloads(client, monkeypatch):
    called = []
    monkeypatch.setattr(RUNTIME, "save_dialog", lambda name: called.append(name))
    r = client.get("/api/notes/export-md", headers=SAVE)
    assert r.headers["content-type"] == "application/zip"
    assert zipfile.ZipFile(io.BytesIO(r.content)).namelist() is not None
    assert called == []


def test_open_folder_only_for_files_saved_this_run(desk, monkeypatch, tmp_path):
    c, _, _, _ = desk
    shown = []
    monkeypatch.setattr(desktop_save, "reveal", shown.append)
    token = c.get("/api/notes/export-md", headers=SAVE).json()["token"]
    assert c.post("/api/desktop/reveal", json={"token": token}).status_code == 200
    assert shown == [tmp_path / "out" / "export.zip"]
    r = c.post("/api/desktop/reveal", json={"token": "made-up"})
    assert r.status_code == 404 and r.json()["detail"]["code"] == "file_not_found"
    (tmp_path / "out" / "export.zip").unlink()
    assert c.post("/api/desktop/reveal", json={"token": token}).status_code == 404
    assert len(shown) == 1


def test_reveal_is_not_available_in_web_mode(client, monkeypatch, tmp_path):
    f = tmp_path / "x.txt"
    f.write_text("x")
    monkeypatch.setattr(RUNTIME, "saved_files", {"t": f})
    monkeypatch.setattr(desktop_save, "reveal", lambda p: pytest.fail("revealed in web mode"))
    assert client.post("/api/desktop/reveal", json={"token": "t"}).status_code == 404


def test_a_failing_dialog_is_reported_not_a_bare_500(desk):
    c, _, _, _ = desk

    def boom(name):
        raise RuntimeError("window is closing")

    RUNTIME.save_dialog = boom
    r = c.get("/api/backup", headers=SAVE)
    assert r.status_code == 500
    assert r.json()["detail"] == {"code": "save_failed", "params": {"error": "window is closing"}}


def test_filename_from_content_disposition():
    assert desktop_save.filename_from(
        "attachment; filename=\"N_kup.txt\"; filename*=UTF-8''N%C3%A1kup.txt") == "Nákup.txt"
    assert desktop_save.filename_from('attachment; filename="a.zip"') == "a.zip"
    assert desktop_save.filename_from("attachment") == ""


def test_d13_fullscreen_toggles_the_desktop_window(desk, monkeypatch):
    c, _, _, _ = desk
    calls = []
    monkeypatch.setattr(RUNTIME, "toggle_fullscreen", lambda: calls.append(1))
    assert c.post("/api/desktop/fullscreen").status_code == 200
    assert calls == [1]


def test_d13_fullscreen_endpoint_is_desktop_only(client, monkeypatch):
    monkeypatch.setattr(RUNTIME, "toggle_fullscreen", lambda: pytest.fail("toggled in web mode"))
    assert client.post("/api/desktop/fullscreen").status_code == 404


def test_d14_a_failed_export_never_logs_the_path(desk, tmp_path, caplog):
    c, _, target, _ = desk
    target["path"] = str(tmp_path / "Soukrome_Prace" / "neexistuje" / "tajny-projekt.zip")
    with caplog.at_level("DEBUG"):
        r = c.get("/api/backup", headers=SAVE)
    assert r.status_code == 500 and r.json()["detail"]["code"] == "save_failed"
    logged = "\n".join(rec.getMessage() for rec in caplog.records)
    assert "Saving an export failed" in logged
    assert "tajny-projekt" not in logged and "Soukrome_Prace" not in logged
    assert "tajny-projekt" not in r.json()["detail"]["params"]["error"]

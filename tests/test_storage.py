"""Data-file reliability: atomic writes, rotating backups, corrupt files."""

import json

import pytest

from conftest import new_note, pending


def test_write_is_atomic_and_leaves_no_tmp(client, np_backend):
    new_note(client, content="x")
    assert np_backend.DATA_FILE.exists()
    assert not np_backend.DATA_TMP.exists()
    json.loads(np_backend.DATA_FILE.read_text(encoding="utf-8"))


def _corrupt(np_backend, payload: bytes):
    np_backend.DATA_FILE.write_bytes(payload)


# D8 – nevalidní UTF-8 → každý request 500
@pytest.mark.parametrize("payload", [b"{\"tree\": [\xff\xfe", b"{not json"])
def test_d8_corrupt_file_recovers_from_backup(client, np_backend, payload):
    nid = new_note(client, "Zachráněná", content="obsah")
    np_backend.make_backup(force=True)
    _corrupt(np_backend, payload)

    r = client.get("/api/data")
    assert r.status_code == 200
    assert r.json()["tree"][0]["name"] == "Zachráněná"
    assert client.get(f"/api/note/{nid}").json()["content"] == "obsah"

    corrupt = list(np_backend.DATA_DIR.glob("notes_data.corrupt-*.json"))
    assert len(corrupt) == 1 and corrupt[0].read_bytes() == payload

    notice = client.get("/api/session").json()["data_notice"]
    assert notice["code"] == "data_restored"
    assert notice["params"]["file"] == corrupt[0].name


def test_d8_corrupt_file_without_backup_is_kept(client, np_backend):
    _corrupt(np_backend, b"\xff\xfe garbage")
    r = client.get("/api/data")
    assert r.status_code == 200
    assert r.json()["tree"] == []
    assert len(list(np_backend.DATA_DIR.glob("notes_data.corrupt-*.json"))) == 1
    # A later save must not destroy the evidence.
    new_note(client, "Nová")
    assert len(list(np_backend.DATA_DIR.glob("notes_data.corrupt-*.json"))) == 1


# D8 – zálohy: rotující, ne jeden .bak přepisovaný při každém uložení
def test_d8_backups_are_throttled(client, np_backend):
    for i in range(5):
        new_note(client, f"N{i}")
    assert len(list((np_backend.DATA_DIR / "backups").glob("notes_data-*.json"))) == 1


def test_d8_backups_rotate(client, np_backend, monkeypatch):
    monkeypatch.setattr(np_backend, "BACKUP_MIN_INTERVAL", 0)
    for i in range(12):
        new_note(client, f"N{i}")
    backups = list((np_backend.DATA_DIR / "backups").glob("notes_data-*.json"))
    assert len(backups) == np_backend.BACKUP_KEEP == 7


# D7 – dvě instance nad stejnými daty = ztráta dat
def test_d7_single_instance_lock(np_backend):
    first = np_backend.acquire_instance_lock()
    assert first is not None
    try:
        assert np_backend.acquire_instance_lock() is None
    finally:
        first.close()
    again = np_backend.acquire_instance_lock()
    assert again is not None
    again.close()


def test_d8_notice_can_be_dismissed(client, np_backend):
    new_note(client, "x")
    np_backend.make_backup(force=True)
    np_backend.DATA_FILE.write_bytes(b"{broken")
    client.get("/api/data")
    assert client.get("/api/session").json()["data_notice"]
    client.post("/api/session/dismiss-notice")
    assert client.get("/api/session").json()["data_notice"] is None


def test_d8_write_is_fsynced_and_leaves_no_bak(client, np_backend):
    new_note(client, "a")
    new_note(client, "b")
    assert not np_backend.DATA_BAK.exists()


# D8 – poškozený soubor nalezený už při startu (set_data_dir) musí taky dát hlášku
def test_d8_corrupt_at_startup_sets_notice(np_backend, tmp_path):
    d = tmp_path / "startup"
    (d / "backups").mkdir(parents=True)
    (d / "backups" / "notes_data-20260101-000000-000000.json").write_text(
        '{"tree": [{"id": "a", "name": "A", "type": "note"}], "notes": {"a": ""}}',
        encoding="utf-8")
    (d / "notes_data.json").write_bytes(b"\xff\xfe")
    np_backend.set_data_dir(d)
    assert np_backend.RUNTIME.data_notice
    assert np_backend._read_data()["tree"][0]["name"] == "A"


def test_spellcheck_is_on_for_a_new_install(client, np_backend):
    """A fresh data dir (no notes_data.json yet) starts with spellcheck on,
    and it stays on once the first save has written the file."""
    assert not np_backend.DATA_FILE.exists()
    assert client.get("/api/data").json()["spellcheck"] is True
    new_note(client, content="x")
    assert json.loads(np_backend.DATA_FILE.read_text(encoding="utf-8"))["spellcheck"] is True


def test_recent_notes_are_a_setting(client, np_backend):
    """Start page RECENT: [{id, at}] stored at the top level, at most 10."""
    assert client.get("/api/data").json()["recent_notes"] == []
    recent = [{"id": f"n{i}", "at": 1_700_000_000_000 + i} for i in range(10)]
    assert client.put("/api/settings", json={"recent_notes": recent}).status_code == 200
    assert client.get("/api/data").json()["recent_notes"] == recent
    assert json.loads(np_backend.DATA_FILE.read_text(encoding="utf-8"))["recent_notes"] == recent
    # another setting leaves the list alone
    client.put("/api/settings", json={"theme": "amber"})
    assert client.get("/api/data").json()["recent_notes"] == recent


@pytest.mark.parametrize("bad", [
    [{"id": f"n{i}", "at": 1} for i in range(11)],     # more than 10
    [{"id": "", "at": 1}],
    [{"id": "x" * 65, "at": 1}],
    [{"id": "a", "at": -1}],
    [{"id": "a", "at": 10**13 + 1}],
    [{"id": "a"}],
    ["a"],
])
def test_recent_notes_are_validated(client, bad):
    assert client.put("/api/settings", json={"recent_notes": bad}).status_code == 422
    assert client.get("/api/data").json()["recent_notes"] == []


def test_reset_settings_keeps_the_recent_notes(client):
    recent = [{"id": "n1", "at": 1}]
    client.put("/api/settings", json={"recent_notes": recent, "theme": "amber"})
    client.post("/api/settings/reset")
    data = client.get("/api/data").json()
    assert data["theme"] == "matrix" and data["recent_notes"] == recent


# ---- R7 (kontrola 2): chyba snapshotu / plný disk -------------------------

def test_r7_a_snapshot_that_cannot_be_made_does_not_stop_saving(client, np_backend):
    from conftest import new_note
    nid = new_note(client, name="N", content="first")
    bdir = np_backend.DATA_DIR / "backups"
    for f in bdir.glob("*"):
        f.unlink()
    bdir.rmdir()
    bdir.write_text("not a folder", encoding="utf-8")       # mkdir / glob fail
    np_backend.make_backup(force=True)                      # never raises
    r = client.put(f"/api/note/{nid}", json={"content": "second", "formats": []})
    assert r.status_code == 200, r.text
    assert client.get(f"/api/note/{nid}").json()["content"] == "second"


def test_r7_disk_full_is_a_clear_507_and_leaves_no_tmp(client, np_backend, monkeypatch):
    import errno
    from conftest import new_note
    from noirpad import storage
    nid = new_note(client, name="N", content="kept")
    before = np_backend.DATA_FILE.read_bytes()
    real_replace = storage.os.replace

    def full(src, dst):
        if str(dst).endswith("notes_data.json"):
            raise OSError(errno.ENOSPC, "No space left on device")
        return real_replace(src, dst)

    monkeypatch.setattr(storage.os, "replace", full)
    r = client.put(f"/api/note/{nid}", json={"content": "lost?", "formats": []})
    assert r.status_code == 507
    assert r.json()["detail"] == {"code": "data_write_failed",
                                  "params": {"error": "No space left on device"}}
    assert np_backend.DATA_FILE.read_bytes() == before
    assert not list(np_backend.DATA_DIR.glob("*.tmp"))


# ---- R10 (kontrola 2): ručně upravený datový soubor -----------------------

def _write_raw(np_backend, text, bom=False):
    raw = text.encode("utf-8")
    np_backend.DATA_FILE.write_bytes((b"\xef\xbb\xbf" if bom else b"") + raw)


def test_r10_a_bom_is_not_damage(client, np_backend):
    _write_raw(np_backend, json.dumps({"tree": [{"id": "n", "type": "note", "name": "Č"}],
                                       "notes": {"n": "text"}}), bom=True)
    assert client.get("/api/note/n").json()["content"] == "text"
    assert not list(np_backend.DATA_DIR.glob("notes_data.corrupt-*"))
    assert client.get("/api/session").json()["data_notice"] is None


@pytest.mark.parametrize("data", [
    {"tree": None, "notes": {}},
    {"tree": [{"id": "f", "type": "folder", "name": "F", "children": "oops"}], "notes": {}},
    {"tree": [{"id": "n", "type": "note", "name": "N", "tags": "x"}, 7, {"no": "id"}],
     "notes": None, "trash": [], "favorites": "n"},
], ids=["tree-null", "children-string", "junk-items"])
def test_r10_a_mangled_structure_still_works(client, np_backend, data):
    _write_raw(np_backend, json.dumps(data))
    for url in ("/api/data", "/api/tags", "/api/trash"):
        assert client.get(url).status_code == 200, url
    r = client.post("/api/tree/new-note", json={"name": "Nová", "parent_id": None})
    assert r.status_code == 200, r.text
    assert client.get("/api/backup").status_code == 200


# ---- R9 (kontrola 2): po vlastním uložení poll zbytečně stáhl celá data ----

def test_r9_a_note_save_tells_which_data_it_turned_into(client):
    from conftest import new_note
    nid = new_note(client, name="N", content="a")
    before = client.get("/api/data").headers["etag"]
    r = client.put(f"/api/note/{nid}", json={"content": "b", "formats": []})
    assert r.status_code == 200
    assert r.headers["x-noirpad-etag-before"] == before
    after = r.headers["etag"]
    assert after != before
    # the page that takes it over gets a 304 on its next poll
    assert client.get("/api/data", headers={"If-None-Match": after}).status_code == 304


# ---- R11 (kontrola 2): migrace dat běžela dřív než zámek instance ---------

def test_r11_a_second_noirpad_never_migrates_the_data_of_a_running_one(tmp_path, np_backend):
    import os
    import subprocess
    import sys
    from conftest import ROOT
    data_dir = tmp_path / "running-elsewhere"
    data_dir.mkdir()
    old = json.dumps({"tree": [], "notes": {}, "theme": "matrix"})    # no glow_enabled: would migrate
    (data_dir / "notes_data.json").write_text(old, encoding="utf-8")
    lock = np_backend.acquire_instance_lock(data_dir)                 # "the running NoirPad"
    assert lock is not None
    try:
        env = dict(os.environ, NOIRPAD_DATA_DIR=str(data_dir), NOIRPAD_PORT="18299")
        r = subprocess.run([sys.executable, "-c", "from noirpad import web; web.main()"],
                           cwd=ROOT, env=env, capture_output=True, text=True, timeout=60)
    finally:
        lock.close()
    assert r.returncode != 0
    assert "already running" in r.stderr
    assert (data_dir / "notes_data.json").read_text(encoding="utf-8") == old

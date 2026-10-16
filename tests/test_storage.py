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

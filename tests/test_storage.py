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
@pending("D8", "D")
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
    assert notice and "corrupt" in notice.lower()


@pending("D8", "D")
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
@pending("D8", "D")
def test_d8_backups_are_throttled(client, np_backend):
    for i in range(5):
        new_note(client, f"N{i}")
    assert len(list((np_backend.DATA_DIR / "backups").glob("notes_data-*.json"))) == 1


@pending("D8", "D")
def test_d8_backups_rotate(client, np_backend, monkeypatch):
    monkeypatch.setattr(np_backend, "BACKUP_MIN_INTERVAL", 0)
    for i in range(12):
        new_note(client, f"N{i}")
    backups = list((np_backend.DATA_DIR / "backups").glob("notes_data-*.json"))
    assert len(backups) == np_backend.BACKUP_KEEP == 7

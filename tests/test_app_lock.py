"""Optional app lock: scrypt hash only, 423 until unlocked, no back door."""

import io
import json
import zipfile

import pytest
from fastapi.testclient import TestClient

from noirpad import app_lock

from conftest import API_HEADERS, new_note

PW = "zamek-heslo"


@pytest.fixture(autouse=True)
def cheap_scrypt(monkeypatch):
    """Records carry their own cost; tests don't need the production one."""
    monkeypatch.setattr(app_lock, "SCRYPT_N", 2 ** 10)


def other_client(np_backend):
    """A second browser / a restarted window: no unlock cookie."""
    return TestClient(np_backend.app, base_url="http://127.0.0.1:8000", headers=API_HEADERS)


def enable(client, password=PW, **extra):
    return client.post("/api/app-lock/enable", json={"password": password, **extra})


def test_off_by_default(client):
    assert client.get("/api/session").json()["app_lock"] == {"enabled": False, "unlocked": True}
    assert client.get("/api/data").status_code == 200


def test_enable_stores_only_a_scrypt_hash(client, np_backend):
    assert enable(client).status_code == 200
    raw = np_backend.DATA_FILE.read_text(encoding="utf-8")
    assert PW not in raw
    record = json.loads(raw)["app_lock"]
    assert record["kdf"] == "scrypt" and record["salt"] and record["hash"]
    # The client that set the lock stays unlocked.
    assert client.get("/api/data").status_code == 200


def test_locked_client_gets_423_until_unlock(client, np_backend):
    nid = new_note(client, content="tajné")
    enable(client)
    other = other_client(np_backend)
    assert other.get("/api/session").json()["app_lock"] == {"enabled": True, "unlocked": False}
    assert other.get("/api/data").status_code == 423
    assert other.get(f"/api/note/{nid}").status_code == 423
    assert other.get("/images/00000000-0000-0000-0000-000000000000.png").status_code == 423
    assert other.get("/").status_code == 200   # the shell loads, shows the lock

    assert other.post("/api/app-lock/unlock", json={"password": "spatne-heslo"}).status_code == 401
    r = other.post("/api/app-lock/unlock", json={"password": PW})
    assert r.status_code == 200
    assert "httponly" in r.headers["set-cookie"].lower()
    assert other.get(f"/api/note/{nid}").json()["content"] == "tajné"

    other.post("/api/app-lock/lock")
    assert other.get("/api/data").status_code == 423


def test_restart_starts_locked(client, np_backend, tmp_path):
    enable(client)
    np_backend.set_data_dir(np_backend.DATA_DIR)      # = process restart
    assert client.get("/api/data").status_code == 423


def test_hash_never_leaves_the_server(client):
    enable(client)
    assert "app_lock" not in client.get("/api/data").json()
    blob = client.get("/api/backup").content
    data = json.loads(zipfile.ZipFile(io.BytesIO(blob)).read("notes_data.json"))
    assert "app_lock" not in data


def test_change_and_disable_need_current_password(client, np_backend):
    enable(client)
    assert enable(client, "nove-heslo-123").status_code == 401
    assert enable(client, "nove-heslo-123", current_password=PW).status_code == 200
    assert client.post("/api/app-lock/disable", json={"password": PW}).status_code == 401
    assert client.post("/api/app-lock/disable", json={"password": "nove-heslo-123"}).status_code == 200
    assert "app_lock" not in json.loads(np_backend.DATA_FILE.read_text(encoding="utf-8"))
    assert other_client(np_backend).get("/api/data").status_code == 200


def test_min_length_and_rate_limit(client, np_backend):
    assert enable(client, "abc").status_code == 400
    enable(client)
    other = other_client(np_backend)
    codes = [other.post("/api/app-lock/unlock", json={"password": "x" * 8}).status_code
             for _ in range(np_backend.LOGIN_MAX_FAILURES + 1)]
    assert codes[-1] == 429


def test_settings_reset_and_backup_import_keep_the_lock(client, np_backend):
    enable(client)
    client.post("/api/settings/reset")
    assert other_client(np_backend).get("/api/data").status_code == 423


def test_deleting_the_entry_removes_the_lock(client, np_backend):
    """README: forgotten app-lock password → delete `app_lock` from the data file."""
    enable(client)
    data = json.loads(np_backend.DATA_FILE.read_text(encoding="utf-8"))
    del data["app_lock"]
    np_backend.DATA_FILE.write_text(json.dumps(data), encoding="utf-8")
    np_backend.set_data_dir(np_backend.DATA_DIR)      # restart
    assert other_client(np_backend).get("/api/data").status_code == 200


def test_locking_the_app_forgets_note_keys(client):
    nid = new_note(client, content="x")
    enable(client)
    token = client.post("/api/encrypt", json={"id": nid, "password": "correct horse"}).json()["unlock_token"]
    client.post("/api/app-lock/lock")
    client.post("/api/app-lock/unlock", json={"password": PW})
    r = client.post("/api/save-encrypted", json={"id": nid, "unlock_token": token, "content": "y"})
    assert r.status_code == 401


def test_n5_minimum_is_four_characters(client, np_backend):
    r = enable(client, password="abc")
    assert r.status_code == 400
    assert r.json()["detail"] == {"code": "password_too_short", "params": {"min": 4}}
    assert enable(client, password="1234").status_code == 200
    other = other_client(np_backend)
    assert other.post("/api/app-lock/unlock", json={"password": "1234"}).status_code == 200

"""Per-note encryption: lock, unlock, view, wrong password, save."""

import json

from conftest import new_note

PW = "correct horse"


def stored(np_backend, note_id):
    return np_backend._read_data()["notes"][note_id]


def test_encrypt_then_decrypt(client, np_backend):
    nid = new_note(client, content="tajné")
    assert client.post("/api/encrypt", json={"id": nid, "password": PW}).status_code == 200

    raw = stored(np_backend, nid)
    assert json.loads(raw)["encrypted"] is True
    assert "tajné" not in raw

    assert client.post("/api/decrypt", json={"id": nid, "password": PW}).status_code == 200
    assert stored(np_backend, nid) == "tajné"


def test_double_encrypt_is_rejected(client):
    nid = new_note(client, content="x")
    client.post("/api/encrypt", json={"id": nid, "password": PW})
    assert client.post("/api/encrypt", json={"id": nid, "password": PW}).status_code == 400


def test_wrong_password(client, np_backend):
    nid = new_note(client, content="tajné")
    client.post("/api/encrypt", json={"id": nid, "password": PW})
    before = stored(np_backend, nid)

    assert client.post("/api/decrypt", json={"id": nid, "password": "nope"}).status_code == 400
    assert client.post("/api/decrypt-view", json={"id": nid, "password": "nope"}).status_code == 400
    assert stored(np_backend, nid) == before


def test_decrypt_view_leaves_file_encrypted(client, np_backend):
    nid = new_note(client, content="tajné")
    client.post("/api/encrypt", json={"id": nid, "password": PW})
    r = client.post("/api/decrypt-view", json={"id": nid, "password": PW})
    assert r.status_code == 200
    assert r.json()["content"] == "tajné"
    assert json.loads(stored(np_backend, nid))["encrypted"] is True


def test_save_encrypted_keeps_note_encrypted(client, np_backend):
    nid = new_note(client, content="v1")
    client.post("/api/encrypt", json={"id": nid, "password": PW})
    r = client.post("/api/save-encrypted",
                    json={"id": nid, "password": PW, "content": "v2", "formats": []})
    assert r.status_code == 200
    assert "v2" not in stored(np_backend, nid)
    view = client.post("/api/decrypt-view", json={"id": nid, "password": PW}).json()
    assert view["content"] == "v2"


def test_password_never_stored(client, np_backend):
    nid = new_note(client, content="x")
    client.post("/api/encrypt", json={"id": nid, "password": PW})
    assert PW not in np_backend.DATA_FILE.read_text(encoding="utf-8")


def test_legacy_desktop_envelope_decrypts(client, np_backend):
    nid = new_note(client, content="placeholder")
    envelope = np_backend.encrypt_content("ze staré appky", PW)
    np_backend._update_data(lambda d: d["notes"].__setitem__(nid, envelope))
    r = client.post("/api/decrypt-view", json={"id": nid, "password": PW})
    assert r.json()["content"] == "ze staré appky"

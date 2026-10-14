"""C5, C6, C10–C12: tags, input validation, uploads, HTML zip, envelopes."""

import io
import json
import zipfile

import pytest

from conftest import make_png, new_folder, new_note
from noirpad.crypto import encrypt_content, is_encrypted_content


def test_c5_tags_are_trimmed_unique_ignoring_case_and_never_empty(client):
    nid = new_note(client)
    client.put(f"/api/tags/{nid}", json={"tags": [" Work ", "work", "", "  ", "Práce", "PRÁCE", "x"]})
    tree = client.get("/api/data").json()["tree"]
    assert tree[0]["tags"] == ["Work", "Práce", "x"]


def test_c5_tag_list_leaves_out_the_trash(client):
    live = new_note(client, name="Live")
    gone = new_note(client, name="Gone")
    client.put(f"/api/tags/{live}", json={"tags": ["kept"]})
    client.put(f"/api/tags/{gone}", json={"tags": ["old"]})
    client.post("/api/tree/delete", json={"id": gone})
    assert client.get("/api/tags").json()["tags"] == ["kept"]


@pytest.mark.parametrize("name", ["", "   "])
def test_c6_empty_names_are_refused(client, name):
    nid = new_note(client, name="Ok")
    assert client.post("/api/tree/rename", json={"id": nid, "name": name}).status_code == 422
    assert client.post("/api/tree/new-note", json={"name": name, "parent_id": None}).status_code == 422


def test_c6_names_are_trimmed(client):
    nid = new_note(client, name="  Pad  ")
    assert client.get("/api/data").json()["tree"][0]["name"] == "Pad"


def test_c6_unknown_move_position_is_refused(client):
    a, b = new_note(client, name="A"), new_note(client, name="B")
    r = client.post("/api/tree/move", json={"id": a, "target_id": b, "position": "bogus"})
    assert r.status_code == 422


def test_c10_cut_off_png_is_refused(client):
    png = make_png()
    r = client.post("/api/images/upload", files={"file": ("a.png", png[:30], "image/png")})
    assert r.status_code == 415 and r.json()["detail"]["code"] == "image_incomplete"
    assert client.post("/api/images/upload", files={"file": ("a.png", png, "image/png")}).status_code == 200


def test_c10_failed_write_leaves_no_file(client, np_backend, monkeypatch):
    import pathlib as _pl
    real = _pl.Path.write_bytes

    def disk_full(self, data):
        if self.parent == np_backend.IMAGES_DIR:
            raise OSError(28, "No space left on device")
        return real(self, data)

    monkeypatch.setattr(_pl.Path, "write_bytes", disk_full)
    r = client.post("/api/images/upload", files={"file": ("a.png", make_png(), "image/png")})
    assert r.status_code == 507 and r.json()["detail"]["code"] == "image_write_failed"
    assert [p for p in np_backend.IMAGES_DIR.iterdir() if p.is_file()] == []


def test_c11_html_zip_keeps_same_named_folders_apart(client):
    a = new_folder(client, name="CON")
    b = new_folder(client, name="CON")
    new_note(client, name="one", parent_id=a, content="1")
    new_note(client, name="one", parent_id=b, content="2")
    zf = zipfile.ZipFile(io.BytesIO(client.get("/api/notes/export").content))
    assert sorted(n for n in zf.namelist() if n.endswith(".html")) == ["CON- (2)/one.html", "CON-/one.html"]


def test_c12_only_a_real_envelope_counts_as_encrypted(client):
    assert is_encrypted_content(encrypt_content("x", "pass1234"))
    for fake in ('{"encrypted": true, "data": "x"}', '{"encrypted": true}',
                 '{"encrypted": true, "data": "QUJD"}', '{"encrypted": "yes", "data": "QUJD"}'):
        assert not is_encrypted_content(fake), fake
    nid = new_note(client, name="json", content='{"encrypted": true, "data": "x"}')
    r = client.get("/api/notes/export-md")
    assert r.headers["x-noirpad-skipped"] == "0"
    names = zipfile.ZipFile(io.BytesIO(r.content)).namelist()
    assert "json.md" in names

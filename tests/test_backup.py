"""Backup download + import, including the D15 / K5 import hardening."""

import io
import json
import zipfile

from conftest import make_png, make_zip, new_folder, new_note, pending


def upload_png(client):
    r = client.post("/api/images/upload", files={"file": ("a.png", make_png(), "image/png")})
    return r.json()["filename"]


def download(client):
    r = client.get("/api/backup")
    assert r.status_code == 200
    return r.content


def import_zip(client, data):
    return client.post("/api/backup/import",
                       files={"file": ("backup.zip", data, "application/zip")})


def backup_with(tree, notes, images=None):
    files = {"notes_data.json": json.dumps({"tree": tree, "notes": notes})}
    for name, data in (images or {}).items():
        files["images/" + name] = data
    return make_zip(files)


def test_backup_roundtrip(client, np_backend, tmp_path):
    f = new_folder(client, "Složka")
    img = upload_png(client)
    nid = new_note(client, "Poznámka", parent_id=f, content=f"text <<IMG:{img}>>")
    client.post("/api/favorites/toggle", json={"id": nid})
    blob = download(client)

    zf = zipfile.ZipFile(io.BytesIO(blob))
    assert set(zf.namelist()) == {"notes_data.json", f"images/{img}"}

    # Fresh, empty profile → import → everything is back.
    np_backend.set_data_dir(tmp_path / "fresh")
    assert import_zip(client, blob).status_code == 200
    data = client.get("/api/data").json()
    assert data["tree"][0]["children"][0]["name"] == "Poznámka"
    assert data["favorites"] == [nid]
    assert client.get(f"/api/note/{nid}").json()["content"] == f"text <<IMG:{img}>>"
    assert client.get(f"/images/{img}").content == make_png()


def test_import_replaces_existing_notes(client):
    new_note(client, "Stará", content="old")
    blob = backup_with([{"id": "n1", "name": "Nová", "type": "note"}], {"n1": "new"})
    assert import_zip(client, blob).status_code == 200
    assert [i["name"] for i in client.get("/api/data").json()["tree"]] == ["Nová"]


def test_import_drops_unreferenced_notes_and_user_ids(client):
    blob = backup_with([{"id": "n1", "name": "N", "type": "note", "user_id": "u"}],
                       {"n1": "a", "orphan": "b"})
    import_zip(client, blob)
    data = client.get("/api/data").json()
    assert data["tree"] == [{"id": "n1", "name": "N", "type": "note"}]
    assert data["notes"] == {"n1": "a"}


def test_import_rejects_garbage(client):
    assert import_zip(client, b"not a zip").status_code == 400
    assert import_zip(client, make_zip({"x.txt": "y"})).status_code == 400
    assert import_zip(client, make_zip({"notes_data.json": "{bad"})).status_code == 400


def test_import_zip_slip(client, np_backend):
    blob = backup_with([], {}, {"../../evil.png": make_png()})
    assert import_zip(client, blob).status_code == 400
    assert not (np_backend.DATA_DIR.parent / "evil.png").exists()


# K5 – import zálohy zapsal images/payload.html z cizího zipu
def test_k5_import_rejects_non_images(client, np_backend):
    new_note(client, "Zůstane", content="x")
    blob = backup_with([], {}, {"payload.html": b"<script>alert(1)</script>"})
    assert import_zip(client, blob).status_code == 415
    assert not (np_backend.IMAGES_DIR / "payload.html").exists()
    assert client.get("/api/data").json()["tree"][0]["name"] == "Zůstane"


# D15 – před importem automatická záloha stávajícího stavu
@pending("D15", "D")
def test_d15_import_makes_safety_backup(client, np_backend):
    new_note(client, "Před importem", content="důležité")
    import_zip(client, backup_with([], {}))
    safety = sorted((np_backend.DATA_DIR / "backups").glob("pre-import-*.zip"))
    assert len(safety) == 1
    saved = json.loads(zipfile.ZipFile(safety[0]).read("notes_data.json"))
    assert saved["tree"][0]["name"] == "Před importem"


# D15 – limit rozbalené velikosti (zip bomb)
@pending("D15", "D")
def test_d15_uncompressed_size_limit(client, np_backend, monkeypatch):
    monkeypatch.setattr(np_backend, "MAX_BACKUP_UNCOMPRESSED", 10_000)
    new_note(client, "Zůstane")
    blob = make_zip({"notes_data.json": json.dumps({"tree": [], "pad": "x" * 50_000})})
    assert import_zip(client, blob).status_code == 413
    assert client.get("/api/data").json()["tree"][0]["name"] == "Zůstane"


# D15 – limit počtu souborů
@pending("D15", "D")
def test_d15_file_count_limit(client, np_backend, monkeypatch):
    monkeypatch.setattr(np_backend, "MAX_BACKUP_FILES", 5)
    images = {f"{i:08d}-0000-0000-0000-000000000000.png": make_png() for i in range(10)}
    assert import_zip(client, backup_with([], {}, images)).status_code == 413


# D15 – obrázek ze zálohy nesmí přepsat existující se stejným jménem
@pending("D15", "D")
def test_d15_existing_image_not_overwritten(client, np_backend):
    name = upload_png(client)
    original = (np_backend.IMAGES_DIR / name).read_bytes()
    other = make_png(7, 7)
    import_zip(client, backup_with([], {}, {name: other}))
    assert (np_backend.IMAGES_DIR / name).read_bytes() == original

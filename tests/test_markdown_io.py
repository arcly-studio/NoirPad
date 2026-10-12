"""Export all notes as Markdown (zip) and import .md files / such zips."""

import io
import zipfile

from conftest import make_png, make_zip, new_folder, new_note


def upload(client):
    r = client.post("/api/images/upload", files={"file": ("a.png", make_png(), "image/png")})
    return r.json()["filename"]


def export(client):
    r = client.get("/api/notes/export-md")
    assert r.status_code == 200
    return zipfile.ZipFile(io.BytesIO(r.content)), int(r.headers["x-noirpad-skipped"])


def import_files(client, *files):
    return client.post("/api/notes/import-md",
                       files=[("files", (name, data, "application/octet-stream"))
                              for name, data in files])


def all_notes(client):
    """name -> (folder path, content) for every note in the tree."""
    data = client.get("/api/data").json()
    out = {}

    def walk(items, path):
        for it in items:
            if it["type"] == "folder":
                walk(it.get("children") or [], path + [it["name"]])
            else:
                out[it["name"]] = ("/".join(path), data["notes"][it["id"]])

    walk(data["tree"], [])
    return out


def test_export_layout_images_and_skipped_locked(client):
    img, md_img = upload(client), upload(client)
    f = new_folder(client, "Škola")
    sub = new_folder(client, "Fyzika", parent_id=f)
    new_note(client, "Úkoly", parent_id=sub, content=f"text <<IMG:{img}|w=200>> konec")
    new_note(client, "Kořen", content=f"# Nadpis\n![obr](/images/{md_img})")
    secret = new_note(client, "Tajné", content="pst")
    client.post("/api/encrypt", json={"id": secret, "password": "correct horse"})

    zf, skipped = export(client)
    names = zf.namelist()
    assert skipped == 1
    assert "Škola/Fyzika/Úkoly.md" in names and "Kořen.md" in names
    assert not any("Tajné" in n for n in names)
    assert zf.read("Škola/Fyzika/Úkoly.md").decode() == f"text ![](../../assets/{img}) konec"
    assert zf.read("Kořen.md").decode() == f"# Nadpis\n![obr](assets/{md_img})"
    assert f"assets/{img}" in names and f"assets/{md_img}" in names


def test_export_import_roundtrip_adds_and_keeps_existing(client):
    img = upload(client)
    f = new_folder(client, "Projekty")
    new_note(client, "Plán", parent_id=f, content=f"- [ ] krok\n<<IMG:{img}>>")
    blob = client.get("/api/notes/export-md").content

    r = import_files(client, ("zaloha.zip", blob))
    assert r.status_code == 200, r.text
    assert r.json() == {"notes": 1, "folders": 2, "images": 1, "skipped": 0}

    data = client.get("/api/data").json()
    assert [i["name"] for i in data["tree"]] == ["Projekty", "zaloha"]  # original kept
    imported = data["tree"][1]["children"][0]["children"][0]
    text = data["notes"][imported["id"]]
    assert text.startswith("- [ ] krok\n![](/images/")
    new_img = text.split("/images/")[1].rstrip(")")
    assert new_img != img
    assert client.get(f"/images/{new_img}").content == make_png()
    assert data["note_modes"][imported["id"]] == "markdown"


def test_import_single_md_files(client):
    r = import_files(client, ("Ahoj.md", "﻿Český text".encode("utf-8")),
                     ("Stará.md", "Příliš žluťoučký".encode("cp1250")))
    assert r.json()["notes"] == 2
    notes = all_notes(client)
    assert notes["Ahoj"] == ("", "Český text")
    assert notes["Stará"] == ("", "Příliš žluťoučký")


def test_import_zip_of_one_folder_uses_it_as_root(client):
    blob = make_zip({"Poznámky/a.md": "A", "Poznámky/sub/b.md": "B ![x](../img.png)",
                     "Poznámky/img.png": make_png()})
    assert import_files(client, ("export.zip", blob)).json()["images"] == 1
    notes = all_notes(client)
    assert notes["a"] == ("Poznámky", "A")
    folder, text = notes["b"]
    assert folder == "Poznámky/sub" and "/images/" in text


def test_import_never_trusts_links(client):
    blob = make_zip({"a.md": "![x](https://evil.example/x.png) ![y](../../etc/passwd)"
                             " ![z](fake.png)", "fake.png": b"<svg onload=alert(1)>"})
    r = import_files(client, ("x.zip", blob))
    assert r.json()["images"] == 0
    (_, text), = all_notes(client).values()
    assert "https://evil.example/x.png" in text and "fake.png" in text


def test_import_rejects_other_files_and_zip_bombs(client, np_backend, monkeypatch):
    assert import_files(client, ("x.exe", b"MZ")).status_code == 415
    monkeypatch.setattr(np_backend, "MAX_BACKUP_FILES", 2)
    blob = make_zip({"a.md": "a", "b.md": "b", "c.md": "c"})
    assert import_files(client, ("x.zip", blob)).status_code == 413
    assert client.get("/api/data").json()["tree"] == []

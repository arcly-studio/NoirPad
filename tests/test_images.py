"""Image upload + serving, including the K5 upload allowlist."""

import re

import pytest

from conftest import make_png, pending

UUID_IMG = re.compile(r"^[0-9a-f-]{36}\.(png|jpe?g|gif|webp)$")

JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 32
GIF = b"GIF89a\x01\x00\x01\x00\x00\x00\x00;"
WEBP = b"RIFF\x18\x00\x00\x00WEBPVP8 " + b"\x00" * 16   # RIFF size = length - 8


def upload(client, name, data, ctype="application/octet-stream"):
    return client.post("/api/images/upload", files={"file": (name, data, ctype)})


def test_upload_and_serve_png(client):
    png = make_png()
    r = upload(client, "screen.png", png, "image/png")
    assert r.status_code == 200
    name = r.json()["filename"]
    assert UUID_IMG.match(name)
    assert r.json()["url"] == f"/images/{name}"

    got = client.get(f"/images/{name}")
    assert got.status_code == 200
    assert got.headers["content-type"] == "image/png"
    assert got.content == png


@pytest.mark.parametrize("name,data,ext", [
    ("a.jpg", JPEG, "jpg"), ("a.gif", GIF, "gif"), ("a.webp", WEBP, "webp")])
def test_upload_other_allowed_formats(client, name, data, ext):
    r = upload(client, name, data)
    assert r.status_code == 200
    assert r.json()["filename"].endswith("." + ext)


def test_missing_image_is_404(client):
    assert client.get("/images/00000000-0000-0000-0000-000000000000.png").status_code == 404


def test_path_traversal_is_rejected(client):
    assert client.get("/images/..%2Fnotes_data.json").status_code in (400, 404)
    assert client.get("/images/..%5Cnotes_data.json").status_code in (400, 404)


def test_upload_size_limit(client, np_backend, monkeypatch):
    monkeypatch.setattr(np_backend, "MAX_IMAGE_BYTES", 100)
    assert upload(client, "big.png", make_png(50, 50)).status_code == 413


# K5 – upload „obrázku" přijme libovolnou příponu a servíruje ji z originu appky
@pytest.mark.parametrize("name,data", [
    ("evil.html", b"<script>alert(1)</script>"),
    ("evil.svg", b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'),
    ("x.exe", b"MZ\x90\x00"),
    ("fake.png", b"<html><script>alert(1)</script></html>"),  # wrong magic bytes
])
def test_k5_non_images_rejected(client, np_backend, name, data):
    r = upload(client, name, data, "image/png")
    assert r.status_code == 415
    assert list(np_backend.IMAGES_DIR.iterdir()) == []


# K5 – přípona se odvozuje z obsahu, ne z názvu souboru
def test_k5_extension_follows_content(client):
    r = upload(client, "photo.gif", make_png())
    assert r.status_code == 200
    assert r.json()["filename"].endswith(".png")


# K5 – servírování s nosniff + CSP sandbox
def test_k5_image_response_headers(client):
    name = upload(client, "a.png", make_png()).json()["filename"]
    r = client.get(f"/images/{name}")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in r.headers["content-security-policy"]


# K5 – i soubor, který na disk propašovala stará verze, se nesmí servírovat jako HTML
def test_k5_legacy_html_file_not_served(client, np_backend):
    (np_backend.IMAGES_DIR / "payload.html").write_text("<script>alert(1)</script>")
    r = client.get("/images/payload.html")
    assert r.status_code in (403, 404, 415)


# K4: purging a note must not delete an image another note still shows.
@pytest.mark.parametrize("purge", ["empty", "delete"])
def test_k4_purge_keeps_images_used_elsewhere(client, purge):
    from conftest import new_note
    shared = upload(client, "a.png", make_png(), "image/png").json()["filename"]
    own = upload(client, "b.png", make_png(3, 3), "image/png").json()["filename"]
    a = new_note(client, name="A", content=f"x <<IMG:{shared}>> <<IMG:{own}>>")
    b = new_note(client, name="B", content=f"y <<IMG:{shared}>>")
    keep_trashed = new_note(client, name="C", content=f"z <<IMG:{own}>>")
    client.post("/api/tree/delete", json={"id": a})
    if purge == "empty":
        client.post("/api/tree/delete", json={"id": keep_trashed})
        client.post("/api/trash/empty")
        assert client.get(f"/images/{shared}").status_code == 200     # B still uses it
        assert client.get(f"/images/{own}").status_code == 404        # nobody left
    else:
        client.post("/api/trash/delete", json={"id": a})
        assert client.get(f"/images/{shared}").status_code == 200
        assert client.get(f"/images/{own}").status_code == 200        # C uses it
    assert client.get(f"/api/note/{b}").json()["content"] == f"y <<IMG:{shared}>>"

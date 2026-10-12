"""D13 (ETag polling) and D14 (orphan image cleanup)."""

import os
import time

from noirpad import images

from conftest import make_png, new_note

DAY = 24 * 60 * 60


def upload(client):
    r = client.post("/api/images/upload", files={"file": ("a.png", make_png(), "image/png")})
    return r.json()["filename"]


def age(path, seconds):
    t = time.time() - seconds
    os.utime(path, (t, t))


# ---- D13 ------------------------------------------------------------------


def test_d13_data_etag_304_until_change(client):
    first = client.get("/api/data")
    etag = first.headers["etag"]
    again = client.get("/api/data", headers={"If-None-Match": etag})
    assert again.status_code == 304 and again.content == b""
    new_note(client, "x")
    changed = client.get("/api/data", headers={"If-None-Match": etag})
    assert changed.status_code == 200
    assert changed.headers["etag"] != etag
    assert changed.json()["tree"][0]["name"] == "x"


# ---- D14 ------------------------------------------------------------------


def test_d14_old_orphan_goes_to_trash_and_referenced_stays(client, np_backend):
    used, orphan, fresh = upload(client), upload(client), upload(client)
    new_note(client, content=f"<<IMG:{used}>>")
    img = np_backend.IMAGES_DIR
    for name in (used, orphan):
        age(img / name, 2 * DAY)

    counts = images.collect_orphans()

    assert counts["trashed"] == 1
    assert (img / used).exists() and (img / fresh).exists()  # fresh: < 24 h
    assert not (img / orphan).exists()
    assert (img / ".trash" / orphan).exists()


def test_d14_trash_purged_after_30_days_and_restored_when_referenced(client, np_backend):
    expired, back = upload(client), upload(client)
    trash = np_backend.IMAGES_DIR / ".trash"
    trash.mkdir()
    for name in (expired, back):
        os.replace(np_backend.IMAGES_DIR / name, trash / name)
        age(trash / name, 31 * DAY)
    new_note(client, content=f"<<IMG:{back}>>")

    counts = images.collect_orphans()

    assert counts == {"trashed": 0, "purged": 1, "restored": 1}
    assert not (trash / expired).exists()
    assert (np_backend.IMAGES_DIR / back).exists()


def test_d14_images_of_encrypted_notes_are_kept(client, np_backend):
    name = upload(client)
    nid = new_note(client, content=f"<<IMG:{name}>>")
    client.post("/api/encrypt", json={"id": nid, "password": "correct horse"})
    age(np_backend.IMAGES_DIR / name, 2 * DAY)
    assert images.collect_orphans()["trashed"] == 0
    assert (np_backend.IMAGES_DIR / name).exists()


def test_d14_skipped_when_encrypted_note_has_no_image_list(client, np_backend):
    orphan = upload(client)
    nid = new_note(client)

    def _legacy(data):
        data["notes"][nid] = np_backend.encrypt_content("<<IMG:x>>", "correct horse")
        data["note_images"].pop(nid, None)

    np_backend._update_data(_legacy)
    age(np_backend.IMAGES_DIR / orphan, 2 * DAY)
    assert images.collect_orphans()["trashed"] == 0
    assert (np_backend.IMAGES_DIR / orphan).exists()


def test_d14_runs_at_startup(np_backend):
    from fastapi.testclient import TestClient

    np_backend.IMAGES_DIR.joinpath("00000000-0000-0000-0000-000000000000.png").write_bytes(make_png())
    age(np_backend.IMAGES_DIR / "00000000-0000-0000-0000-000000000000.png", 2 * DAY)
    with TestClient(np_backend.app, base_url="http://127.0.0.1:8000"):
        pass
    assert (np_backend.IMAGES_DIR / ".trash" / "00000000-0000-0000-0000-000000000000.png").exists()


def test_d14_zoomed_marker_and_markdown_link_count_as_references(client, np_backend):
    zoomed, md = upload(client), upload(client)
    new_note(client, content=f"<<IMG:{zoomed}|w=320>>")
    new_note(client, content=f"text ![obr](/images/{md}) text")
    for name in (zoomed, md):
        age(np_backend.IMAGES_DIR / name, 2 * DAY)
    assert images.collect_orphans()["trashed"] == 0


def test_markdown_note_images_are_in_backup(client):
    import io
    import zipfile

    md = upload(client)
    new_note(client, content=f"![obr](/images/{md})")
    names = zipfile.ZipFile(io.BytesIO(client.get("/api/backup").content)).namelist()
    assert f"images/{md}" in names

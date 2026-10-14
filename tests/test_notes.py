"""CRUD for notes, folders, trash, favorites, tags and settings."""

from conftest import new_folder, new_note


def tree(client):
    return client.get("/api/data").json()["tree"]


def test_empty_profile(client):
    data = client.get("/api/data").json()
    assert data["tree"] == []
    assert data["notes"] == {}
    assert "users" not in data and "sessions" not in data


def test_create_note_in_folder_and_read_back(client):
    fid = new_folder(client, "Škola")
    nid = new_note(client, "Úkoly", parent_id=fid, content="ahoj\nsvěte")

    t = tree(client)
    assert t[0]["name"] == "Škola"
    assert t[0]["children"][0] == {"id": nid, "name": "Úkoly", "type": "note"}

    note = client.get(f"/api/note/{nid}").json()
    assert note == {"content": "ahoj\nsvěte", "formats": [], "mode": "rich-text", "trashed": False}


def test_note_in_missing_parent_is_rejected(client):
    r = client.post("/api/tree/new-note", json={"name": "x", "parent_id": "nope"})
    assert r.status_code == 400


def test_save_formats_and_markdown_mode(client):
    nid = new_note(client)
    fmt = [{"start": "1.0", "end": "1.4", "italic": True}]
    r = client.put(f"/api/note/{nid}", json={"content": "# hi", "formats": fmt, "mode": "markdown"})
    assert r.status_code == 200
    assert client.get(f"/api/note/{nid}").json() == {
        "content": "# hi", "formats": fmt, "mode": "markdown", "trashed": False}

    client.put(f"/api/note/{nid}", json={"content": "x", "formats": [], "mode": "rich-text"})
    assert client.get(f"/api/note/{nid}").json()["mode"] == "rich-text"


def test_missing_note_is_404(client):
    assert client.get("/api/note/nope").status_code == 404
    assert client.put("/api/note/nope", json={"content": "x"}).status_code == 404


def test_rename(client):
    nid = new_note(client, "Old")
    assert client.post("/api/tree/rename", json={"id": nid, "name": "New"}).status_code == 200
    assert tree(client)[0]["name"] == "New"
    assert client.post("/api/tree/rename", json={"id": "nope", "name": "x"}).status_code == 404


def test_move_inside_before_after(client):
    a = new_note(client, "A")
    b = new_note(client, "B")
    f = new_folder(client, "F")

    client.post("/api/tree/move", json={"id": b, "target_id": a, "position": "before"})
    assert [i["name"] for i in tree(client)] == ["B", "A", "F"]

    client.post("/api/tree/move", json={"id": a, "target_id": f, "position": "inside"})
    t = tree(client)
    assert [i["name"] for i in t] == ["B", "F"]
    assert t[1]["children"][0]["id"] == a

    client.post("/api/tree/move", json={"id": b, "target_id": f, "position": "after"})
    assert [i["name"] for i in tree(client)] == ["F", "B"]


def test_move_folder_into_itself_is_rejected(client):
    f = new_folder(client, "F")
    g = new_folder(client, "G", parent_id=f)
    r = client.post("/api/tree/move", json={"id": f, "target_id": g, "position": "inside"})
    assert r.status_code == 400
    assert tree(client)[0]["children"][0]["id"] == g


def test_delete_restore_and_empty_trash(client):
    f = new_folder(client, "F")
    nid = new_note(client, "N", parent_id=f, content="obsah")
    client.post("/api/favorites/toggle", json={"id": nid})

    assert client.post("/api/tree/delete", json={"id": f}).status_code == 200
    assert tree(client) == []
    trash = client.get("/api/trash").json()
    assert trash["tree"][0]["id"] == f
    assert trash["notes"][nid] == "obsah"
    assert client.get("/api/data").json()["favorites"] == []

    assert client.post("/api/trash/restore", json={"id": f}).status_code == 200
    assert tree(client)[0]["id"] == f
    assert client.get(f"/api/note/{nid}").json()["content"] == "obsah"

    client.post("/api/tree/delete", json={"id": f})
    assert client.post("/api/trash/empty").status_code == 200
    assert client.get("/api/trash").json() == {"tree": [], "notes": {}}


def test_delete_single_trash_item(client):
    a = new_note(client, "A", content="a")
    b = new_note(client, "B", content="b")
    client.post("/api/tree/delete", json={"id": a})
    client.post("/api/tree/delete", json={"id": b})
    assert client.post("/api/trash/delete", json={"id": a}).status_code == 200
    trash = client.get("/api/trash").json()
    assert [i["id"] for i in trash["tree"]] == [b]
    assert a not in trash["notes"]
    assert client.post("/api/trash/delete", json={"id": a}).status_code == 404


def test_favorites_toggle(client):
    nid = new_note(client)
    assert client.post("/api/favorites/toggle", json={"id": nid}).json() == {"favorite": True}
    assert client.get("/api/data").json()["favorites"] == [nid]
    assert client.post("/api/favorites/toggle", json={"id": nid}).json() == {"favorite": False}
    assert client.post("/api/favorites/toggle", json={"id": "nope"}).status_code == 404


def test_tags(client):
    a = new_note(client, "A")
    b = new_note(client, "B")
    client.put(f"/api/tags/{a}", json={"tags": ["škola", "x"]})
    client.put(f"/api/tags/{b}", json={"tags": ["x"]})
    assert client.get("/api/tags").json() == {"tags": ["x", "škola"]}
    assert client.put("/api/tags/nope", json={"tags": []}).status_code == 404


def test_settings_update_and_reset(client):
    client.put("/api/settings", json={"theme": "nord", "font_size": 16})
    data = client.get("/api/data").json()
    assert (data["theme"], data["font_size"]) == ("nord", 16)

    client.post("/api/settings/reset")
    data = client.get("/api/data").json()
    assert (data["theme"], data["font_size"]) == ("matrix", 12)


def test_storage_reports_sizes(client):
    new_note(client, content="x" * 100)
    s = client.get("/api/storage").json()
    assert s["notes_size"] > 100
    assert s["total_size"] == s["notes_size"] + s["images_size"]


def test_legacy_multi_user_data_is_flattened(np_backend, tmp_path):
    import json

    d = tmp_path / "legacy"
    d.mkdir()
    (d / "notes_data.json").write_text(json.dumps({
        "tree": [{"id": "a", "name": "A", "type": "note", "user_id": "u1"},
                 {"id": "b", "name": "B", "type": "note", "user_id": "u2"}],
        "notes": {"a": "1", "b": "2"},
        "trash": {"tree": [], "notes": {}},
        "users": {"u1": {}, "u2": {}},
        "sessions": {"t": {"user_id": "u1"}},
    }), encoding="utf-8")
    np_backend.set_data_dir(d)

    data = np_backend._read_data()
    assert "users" not in data and "sessions" not in data
    assert data["tree"] == [{"id": "a", "name": "A", "type": "note"},
                            {"id": "b", "name": "B", "type": "note"}]
    assert list(d.glob("notes_data.pre-single-profile-*.json"))


# Limity délky názvu a obsahu
def test_name_length_limit(client, np_backend):
    long = "x" * (np_backend.MAX_NAME_LEN + 1)
    assert client.post("/api/tree/new-note", json={"name": long}).status_code == 422
    assert client.post("/api/tree/new-folder", json={"name": long}).status_code == 422
    nid = new_note(client, "ok")
    assert client.post("/api/tree/rename", json={"id": nid, "name": long}).status_code == 422
    assert client.post("/api/tree/rename",
                       json={"id": nid, "name": "x" * np_backend.MAX_NAME_LEN}).status_code == 200


def test_content_length_limit(client, np_backend, monkeypatch):
    nid = new_note(client)
    too_big = "x" * (np_backend.MAX_NOTE_CHARS + 1)
    assert client.put(f"/api/note/{nid}", json={"content": too_big}).status_code == 422


def test_tag_limits(client, np_backend):
    nid = new_note(client)
    assert client.put(f"/api/tags/{nid}",
                      json={"tags": ["t"] * (np_backend.MAX_TAGS + 1)}).status_code == 422
    assert client.put(f"/api/tags/{nid}",
                      json={"tags": ["x" * (np_backend.MAX_TAG_LEN + 1)]}).status_code == 422


# ---- D8: a note in the trash can be viewed, read-only ------------------------

def test_d8_trashed_note_can_be_read_but_not_written(client):
    nid = new_note(client, name="Old", content="obsah v koši")
    client.post("/api/tree/delete", json={"id": nid})
    r = client.get(f"/api/note/{nid}")
    assert r.status_code == 200
    assert r.json()["content"] == "obsah v koši" and r.json()["trashed"] is True
    assert client.put(f"/api/note/{nid}", json={"content": "x"}).status_code == 404
    data = client.get("/api/data").json()
    assert nid not in data["notes"]          # no stray copy outside the trash


def test_d8_live_note_is_not_marked_trashed(client):
    nid = new_note(client, name="Live", content="x")
    assert client.get(f"/api/note/{nid}").json()["trashed"] is False


# ---- D9: favorites and the trash ----------------------------------------------

def favorites(client):
    return client.get("/api/data").json()["favorites"]


def test_d9_trashed_note_cannot_become_a_favorite(client):
    nid = new_note(client, name="Old")
    client.post("/api/tree/delete", json={"id": nid})
    assert client.post("/api/favorites/toggle", json={"id": nid}).status_code == 404
    assert favorites(client) == []


def test_d9_restore_brings_the_star_back(client):
    folder = new_folder(client, name="F")
    a = new_note(client, name="A", parent_id=folder)
    b = new_note(client, name="B")
    client.post("/api/favorites/toggle", json={"id": a})
    client.post("/api/favorites/toggle", json={"id": b})
    client.post("/api/tree/delete", json={"id": folder})
    assert favorites(client) == [b]
    client.post("/api/trash/restore", json={"id": folder})
    assert sorted(favorites(client)) == sorted([a, b])


def test_d9_purge_forgets_favorites_and_modes(client, np_backend):
    a = new_note(client, name="A")
    client.put(f"/api/note/{a}", json={"content": "# md", "mode": "markdown"})
    client.post("/api/favorites/toggle", json={"id": a})
    client.post("/api/tree/delete", json={"id": a})
    client.post("/api/trash/empty")
    data = np_backend._read_data()
    assert a not in data["favorites"]
    assert a not in data.get("note_modes", {})
    assert a not in (data.get("trash") or {}).get("favorites", [])

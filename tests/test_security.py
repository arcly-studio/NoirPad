"""HTTP-level hardening: headers, Host, CSRF, desktop token, password mode."""

import re

from fastapi.testclient import TestClient

from conftest import ROOT, pending


def raw_client(backend, **kw):
    """TestClient WITHOUT the default X-NoirPad-Request header."""
    return TestClient(backend.app, base_url="http://127.0.0.1:8000", **kw)


# ---- server password (NOIRPAD_PASSWORD) -----------------------------------


def test_password_mode_requires_login(client, np_backend):
    np_backend.configure(password="tajne-heslo")
    assert client.get("/api/session").json() == {
        "mode": "server", "password_required": True, "authenticated": False,
        "data_notice": None, "app_lock": {"enabled": False, "unlocked": True},
        "language": "auto", "install_language": None}
    assert client.get("/api/data").status_code == 401
    assert client.get("/images/x.png").status_code == 401

    assert client.post("/api/login", json={"password": "spatne"}).status_code == 401
    r = client.post("/api/login", json={"password": "tajne-heslo"})
    assert r.status_code == 200
    assert "httponly" in r.headers["set-cookie"].lower()
    assert "samesite=strict" in r.headers["set-cookie"].lower()
    assert client.get("/api/data").status_code == 200

    client.post("/api/logout")
    assert client.get("/api/data").status_code == 401


def test_login_rate_limit(client, np_backend):
    np_backend.configure(password="tajne-heslo")
    for _ in range(np_backend.LOGIN_MAX_FAILURES):
        client.post("/api/login", json={"password": "x"})
    r = client.post("/api/login", json={"password": "tajne-heslo"})
    assert r.status_code == 429


# ---- K6: CSP + security headers -------------------------------------------

EXPECTED_CSP = {
    "default-src": "'self'",
    "style-src": "'self' 'unsafe-inline'",
    "img-src": "'self' data: blob:",
    "connect-src": "'self'",
    "frame-ancestors": "'none'",
    "base-uri": "'none'",
    "form-action": "'self'",
}


# K6 – žádná CSP ani bezpečnostní hlavičky
def test_k6_security_headers(client):
    r = client.get("/")
    csp = dict(
        (d.split(" ", 1) + [""])[:2]
        for d in (p.strip() for p in r.headers["content-security-policy"].split(";")) if d
    )
    for key, value in EXPECTED_CSP.items():
        assert csp[key] == value, key
    assert csp["script-src"].startswith("'self'")
    assert "unsafe-inline" not in csp["script-src"]
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["referrer-policy"] == "no-referrer"
    assert r.headers["x-frame-options"] == "DENY"


# K6 / D10 – index.html bez inline skriptů, handlerů a externích zdrojů
def test_k6_index_has_no_inline_script_or_cdn():
    html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
    assert not re.search(r"<script(?![^>]*\bsrc=)[^>]*>", html), "inline <script>"
    assert not re.search(r"\son[a-z]+\s*=", html, re.I), "inline event handler"
    assert "esm.sh" not in html and "fonts.googleapis" not in html


# ---- D4: Host header / DNS rebinding + desktop token ----------------------


# D4 – bez validace hlavičky Host → DNS rebinding
def test_d4_foreign_host_rejected(client):
    assert client.get("/api/data", headers={"host": "evil.example"}).status_code == 400
    assert client.get("/api/data", headers={"host": "localhost:8000"}).status_code == 200


def test_d4_allowed_hosts_from_env(np_backend, monkeypatch):
    monkeypatch.setenv("NOIRPAD_ALLOWED_HOSTS", "notes.example.org")
    np_backend.configure(mode="server")
    c = raw_client(np_backend)
    assert c.get("/", headers={"host": "notes.example.org"}).status_code == 200
    assert c.get("/", headers={"host": "evil.example"}).status_code == 400


# D4 – desktop: náhodný token per spuštění
def test_d4_desktop_requires_token(np_backend):
    np_backend.configure(mode="desktop", desktop_token="tok-123")
    c = raw_client(np_backend)
    assert c.get("/api/data").status_code == 403
    assert c.get("/api/data", headers={"X-NoirPad-Token": "wrong"}).status_code == 403
    assert c.get("/api/data", headers={"X-NoirPad-Token": "tok-123"}).status_code == 200
    # Static shell stays reachable so the window can boot.
    assert c.get("/").status_code == 200


def test_d4_desktop_images_need_token_or_cookie(np_backend):
    np_backend.configure(mode="desktop", desktop_token="tok-123")
    c = raw_client(np_backend)
    assert c.get("/images/00000000-0000-0000-0000-000000000000.png").status_code == 403
    r = c.post("/api/session/bind", headers={"X-NoirPad-Token": "tok-123"})
    assert r.status_code == 200
    # Cookie set by bind authorises <img> requests (they can't send headers).
    assert c.get("/images/00000000-0000-0000-0000-000000000000.png").status_code == 404


# ---- D5: CSRF -------------------------------------------------------------


# D5 – form-post bez vlastní hlavičky projde
def test_d5_unsafe_method_needs_custom_header(np_backend):
    c = raw_client(np_backend)
    r = c.post("/api/settings/reset",
               headers={"content-type": "application/x-www-form-urlencoded"})
    assert r.status_code == 403
    assert c.get("/api/data").status_code == 200  # reads stay simple


def test_d5_foreign_origin_rejected(client):
    r = client.post("/api/settings/reset", headers={"origin": "http://127.0.0.1:9999"})
    assert r.status_code == 403
    r = client.post("/api/settings/reset", headers={"origin": "http://127.0.0.1:8000"})
    assert r.status_code == 200


def test_d5_no_cors_for_foreign_origins(client):
    r = client.options("/api/settings/reset", headers={
        "origin": "http://localhost:8000",
        "access-control-request-method": "POST",
        "access-control-request-headers": "x-noirpad-request",
    })
    assert "access-control-allow-origin" not in r.headers


# ---- drobné: /docs, /openapi.json -----------------------------------------


def test_docs_disabled(client):
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404, path


def test_d4_bind_needs_token(np_backend):
    np_backend.configure(mode="desktop", desktop_token="tok-123")
    c = raw_client(np_backend)
    assert c.post("/api/session/bind").status_code == 403
    assert "set-cookie" not in c.post("/api/session/bind").headers


def test_d4_desktop_token_cookie_is_not_enough_for_api(np_backend):
    np_backend.configure(mode="desktop", desktop_token="tok-123")
    c = raw_client(np_backend)
    c.cookies.set("noirpad_desktop", "tok-123")
    assert c.get("/api/data").status_code == 403


# ---- S1 (kontrola 2): UNC název obrázku z cizí zálohy / .md -----------------
#
# Path("…/images") / "//host/share/x.png" je na Windows \host\share\x.png a
# resolve() se na ten SMB server připojí (únik NTLM hashe, ~20 s blokace).
# Testy hlídají, že se k žádné takové cestě nikdy nedojde.

UNC_NAMES = ["//192.0.2.1/share/x.png", r"\\192.0.2.1\share\x.png",
             r"\\?\UNC\192.0.2.1\share\x.png"]
IMG = "0123abcd-0000-4000-8000-0123456789ab.png"


def _no_unc(monkeypatch):
    import pathlib
    real = pathlib.Path.resolve
    touched = []

    def guarded(self, *a, **kw):
        s = str(self).replace("/", "\\")
        if s.startswith("\\\\") and "192.0.2." in s:
            touched.append(s)
            raise AssertionError(f"UNC path resolved: {s}")
        return real(self, *a, **kw)

    monkeypatch.setattr(pathlib.Path, "resolve", guarded)
    return touched


def test_s1_safe_image_path_rejects_anything_but_a_stored_name(np_backend, monkeypatch):
    from noirpad.images import safe_image_path
    touched = _no_unc(monkeypatch)
    for name in UNC_NAMES + [IMG + "\n", "../" + IMG, "x.png", "", None]:
        assert safe_image_path(name) is None, repr(name)
    assert touched == []
    assert safe_image_path(IMG) == (np_backend.IMAGES_DIR / IMG).resolve()


def test_s1_backup_import_with_unc_image_entry_is_refused(client, monkeypatch):
    from conftest import make_png, make_zip
    import json
    touched = _no_unc(monkeypatch)
    tree = [{"id": "n", "type": "note", "name": "N"}]
    for name in UNC_NAMES:
        blob = make_zip({"notes_data.json": json.dumps({"tree": tree, "notes": {"n": "x"}}),
                         "images/" + name.replace("\\", "/"): make_png()})
        r = client.post("/api/backup/import", files={"file": ("b.zip", blob, "application/zip")})
        assert r.status_code == 400, name
        assert r.json()["detail"]["code"] == "backup_unsafe_path"
    assert touched == []


def test_s1_backup_note_images_keep_only_stored_names(client, np_backend, monkeypatch):
    from conftest import make_zip
    import json
    touched = _no_unc(monkeypatch)
    tree = [{"id": "n", "type": "note", "name": "N"}]
    data = {"tree": tree, "notes": {"n": "x"},
            "note_images": {"n": UNC_NAMES + [IMG, IMG + "\n"]}}
    r = client.post("/api/backup/import",
                    files={"file": ("b.zip", make_zip({"notes_data.json": json.dumps(data)}),
                                    "application/zip")})
    assert r.status_code == 200, r.text
    assert np_backend.read_data()["note_images"] == {"n": [IMG]}
    # Mazání poznámky (delete_images ze seznamu) se UNC cesty nedotkne.
    assert client.post("/api/tree/delete", json={"id": "n"}).status_code == 200
    assert client.post("/api/trash/empty").status_code in (200, 204)
    assert touched == []


def test_s1_html_and_md_export_ignore_unc_image_markers(client, monkeypatch):
    from conftest import new_note
    touched = _no_unc(monkeypatch)
    content = " ".join(f"<<IMG:{n}>>" for n in UNC_NAMES)
    nid = new_note(client, name="UNC", content=content)
    assert client.get(f"/api/export/{nid}/html").status_code == 200
    assert client.get(f"/api/export/{nid}/md").status_code == 200
    assert client.get("/api/notes/export").status_code == 200
    assert client.get("/api/notes/export-md").status_code == 200
    assert touched == []


def test_s1_md_import_with_unc_image_does_not_touch_it(client, monkeypatch):
    touched = _no_unc(monkeypatch)
    md = "# T\n\n![x](//192.0.2.3/share/x.png)\n<<IMG://192.0.2.3/share/y.png>>\n"
    r = client.post("/api/notes/import-md",
                    files={"files": ("a.md", md.encode(), "text/markdown")})
    assert r.status_code in (200, 400, 422), r.text
    assert touched == []


def test_s3_backup_tags_must_be_strings(client):
    from conftest import make_zip
    import json
    tree = [{"id": "n", "type": "note", "name": "N", "tags": [1, "x", {}]}]
    blob = make_zip({"notes_data.json": json.dumps({"tree": tree, "notes": {"n": "x"}})})
    r = client.post("/api/backup/import", files={"file": ("b.zip", blob, "application/zip")})
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "backup_corrupt_data"
    assert client.get("/api/tags").status_code == 200


def test_s4_an_unexpected_error_keeps_the_security_headers(client, monkeypatch):
    from noirpad.routes import notes as notes_routes

    def boom():
        raise RuntimeError("unexpected")

    monkeypatch.setattr(notes_routes, "read_data", boom)
    r = client.get("/api/tags")
    assert r.status_code == 500
    assert r.json() == {"detail": {"code": "generic", "params": {"status": 500}}}
    assert "default-src" in r.headers["content-security-policy"]
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "no-store" in r.headers["cache-control"]


# ---- R8 (kontrola 2): synchronní I/O v async handlerech blokovalo server ----

ASYNC_OK = {"upload_image", "backup_import", "import_markdown"}   # await the upload, then a thread


def test_r8_handlers_never_block_the_event_loop(np_backend):
    import inspect
    from fastapi.routing import APIRoute
    async_routes = {r.endpoint.__name__ for r in np_backend.app.routes
                    if isinstance(r, APIRoute) and inspect.iscoroutinefunction(r.endpoint)}
    assert async_routes == ASYNC_OK

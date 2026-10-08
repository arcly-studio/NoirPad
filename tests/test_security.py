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
        "mode": "server", "password_required": True, "authenticated": False}
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

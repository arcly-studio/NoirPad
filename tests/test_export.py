"""Single-note TXT/HTML export and the bulk HTML zip export.

PDF export is the browser's print dialog (static/js/print.js) and is
covered by tests/js/print.test.js.
"""

import io
import re
import zipfile
from urllib.parse import unquote

from conftest import new_folder, new_note, pending

CZECH = "Úkoly – řešení ř š č"


def ascii_fallback(resp):
    """The plain filename="…" parameter (for clients without RFC 5987)."""
    m = re.search(r'filename="([^"]*)"', resp.headers["content-disposition"])
    return m.group(1) if m else None


def utf8_name(resp):
    m = re.search(r"filename\*=UTF-8''([^;]+)", resp.headers["content-disposition"])
    return unquote(m.group(1)) if m else None


def test_export_txt_ascii_name(client):
    nid = new_note(client, "Plain", content="řádek 1\nřádek 2")
    r = client.get(f"/api/export/{nid}/txt")
    assert r.status_code == 200
    assert r.content.decode("utf-8") == "řádek 1\nřádek 2"
    assert "Plain.txt" in r.headers["content-disposition"]


def test_export_html_escapes_content(client):
    nid = new_note(client, "Plain", content="<b>x</b> & y")
    r = client.get(f"/api/export/{nid}/html")
    assert r.status_code == 200
    assert "&lt;b&gt;x&lt;/b&gt; &amp; y" in r.text
    assert "<b>x</b>" not in r.text


def test_export_missing_note(client):
    assert client.get("/api/export/nope/txt").status_code == 404


def test_bulk_export_skips_encrypted(client):
    f = new_folder(client, "Složka")
    new_note(client, "A", parent_id=f, content="aaa")
    secret = new_note(client, "Tajné", content="sss")
    client.post("/api/encrypt", json={"id": secret, "password": "heslo123"})

    r = client.get("/api/notes/export")
    assert r.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    names = zf.namelist()
    assert "Složka/A.html" in names
    assert "_EXCLUDED.txt" in names
    assert "Tajné" in zf.read("_EXCLUDED.txt").decode("utf-8")


# K7 – export TXT/HTML padá na 500 u českých názvů
def test_k7_export_txt_czech_name(client):
    nid = new_note(client, CZECH, content="obsah")
    r = client.get(f"/api/export/{nid}/txt")
    assert r.status_code == 200
    assert utf8_name(r) == CZECH + ".txt"
    fallback = ascii_fallback(r)
    assert fallback == "Ukoly  reseni r s c.txt"


def test_k7_export_html_czech_name(client):
    nid = new_note(client, CZECH, content="obsah")
    r = client.get(f"/api/export/{nid}/html")
    assert r.status_code == 200
    assert f"<title>{CZECH}</title>" in r.text
    assert utf8_name(r) == CZECH + ".html"


# K7 – uvozovka v názvu nesmí rozbít hlavičku
def test_k7_quote_in_name(client):
    nid = new_note(client, 'a"b', content="x")
    r = client.get(f"/api/export/{nid}/txt")
    assert r.status_code == 200
    fallback = ascii_fallback(r)
    assert fallback == "a-b.txt"
    assert utf8_name(r) == "a-b.txt"


# K7 – název v <title> musí být escapovaný
def test_k7_html_title_escaped(client):
    nid = new_note(client, "x</title><script>alert(1)</script>", content="y")
    r = client.get(f"/api/export/{nid}/html")
    assert "<script>alert(1)</script>" not in r.text
    assert "&lt;/title&gt;&lt;script&gt;" in r.text


def test_export_non_latin_name_has_ascii_fallback(client):
    nid = new_note(client, "Ελληνικά", content="x")
    r = client.get(f"/api/export/{nid}/txt")
    assert r.status_code == 200
    assert ascii_fallback(r).isascii()
    assert utf8_name(r) == "Ελληνικά.txt"

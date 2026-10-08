"""Single-note TXT/HTML export and the bulk HTML zip export.

PDF export is the browser's print dialog (static/js/print.js) and is
covered by tests/js/print.test.js.
"""

import io
import zipfile
from email.message import Message
from urllib.parse import unquote

from conftest import new_folder, new_note, pending

CZECH = "Úkoly – řešení ř š č"


def disposition(resp):
    msg = Message()
    msg["content-disposition"] = resp.headers["content-disposition"]
    return msg


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
@pending("K7", "D")
def test_k7_export_txt_czech_name(client):
    nid = new_note(client, CZECH, content="obsah")
    r = client.get(f"/api/export/{nid}/txt")
    assert r.status_code == 200
    d = disposition(r)
    assert d.get_param("filename*", header="content-disposition")
    raw = r.headers["content-disposition"]
    assert "filename*=UTF-8''" in raw
    encoded = raw.split("filename*=UTF-8''", 1)[1].split(";")[0]
    assert unquote(encoded) == CZECH + ".txt"
    fallback = d.get_param("filename", header="content-disposition")
    assert fallback and fallback.isascii() and fallback.endswith(".txt")


@pending("K7", "D")
def test_k7_export_html_czech_name(client):
    nid = new_note(client, CZECH, content="obsah")
    r = client.get(f"/api/export/{nid}/html")
    assert r.status_code == 200
    assert f"<title>{CZECH}</title>" in r.text
    assert "filename*=UTF-8''" in r.headers["content-disposition"]


# K7 – uvozovka v názvu nesmí rozbít hlavičku
@pending("K7", "D")
def test_k7_quote_in_name(client):
    nid = new_note(client, 'a"b', content="x")
    r = client.get(f"/api/export/{nid}/txt")
    assert r.status_code == 200
    fallback = disposition(r).get_param("filename", header="content-disposition")
    assert fallback.endswith(".txt") and '"' not in fallback


# K7 – název v <title> musí být escapovaný
@pending("K7", "D")
def test_k7_html_title_escaped(client):
    nid = new_note(client, "x</title><script>alert(1)</script>", content="y")
    r = client.get(f"/api/export/{nid}/html")
    assert "<script>alert(1)</script>" not in r.text
    assert "&lt;/title&gt;&lt;script&gt;" in r.text

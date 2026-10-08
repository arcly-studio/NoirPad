"""Shared pytest fixtures.

The backend never touches the real %LOCALAPPDATA%\\NoirPad during tests:
NOIRPAD_DATA_DIR is pointed at a throwaway directory before the module is
imported, and every test gets its own fresh data dir via `set_data_dir`.
"""

import importlib.util
import io
import os
import struct
import sys
import tempfile
import zipfile
import zlib
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

os.environ["NOIRPAD_DATA_DIR"] = tempfile.mkdtemp(prefix="noirpad-test-import-")
os.environ.pop("NOIRPAD_PASSWORD", None)


def _load_backend():
    spec = importlib.util.spec_from_file_location("noirpad_web", ROOT / "NoirPad-web.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["noirpad_web"] = module
    spec.loader.exec_module(module)
    return module


backend = _load_backend()

# Header the frontend sends on every API call (CSRF guard, D5).
API_HEADERS = {"X-NoirPad-Request": "1"}


@pytest.fixture
def np_backend(tmp_path):
    """The backend module, pointed at an empty per-test data dir."""
    backend.set_data_dir(tmp_path / "data")
    backend.configure(mode="server", password=None)
    yield backend
    backend.configure(mode="server", password=None)


@pytest.fixture
def client(np_backend):
    from fastapi.testclient import TestClient

    with TestClient(np_backend.app, base_url="http://127.0.0.1:8000",
                    headers=API_HEADERS) as c:
        yield c


# ---- helpers ---------------------------------------------------------------


def make_png(width=2, height=2) -> bytes:
    """A tiny but valid PNG."""
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    raw = b"".join(b"\x00" + b"\xff\x00\x00" * width for _ in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def make_zip(files: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buf.getvalue()


def new_note(client, name="Note", parent_id=None, content=None):
    r = client.post("/api/tree/new-note", json={"name": name, "parent_id": parent_id})
    assert r.status_code == 200, r.text
    note_id = r.json()["id"]
    if content is not None:
        r = client.put(f"/api/note/{note_id}", json={"content": content, "formats": []})
        assert r.status_code == 200, r.text
    return note_id


def new_folder(client, name="Folder", parent_id=None):
    r = client.post("/api/tree/new-folder", json={"name": name, "parent_id": parent_id})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def pending(finding: str, step: str):
    """Regression test for an audit finding that is not fixed yet.

    strict=True: the moment the fix lands the test XPASSes, which fails the
    run until this marker is removed — so fixed findings stay guarded.
    """
    return pytest.mark.xfail(strict=True, reason=f"{finding}: oprava v kroku {step}")

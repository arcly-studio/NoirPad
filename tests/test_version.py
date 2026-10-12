"""Step D: noirpad/__version__.py is the only place the version is written."""

import re

from noirpad.__version__ import PROJECT_URL, __version__

from conftest import ROOT


def test_api_version(client):
    assert client.get("/api/version").json() == {"version": __version__, "url": PROJECT_URL}


def test_fastapi_reports_same_version(np_backend):
    assert np_backend.app.version == __version__


def test_version_is_not_hardcoded_elsewhere():
    pattern = re.compile(re.escape(__version__))
    offenders = []
    for path in [*ROOT.glob("*.py"), *ROOT.glob("*.spec"), *ROOT.glob("*.iss"),
                 *ROOT.glob("*.ps1"), *(ROOT / "noirpad").rglob("*.py"),
                 *(ROOT / "static" / "js").glob("*.js"), ROOT / "static" / "index.html"]:
        if path.name == "__version__.py":
            continue
        if pattern.search(path.read_text(encoding="utf-8")):
            offenders.append(path.name)
    assert offenders == []

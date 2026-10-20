"""Step D: noirpad/__version__.py is the only place the version is written."""

import re

from noirpad.__version__ import AUTHOR, PROJECT_URL, __version__

from conftest import ROOT


def test_api_version(client):
    assert client.get("/api/version").json() == {
        "version": __version__, "url": PROJECT_URL, "author": AUTHOR}


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


def test_project_url_and_publisher_are_the_new_owner():
    """The repository moved to the arcly-studio organization (2026-10). The
    old owner may only remain in LICENSE (copyright holder) and in the notes
    for agents (CLAUDE.md)."""
    assert PROJECT_URL == "https://github.com/arcly-studio/NoirPad"
    assert AUTHOR == "Arcly Studio"
    iss = (ROOT / "installer.iss").read_text(encoding="utf-8-sig")
    assert re.search(r'^#define AppPublisher\s+"Arcly Studio"', iss, re.M)      # own copy of AUTHOR
    assert PROJECT_URL in iss
    assert re.search(r"'CompanyName',\s*'\{AUTHOR\}'", (ROOT / "noirpad.spec").read_text(encoding="utf-8"))
    offenders = []
    for path in [*ROOT.glob("*.md"), *ROOT.glob("*.py"), *ROOT.glob("*.spec"), *ROOT.glob("*.iss"),
                 *ROOT.glob("*.ps1"), *(ROOT / ".github").rglob("*.yml"),
                 *(ROOT / "noirpad").rglob("*.py"), *(ROOT / "static").rglob("*.js"),
                 *(ROOT / "static").rglob("*.json"), *(ROOT / "static").rglob("*.html")]:
        if "vendor" in path.parts or "node_modules" in path.parts or path.name == "CLAUDE.md":
            continue
        if "krystof2-ops" in path.read_text(encoding="utf-8-sig"):
            offenders.append(path.name)
    assert offenders == []

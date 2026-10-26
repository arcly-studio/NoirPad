"""N4: the new logo is used everywhere; the old icon (white N with a green
cursor) is gone."""

import hashlib
import json
import re
import struct

from conftest import ROOT

OLD_ICON_SHA256 = "053bc07945e506d0c642f2a65b7f4af5fbd8dec71816cc5ad34ccc8c908e6d96"
STATIC = ROOT / "static"


def ico_sizes(path):
    data = path.read_bytes()
    _, kind, count = struct.unpack_from("<HHH", data)
    assert kind == 1
    sizes = set()
    for i in range(count):
        w, h = data[6 + 16 * i], data[7 + 16 * i]
        sizes.add((w or 256, h or 256))
    return sizes


def test_old_icon_is_gone_everywhere():
    for path in [*ROOT.glob("*.ico"), *STATIC.rglob("*.ico"), *(ROOT / "docs").rglob("*.ico")]:
        assert hashlib.sha256(path.read_bytes()).hexdigest() != OLD_ICON_SHA256, path


def test_app_and_installer_icon_has_all_windows_sizes():
    sizes = ico_sizes(ROOT / "noirpad.ico")
    assert {(16, 16), (24, 24), (32, 32), (48, 48), (256, 256)} <= sizes
    assert 'icon="noirpad.ico"' in (ROOT / "noirpad.spec").read_text(encoding="utf-8")
    iss = (ROOT / "installer.iss").read_text(encoding="utf-8-sig")
    assert "SetupIconFile=noirpad.ico" in iss
    assert r"UninstallDisplayIcon={app}\{#AppExeName}" in iss     # the exe carries noirpad.ico


def test_favicon():
    assert {(16, 16), (32, 32)} <= ico_sizes(STATIC / "favicon.ico")


def test_wizard_images_exist_with_alpha():
    iss = (ROOT / "installer.iss").read_text(encoding="utf-8-sig")
    files = re.search(r"^WizardSmallImageFile=(.+)$", iss, re.M).group(1).split(",")
    assert len(files) >= 2 and "WizardImageAlphaFormat=defined" in iss
    for rel in files:
        data = (ROOT / rel).read_bytes()
        assert data[:2] == b"BM"
        width, height, _, bpp = struct.unpack_from("<iiHH", data, 18)
        assert width == height == int(re.search(r"(\d+)\.bmp$", rel).group(1)) and bpp == 32


def test_web_icons_and_manifest(client):
    html = (STATIC / "index.html").read_text(encoding="utf-8")
    for href in re.findall(r'<link rel="(?:icon|apple-touch-icon|manifest)" href="([^"]+)"', html):
        assert client.get(href).status_code == 200, href
    assert client.get("/static/img/noirpad-icon.svg").headers["content-type"].startswith("image/svg+xml")
    manifest = json.loads((STATIC / "manifest.json").read_text(encoding="utf-8"))
    assert {"192x192", "512x512"} <= {i["sizes"] for i in manifest["icons"]}
    for icon in manifest["icons"]:
        assert client.get(icon["src"]).status_code == 200, icon["src"]


def test_ui_shows_the_svg_logo():
    logo = "/static/img/noirpad-icon.svg"
    assert logo in (STATIC / "js" / "welcome.js").read_text(encoding="utf-8")      # start page
    assert logo in (STATIC / "js" / "auth.js").read_text(encoding="utf-8")         # login / app lock
    assert 'class="about-logo np-decorative" src="' + logo in (STATIC / "index.html").read_text(encoding="utf-8")


def test_brand_sources_and_readme_logo():
    for name in ("noirpad-icon.svg", "noirpad-icon-small.svg", "noirpad-1024.png"):
        assert (ROOT / "docs" / "brand" / name).is_file()
    png = (ROOT / "docs" / "logo.png").read_bytes()
    assert png[:8] == b"\x89PNG\r\n\x1a\n" and struct.unpack(">II", png[16:24]) == (256, 256)
    for readme in ("README.md", "README.cs.md"):
        assert '<img src="docs/logo.png"' in (ROOT / readme).read_text(encoding="utf-8")


# ---- I3–I5 (kontrola 2): instalátor -------------------------------------------

def _iss():
    return (ROOT / "installer.iss").read_text(encoding="utf-8-sig")


def test_i3_a_silent_install_installs_webview2_too():
    iss = _iss()
    prep = re.search(r"function PrepareToInstall.*?\nend;", iss, re.S).group(0)
    assert "WizardSilent() and not WebView2Installed()" in prep
    assert "InstallWebView2Silently" in prep
    body = re.search(r"procedure InstallWebView2Silently\(\);.*?\nend;", iss, re.S).group(0)
    assert "DownloadTemporaryFile" in body and "MsgBox" not in body   # never a window when silent


def test_i4_the_dir_not_empty_text_does_not_ask_for_another_folder():
    iss = _iss()
    for line in re.findall(r"^\w+\.DirNotEmpty=.*$", iss, re.M):
        assert "choose" not in line and "zvolte" not in line, line


def test_i5_copyright_and_uninstall_name():
    iss = _iss()
    assert re.search(r"^AppCopyright=\{#AppCopyright\}$", iss, re.M)
    assert re.search(r"^VersionInfoCopyright=\{#AppCopyright\}$", iss, re.M)
    assert re.search(r"^UninstallDisplayName=\{#AppName\}$", iss, re.M)
    spec = (ROOT / "noirpad.spec").read_text(encoding="utf-8")
    assert "StringStruct('LegalCopyright', 'MIT License')" not in spec
    assert re.search(r"LegalCopyright', 'Copyright \(c\) [^']+MIT License\.'", spec)

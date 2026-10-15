"""Redesign "G – Noir čistý": stylesheet rules that keep the calm look."""

import json
import re

from conftest import ROOT
from noirpad import storage

CSS = re.sub(r"/\*.*?\*/", "", (ROOT / "static" / "css" / "noirpad.css").read_text(encoding="utf-8"),
             flags=re.S)


def rule(selector: str) -> str:
    """Bodies of every top-level rule whose selector list is exactly *selector*."""
    bodies = re.findall(rf"(?m)^{re.escape(selector)}\s*\{{([^}}]*)\}}", CSS)
    assert bodies, selector
    return "\n".join(bodies)


def test_g4_editor_and_panes_have_no_frame():
    for sel in ("#editor", "#md-source,\n#md-preview"):
        body = rule(sel)
        assert re.search(r"border:\s*none", body), sel
        assert not re.search(r"box-shadow:\s*0", body), sel
    assert re.search(r"padding:\s*16px 34px", rule("#editor"))


def test_g4_one_thin_line_between_source_and_preview():
    assert re.search(r"border-left:\s*1px solid var\(--border\)", rule("#md-preview"))


def test_g4_code_blocks_soft_background_no_frame():
    for sel in (".np-code", "#md-preview .md-codeblock"):
        body = rule(sel)
        assert "var(--code-bg)" in body, sel
        assert re.search(r"border:\s*none", body), sel


# ---- G6: Noir effects are off for new installs, kept for existing data ----

def _data_dir_with(tmp_path, data):
    d = tmp_path / "old"
    d.mkdir()
    (d / "notes_data.json").write_text(json.dumps(data), encoding="utf-8")
    storage.set_data_dir(d)
    return json.loads((d / "notes_data.json").read_text(encoding="utf-8"))


def test_g6_new_install_has_the_effects_off(client):
    data = client.get("/api/data").json()
    assert data["glow_enabled"] is False
    assert data["matrix_rain_enabled"] is False
    assert data["crt_enabled"] is False
    assert data["ui_font"] == "jetbrains-mono"


def test_g6_existing_data_keeps_its_effects(np_backend, tmp_path):
    # written by 1.0.0: matrix rain on (its default), glow always on, no CRT key
    data = _data_dir_with(tmp_path, {"tree": [], "notes": {}, "matrix_rain_enabled": True,
                                     "glow_intensity": 80, "ui_font": "orbitron"})
    assert data["glow_enabled"] is True
    assert data["matrix_rain_enabled"] is True
    assert data["glow_intensity"] == 80
    assert "crt_enabled" not in data          # the browser carries over its old local value
    assert data["ui_font"] == "jetbrains-mono"


def test_g6_existing_choices_are_respected(np_backend, tmp_path):
    data = _data_dir_with(tmp_path, {"tree": [], "notes": {}, "matrix_rain_enabled": False,
                                     "ui_font": "inter"})
    assert data["matrix_rain_enabled"] is False
    assert data["glow_enabled"] is True
    assert data["ui_font"] == "inter"


def test_g6_migration_runs_once(np_backend, tmp_path):
    _data_dir_with(tmp_path, {"tree": [], "notes": {}, "matrix_rain_enabled": True})
    f = tmp_path / "old" / "notes_data.json"
    d = json.loads(f.read_text(encoding="utf-8"))
    d["glow_enabled"] = False                  # the user turns it off later
    d["matrix_rain_enabled"] = False
    f.write_text(json.dumps(d), encoding="utf-8")
    storage.set_data_dir(tmp_path / "old")     # next start
    again = json.loads(f.read_text(encoding="utf-8"))
    assert again["glow_enabled"] is False
    assert again["matrix_rain_enabled"] is False


# ---- G7: one visual language for every window ----

def test_g7_windows_share_line_radius_and_no_glow():
    m = re.search(r"\.dialog-box,\s*#settings-window,[^{]*\{([^}]*)\}", CSS)
    assert m, "the shared window rule is missing"
    selectors = m.group(0).split("{")[0]
    for sel in ("#help-window", "#font-picker", "#shortcuts-panel", ".np-findall-modal",
                ".paste-image-modal", ".np-command-bar", ".auth-window", ".np-toast", ".np-menu"):
        assert sel in selectors, sel
    body = m.group(1)
    assert re.search(r"border:\s*1px solid var\(--border\)", body)
    assert re.search(r"border-radius:\s*6px", body)
    assert "glow" not in body


def test_g7_no_text_glow_without_noir_effects():
    assert re.search(r"body:not\(\.np-glow\) \*,[^{]*\{\s*text-shadow:\s*none !important", CSS)


def test_g7_command_bar_has_no_inline_look():
    js = (ROOT / "static" / "js" / "command-bar.js").read_text(encoding="utf-8")
    assert "var(--accent,#00ff41);border-top:none" not in js
    assert "np-command-input" in js


# ---- G8: the top bar never pushes the tools out of a narrow window ----

def test_g8_tabs_scroll_tools_stay():
    strip = rule("#tab-bar")
    assert re.search(r"overflow-x:\s*auto", strip)
    assert re.search(r"min-width:\s*0", strip)          # may shrink below its content
    assert re.search(r"flex-shrink:\s*0", rule("#top-tools"))
    assert re.search(r"max-width:\s*200px", rule(".tab-pill"))
    assert re.search(r"text-overflow:\s*ellipsis", rule(".tab-pill .tab-name"))


def test_g6_snapshot_restored_after_damage_keeps_its_effects(np_backend, tmp_path):
    d = tmp_path / "dmg"
    d.mkdir()
    storage.set_data_dir(d)                               # new install: effects off
    storage.backups_dir().mkdir(parents=True, exist_ok=True)
    (storage.backups_dir() / "notes_data-20260101-000000.json").write_text(
        json.dumps({"tree": [], "notes": {}, "matrix_rain_enabled": True}), encoding="utf-8")
    (d / "notes_data.json").write_text("{ damaged", encoding="utf-8")
    data = storage.read_data()                            # recovers from the old snapshot
    assert data["glow_enabled"] is True
    assert data["matrix_rain_enabled"] is True

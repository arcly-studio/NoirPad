"""Redesign "G – Noir čistý": stylesheet rules that keep the calm look."""

import re

from conftest import ROOT

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

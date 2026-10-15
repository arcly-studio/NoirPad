"""D12: secondary text (--fg-dim) on bars and buttons (--bg-light) reaches
WCAG AA 4.5:1 in every theme. Computed from static/css/themes.css."""

import re

import pytest

from conftest import ROOT

CSS = re.sub(r"/\*.*?\*/", "", (ROOT / "static" / "css" / "themes.css").read_text(encoding="utf-8"),
             flags=re.S)


def _hex(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def _lum(c):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = map(ch, c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    hi, lo = sorted((_lum(a), _lum(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def _mix(a, b, p):
    return tuple(round(x * p + y * (1 - p)) for x, y in zip(a, b))


def _vars(selector_regex):
    """Custom properties of every rule whose selector list matches."""
    out = {}
    for sel, body in re.findall(r"([^{}]+)\{([^{}]*)\}", CSS):
        if re.search(selector_regex, sel):
            out.update(dict(re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", body)))
    return out


def _resolve(value, env):
    value = re.sub(r"/\*.*?\*/", "", value).strip()
    if value.startswith("#"):
        return _hex(value)
    m = re.match(r"color-mix\(in srgb,\s*var\((--[\w-]+)\)\s*(\d+)%,\s*(#[0-9a-fA-F]{6})\)", value)
    if m:
        return _mix(_resolve(env[m.group(1)], env), _hex(m.group(3)), int(m.group(2)) / 100)
    raise AssertionError(f"cannot resolve {value!r}")


THEMES = sorted(set(re.findall(r'\[data-theme="([\w-]+)"\]', CSS)))


def test_all_17_themes_found():
    assert len(THEMES) == 17


@pytest.mark.parametrize("theme", THEMES)
def test_d12_secondary_text_is_readable(theme):
    env = _vars(r"^\s*:root\s*$")
    env.update(_vars(rf'\[data-theme="{theme}"\]'))
    ratio = contrast(_resolve(env["--fg-dim"], env), _resolve(env["--bg-light"], env))
    assert ratio >= 4.5, f"{theme}: {ratio:.2f}"


def test_d11_header_strip_hides_the_matrix_rain():
    """The rain canvas sits behind #app; the note title, tabs and tags
    need an opaque background or the glyphs run right under the text."""
    css = re.sub(r"/\*.*?\*/", "", (ROOT / "static" / "css" / "noirpad.css").read_text(encoding="utf-8"),
                 flags=re.S)
    for sel in ("#top-bar", "#note-header"):   # tabs in #top-bar (G1), tags in #note-header (G3)
        body = re.search(rf"(?m)^{re.escape(sel)}\s*\{{([^}}]*)\}}", css).group(1)
        assert re.search(r"background\s*:\s*var\(--bg\)", body), sel

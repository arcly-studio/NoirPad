"""
One-shot helper that captures the 6 README screenshots into docs/screenshots/.

Strategy:
  1. Back up notes_data.json -> notes_data.json.preshot.bak
  2. Write a clean demo dataset (single welcome note + markdown sample)
  3. Run Playwright (headless Chromium) against http://127.0.0.1:8000
  4. Restore the original notes_data.json

This script starts and stops the FastAPI server itself.

Dev-only requirements (not in requirements.txt):
    python -m pip install playwright pillow
    python -m playwright install chromium

Usage:
    python _take_screenshots.py
"""

import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / "notes_data.json"
BACKUP_FILE = ROOT / "notes_data.json.preshot.bak"
SHOTS_DIR = ROOT / "docs" / "screenshots"
SHOTS_DIR.mkdir(parents=True, exist_ok=True)

URL = "http://127.0.0.1:8000"
DESKTOP = {"width": 1440, "height": 900}
MOBILE = {"width": 414, "height": 820}

# ---------------------------------------------------------------------------
# Demo dataset
# ---------------------------------------------------------------------------

WELCOME_NOTE_ID = "demo-welcome-0001"
MARKDOWN_NOTE_ID = "demo-markdown-0002"
SECRET_NOTE_ID = "demo-secret-0003"
PROJECT_FOLDER_ID = "demo-folder-0001"

MARKDOWN_BODY = """# NoirPad Demo

> Terminal-aesthetic note-taking with **markdown**, syntax highlighting,
> encryption, and 17 themes.

## Features

- Split-pane markdown editor
- Shiki syntax highlighting
- Per-note password encryption
- 17 retro themes

## Code sample

```python
from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def root():
    return {"hello": "noirpad"}
```

```javascript
// vanilla JS, no build step
window.NP.editor.save();
```

## Checklist

- [x] Markdown rendering
- [x] Syntax highlighting
- [ ] Conquer the world
"""

WELCOME_BODY = (
    "Welcome to NoirPad.\n\n"
    "Local, single-user note app with markdown, encryption, and 17 themes.\n\n"
    "Open the Markdown demo note to see syntax highlighting, or hit Ctrl+M\n"
    "to toggle markdown mode on this note."
)

SECRET_BODY = (
    "Secret diary entry — March 5.\n\n"
    "Investor meeting went well. Don't forget to lock this note before pushing\n"
    "anything sensitive into it. Click the Lock button in the header to encrypt."
)


def demo_data() -> dict:
    return {
        "tree": [
            {
                "id": PROJECT_FOLDER_ID,
                "name": "NoirPad",
                "type": "folder",
                "children": [
                    {"id": WELCOME_NOTE_ID, "name": "Welcome", "type": "note"},
                    {"id": MARKDOWN_NOTE_ID, "name": "Markdown demo", "type": "note"},
                    {"id": SECRET_NOTE_ID, "name": "Secret diary", "type": "note"},
                ],
            },
        ],
        "notes": {
            WELCOME_NOTE_ID: WELCOME_BODY,
            MARKDOWN_NOTE_ID: MARKDOWN_BODY,
            SECRET_NOTE_ID: SECRET_BODY,
        },
        "theme": "matrix",
        "tags": {
            WELCOME_NOTE_ID: ["readme", "intro"],
            MARKDOWN_NOTE_ID: ["markdown", "demo"],
            SECRET_NOTE_ID: ["private"],
        },
        "autosave": True,
        "favorites": [MARKDOWN_NOTE_ID],
        "trash": [],
        "font_family": "jetbrains",
        "font_size": 14,
        "note_formats": {},
        "page_orientation": "portrait",
        "ui_font": "orbitron",
        "matrix_rain_enabled": False,
        "autosave_interval": 30,
        "confirm_delete": True,
        "idle_lock_minutes": 0,
        "note_images": {},
        "show_splash": False,
        "glitch_effect": False,
        "spellcheck": False,
        "glow_intensity": 100,
        "custom_shortcuts": {},
        "default_encrypted": False,
        "show_shortcut_hints": True,
        "note_modes": {
            MARKDOWN_NOTE_ID: "markdown",
        },
    }


# ---------------------------------------------------------------------------
# Server lifecycle
# ---------------------------------------------------------------------------

def start_server() -> subprocess.Popen:
    proc = subprocess.Popen(
        [sys.executable, "NoirPad-web.py"],
        cwd=str(ROOT),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    # Wait for server to come up
    import urllib.request
    import urllib.error

    deadline = time.time() + 30
    while time.time() < deadline:
        try:
            urllib.request.urlopen(URL, timeout=1).read()
            return proc
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            time.sleep(0.3)
    raise RuntimeError("Server did not come up within 30 seconds")


def stop_server(proc: subprocess.Popen) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


# ---------------------------------------------------------------------------
# Screenshot helpers
# ---------------------------------------------------------------------------

def wait_ready(page) -> None:
    page.wait_for_function(
        "() => window.NP && NP.state && NP.state.data && !document.getElementById('splash-overlay')",
        timeout=10_000,
    )
    page.wait_for_timeout(400)


def open_note(page, note_id: str) -> None:
    """Expand ancestor folders, then open the note via the tree row click handler."""
    page.evaluate(
        """(id) => {
            const data = NP.state.data;
            // Find path of folder IDs from root to the note.
            function path(tree, target, acc) {
                for (const it of tree) {
                    if (it.id === target) return acc;
                    if (it.children) {
                        const r = path(it.children, target, [...acc, it.id]);
                        if (r) return r;
                    }
                }
                return null;
            }
            const ancestors = path(data.tree, id, []) || [];
            for (const fid of ancestors) NP.state.setFolderOpenState(fid, true);
            NP.tree.render();
            const row = document.querySelector(
                `#tree-container .tree-item[data-id='${id}']`
            );
            if (row) row.click();
        }""",
        note_id,
    )
    page.wait_for_timeout(800)


def set_theme(page, theme: str) -> None:
    page.evaluate(
        """(t) => {
            if (window.NP && NP.themes && NP.themes.apply) {
                NP.themes.apply(t);
            } else {
                document.documentElement.setAttribute('data-theme', t);
            }
        }""",
        theme,
    )
    page.wait_for_timeout(150)


def screenshot(page, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(path), full_page=False)
    print(f"  -> {path.relative_to(ROOT)}")


# ---------------------------------------------------------------------------
# Capture flows
# ---------------------------------------------------------------------------

def shot_welcome(browser):
    print("[1/6] welcome.png")
    ctx = browser.new_context(viewport=DESKTOP, device_scale_factor=1)
    page = ctx.new_page()
    page.goto(URL)
    wait_ready(page)
    # Make sure no note is selected — call showWelcome() directly.
    page.evaluate("() => { if (NP.editor && NP.editor.showWelcome) NP.editor.showWelcome(); }")
    page.wait_for_timeout(800)
    screenshot(page, SHOTS_DIR / "welcome.png")
    ctx.close()


def shot_markdown(browser):
    print("[2/6] markdown.png")
    ctx = browser.new_context(viewport=DESKTOP, device_scale_factor=1)
    page = ctx.new_page()
    page.goto(URL)
    wait_ready(page)
    open_note(page, MARKDOWN_NOTE_ID)
    # Ensure markdown mode is on (the note already has mode=markdown in data,
    # but we toggle explicitly for safety).
    page.evaluate(
        """() => {
            const md = document.getElementById('md-stack');
            if (md && md.offsetParent === null) {
                document.getElementById('btn-md-toggle').click();
            }
        }"""
    )
    page.wait_for_timeout(1500)  # let Shiki finish highlighting
    screenshot(page, SHOTS_DIR / "markdown.png")
    ctx.close()


def shot_themes(browser):
    print("[3/6] themes.png (composite of 4 themes)")
    themes = ["matrix", "amber", "dracula", "tokyo-night"]
    tiles = []
    ctx = browser.new_context(viewport={"width": 720, "height": 480}, device_scale_factor=1)
    page = ctx.new_page()
    page.goto(URL)
    wait_ready(page)
    open_note(page, MARKDOWN_NOTE_ID)
    page.wait_for_timeout(800)
    for t in themes:
        set_theme(page, t)
        page.wait_for_timeout(900)
        tile_path = SHOTS_DIR / f"_theme_{t}.png"
        screenshot(page, tile_path)
        tiles.append(tile_path)
    # Reset persisted theme back to matrix so subsequent contexts load fresh.
    set_theme(page, "matrix")
    page.wait_for_timeout(300)
    ctx.close()

    # 2x2 composite
    imgs = [Image.open(p) for p in tiles]
    w, h = imgs[0].size
    gap = 12
    combined = Image.new("RGB", (w * 2 + gap, h * 2 + gap), (0, 0, 0))
    combined.paste(imgs[0], (0, 0))
    combined.paste(imgs[1], (w + gap, 0))
    combined.paste(imgs[2], (0, h + gap))
    combined.paste(imgs[3], (w + gap, h + gap))
    out = SHOTS_DIR / "themes.png"
    combined.save(out, optimize=True)
    print(f"  -> {out.relative_to(ROOT)}")
    for p in tiles:
        p.unlink(missing_ok=True)


def shot_encryption(browser):
    print("[4/6] encryption.png")
    ctx = browser.new_context(viewport=DESKTOP, device_scale_factor=1)
    page = ctx.new_page()
    page.goto(URL)
    wait_ready(page)
    open_note(page, SECRET_NOTE_ID)
    page.wait_for_timeout(500)
    # Show the lock-overlay UI (the same element used when opening an encrypted
    # note). We do this directly rather than clicking btn-lock because btn-lock
    # uses window.prompt() which is a blocking browser dialog.
    page.evaluate(
        """() => {
            const ov = document.getElementById('lock-overlay');
            if (ov) {
                ov.classList.add('visible');
                const inp = document.getElementById('lock-password-input');
                if (inp) {
                    inp.value = '••••••••••';
                    inp.focus();
                }
            }
        }"""
    )
    page.wait_for_timeout(400)
    screenshot(page, SHOTS_DIR / "encryption.png")
    ctx.close()


def shot_pdf(browser):
    print("[5/6] pdf.png")
    ctx = browser.new_context(viewport=DESKTOP, device_scale_factor=1)
    page = ctx.new_page()
    page.goto(URL)
    wait_ready(page)
    open_note(page, MARKDOWN_NOTE_ID)
    page.wait_for_timeout(800)
    # Click PDF button — for markdown notes this shows the
    # "Export Markdown to PDF" choice dialog (the NoirPad-specific UI,
    # nicer for a screenshot than the browser's print dialog).
    page.evaluate(
        """() => {
            const btn = document.getElementById('btn-print');
            if (btn) btn.click();
        }"""
    )
    page.wait_for_timeout(800)
    screenshot(page, SHOTS_DIR / "pdf.png")
    ctx.close()


def shot_mobile(browser):
    print("[6/6] mobile.png")
    ctx = browser.new_context(
        viewport=MOBILE,
        device_scale_factor=2,
        is_mobile=True,
        has_touch=True,
    )
    page = ctx.new_page()
    page.goto(URL)
    wait_ready(page)
    open_note(page, MARKDOWN_NOTE_ID)
    page.wait_for_timeout(800)
    # Open the slide-out sidebar via hamburger to show the mobile chrome.
    page.evaluate(
        """() => {
            const h = document.getElementById('btn-hamburger');
            if (h) h.click();
        }"""
    )
    page.wait_for_timeout(600)
    screenshot(page, SHOTS_DIR / "mobile.png")
    ctx.close()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    # 1. Back up + seed demo data
    if not BACKUP_FILE.exists():
        shutil.copy2(DATA_FILE, BACKUP_FILE)
        print(f"backed up notes_data.json -> {BACKUP_FILE.name}")
    DATA_FILE.write_text(
        json.dumps(demo_data(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print("seeded demo notes_data.json")

    server = None
    try:
        # 2. Start server
        print("starting server...")
        server = start_server()
        print("server up")

        # 3. Run Playwright capture
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                shot_welcome(browser)
                shot_markdown(browser)
                shot_themes(browser)
                shot_encryption(browser)
                shot_pdf(browser)
                shot_mobile(browser)
            finally:
                browser.close()
    finally:
        if server is not None:
            print("stopping server...")
            stop_server(server)
        # 4. Restore original data
        if BACKUP_FILE.exists():
            shutil.copy2(BACKUP_FILE, DATA_FILE)
            BACKUP_FILE.unlink()
            print("restored original notes_data.json")

    print("done.")


if __name__ == "__main__":
    main()

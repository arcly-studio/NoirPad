"""Capture the README screenshots into docs/screenshots/ from DEMO data.

Starts NoirPad-web.py on a free port with NOIRPAD_DATA_DIR pointing at a
fresh temp directory seeded by tools/demo_data.py — real notes are never
read or touched. Dev-only requirement (not in requirements*.txt):

    .venv\\Scripts\\pip install playwright
    .venv\\Scripts\\python -m playwright install chromium
    .venv\\Scripts\\python tools/take_screenshots.py [--lang en|cs]
"""

import argparse
import base64
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import Error as PlaywrightError, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

import demo_data  # noqa: E402

SHOTS_DIR = ROOT / "docs" / "screenshots"
DESKTOP = {"width": 1440, "height": 900}
MOBILE = {"width": 414, "height": 820}
THEMES = ["matrix", "amber", "dracula", "tokyo-night"]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_server(data_dir: Path, port: int) -> subprocess.Popen:
    env = dict(os.environ, NOIRPAD_DATA_DIR=str(data_dir), NOIRPAD_PORT=str(port))
    env.pop("NOIRPAD_PASSWORD", None)
    proc = subprocess.Popen([sys.executable, "NoirPad-web.py"], cwd=str(ROOT), env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.time() + 30
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1).read()
            return proc
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            time.sleep(0.3)
    proc.kill()
    raise RuntimeError("Server did not come up within 30 seconds")


class Shooter:
    def __init__(self, browser, url: str, lang: str):
        self.browser, self.url, self.lang = browser, url, lang

    def page(self, viewport=DESKTOP, **ctx_opts):
        ctx = self.browser.new_context(viewport=viewport, locale=self.lang, **ctx_opts)
        page = ctx.new_page()
        page.goto(self.url)
        page.wait_for_function(
            "() => window.NP && NP.state && NP.state.data"
            " && !document.getElementById('splash-overlay')", timeout=15_000)
        page.wait_for_timeout(400)
        return page

    @staticmethod
    def open_note(page, note_id: str) -> None:
        """Expand ancestor folders, then click the note's tree row."""
        page.evaluate("""(id) => {
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
            for (const fid of path(NP.state.data.tree, id, []) || [])
                NP.state.setFolderOpenState(fid, true);
            NP.tree.render();
            const row = document.querySelector(`#tree-container .tree-item[data-id='${id}']`);
            if (row) row.click();
        }""", note_id)
        page.wait_for_timeout(1200)

    @staticmethod
    def save(page, name: str) -> Path:
        path = SHOTS_DIR / name
        page.screenshot(path=str(path))
        print(f"  -> {path.relative_to(ROOT)}")
        return path

    def welcome(self):
        page = self.page()
        self.open_note(page, demo_data.WELCOME_ID)
        self.save(page, "welcome.png")
        page.context.close()

    def markdown(self):
        page = self.page()
        self.open_note(page, demo_data.MARKDOWN_ID)
        self.save(page, "markdown.png")
        page.context.close()

    def themes(self):
        page = self.page()
        self.open_note(page, demo_data.MARKDOWN_ID)
        tiles = []
        for theme in THEMES:
            page.evaluate("(t) => NP.themes.apply(t)", theme)
            page.wait_for_timeout(700)
            tiles.append(base64.b64encode(page.screenshot()).decode())
        page.evaluate("() => NP.themes.apply('matrix')")
        page.context.close()
        # 2×2 composite, rendered by the browser itself (no Pillow needed).
        w, h = DESKTOP["width"] // 2, DESKTOP["height"] // 2
        imgs = "".join(f'<img src="data:image/png;base64,{t}" width="{w}" height="{h}">'
                       for t in tiles)
        grid = self.browser.new_page(viewport={"width": w * 2 + 12, "height": h * 2 + 12})
        grid.set_content(
            "<body style='margin:0;background:#000;display:grid;"
            f"grid-template-columns:{w}px {w}px;gap:12px'>{imgs}</body>")
        self.save(grid, "themes.png")
        grid.close()

    def encryption(self):
        page = self.page()
        self.open_note(page, demo_data.SECRET_ID)   # asks for the password
        if page.locator("#np-pw-1").count():
            page.fill("#np-pw-1", "demo-password")   # rendered as dots
        self.save(page, "encryption.png")
        page.context.close()

    def pdf(self):
        page = self.page()
        self.open_note(page, demo_data.MARKDOWN_ID)
        page.click("#btn-print")   # markdown notes show NoirPad's own export dialog
        page.wait_for_timeout(800)
        self.save(page, "pdf.png")
        page.context.close()

    def mobile(self):
        page = self.page(MOBILE, device_scale_factor=2, is_mobile=True, has_touch=True)
        self.open_note(page, demo_data.MARKDOWN_ID)
        page.click("#btn-hamburger")
        page.wait_for_timeout(600)
        self.save(page, "mobile.png")
        page.context.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lang", default="en", help="UI language (browser locale)")
    args = parser.parse_args()

    SHOTS_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="noirpad-shots-") as tmp:
        data_dir = Path(tmp)
        demo_data.write_demo(data_dir)
        port = free_port()
        server = start_server(data_dir, port)
        try:
            with sync_playwright() as p:
                try:
                    browser = p.chromium.launch(headless=True)
                except PlaywrightError:   # bundled Chromium missing → installed Chrome
                    browser = p.chromium.launch(headless=True, channel="chrome")
                try:
                    shooter = Shooter(browser, f"http://127.0.0.1:{port}/", args.lang)
                    for step in ("welcome", "markdown", "themes", "encryption", "pdf", "mobile"):
                        print(step)
                        getattr(shooter, step)()
                finally:
                    browser.close()
        finally:
            server.terminate()
            server.wait(timeout=10)


if __name__ == "__main__":
    main()

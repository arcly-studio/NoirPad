"""Demo dataset for screenshots and manual testing — never real notes.

    python tools/demo_data.py <empty-dir>     # writes <dir>/notes_data.json

Then e.g. `set NOIRPAD_DATA_DIR=<dir>` and run NoirPad. The locked note's
password is DEMO_PASSWORD.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from noirpad.crypto import encrypt_content  # noqa: E402

DEMO_PASSWORD = "demo-password"

WELCOME_ID = "11111111-1111-4111-8111-000000000001"
MARKDOWN_ID = "11111111-1111-4111-8111-000000000002"
API_ID = "11111111-1111-4111-8111-000000000003"
SHOPPING_ID = "11111111-1111-4111-8111-000000000004"
SECRET_ID = "11111111-1111-4111-8111-000000000005"
PROJECTS_ID = "11111111-1111-4111-8111-0000000000f1"
PERSONAL_ID = "11111111-1111-4111-8111-0000000000f2"

WELCOME = """# Welcome to NoirPad

Your notes stay **on this PC** — no account, no cloud, no telemetry.

- Folders and tags in the sidebar
- Markdown with live preview (`Ctrl+M`)
- Lock a note with a password (`Ctrl+Shift+L`)
- 17 themes in Settings

> Tip: `Ctrl+Shift+P` opens the command bar, `F1` the help.
"""

MARKDOWN = """# Markdown demo

## Code

```python
from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def root():
    return {"hello": "noirpad"}
```

```javascript
// vanilla JS, no build step
document.querySelectorAll(".note").forEach(n => n.classList.add("glow"));
```

## Table

| Shortcut | Action |
|----------|--------|
| Ctrl+S   | Save   |
| Ctrl+F   | Find   |

## Checklist

- [x] Markdown rendering
- [x] Syntax highlighting
- [ ] Conquer the world
"""

API = """# API notes

```bash
curl -s http://127.0.0.1:8000/api/version
```

```sql
SELECT title, updated_at FROM notes ORDER BY updated_at DESC LIMIT 10;
```
"""

SHOPPING = """# Groceries

- [ ] coffee beans
- [ ] oat milk
- [x] dark chocolate
"""

SECRET = """Secret diary — March 5.

The investor meeting went well. This note is encrypted with a password."""


def build_demo_data() -> dict:
    return {
        "tree": [
            {"id": WELCOME_ID, "name": "Welcome", "type": "note", "tags": ["intro"]},
            {"id": PROJECTS_ID, "name": "Projects", "type": "folder", "children": [
                {"id": MARKDOWN_ID, "name": "Markdown demo", "type": "note",
                 "tags": ["markdown", "demo"]},
                {"id": API_ID, "name": "API notes", "type": "note", "tags": ["code"]},
            ]},
            {"id": PERSONAL_ID, "name": "Personal", "type": "folder", "children": [
                {"id": SHOPPING_ID, "name": "Groceries", "type": "note", "tags": ["todo"]},
                {"id": SECRET_ID, "name": "Secret diary", "type": "note", "tags": ["private"]},
            ]},
        ],
        "notes": {
            WELCOME_ID: WELCOME,
            MARKDOWN_ID: MARKDOWN,
            API_ID: API,
            SHOPPING_ID: SHOPPING,
            SECRET_ID: encrypt_content(SECRET, DEMO_PASSWORD),
        },
        "note_modes": {nid: "markdown" for nid in (WELCOME_ID, MARKDOWN_ID, API_ID, SHOPPING_ID)},
        "favorites": [MARKDOWN_ID],
        "trash": {"tree": [], "notes": {}},
        "note_formats": {},
        "note_images": {},
        "theme": "matrix",
        "font_size": 14,
        "matrix_rain_enabled": False,
        "show_splash": False,
        "glitch_effect": False,
        "spellcheck": False,
    }


def write_demo(data_dir: Path) -> Path:
    data_dir.mkdir(parents=True, exist_ok=True)
    target = data_dir / "notes_data.json"
    if target.exists():
        raise SystemExit(f"{target} already exists — use an empty directory")
    target.write_text(json.dumps(build_demo_data(), ensure_ascii=False, indent=2),
                      encoding="utf-8")
    return target


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    print(write_demo(Path(sys.argv[1])))

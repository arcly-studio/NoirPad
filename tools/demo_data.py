"""Demo dataset for screenshots, the README GIF and manual testing — never real notes.

    python tools/demo_data.py <empty-dir> [--lang en|cs]

writes <dir>/notes_data.json and <dir>/images/. Then e.g.
`set NOIRPAD_DATA_DIR=<dir>` and run NoirPad. The locked note's password is
DEMO_PASSWORD. tools/take_screenshots.py uses this to regenerate
docs/screenshots/ and docs/demo.gif at any time.
"""

import json
import math
import struct
import sys
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from noirpad.crypto import encrypt_content  # noqa: E402

DEMO_PASSWORD = "demo-password"


def _id(n: int) -> str:
    return f"11111111-1111-4111-8111-{n:012x}"


# Folders
PROJECTS_ID, JOURNAL_ID, SNIPPETS_ID, IDEAS_ID = _id(0xF1), _id(0xF2), _id(0xF3), _id(0xF4)
# Notes
WELCOME_ID = _id(1)
TOUR_ID = _id(2)          # hero: Markdown with code
CHECKLIST_ID = _id(3)     # split preview: table + tasks
API_ID = _id(4)
ROADMAP_ID = _id(5)
REVIEW_ID = _id(6)        # has the image
READING_ID = _id(7)
SECRET_ID = _id(8)        # locked
CSV_ID = _id(9)
SQL_ID = _id(10)
DEBOUNCE_ID = _id(11)
SIDE_ID = _id(12)
TRIP_ID = _id(13)
PHOTO_ID = _id(14)        # hero: a rich-text note with a picture

PHOTO_IMAGE = "22222222-2222-4222-8222-000000000002.png"

CHART_IMAGE = "22222222-2222-4222-8222-000000000001.png"

NOTES = {
    WELCOME_ID: """# Welcome to NoirPad

Your notes stay **on this PC** — no account, no cloud, no telemetry.

- Folders, tags and favorites in the sidebar
- Markdown with a live preview (`Ctrl+M`)
- Lock a note with its own password (`Ctrl+Shift+L`)
- 17 themes in Settings

> Tip: `Ctrl+Shift+P` opens the command bar, `F1` the help.
""",
    TOUR_ID: """# Ingest service — notes

The nightly job pulls the export, cleans it and loads it into Postgres.

## Retry with backoff

```python
import time
from functools import wraps

def retry(times=3, delay=0.5):
    def deco(fn):
        @wraps(fn)
        def run(*args, **kw):
            for n in range(times - 1):
                try:
                    return fn(*args, **kw)
                except OSError:
                    time.sleep(delay * 2**n)
            return fn(*args, **kw)
        return run
    return deco
```

## Open questions

- [x] Move the job to 02:00
- [ ] Alert when a run takes > 10 min
- [ ] Archive raw exports after 30 days

> Keep the loader idempotent — re-running a day must never duplicate rows.
""",
    CHECKLIST_ID: """# Release checklist — v2.4

| Step | Owner | Status |
|------|-------|--------|
| Freeze `main` | Anna | done |
| Run the full test suite | CI | done |
| Update the changelog | Tom | in review |
| Build and sign | Anna | waiting |

```python
VERSION = "2.4"
if run_tests() != 0:
    raise SystemExit("tests must pass")
tag(f"v{VERSION}", message="Release 2.4")
```

## Before tagging

- [x] Version bumped in `pyproject.toml`
- [x] Migration tested on a copy of production
- [ ] Release notes proofread
- [ ] Rollback plan written down

## After release

1. Watch error rates for an hour
2. Close the milestone
3. Post the announcement
""",
    API_ID: """# API notes

```bash
curl -s http://127.0.0.1:8000/api/health | jq .
```

```sql
SELECT title, updated_at
FROM notes
WHERE archived = false
ORDER BY updated_at DESC
LIMIT 10;
```

Rate limit: **60 requests / minute** per token.
""",
    ROADMAP_ID: """# Roadmap

## Now
- [x] Offline mode
- [ ] Faster search over large notebooks

## Next
- [ ] Import from plain-text folders
- [ ] Per-folder default theme

## Later
- Sync between two PCs over the local network (maybe)
""",
    REVIEW_ID: f"""# Weekly review — week 41

Notes written per day:

![Notes written per day, week 41](/images/{CHART_IMAGE})

**Went well:** shipped the importer, inbox at zero on Friday.
**To improve:** fewer meetings on Tuesday.

- [x] Plan next week
- [ ] Clean up the downloads folder
""",
    READING_ID: """# Reading list

- [x] *The Pragmatic Programmer* — Hunt & Thomas
- [ ] *Designing Data-Intensive Applications* — Kleppmann
- [ ] *A Philosophy of Software Design* — Ousterhout

> "Complexity is anything related to the structure of a software system
> that makes it hard to understand and modify." — Ousterhout
""",
    CSV_ID: """# Python: read a CSV into dicts

```python
import csv
from pathlib import Path

def load_rows(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))

rows = load_rows(Path("export.csv"))
print(f"{len(rows)} rows, columns: {', '.join(rows[0])}")
```
""",
    SQL_ID: """# SQL: weekly report

```sql
SELECT date_trunc('week', created_at) AS week,
       count(*)                       AS notes,
       count(*) FILTER (WHERE locked) AS locked
FROM notes
GROUP BY 1
ORDER BY 1 DESC
LIMIT 8;
```
""",
    DEBOUNCE_ID: """# JavaScript: debounce

```javascript
export function debounce(fn, ms = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

window.addEventListener("resize", debounce(() => layout(), 150));
```
""",
    SIDE_ID: """# Side projects

- **Plant watering reminder** — ESP32 + soil sensor, sends a message when dry
- **Recipe scaler** — paste a recipe, change servings, units convert
- **Bookshelf scanner** — photo of a shelf → list of titles

> Pick one. Finish it.
""",
    TRIP_ID: """# Weekend in the mountains

- [x] Book the cabin
- [ ] Check the weather on Thursday
- [ ] Pack: headlamp, rain jacket, thermos

Trail: 14 km, 900 m up. Start before 8:00.
""",
}

# A rich-text note: plain text + format runs ("line.col" positions).
PHOTO = f"""Trip to the Tatras

Three days, two huts and one very cold lake.

<<IMG:{PHOTO_IMAGE}|w=520>>

Day 1 – Štrbské Pleso to Popradské pleso, 12 km
Day 2 – Rysy (2,499 m), start at 6:00
Day 3 – down to Hrebienok, lunch, train home

Packing: headlamp, rain jacket, thermos, plasters."""
PHOTO_FORMATS = [
    {"start": "1.0", "end": "1.18", "size": 24},
    {"start": "3.0", "end": "3.44", "italic": True},
    {"start": "11.0", "end": "11.8", "underline": True},
]

SECRET = """# Journal — private

The interview went better than expected. They want a second round next week.
Do not forget to ask about the remote days."""

TREE = [
    {"id": WELCOME_ID, "name": "Welcome", "type": "note", "tags": ["intro"]},
    {"id": PROJECTS_ID, "name": "Projects", "type": "folder", "children": [
        {"id": TOUR_ID, "name": "Ingest service", "type": "note", "tags": ["python", "work"]},
        {"id": CHECKLIST_ID, "name": "Release checklist", "type": "note", "tags": ["work", "todo"]},
        {"id": API_ID, "name": "API notes", "type": "note", "tags": ["api"]},
        {"id": ROADMAP_ID, "name": "Roadmap", "type": "note", "tags": ["planning"]},
    ]},
    {"id": JOURNAL_ID, "name": "Journal", "type": "folder", "children": [
        {"id": PHOTO_ID, "name": "Tatras trip", "type": "note", "tags": ["travel"]},
        {"id": REVIEW_ID, "name": "Weekly review", "type": "note", "tags": ["review"]},
        {"id": READING_ID, "name": "Reading list", "type": "note", "tags": ["books"]},
        {"id": SECRET_ID, "name": "Private journal", "type": "note", "tags": ["private"]},
    ]},
    {"id": SNIPPETS_ID, "name": "Snippets", "type": "folder", "children": [
        {"id": CSV_ID, "name": "Python: CSV to dicts", "type": "note", "tags": ["python"]},
        {"id": SQL_ID, "name": "SQL: weekly report", "type": "note", "tags": ["sql"]},
        {"id": DEBOUNCE_ID, "name": "JavaScript: debounce", "type": "note", "tags": ["js"]},
    ]},
    {"id": IDEAS_ID, "name": "Ideas", "type": "folder", "children": [
        {"id": SIDE_ID, "name": "Side projects", "type": "note", "tags": ["ideas"]},
        {"id": TRIP_ID, "name": "Weekend trip", "type": "note", "tags": ["personal"]},
    ]},
]


def chart_png(width: int = 720, height: int = 300) -> bytes:
    """A small bar chart as PNG, drawn pixel by pixel (no Pillow needed)."""
    bg, grid, bar, peak = (17, 19, 24), (40, 44, 52), (74, 148, 255), (130, 184, 255)
    values = [4, 7, 5, 9, 6, 3, 8]
    px = [[bg] * width for _ in range(height)]
    left, bottom, top = 40, height - 30, 20
    for gy in range(bottom, top - 1, -(bottom - top) // 4):
        for x in range(left, width - 20):
            px[gy][x] = grid
    slot = (width - 20 - left) // len(values)
    for i, v in enumerate(values):
        h = int((bottom - top) * v / max(values))
        x0 = left + i * slot + slot // 5
        for y in range(bottom - h, bottom):
            for x in range(x0, x0 + slot * 3 // 5):
                px[y][x] = peak if v == max(values) else bar
    raw = b"".join(b"\x00" + bytes(c for p in row for c in p) for row in px)

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def photo_png(width: int = 720, height: int = 400) -> bytes:
    """A small landscape (sky, two mountain ridges, a lake), drawn pixel by
    pixel so the demo needs no image files or Pillow."""
    def lerp(a, b, f):
        return tuple(round(x + (y - x) * f) for x, y in zip(a, b))

    sky_top, sky_low = (28, 44, 92), (236, 156, 104)
    far, near = (92, 82, 120), (38, 40, 62)
    lake_hi, lake_lo = (120, 110, 150), (24, 32, 58)
    horizon = int(height * 0.68)
    rows = []
    for y in range(height):
        row = []
        for x in range(width):
            far_ridge = (horizon - 105 - 55 * math.sin(x / 61) - 22 * math.sin(x / 19 + 1)
                         - 9 * math.sin(x / 7 + 2))
            near_ridge = horizon - 28 - 22 * math.sin(x / 43 + 2) - 8 * math.sin(x / 13)
            if y >= horizon:                       # lake, reflecting the sky
                f = (y - horizon) / (height - horizon)
                px = lerp(lake_hi, lake_lo, f)
                if (y + x // 9) % 11 == 0:
                    px = lerp(px, (250, 200, 150), 0.35)
            elif y >= near_ridge:
                px = near
            elif y >= far_ridge:
                px = lerp(far, sky_low, 0.15)
            else:
                px = lerp(sky_top, sky_low, y / horizon)
                if (x - 560) ** 2 + (y - horizon + 70) ** 2 < 26 ** 2:   # low sun
                    px = (255, 214, 150)
            row.append(px)
        rows.append(row)
    return _png(rows)


def _png(rows) -> bytes:
    height, width = len(rows), len(rows[0])
    raw = b"".join(b"\x00" + bytes(c for p in row for c in p) for row in rows)

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def build_demo_data(lang: str = "en") -> dict:
    notes = dict(NOTES)
    notes[PHOTO_ID] = PHOTO
    notes[SECRET_ID] = encrypt_content(SECRET, DEMO_PASSWORD)
    return {
        "tree": json.loads(json.dumps(TREE)),
        "notes": notes,
        "note_modes": {nid: "markdown" for nid in NOTES if nid != TRIP_ID},
        "favorites": [TOUR_ID, CHECKLIST_ID],
        "trash": {"tree": [], "notes": {}},
        "note_formats": {PHOTO_ID: PHOTO_FORMATS},
        "note_images": {REVIEW_ID: [CHART_IMAGE], PHOTO_ID: [PHOTO_IMAGE]},
        "theme": "matrix",
        "language": lang,
        "font_size": 13,
        "matrix_rain_enabled": False,
        "show_splash": False,
        "glitch_effect": False,
        "spellcheck": False,
    }


def write_demo(data_dir: Path, lang: str = "en") -> Path:
    data_dir.mkdir(parents=True, exist_ok=True)
    target = data_dir / "notes_data.json"
    if target.exists():
        raise SystemExit(f"{target} already exists — use an empty directory")
    images = data_dir / "images"
    images.mkdir(exist_ok=True)
    (images / CHART_IMAGE).write_bytes(chart_png())
    (images / PHOTO_IMAGE).write_bytes(photo_png())
    target.write_text(json.dumps(build_demo_data(lang), ensure_ascii=False, indent=2),
                      encoding="utf-8")
    return target


if __name__ == "__main__":
    args = sys.argv[1:]
    lang = "en"
    if "--lang" in args:
        i = args.index("--lang")
        lang = args[i + 1]
        del args[i:i + 2]
    if len(args) != 1:
        raise SystemExit(__doc__)
    print(write_demo(Path(args[0]), lang))

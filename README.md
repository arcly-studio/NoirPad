**English** | [Čeština](README.cs.md)

# 🌃 NoirPad

> Hacker-aesthetic note-taking app with a terminal vibe — Markdown, syntax highlighting, encryption, and 17 themes. FastAPI backend + vanilla JS frontend, no build step.

[![Python](https://img.shields.io/badge/Python-3.9+-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-2.0-brightgreen.svg)](#)

NoirPad is a local, single-user, desktop-style note app inspired by terminal aesthetics. It pairs a clean FastAPI backend with a vanilla-JS frontend (zero build step) so you can clone, install, and run it in under a minute. Notes live in a single JSON file next to the app — no database, no cloud, no telemetry.

## 📸 Screenshots

| Welcome Screen | Markdown + Syntax Highlighting |
|:---:|:---:|
| ![Welcome](docs/screenshots/welcome.png) | ![Markdown](docs/screenshots/markdown.png) |

| Themes | Encryption |
|:---:|:---:|
| ![Themes](docs/screenshots/themes.png) | ![Encryption](docs/screenshots/encryption.png) |

| PDF Export | Mobile View |
|:---:|:---:|
| ![PDF](docs/screenshots/pdf.png) | ![Mobile](docs/screenshots/mobile.png) |

## ✨ Features

### 📁 Notes & Structure
- Hierarchical folders + notes with drag & drop
- Multi-tab editor (multiple notes open at once)
- Per-note mode: rich-text or markdown
- Auto-save (5s / 30s / 1m / 5m interval)

### ✍️ Markdown
- Split-pane editor — raw source on the left, rendered preview on the right
- Block-level rendering: H1-H3, blockquotes, lists, code blocks
- **Shiki syntax highlighting** with automatic language detection
- Markdown keyboard shortcuts (toggle with `Ctrl+M`)

### 🔒 Encryption
- Per-note password encryption (Fernet + PBKDF2HMAC)
- Default-encrypted option for new notes
- Auto-lock after inactivity (5 / 30 / 60 min)

### 🏷️ Organization
- Tags (multi-tag per note)
- Favorites (star marking)
- Trash (soft-delete + restore)

### 🔍 Search
- In-note find & replace (`Ctrl+F`)
- Global full-text search across all notes
- Command bar (`Ctrl+Shift+P`) with fuzzy search

### 📤 Export / Import
- Per-note: TXT, HTML, PDF (via browser print)
- Whole-app: ZIP backup (data + images)

### 🖼️ Images
- Paste / drag-drop / `+Img` button
- `Ctrl`+wheel resize inline

### 🎨 Appearance
- **17 themes**: matrix, amber, cyan, red, purple, blue, pink, white, gold, lime, orange, ice, dracula, synthwave, nord, gruvbox, tokyo-night
- UI font: Orbitron, Space Grotesk, Outfit, Unbounded, Inter, JetBrains Mono, system
- Editor font + size picker
- Glow intensity slider (0-150%)
- CRT scanline overlay (toggle)
- Matrix rain background (toggle)
- Glitch typing effect (toggle)
- ASCII splash screen (toggle)
- Page orientation: portrait / landscape

### ⌨️ UX & Shortcuts
- Customizable keyboard shortcuts (rebind any action)
- Built-in help (`F1`)
- Focus mode (`Ctrl+B` — hide sidebar)
- Spellcheck toggle
- Confirm-before-delete option

### 📱 Mobile Layout
- Responsive (≤ 900px breakpoint)
- Slide-out sidebar with hamburger toggle
- Touch-friendly tap targets

## 🛠️ Tech Stack

- **Backend:** Python 3.9+ — FastAPI, Uvicorn, Pydantic, cryptography, python-multipart
- **Frontend:** Vanilla JavaScript (33 modules, no build step, `window.NP` namespace), HTML, CSS
- **Storage:** Flat-file JSON (`notes_data.json`) — no database
- **Encryption:** Fernet (AES-128-CBC + HMAC-SHA256) with PBKDF2HMAC key derivation
- **Syntax highlighting:** Shiki (loaded via CDN) + `vscode-languagedetection`

## 📦 Installation

```bash
# 1. Clone the repo
git clone https://github.com/krystof2-ops/NoirPad-web.git
cd NoirPad-web

# 2. (Recommended) Create a virtual environment
python -m venv .venv
source .venv/bin/activate          # Linux / macOS
.venv\Scripts\activate             # Windows

# 3. Install dependencies
pip install -r requirements.txt
```

## 🚀 Usage

```bash
# Standalone — preferred for daily use
python NoirPad-web.py

# Development — with auto-reload on file changes
python -m uvicorn NoirPad-web:app --reload --host 127.0.0.1 --port 8000
```

Then open **http://127.0.0.1:8000** in your browser.

> The server binds to `127.0.0.1` (loopback) on purpose — NoirPad is a single-user local app with no authentication. See [Security Note](#-security-note).

## 📂 Project Structure

```
NoirPad-web/
├── NoirPad-web.py          # FastAPI backend (single file)
├── requirements.txt
├── notes_data.json         # Your notes (created on first run)
├── images/                 # Embedded images (UUID-named)
└── static/
    ├── index.html          # Single-page UI
    ├── css/
    │   ├── noirpad.css     # Main stylesheet
    │   └── themes.css      # 17 theme color tokens
    └── js/                 # 33 frontend modules
        ├── app.js          # bootstrap
        ├── api.js          # HTTP client
        ├── editor.js       # rich-text editor
        ├── markdown.js     # split-pane preview
        ├── encryption.js   # password prompt UI
        └── ...             # (28 more)
```

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+S` | Save current note |
| `Ctrl+F` | Find / replace in note |
| `Ctrl+M` | Toggle Markdown mode |
| `Ctrl+B` | Focus mode (hide sidebar) |
| `Ctrl+P` | Export current note to PDF |
| `Ctrl+Shift+P` | Command palette |
| `F1` | Open help |
| `Escape` | Close dialog / cancel |

All shortcuts are customizable in **Settings → Keyboard shortcuts**.

## 🔐 Security Note

NoirPad is designed as a **local, single-user desktop-style app**:

- The server only listens on **127.0.0.1** (localhost) — it is not reachable from other machines on your network.
- **No authentication.** Anyone with access to your machine has access to the notes.
- For sensitive content, use **per-note password encryption** (Lock button or `default_encrypted` setting). Encrypted notes use Fernet (AES-128-CBC + HMAC-SHA256) with PBKDF2HMAC key derivation; the server never stores your password.
- **What is NOT encrypted:** only the note's text is encrypted. Its **title, tags and images** (files in the `images/` folder) are stored unencrypted.
- **A forgotten password cannot be recovered.** The note can never be opened again.
- The password is sent to the local backend once, when you lock or unlock a note. The backend keeps the derived key in memory only and forgets it when you leave the note, on auto-lock or when NoirPad exits; it is never written to disk.
- Auto-lock can be enabled to re-prompt for the password after 5 / 30 / 60 minutes of inactivity.
- File-level safety: atomic writes via `.tmp` swap, automatic `.bak` snapshot before every write, recovery from backup if the data file is corrupt.
- Upload limits: images 10 MB, backup ZIPs 100 MB. Path-traversal and zip-slip protection are enforced on every upload.

> If you want to expose NoirPad on a network, you **must** add authentication first.

## 🤝 Contributing

Pull requests are welcome. For larger changes, please open an issue first to discuss what you'd like to change.

When contributing:
1. Keep the no-build, no-bundle philosophy (vanilla JS, single Python file).
2. Match the existing code style (no framework, plain DOM APIs, `window.NP.*` namespacing).
3. Test against the `matrix`, `dracula`, and `tokyo-night` themes — they exercise different color systems.

## 📜 License

[MIT](LICENSE) © 2025 krystof2-ops

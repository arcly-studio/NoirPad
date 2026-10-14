**English** | [Čeština](README.cs.md)

<p align="center"><img src="docs/logo.png" width="128" height="128" alt="NoirPad logo"></p>

# NoirPad

A terminal-styled note app for Windows with Markdown, password-locked notes and 17 themes.

[![Release](https://img.shields.io/github/v/release/krystof2-ops/NoirPad?include_prereleases)](https://github.com/krystof2-ops/NoirPad/releases)
[![Tests](https://github.com/krystof2-ops/NoirPad/actions/workflows/test.yml/badge.svg)](https://github.com/krystof2-ops/NoirPad/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

![NoirPad with a Markdown note](docs/screenshots/markdown.png)

**No account, no cloud, no telemetry — your notes stay on your PC.**
NoirPad makes no network requests of its own: fonts, Markdown renderer and code highlighter are
bundled. The only links that leave the app are the ones you click.

| Welcome | Themes | Locked note |
|:---:|:---:|:---:|
| ![Welcome](docs/screenshots/welcome.png) | ![Themes](docs/screenshots/themes.png) | ![Locked note](docs/screenshots/encryption.png) |

## Features

- **Notes and folders** — tree with drag & drop, tabs, tags, favorites, trash with restore.
- **Two editing modes per note** — rich text, or Markdown with a live preview, tables, task lists
  and syntax-highlighted code blocks.
- **Locked notes** — encrypt a single note with its own password (details below).
- **App lock** (optional) — ask for a password whenever NoirPad starts or after inactivity.
- **Search** — find in the note, search across all notes, command bar (`Ctrl+Shift+P`).
- **Images** — paste, drag & drop or insert; zoom with `Ctrl`+wheel.
- **Export** — a note as TXT, HTML or PDF; everything as Markdown files or HTML in a ZIP. The
  desktop app asks where to save (“Save as”) and then offers *Open folder*.
- **Import** — Markdown files or a ZIP of them (adds notes, never deletes).
- **Look** — 17 themes, UI and editor fonts, glow, CRT scanlines, Matrix rain, focus mode.
- **Keyboard first** — every shortcut can be remapped; built-in help with `F1`.
- **English and Czech UI** — starts in the language you chose in the installer, switchable in
  Settings.

## Download

Get **`NoirPad-Setup-<version>.exe`** from **[Releases](https://github.com/krystof2-ops/NoirPad/releases)**.
It installs for your user only (no admin rights) into `%LOCALAPPDATA%\Programs\NoirPad`.

NoirPad needs the Microsoft Edge **WebView2 Runtime**. Windows 11 has it; on older systems the
installer offers to download it from Microsoft.

**Windows SmartScreen:** the installer is not code-signed, so Windows may show “Windows protected
your PC”. Click **More info → Run anyway**. To be sure the file is the one published here, compare
its SHA-256 with the `.sha256` file next to it in the release:

```powershell
Get-FileHash .\NoirPad-Setup-1.0.0.exe -Algorithm SHA256
```

## Your data

| What | Where |
|---|---|
| Notes, settings | `%LOCALAPPDATA%\NoirPad\notes_data.json` |
| Images | `%LOCALAPPDATA%\NoirPad\images\` |
| Automatic snapshots | `%LOCALAPPDATA%\NoirPad\backups\` — the last 7, at most one per 10 minutes, plus a copy before every backup import |
| Log | `%LOCALAPPDATA%\NoirPad\logs\noirpad.log` — start-up and errors, never note content |

Paste `%LOCALAPPDATA%\NoirPad` into the Explorer address bar to open the folder. Uninstalling
removes the program folder (`%LOCALAPPDATA%\Programs\NoirPad`) completely and asks whether to delete
your data folder too (default: keep it).

- **Backup:** Settings → Data → *Download backup* saves a ZIP with all notes and images.
  *Import backup* **replaces** all notes with the ZIP's content (a safety copy is made first).
- **Export:** *Export all as Markdown* writes one `.md` file per note (folders become directories,
  images go to `assets/`); *Export all as HTML* does the same as readable web pages.
  Locked notes are skipped — the app tells you how many.
- If `notes_data.json` ever gets damaged, NoirPad keeps the damaged file, restores the newest good
  snapshot and tells you.

## Encryption and the app lock

**Locked notes** (Lock button / `Ctrl+Shift+L`) are encrypted with your password:
Fernet (AES-128-CBC + HMAC-SHA256) with a key from PBKDF2-SHA256, 480 000 iterations and a random
salt per note. A password needs at least 4 characters (the same for the app lock); below 8 NoirPad
reminds you that short passwords are easy to crack.

| Encrypted | Not encrypted |
|---|---|
| the note's text | the note's **name**, its **tags** and its **folder** |
| | **images** in the note (separate files in `images\`) |
| | formatting data, favorites, settings |

- **A forgotten note password cannot be recovered.** There is no reset and no back door; the note
  stays unreadable.
- The password is sent once to NoirPad's local server to unlock; the server keeps only the derived
  key in memory while the note is open and forgets it on lock, after inactivity or on exit.
  It is never written to disk or to the log.

**The app lock is not encryption.** It keeps people from opening NoirPad (the local server refuses
every request until you unlock), but `notes_data.json` stays readable to anyone with access to your
Windows account. Only locked notes are encrypted.

*Forgot the app-lock password?* Close NoirPad, open `%LOCALAPPDATA%\NoirPad\notes_data.json` in a
text editor, delete the `"app_lock": { … }` entry (mind the commas so the JSON stays valid), save,
and start NoirPad. Your notes are untouched.

## Self-hosting (web version)

NoirPad also runs as a small web server, e.g. on a home server. You need Python 3.14.

```bash
git clone https://github.com/krystof2-ops/NoirPad.git
cd NoirPad
python -m venv .venv
.venv/bin/pip install -r requirements.txt        # Windows: .venv\Scripts\pip
NOIRPAD_PASSWORD='a long passphrase' \
NOIRPAD_ALLOWED_HOSTS=notes.example.org \
NOIRPAD_HOST=127.0.0.1 NOIRPAD_PORT=8000 \
.venv/bin/python NoirPad-web.py
```

| Variable | Meaning |
|---|---|
| `NOIRPAD_PASSWORD` | Login password. **Required** when listening on anything but localhost (the server refuses to start otherwise). |
| `NOIRPAD_ALLOWED_HOSTS` | Comma-separated host names the server answers to (protects against DNS rebinding). Localhost is always allowed. |
| `NOIRPAD_HOST`, `NOIRPAD_PORT` | Listen address, default `127.0.0.1:8000`. |
| `NOIRPAD_DATA_DIR` | Data folder, default `~/.local/share/NoirPad` (Linux) / `%LOCALAPPDATA%\NoirPad`. |
| `NOIRPAD_SECURE_COOKIES` | `1` behind HTTPS: the session cookie gets the `Secure` flag. |

**Use HTTPS.** Keep NoirPad on `127.0.0.1` and put a reverse proxy (Caddy, nginx, Traefik) in front
that terminates TLS and passes the original `Host` header. With Caddy:

```
notes.example.org {
    reverse_proxy 127.0.0.1:8000
}
```

`uvicorn noirpad.app:app` works too, but `NoirPad-web.py` adds the password check above and makes
sure only one NoirPad uses the data folder at a time.

## Building from source, tests, license

Windows build (tests → PyInstaller → Inno Setup, from a clean checkout):

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1
```

See [BUILD.md](BUILD.md) for requirements and details. Running from source:
`python desktop.py` (window) or `python NoirPad-web.py` (browser at http://127.0.0.1:8000).

Tests:

```bash
pip install -r requirements-dev.txt && python -m pytest -q    # backend
npm ci && npx vitest run                                       # frontend
```

Security issues: see [SECURITY.md](SECURITY.md). Changes: [CHANGELOG.md](CHANGELOG.md).

MIT License — see [LICENSE](LICENSE).

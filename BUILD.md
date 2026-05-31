# NoirPad — desktop build

## Run modes

| Mode | Command | What it does |
|------|---------|--------------|
| Web (existing) | `python NoirPad-web.py` | Plain FastAPI on `http://127.0.0.1:8000`. Unchanged. |
| Desktop (dev) | `python desktop.py` | Same backend on a free loopback port + pywebview window. |
| Desktop (bundled) | `dist/NoirPad/NoirPad.exe` | After `pyinstaller noirpad.spec`. |

## Data location

| Mode | `notes_data.json` + images live in |
|------|------------------------------------|
| Web / desktop dev | project directory (unchanged) |
| Frozen bundle | `%LOCALAPPDATA%\NoirPad\` (per `platformdirs.user_data_dir`) |

The bundle never writes next to the `.exe`. Frozen mode starts with an empty
data dir on first launch — there is no automatic migration from a dev install.

## Build

```powershell
pip install -r requirements.txt
pyinstaller --clean --noconfirm noirpad.spec
```

Output: `dist/NoirPad/NoirPad.exe` (one-dir layout).

The first build is intentionally console-on so errors are visible. Once it
launches cleanly, flip `CONSOLE = True` to `False` at the top of
`noirpad.spec` and rebuild for the windowed (no terminal flash) version.

### --onefile alternative

`noirpad.spec` includes a commented-out `--onefile` block. It produces a
single `NoirPad.exe` but unpacks to `%TEMP%` on every launch (slower start,
harder to debug). Default is onedir.

## Runtime requirement

The target machine needs the **WebView2 Runtime**. Windows 11 and recent
Windows 10 builds ship it with Edge; on stripped systems install it from
<https://developer.microsoft.com/microsoft-edge/webview2/>.

## Installer (Inno Setup)

`installer.iss` wraps the PyInstaller `dist\NoirPad\` output into a
per-user installer. No admin rights, no UAC prompt — installs into
`%LOCALAPPDATA%\Programs\NoirPad`.

Prereq: install **Inno Setup 6** from <https://jrsoftware.org/isdl.php>.

```powershell
# 1. Build the app first
pyinstaller --clean --noconfirm noirpad.spec

# 2. Compile the installer
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer.iss
```

Output: `dist\installer\NoirPad-Setup-<version>.exe`.

The version comes from `MyAppVersion` near the top of `installer.iss` —
bump it for each release.

### What the installer does

- Drops `NoirPad.exe` + `_internal\` together under
  `%LOCALAPPDATA%\Programs\NoirPad\` (so `python314.dll` is always findable).
- Adds a Start Menu entry; optional Desktop icon via a wizard checkbox.
- Registers an uninstaller in "Apps & features".
- Leaves user data (`%LOCALAPPDATA%\NoirPad\notes_data.json` + images)
  alone on uninstall.

## Out of scope (per spec)

Single-instance lock, auto-update, code signing — not implemented in
this pass.

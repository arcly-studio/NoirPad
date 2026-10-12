# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for NoirPad desktop.

Layout:
  * Entrypoint: desktop.py — spins up uvicorn + opens a pywebview window.
  * Backend script: NoirPad-web.py is shipped as data and loaded by
    desktop.py via importlib (its dashed filename isn't a legal module name
    for a plain import, so we let PyInstaller treat it as a resource).
  * Frontend assets: static/ is added as data and mounted at runtime via
    resource_path() inside NoirPad-web.py (which honours sys._MEIPASS).

Build (first pass — keep the console so errors are visible):
    pyinstaller --clean --noconfirm noirpad.spec

Once the .exe runs end-to-end, flip CONSOLE = False below and rebuild.
The artefact lands under dist/NoirPad/.

Optional one-file mode: replace COLLECT(...) with the EXE-bundles-everything
form (see the `--onefile` block at the bottom of this file, commented out).
Onefile is slower to start (it unpacks _MEIPASS to %TEMP% each launch) and
slightly harder to debug, so we default to onedir.

The target machine needs the WebView2 Runtime. On Windows 11 and recent
Windows 10 updates it ships with Edge by default; on stripped-down systems
install it from https://developer.microsoft.com/microsoft-edge/webview2/.
"""

from PyInstaller.utils.hooks import collect_submodules, collect_data_files

# Toggle to False for the polished build (no terminal window flashes up).
CONSOLE = False


# ---- Bundled data files ----------------------------------------------------
#
# The backend Python file lives alongside the entrypoint at runtime so
# desktop.py can importlib it from sys._MEIPASS. The frontend tree is added
# verbatim so resource_path("static") finds index.html + css/ + js/.
datas = [
    ("static", "static"),
]


# ---- Hidden imports --------------------------------------------------------
#
# desktop.py loads NoirPad-web.py with importlib.util.spec_from_file_location,
# which is invisible to PyInstaller's static analysis. We enumerate the
# transitive deps of the backend so they make it into the bundle.
hiddenimports = [
    # Core HTTP stack
    "fastapi",
    "uvicorn",
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "starlette.routing",
    "pydantic",
    # File uploads
    "multipart",
    "python_multipart",
    # Crypto: NoirPad's per-note encryption
    "cryptography",
    "_cffi_backend",
    # platformdirs is used inside get_data_dir() at runtime
    "platformdirs",
    # pywebview backend on Windows
    "webview",
    "webview.platforms.edgechromium",
    "clr_loader",
]

# Pull in uvicorn / cryptography / fastapi sub-modules wholesale —
# they all use dynamic / conditional imports that the static analyser misses.
for pkg in ("uvicorn", "fastapi", "starlette", "cryptography",
            "anyio", "h11"):
    hiddenimports += collect_submodules(pkg)

# Some packages ship data files (e.g. .pyi stubs, JSON tables); add them too
# so we don't get FileNotFoundError surprises at runtime.
for pkg in ("uvicorn", "fastapi", "starlette", "cryptography"):
    datas += collect_data_files(pkg)


# ---------------------------------------------------------------------------
# Analysis / EXE / COLLECT — standard onedir layout
# ---------------------------------------------------------------------------

a = Analysis(
    ["desktop.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="NoirPad",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=CONSOLE,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon="noirpad.ico",
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="NoirPad",
)


# ---------------------------------------------------------------------------
# Optional --onefile variant (commented out)
# ---------------------------------------------------------------------------
#
# Slower cold start (extracts to %TEMP% each run) and harder to inspect.
# To use it, comment out the EXE+COLLECT block above and uncomment below:
#
# exe = EXE(
#     pyz,
#     a.scripts,
#     a.binaries,
#     a.datas,
#     [],
#     name="NoirPad",
#     debug=False,
#     bootloader_ignore_signals=False,
#     strip=False,
#     upx=False,
#     upx_exclude=[],
#     runtime_tmpdir=None,
#     console=CONSOLE,
#     icon="noirpad.ico",
# )

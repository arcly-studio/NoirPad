"""Server settings and the modules NoirPad imports by name at run time.

Shared by desktop.py, noirpad/web.py and noirpad.spec (no imports here, so
the spec can read it without pulling in the app).

uvicorn picks its HTTP/WebSocket/lifespan/loop implementations from
strings, anyio loads its backend with import_module and pywebview loads
its Windows backend on webview.start() — PyInstaller's static analysis
can't follow any of that. ``NoirPad.exe --smoke-test`` imports every
module below from the bundle, so a build that lacks one fails (build.ps1).
"""

# Fixed choices, never "auto": "auto" imports optional packages
# (websockets, wsproto, httptools, uvloop) if they happen to be importable,
# and a half-present one crashed the first release build at start-up. NoirPad uses no
# WebSockets; the lifespan runs the image cleanup.
UVICORN_OPTIONS = {
    "http": "h11",
    "ws": "none",
    "lifespan": "on",
    "loop": "asyncio",
    "interface": "asgi3",
}

RUNTIME_IMPORTS = (
    # uvicorn, as configured by UVICORN_OPTIONS
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.lifespan.on",
    "uvicorn.loops.asyncio",
    "h11",
    # logging (uvicorn.config uses logging.config; logs.py the handlers)
    "logging.config",
    "logging.handlers",
    # starlette / fastapi: async backend, form uploads, HTTP dates
    "anyio._backends._asyncio",
    "python_multipart",
    "python_multipart.multipart",
    "email.utils",
    # per-note encryption
    "cryptography.hazmat.bindings._rust",
    "cryptography.hazmat.primitives.kdf.pbkdf2",
    "cryptography.fernet",
)

# pywebview's WebView2 backend via pythonnet; checked on Windows only.
WINDOWS_IMPORTS = (
    "clr",
    "webview.platforms.winforms",
    "webview.platforms.edgechromium",
)

"""Web/server mode: uvicorn on NOIRPAD_HOST:NOIRPAD_PORT (127.0.0.1:8000)."""

import os
import sys


def main() -> None:
    import uvicorn

    from . import storage
    from .app import app
    from .runtime import RUNTIME
    from .runtime_imports import UVICORN_OPTIONS

    host = os.environ.get("NOIRPAD_HOST", "127.0.0.1")
    port = int(os.environ.get("NOIRPAD_PORT", "8000"))
    if host not in ("127.0.0.1", "localhost", "::1") and not RUNTIME.password:
        sys.exit(
            f"Refusing to listen on {host}: set NOIRPAD_PASSWORD first, "
            "otherwise anyone on the network can read your notes."
        )
    instance_lock = storage.acquire_instance_lock()
    if instance_lock is None:
        sys.exit(
            f"NoirPad is already running with the data directory {storage.DATA_DIR} "
            "(desktop app or another web server). Close it first: two "
            "instances would overwrite each other's changes."
        )
    from .__version__ import __version__
    print(f"NoirPad {__version__} - http://{host}:{port}/  (data: {storage.DATA_DIR})")
    uvicorn.run(app, host=host, port=port, **UVICORN_OPTIONS)

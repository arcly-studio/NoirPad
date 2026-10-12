"""NoirPad web/server mode: ``python NoirPad-web.py`` → http://127.0.0.1:8000.

The backend lives in the noirpad/ package; this is only a launcher.
Environment: NOIRPAD_HOST, NOIRPAD_PORT, NOIRPAD_PASSWORD,
NOIRPAD_ALLOWED_HOSTS, NOIRPAD_DATA_DIR (see README).
"""

from noirpad.web import main

if __name__ == "__main__":
    main()

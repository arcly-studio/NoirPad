"""Process-wide mutable state (never written to disk)."""

import os
from typing import Optional

LOOPBACK_HOSTS = ("127.0.0.1", "localhost")


def env_allowed_hosts() -> set[str]:
    raw = os.environ.get("NOIRPAD_ALLOWED_HOSTS") or ""
    return {h.strip().lower() for h in raw.split(",") if h.strip()}


class _Runtime:
    mode: str = "server"
    password: Optional[str] = os.environ.get("NOIRPAD_PASSWORD") or None
    desktop_token: Optional[str] = None
    data_notice: Optional[str] = None        # shown once in the UI (D8)
    # Unlocked encrypted notes: token -> {note_id, key, salt, created, used}.
    # Keys live only here, never on disk; lost on lock, expiry or exit.
    unlocked: dict[str, dict] = {}
    allowed_hosts: set[str] = set(LOOPBACK_HOSTS) | env_allowed_hosts()
    sessions: dict[str, float] = {}       # token -> expires_at (epoch secs)
    login_failures: list[float] = []


RUNTIME = _Runtime()

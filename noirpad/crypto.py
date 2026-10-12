"""Per-note encryption envelope.

Envelope (same as the old desktop app): {"encrypted": true, "data":
base64(version(1) + salt(16) + payload)}. Version 1 = Fernet with a
PBKDF2-SHA256 key; version 2 = legacy XOR, decrypt-only.
"""

import base64
import hashlib
import json
import os

from cryptography.fernet import Fernet, InvalidToken  # noqa: F401  (re-exported)
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

PBKDF2_ITERATIONS = 480_000
MIN_NOTE_PASSWORD = 8
MAX_NOTE_PASSWORD = 1024


def derive_key(password: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt,
                     iterations=PBKDF2_ITERATIONS)
    return base64.urlsafe_b64encode(kdf.derive(password.encode()))


def encrypt_with_key(content: str, key: bytes, salt: bytes) -> str:
    """Version-1 envelope from an already derived key (no KDF cost)."""
    combined = b"\x01" + salt + Fernet(key).encrypt(content.encode("utf-8"))
    return json.dumps({"encrypted": True, "data": base64.b64encode(combined).decode("ascii")})


def _parse_envelope(stored: str) -> tuple[int, bytes, bytes]:
    obj = json.loads(stored)  # json.JSONDecodeError is a subclass of ValueError
    if not isinstance(obj, dict) or not obj.get("encrypted"):
        raise ValueError("Content is not encrypted")
    combined = base64.b64decode(obj["data"])
    return combined[0], combined[1:17], combined[17:]


def encrypt_content(content: str, password: str) -> str:
    """Encrypt with a fresh random salt (version 1)."""
    salt = os.urandom(16)
    return encrypt_with_key(content, derive_key(password, salt), salt)


def unlock_content(stored: str, password: str) -> tuple[str, bytes, bytes]:
    """Decrypt *stored* → (plaintext, key, salt) for later re-encryption.

    Raises ValueError for structurally-bad / not-encrypted / unknown-version
    input, and InvalidToken for a wrong password. A legacy version-2 note
    gets a fresh salt + version-1 key, so its next save upgrades it.
    """
    version, salt, payload = _parse_envelope(stored)
    if version == 1:
        key = derive_key(password, salt)
        return Fernet(key).decrypt(payload).decode("utf-8"), key, salt
    if version == 2:
        xor_key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100000)
        text = bytes(b ^ xor_key[i % len(xor_key)] for i, b in enumerate(payload)).decode("utf-8")
        new_salt = os.urandom(16)
        return text, derive_key(password, new_salt), new_salt
    raise ValueError("Unknown encryption version")


def decrypt_content(stored: str, password: str) -> str:
    return unlock_content(stored, password)[0]


def decrypt_with_key(stored: str, key: bytes) -> str:
    version, _salt, payload = _parse_envelope(stored)
    if version != 1:
        raise ValueError("Unknown encryption version")
    return Fernet(key).decrypt(payload).decode("utf-8")


def is_encrypted_content(content: str) -> bool:
    """True if *content* is a NoirPad encryption envelope ({"encrypted":true})."""
    try:
        obj = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        return False
    return isinstance(obj, dict) and obj.get("encrypted") is True

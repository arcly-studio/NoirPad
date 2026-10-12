"""API errors carry a stable code (+ params); the frontend writes the text.

Response body: {"detail": {"code": "note_not_found", "params": {...}}}.
static/js/api.js turns it into NP.t("errors.<code>", params), so every
code here needs an `errors.<code>` entry in static/locales/*.json.
"""

from fastapi import HTTPException


class ApiError(HTTPException):
    def __init__(self, status: int, code: str, **params):
        detail: dict = {"code": code}
        if params:
            detail["params"] = params
        super().__init__(status, detail)
        self.code = code

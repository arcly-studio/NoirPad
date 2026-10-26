"""User settings, stored at the top level of notes_data.json."""

import copy

from fastapi import APIRouter

from ..models import SettingsBody
from ..storage import DEFAULT_DATA, update_data

router = APIRouter()

SETTINGS_FIELDS: tuple[str, ...] = tuple(SettingsBody.model_fields)
KEEP_ON_RESET = {"recent_notes"}


@router.put("/api/settings")
def update_settings(body: SettingsBody):
    values = body.model_dump()   # nested models (recent_notes) as plain dicts

    def _mut(data: dict) -> None:
        for field in SETTINGS_FIELDS:
            value = values[field]
            if value is not None:
                data[field] = value

    update_data(_mut)
    return {"ok": True}


@router.post("/api/settings/reset")
def reset_settings():
    """Restore every settings field to its default. Notes are untouched, and so
    is the start page's RECENT list (a history, not a preference)."""
    def _mut(data: dict) -> None:
        for field in SETTINGS_FIELDS:
            if field in DEFAULT_DATA and field not in KEEP_ON_RESET:
                data[field] = copy.deepcopy(DEFAULT_DATA[field])

    update_data(_mut)
    return {"ok": True}

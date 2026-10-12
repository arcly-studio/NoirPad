"""User settings, stored at the top level of notes_data.json."""

import copy

from fastapi import APIRouter

from ..models import SettingsBody
from ..storage import DEFAULT_DATA, update_data

router = APIRouter()

SETTINGS_FIELDS: tuple[str, ...] = tuple(SettingsBody.model_fields)


@router.put("/api/settings")
async def update_settings(body: SettingsBody):
    def _mut(data: dict) -> None:
        for field in SETTINGS_FIELDS:
            value = getattr(body, field)
            if value is not None:
                data[field] = value

    update_data(_mut)
    return {"ok": True}


@router.post("/api/settings/reset")
async def reset_settings():
    """Restore every settings field to its default. Notes are untouched."""
    def _mut(data: dict) -> None:
        for field in SETTINGS_FIELDS:
            if field in DEFAULT_DATA:
                data[field] = copy.deepcopy(DEFAULT_DATA[field])

    update_data(_mut)
    return {"ok": True}

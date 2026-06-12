"""Workspace settings (branding) backed by the app_settings table."""

from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import AppSetting

BRANDING_KEY = "branding"


def get_branding(db: Session) -> dict:
    row = db.get(AppSetting, BRANDING_KEY)
    branding = {"markerColor": get_settings().marker_color, "logoPath": None}
    if row is not None:
        branding.update(row.value or {})
    return branding


def update_branding(db: Session, **changes) -> dict:
    branding = get_branding(db)
    branding.update(changes)
    row = db.get(AppSetting, BRANDING_KEY)
    if row is None:
        db.add(AppSetting(key=BRANDING_KEY, value=branding))
    else:
        row.value = branding
    db.commit()
    return branding

from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..schemas import SettingsOut, SettingsPatch
from ..services.settings_store import get_branding, update_branding

router = APIRouter(prefix="/api/settings", tags=["settings"])

LOGO_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}


def _settings_out(branding: dict) -> SettingsOut:
    return SettingsOut(
        markerColor=branding["markerColor"],
        hasLogo=bool(branding.get("logoPath")),
    )


@router.get("", response_model=SettingsOut)
def read_settings(db: Session = Depends(get_db)) -> SettingsOut:
    return _settings_out(get_branding(db))


@router.patch("", response_model=SettingsOut)
def patch_settings(body: SettingsPatch, db: Session = Depends(get_db)) -> SettingsOut:
    branding = get_branding(db)
    if body.markerColor is not None:
        branding = update_branding(db, markerColor=body.markerColor)
    return _settings_out(branding)


@router.post("/logo", response_model=SettingsOut)
async def upload_logo(
    logo: UploadFile = File(...), db: Session = Depends(get_db)
) -> SettingsOut:
    ext = LOGO_TYPES.get(logo.content_type or "")
    if ext is None:
        raise HTTPException(415, f"Logo must be one of: {', '.join(LOGO_TYPES)}")
    data = await logo.read()
    if not data:
        raise HTTPException(422, "Empty logo upload")

    branding_dir = get_settings().data_dir / "branding"
    branding_dir.mkdir(parents=True, exist_ok=True)
    # Remove any previous logo (the extension may differ)
    for old in branding_dir.glob("logo.*"):
        old.unlink()
    rel_path = Path("branding") / f"logo{ext}"
    (get_settings().data_dir / rel_path).write_bytes(data)
    return _settings_out(update_branding(db, logoPath=rel_path.as_posix()))


@router.delete("/logo", response_model=SettingsOut)
def delete_logo(db: Session = Depends(get_db)) -> SettingsOut:
    branding = get_branding(db)
    logo_path = branding.get("logoPath")
    if logo_path:
        full = get_settings().data_dir / logo_path
        if full.exists():
            full.unlink()
    return _settings_out(update_branding(db, logoPath=None))


@router.get("/logo")
def get_logo(db: Session = Depends(get_db)) -> FileResponse:
    logo_path = get_branding(db).get("logoPath")
    if not logo_path:
        raise HTTPException(404, "No logo uploaded")
    full = get_settings().data_dir / logo_path
    if not full.exists():
        raise HTTPException(404, "Logo file missing")
    media_type = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".webp": "image/webp",
    }.get(full.suffix, "application/octet-stream")
    return FileResponse(full, media_type=media_type)

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Screenshot
from ..services.storage import resolve_path

router = APIRouter(prefix="/api/screenshots", tags=["screenshots"])


@router.get("/{screenshot_id}")
def get_screenshot(screenshot_id: str, db: Session = Depends(get_db)) -> FileResponse:
    shot = db.get(Screenshot, screenshot_id)
    if shot is None:
        raise HTTPException(404, "Screenshot not found")
    path = resolve_path(shot.file_path)
    if not path.exists():
        raise HTTPException(404, "Screenshot file missing")
    return FileResponse(
        path,
        media_type="image/png",
        headers={
            "ETag": f'"{shot.id}"',
            # Content-addressed: the URL changes when the content does.
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    )

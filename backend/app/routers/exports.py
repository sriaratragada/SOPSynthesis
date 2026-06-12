from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.export_markdown import build_markdown_zip
from ..services.settings_store import get_branding
from .guides import get_guide_or_404

router = APIRouter(prefix="/api/guides", tags=["exports"])


@router.get("/{guide_id}/export/markdown")
def export_markdown(guide_id: str, db: Session = Depends(get_db)) -> Response:
    guide = get_guide_or_404(guide_id, db)
    data, filename = build_markdown_zip(guide, db, get_branding(db)["markerColor"])
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Event, Guide, Recording, Screenshot, Step, utcnow
from ..schemas import GuideOut, GuidePatch, GuideSummary
from ..services.storage import delete_screenshot_file
from .common import guide_out, guide_summary

router = APIRouter(prefix="/api/guides", tags=["guides"])


def get_guide_or_404(guide_id: str, db: Session) -> Guide:
    guide = db.get(Guide, guide_id)
    if guide is None:
        raise HTTPException(404, "Guide not found")
    return guide


@router.get("", response_model=list[GuideSummary])
def list_guides(db: Session = Depends(get_db)) -> list[GuideSummary]:
    guides = db.scalars(select(Guide).order_by(Guide.created_at.desc())).all()
    return [guide_summary(g) for g in guides]


@router.get("/{guide_id}", response_model=GuideOut)
def get_guide(guide_id: str, db: Session = Depends(get_db)) -> GuideOut:
    return guide_out(get_guide_or_404(guide_id, db))


@router.patch("/{guide_id}", response_model=GuideOut)
def patch_guide(guide_id: str, body: GuidePatch, db: Session = Depends(get_db)) -> GuideOut:
    guide = get_guide_or_404(guide_id, db)
    if body.title is not None:
        guide.title = body.title
    if body.description is not None:
        guide.description = body.description
    guide.updated_at = utcnow()
    db.commit()
    return guide_out(guide)


@router.delete("/{guide_id}", status_code=204)
def delete_guide(guide_id: str, db: Session = Depends(get_db)) -> None:
    guide = get_guide_or_404(guide_id, db)
    source_recording_id = guide.source_recording_id
    db.delete(guide)
    if source_recording_id:
        recording = db.get(Recording, source_recording_id)
        if recording is not None:
            db.delete(recording)  # cascades to its events
    db.flush()
    _collect_orphan_screenshots(db)
    db.commit()


def _collect_orphan_screenshots(db: Session) -> None:
    referenced = select(Step.screenshot_id).where(Step.screenshot_id.is_not(None)).union(
        select(Event.screenshot_id).where(Event.screenshot_id.is_not(None))
    )
    orphans = db.scalars(select(Screenshot).where(Screenshot.id.not_in(referenced))).all()
    for shot in orphans:
        delete_screenshot_file(shot.file_path)
        db.delete(shot)

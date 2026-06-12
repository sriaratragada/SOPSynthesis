from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Event, Guide, Recording, Screenshot, Step, utcnow
from ..processing.generator import get_generator
from ..processing.pipeline import build_guide
from ..schemas import (
    CaptureEvent,
    EventAccepted,
    FinalizeResponse,
    RecordingCreated,
    RecordingStatus,
)
from ..services.storage import save_screenshot

router = APIRouter(prefix="/api/recordings", tags=["recordings"])


@router.post("", response_model=RecordingCreated, status_code=201)
def create_recording(db: Session = Depends(get_db)) -> RecordingCreated:
    recording = Recording()
    db.add(recording)
    db.commit()
    return RecordingCreated(id=recording.id)


@router.post("/{recording_id}/events", response_model=EventAccepted)
async def append_event(
    recording_id: str,
    event: str = Form(...),
    screenshot: UploadFile | None = File(None),
    db: Session = Depends(get_db),
) -> EventAccepted:
    recording = db.get(Recording, recording_id)
    if recording is None:
        raise HTTPException(404, "Recording not found")
    if recording.status != "recording":
        raise HTTPException(409, f"Recording is {recording.status}")

    try:
        capture = CaptureEvent.model_validate_json(event)
    except ValidationError as exc:
        raise HTTPException(422, f"Invalid event payload: {exc}") from exc

    # Defense in depth: never store a masked (password) value, whatever the client sent.
    if capture.typed is not None and capture.typed.masked:
        capture = capture.model_copy(
            update={"typed": capture.typed.model_copy(update={"value": ""})}
        )

    existing = db.scalar(
        select(Event).where(Event.recording_id == recording_id, Event.seq == capture.seq)
    )
    if existing is not None:
        return EventAccepted(seq=capture.seq, duplicate=True)

    screenshot_id: str | None = None
    if screenshot is not None:
        png_bytes = await screenshot.read()
        if png_bytes:
            sha, rel_path, width, height = save_screenshot(png_bytes)
            if db.get(Screenshot, sha) is None:
                db.add(
                    Screenshot(
                        id=sha,
                        file_path=rel_path,
                        width=width,
                        height=height,
                        dpr=capture.viewport.dpr if capture.viewport else 1.0,
                    )
                )
                # The event row FK-references this screenshot, but with no ORM
                # relationship between the two mappers the unit of work won't
                # order the inserts — flush so the screenshot lands first.
                db.flush()
            screenshot_id = sha

    db.add(
        Event(
            recording_id=recording_id,
            seq=capture.seq,
            type=capture.type,
            ts=capture.ts,
            url=capture.url,
            page_title=capture.pageTitle,
            payload=capture.model_dump(),
            screenshot_id=screenshot_id,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()  # concurrent retry of the same seq — idempotent by design
        return EventAccepted(seq=capture.seq, duplicate=True)
    return EventAccepted(seq=capture.seq)


@router.post("/{recording_id}/finalize", response_model=FinalizeResponse)
def finalize_recording(recording_id: str, db: Session = Depends(get_db)) -> FinalizeResponse:
    recording = db.get(Recording, recording_id)
    if recording is None:
        raise HTTPException(404, "Recording not found")

    if recording.status == "finalized":
        guide = db.scalar(select(Guide).where(Guide.source_recording_id == recording_id))
        if guide is not None:
            return FinalizeResponse(guideId=guide.id)
        raise HTTPException(409, "Recording finalized but its guide was deleted")

    events = [CaptureEvent.model_validate(e.payload) for e in recording.events]
    screenshot_ids = {e.seq: e.screenshot_id for e in recording.events if e.screenshot_id}
    draft = build_guide(events, screenshot_ids, get_generator(), recording.started_at)

    guide = Guide(
        title=draft.title,
        description=draft.description,
        source_recording_id=recording.id,
    )
    db.add(guide)
    db.flush()
    for position, step in enumerate(draft.steps):
        db.add(
            Step(
                guide_id=guide.id,
                position=position,
                screenshot_id=step.screenshot_id,
                instruction_text=step.instruction_text,
                click=step.click,
                meta=step.meta,
            )
        )
    recording.status = "finalized"
    recording.ended_at = utcnow()
    db.commit()
    return FinalizeResponse(guideId=guide.id)


@router.get("/{recording_id}", response_model=RecordingStatus)
def get_recording(recording_id: str, db: Session = Depends(get_db)) -> RecordingStatus:
    recording = db.get(Recording, recording_id)
    if recording is None:
        raise HTTPException(404, "Recording not found")
    guide = db.scalar(select(Guide).where(Guide.source_recording_id == recording_id))
    return RecordingStatus(
        id=recording.id,
        status=recording.status,
        eventCount=len(recording.events),
        startedAt=recording.started_at,
        endedAt=recording.ended_at,
        guideId=guide.id if guide else None,
    )

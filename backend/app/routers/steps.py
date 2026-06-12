from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Screenshot, Step, utcnow
from ..processing.generator import StepContext, get_generator
from ..schemas import (
    MergeRequest,
    RegenerateRequest,
    ReorderRequest,
    StepMeta,
    StepOut,
    StepPatch,
)
from ..services.redaction import apply_redactions
from .common import step_out
from .guides import get_guide_or_404

router = APIRouter(prefix="/api/guides", tags=["steps"])


def _get_step_or_404(guide_id: str, step_id: str, db: Session) -> Step:
    step = db.get(Step, step_id)
    if step is None or step.guide_id != guide_id:
        raise HTTPException(404, "Step not found")
    return step


def _reindex(steps: list[Step]) -> None:
    for position, step in enumerate(steps):
        step.position = position


def _as_html_block(text: str) -> str:
    stripped = text.strip()
    return stripped if stripped.startswith("<") else f"<p>{stripped}</p>"


@router.patch("/{guide_id}/steps/{step_id}", response_model=StepOut)
def patch_step(
    guide_id: str, step_id: str, body: StepPatch, db: Session = Depends(get_db)
) -> StepOut:
    guide = get_guide_or_404(guide_id, db)
    step = _get_step_or_404(guide_id, step_id, db)
    fields_set = body.model_fields_set

    if "instructionText" in fields_set and body.instructionText is not None:
        step.instruction_text = body.instructionText
        step.instruction_overridden = True
    if body.clearCallout:
        step.callout_type = None
        step.callout_text = None
    else:
        if "calloutType" in fields_set:
            step.callout_type = body.calloutType
        if "calloutText" in fields_set:
            step.callout_text = body.calloutText
    if "click" in fields_set and body.click is not None:
        step.click = body.click.model_dump()
    if "annotations" in fields_set:
        step.annotations = [a.model_dump() for a in (body.annotations or [])]
    if "crop" in fields_set:
        step.crop = body.crop.model_dump() if body.crop else None
    if "flags" in fields_set and body.flags is not None:
        step.flags = body.flags.model_dump()
    if "redactions" in fields_set:
        redactions = body.redactions or []
        step.redactions = [r.model_dump() for r in redactions]
        step.redacted_screenshot_id = None
        if redactions and step.screenshot_id:
            original = db.get(Screenshot, step.screenshot_id)
            if original is not None:
                step.redacted_screenshot_id = apply_redactions(original, redactions, db)

    guide.updated_at = utcnow()
    db.commit()
    return step_out(step, db)


@router.delete("/{guide_id}/steps/{step_id}", status_code=204)
def delete_step(guide_id: str, step_id: str, db: Session = Depends(get_db)) -> None:
    guide = get_guide_or_404(guide_id, db)
    step = _get_step_or_404(guide_id, step_id, db)
    db.delete(step)
    db.flush()
    _reindex([s for s in guide.steps if s.id != step_id])
    guide.updated_at = utcnow()
    db.commit()


@router.post("/{guide_id}/steps:reorder", response_model=list[StepOut])
def reorder_steps(
    guide_id: str, body: ReorderRequest, db: Session = Depends(get_db)
) -> list[StepOut]:
    guide = get_guide_or_404(guide_id, db)
    by_id = {s.id: s for s in guide.steps}
    if set(body.stepIds) != set(by_id):
        raise HTTPException(422, "stepIds must be a permutation of the guide's step ids")
    for position, step_id in enumerate(body.stepIds):
        by_id[step_id].position = position
    guide.updated_at = utcnow()
    db.commit()
    db.refresh(guide)
    return [step_out(s, db) for s in guide.steps]


@router.post("/{guide_id}/steps/{step_id}:regenerate", response_model=StepOut)
def regenerate_step(
    guide_id: str,
    step_id: str,
    body: RegenerateRequest | None = None,
    db: Session = Depends(get_db),
) -> StepOut:
    guide = get_guide_or_404(guide_id, db)
    step = _get_step_or_404(guide_id, step_id, db)
    force = body.force if body else False

    if step.instruction_overridden and not force:
        return step_out(step, db)

    meta = StepMeta.model_validate(step.meta or {})
    ctx = StepContext(
        index=step.position,
        event_type=meta.eventType or "click",
        url=meta.url,
        page_title="",
        element=meta.element,
        typed=meta.typed,
    )
    step.instruction_text = get_generator().step_instruction(ctx)
    step.instruction_overridden = False
    guide.updated_at = utcnow()
    db.commit()
    return step_out(step, db)


def _clone_step(step: Step, position: int) -> Step:
    return Step(
        guide_id=step.guide_id,
        position=position,
        screenshot_id=step.screenshot_id,
        redacted_screenshot_id=step.redacted_screenshot_id,
        instruction_text=step.instruction_text,
        instruction_overridden=step.instruction_overridden,
        callout_type=step.callout_type,
        callout_text=step.callout_text,
        click=dict(step.click) if step.click else None,
        annotations=[dict(a) for a in (step.annotations or [])],
        redactions=[dict(r) for r in (step.redactions or [])],
        crop=dict(step.crop) if step.crop else None,
        flags=dict(step.flags or {}),
        meta=dict(step.meta or {}),
    )


def _insert_after(guide, anchor: Step, new_step: Step, db: Session) -> None:
    db.add(new_step)
    db.flush()
    ordered = [s for s in guide.steps if s.id != new_step.id]
    ordered.insert(ordered.index(anchor) + 1, new_step)
    _reindex(ordered)
    guide.updated_at = utcnow()


@router.post("/{guide_id}/steps/{step_id}:duplicate", response_model=StepOut)
def duplicate_step(guide_id: str, step_id: str, db: Session = Depends(get_db)) -> StepOut:
    guide = get_guide_or_404(guide_id, db)
    step = _get_step_or_404(guide_id, step_id, db)
    clone = _clone_step(step, position=step.position + 1)
    _insert_after(guide, step, clone, db)
    db.commit()
    return step_out(clone, db)


@router.post("/{guide_id}/steps/{step_id}:split", response_model=list[StepOut])
def split_step(guide_id: str, step_id: str, db: Session = Depends(get_db)) -> list[StepOut]:
    """Split into two steps sharing the same screenshot; the new step gets a
    placeholder instruction to describe the second part of the action."""
    guide = get_guide_or_404(guide_id, db)
    step = _get_step_or_404(guide_id, step_id, db)
    clone = _clone_step(step, position=step.position + 1)
    clone.instruction_text = "Describe this step…"
    clone.instruction_overridden = True
    clone.callout_type = None
    clone.callout_text = None
    _insert_after(guide, step, clone, db)
    db.commit()
    return [step_out(step, db), step_out(clone, db)]


@router.post("/{guide_id}/steps:merge", response_model=StepOut)
def merge_steps(guide_id: str, body: MergeRequest, db: Session = Depends(get_db)) -> StepOut:
    """Merge two steps: the earlier one keeps its screenshot and visuals; the
    later one contributes its instruction text (and callout, if the first has
    none), then is deleted."""
    guide = get_guide_or_404(guide_id, db)
    steps = [_get_step_or_404(guide_id, sid, db) for sid in body.stepIds]
    first, second = sorted(steps, key=lambda s: s.position)
    if first.id == second.id:
        raise HTTPException(422, "Cannot merge a step with itself")

    first.instruction_text = _as_html_block(first.instruction_text) + _as_html_block(
        second.instruction_text
    )
    first.instruction_overridden = True
    if first.callout_type is None and second.callout_type is not None:
        first.callout_type = second.callout_type
        first.callout_text = second.callout_text
    merged_sensitive = list(
        dict.fromkeys(
            (first.flags or {}).get("sensitive", []) + (second.flags or {}).get("sensitive", [])
        )
    )
    first.flags = {"sensitive": merged_sensitive} if merged_sensitive else {}

    db.delete(second)
    db.flush()
    _reindex([s for s in guide.steps if s.id != second.id])
    guide.updated_at = utcnow()
    db.commit()
    return step_out(first, db)

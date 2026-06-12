from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Step, utcnow
from ..processing.generator import StepContext, get_generator
from ..schemas import RegenerateRequest, ReorderRequest, StepMeta, StepOut, StepPatch
from .common import step_out
from .guides import get_guide_or_404

router = APIRouter(prefix="/api/guides", tags=["steps"])


def _get_step_or_404(guide_id: str, step_id: str, db: Session) -> Step:
    step = db.get(Step, step_id)
    if step is None or step.guide_id != guide_id:
        raise HTTPException(404, "Step not found")
    return step


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

    guide.updated_at = utcnow()
    db.commit()
    return step_out(step)


@router.delete("/{guide_id}/steps/{step_id}", status_code=204)
def delete_step(guide_id: str, step_id: str, db: Session = Depends(get_db)) -> None:
    guide = get_guide_or_404(guide_id, db)
    step = _get_step_or_404(guide_id, step_id, db)
    db.delete(step)
    db.flush()
    for position, remaining in enumerate(g for g in guide.steps if g.id != step_id):
        remaining.position = position
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
    return [step_out(s) for s in guide.steps]


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
        return step_out(step)

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
    return step_out(step)

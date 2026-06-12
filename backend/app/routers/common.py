"""ORM → API schema converters shared by routers."""

from sqlalchemy.orm import Session

from ..models import Guide, Screenshot, Step
from ..schemas import (
    Annotation,
    ClickPoint,
    CropRect,
    GuideOut,
    GuideSummary,
    RedactionRect,
    StepFlags,
    StepMeta,
    StepOut,
)


def step_out(step: Step, db: Session) -> StepOut:
    width = height = None
    if step.screenshot_id:
        shot = db.get(Screenshot, step.screenshot_id)
        if shot is not None:
            width, height = shot.width, shot.height
    return StepOut(
        id=step.id,
        position=step.position,
        screenshotId=step.screenshot_id,
        screenshotWidth=width,
        screenshotHeight=height,
        redactedScreenshotId=step.redacted_screenshot_id,
        instructionText=step.instruction_text,
        instructionOverridden=step.instruction_overridden,
        calloutType=step.callout_type,
        calloutText=step.callout_text,
        click=ClickPoint.model_validate(step.click) if step.click else None,
        annotations=[Annotation.model_validate(a) for a in (step.annotations or [])],
        redactions=[RedactionRect.model_validate(r) for r in (step.redactions or [])],
        crop=CropRect.model_validate(step.crop) if step.crop else None,
        flags=StepFlags.model_validate(step.flags or {}),
        meta=StepMeta.model_validate(step.meta or {}),
    )


def guide_out(guide: Guide, db: Session) -> GuideOut:
    return GuideOut(
        id=guide.id,
        title=guide.title,
        description=guide.description,
        createdAt=guide.created_at,
        updatedAt=guide.updated_at,
        steps=[step_out(s, db) for s in guide.steps],
    )


def guide_summary(guide: Guide) -> GuideSummary:
    return GuideSummary(
        id=guide.id,
        title=guide.title,
        description=guide.description,
        stepCount=len(guide.steps),
        createdAt=guide.created_at,
        updatedAt=guide.updated_at,
    )

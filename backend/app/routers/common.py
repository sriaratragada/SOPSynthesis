"""ORM → API schema converters shared by routers."""

from ..models import Guide, Step
from ..schemas import ClickPoint, GuideOut, GuideSummary, StepMeta, StepOut


def step_out(step: Step) -> StepOut:
    return StepOut(
        id=step.id,
        position=step.position,
        screenshotId=step.screenshot_id,
        instructionText=step.instruction_text,
        instructionOverridden=step.instruction_overridden,
        calloutType=step.callout_type,
        calloutText=step.callout_text,
        click=ClickPoint.model_validate(step.click) if step.click else None,
        meta=StepMeta.model_validate(step.meta or {}),
    )


def guide_out(guide: Guide) -> GuideOut:
    return GuideOut(
        id=guide.id,
        title=guide.title,
        description=guide.description,
        createdAt=guide.created_at,
        updatedAt=guide.updated_at,
        steps=[step_out(s) for s in guide.steps],
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

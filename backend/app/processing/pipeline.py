"""Recording → guide transformation. Pure function over events; no DB, no HTTP."""

from datetime import datetime
from urllib.parse import urlparse

from pydantic import BaseModel

from ..schemas import CaptureEvent
from .dedup import dedup_events
from .generator.base import DescriptionGenerator, RecordingMeta, StepContext, pick_label
from .sensitive import scan_for_sensitive


class StepDraft(BaseModel):
    instruction_text: str
    screenshot_id: str | None = None
    click: dict | None = None
    flags: dict = {}
    meta: dict


class GuideDraft(BaseModel):
    title: str
    description: str
    steps: list[StepDraft]


def make_step_context(index: int, ev: CaptureEvent, prev_url: str | None) -> StepContext:
    typed = ev.typed
    if typed is not None and typed.masked:
        # Defense in depth: the extension masks at capture, but never let a
        # masked value slip through to instructions or stored step meta.
        typed = typed.model_copy(update={"value": ""})
    return StepContext(
        index=index,
        event_type=ev.type,
        url=ev.url,
        page_title=ev.pageTitle,
        element=ev.element,
        typed=typed,
        prev_url=prev_url,
    )


def build_guide(
    events: list[CaptureEvent],
    screenshot_ids: dict[int, str],
    generator: DescriptionGenerator,
    started_at: datetime | None = None,
) -> GuideDraft:
    """screenshot_ids maps event seq → stored screenshot id."""
    kept = dedup_events(events)

    ctxs: list[StepContext] = []
    prev_url: str | None = None
    for i, ev in enumerate(kept):
        ctxs.append(make_step_context(i, ev, prev_url))
        prev_url = ev.url

    steps: list[StepDraft] = []
    last_screenshot: str | None = None
    for ev, ctx in zip(kept, ctxs):
        screenshot_id = screenshot_ids.get(ev.seq)
        if screenshot_id:
            last_screenshot = screenshot_id
        elif ev.type == "type":
            # Type events carry no screenshot; show the frame from the click
            # that focused the field.
            screenshot_id = last_screenshot

        sensitive = scan_for_sensitive(
            ev.element.text if ev.element else None,
            ev.element.ariaLabel if ev.element else None,
            ctx.typed.value if ctx.typed else None,
        )
        steps.append(
            StepDraft(
                instruction_text=generator.step_instruction(ctx),
                screenshot_id=screenshot_id,
                click=ev.click.model_dump() if ev.click else None,
                flags={"sensitive": sensitive} if sensitive else {},
                meta={
                    "url": ev.url,
                    "ts": ev.ts,
                    "eventType": ev.type,
                    "elementLabel": pick_label(ev.element),
                    "region": ev.element.region if ev.element else None,
                    "element": ev.element.model_dump() if ev.element else None,
                    "typed": ctx.typed.model_dump() if ctx.typed else None,
                },
            )
        )

    recording_meta = RecordingMeta(
        started_at=started_at,
        domains=_domains_in_order(kept),
        first_page_title=next((e.pageTitle for e in kept if e.pageTitle.strip()), None),
        step_count=len(steps),
    )
    meta = generator.guide_meta(ctxs, recording_meta)
    return GuideDraft(title=meta.title, description=meta.description, steps=steps)


def _domains_in_order(events: list[CaptureEvent]) -> list[str]:
    seen: list[str] = []
    for ev in events:
        domain = urlparse(ev.url).netloc
        if domain and domain not in seen:
            seen.append(domain)
    return seen

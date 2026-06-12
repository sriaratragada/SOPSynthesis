"""Description generator interface — the LLM swap point.

StepContext deliberately carries the full element/page/typed context so a future
LLM-backed implementation has everything it needs for a prompt without any
pipeline changes. Swapping generators is a new subclass + the SOPS_GENERATOR
setting; nothing upstream knows the difference.
"""

from abc import ABC, abstractmethod
from datetime import datetime

from pydantic import BaseModel

from ...schemas import ElementMeta, EventType, TypedValue


class StepContext(BaseModel):
    index: int = 0
    event_type: EventType
    url: str = ""
    page_title: str = ""
    element: ElementMeta | None = None
    typed: TypedValue | None = None
    prev_url: str | None = None


class GuideMeta(BaseModel):
    title: str
    description: str


class RecordingMeta(BaseModel):
    started_at: datetime | None = None
    domains: list[str] = []
    first_page_title: str | None = None
    step_count: int = 0


def pick_label(el: ElementMeta | None) -> str | None:
    """Best human-readable label for an element, in priority order."""
    if el is None:
        return None
    for value in (el.ariaLabel, el.text, el.placeholder, el.name, el.alt):
        if value and value.strip():
            return value.strip()
    return None


class DescriptionGenerator(ABC):
    @abstractmethod
    def step_instruction(self, ctx: StepContext) -> str: ...

    @abstractmethod
    def guide_meta(self, ctxs: list[StepContext], recording: RecordingMeta) -> GuideMeta: ...

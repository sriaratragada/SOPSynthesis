"""Pydantic API schemas — the single source of truth for the wire format.

TypeScript types in packages/shared/src/api-types.gen.ts are generated from the
OpenAPI document these models produce (npm run gen:types). The capture-event
semantics are documented in docs/event-contract.md.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

EventType = Literal["click", "type", "navigate"]
CalloutType = Literal["info", "warning", "caution"]


# ---------- capture events (extension → backend) ----------


class Viewport(BaseModel):
    w: int
    h: int
    dpr: float = 1.0
    scrollX: int = 0
    scrollY: int = 0


class BBox(BaseModel):
    """Element bounding box, normalized to the viewport (0..1 fractions)."""

    nx: float
    ny: float
    nw: float
    nh: float


class ClickPoint(BaseModel):
    """Click position as viewport fractions; raw client coords kept for forensics."""

    nx: float = Field(ge=0, le=1)
    ny: float = Field(ge=0, le=1)
    clientX: int | None = None
    clientY: int | None = None
    bbox: BBox | None = None


class ElementMeta(BaseModel):
    tag: str = ""
    text: str | None = None
    ariaLabel: str | None = None
    placeholder: str | None = None
    name: str | None = None
    id: str | None = None
    role: str | None = None
    type: str | None = None
    href: str | None = None
    alt: str | None = None
    selector: str | None = None
    region: str | None = None


class TypedValue(BaseModel):
    value: str = ""
    masked: bool = False


class CaptureEvent(BaseModel):
    seq: int = Field(ge=0)
    type: EventType
    ts: int
    url: str = ""
    pageTitle: str = ""
    tabId: int | None = None
    viewport: Viewport | None = None
    click: ClickPoint | None = None
    element: ElementMeta | None = None
    typed: TypedValue | None = None


# ---------- recordings ----------


class RecordingCreated(BaseModel):
    id: str


class RecordingStatus(BaseModel):
    id: str
    status: Literal["recording", "finalizing", "finalized", "abandoned"]
    eventCount: int
    startedAt: datetime
    endedAt: datetime | None = None
    guideId: str | None = None


class EventAccepted(BaseModel):
    seq: int
    duplicate: bool = False


class FinalizeResponse(BaseModel):
    guideId: str


# ---------- guides & steps (backend → web) ----------


class StepMeta(BaseModel):
    model_config = ConfigDict(extra="allow")

    url: str = ""
    ts: int | None = None
    eventType: EventType | None = None
    elementLabel: str | None = None
    region: str | None = None
    element: ElementMeta | None = None
    typed: TypedValue | None = None


class StepOut(BaseModel):
    id: str
    position: int
    screenshotId: str | None = None
    instructionText: str
    instructionOverridden: bool = False
    calloutType: CalloutType | None = None
    calloutText: str | None = None
    click: ClickPoint | None = None
    meta: StepMeta


class GuideSummary(BaseModel):
    id: str
    title: str
    description: str
    stepCount: int
    createdAt: datetime
    updatedAt: datetime


class GuideOut(BaseModel):
    id: str
    title: str
    description: str
    createdAt: datetime
    updatedAt: datetime
    steps: list[StepOut]


class GuidePatch(BaseModel):
    title: str | None = None
    description: str | None = None


class StepPatch(BaseModel):
    """Partial update; only fields present in the request are applied."""

    instructionText: str | None = None
    calloutType: CalloutType | None = None
    calloutText: str | None = None
    click: ClickPoint | None = None
    clearCallout: bool = False


class ReorderRequest(BaseModel):
    stepIds: list[str]


class RegenerateRequest(BaseModel):
    force: bool = False


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    version: str = "0.1.0"

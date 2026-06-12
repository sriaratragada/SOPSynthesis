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


# ---------- editing: annotations, redactions, crop ----------


class Annotation(BaseModel):
    """One annotation op. Coordinates are 0..1 fractions of the ORIGINAL image.

    rect/ellipse/text use (nx, ny, nw, nh) bounds; arrow uses (nx, ny) → (nx2, ny2).
    """

    id: str
    kind: Literal["rect", "ellipse", "arrow", "text"]
    nx: float = 0
    ny: float = 0
    nw: float = 0
    nh: float = 0
    nx2: float | None = None
    ny2: float | None = None
    text: str | None = None
    color: str = "#FF5C35"


class RedactionRect(BaseModel):
    id: str
    nx: float
    ny: float
    nw: float
    nh: float


class CropRect(BaseModel):
    nx: float = Field(ge=0, le=1)
    ny: float = Field(ge=0, le=1)
    nw: float = Field(gt=0, le=1)
    nh: float = Field(gt=0, le=1)


class StepFlags(BaseModel):
    model_config = ConfigDict(extra="allow")

    sensitive: list[str] = []


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
    screenshotWidth: int | None = None
    screenshotHeight: int | None = None
    redactedScreenshotId: str | None = None
    instructionText: str
    instructionOverridden: bool = False
    calloutType: CalloutType | None = None
    calloutText: str | None = None
    click: ClickPoint | None = None
    annotations: list[Annotation] = []
    redactions: list[RedactionRect] = []
    crop: CropRect | None = None
    flags: StepFlags = StepFlags()
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
    """Partial update; only fields present in the request are applied.

    Sending `crop: null` clears the crop; `redactions: []` clears redactions
    (and drops the derived redacted image); `flags` replaces flags (send
    `{"sensitive": []}` to dismiss a sensitive-data warning).
    """

    instructionText: str | None = None
    calloutType: CalloutType | None = None
    calloutText: str | None = None
    click: ClickPoint | None = None
    clearCallout: bool = False
    annotations: list[Annotation] | None = None
    redactions: list[RedactionRect] | None = None
    crop: CropRect | None = None
    flags: StepFlags | None = None


class ReorderRequest(BaseModel):
    stepIds: list[str]


class MergeRequest(BaseModel):
    """Merge the second step into the first; both must belong to the guide."""

    stepIds: list[str] = Field(min_length=2, max_length=2)


# ---------- workspace settings / branding ----------


class SettingsOut(BaseModel):
    markerColor: str
    hasLogo: bool


class SettingsPatch(BaseModel):
    markerColor: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")


class RegenerateRequest(BaseModel):
    force: bool = False


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    version: str = "0.1.0"

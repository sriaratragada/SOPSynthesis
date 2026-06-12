"""Event deduplication — turns a raw capture stream into step-worthy events.

Rules, applied in order while walking events by seq:
(a) clicks on the same element within DOUBLE_CLICK_MS collapse to the first
(b) a navigation within NAV_AFTER_CLICK_MS of a click is dropped — the click IS
    the step; the navigation only changes URL context for later steps
(c) clicks on html/body with no extractable label are noise
(d) empty/whitespace-only type events are dropped (masked ones are kept)
(e) surviving navigations only become steps when idle for STANDALONE_NAV_GAP_MS
    before them (a manual address-bar navigation); consecutive navigations to
    the same URL collapse
"""

from ..schemas import CaptureEvent
from .generator.base import pick_label

DOUBLE_CLICK_MS = 600
NAV_AFTER_CLICK_MS = 2000
STANDALONE_NAV_GAP_MS = 2000


def _click_key(ev: CaptureEvent) -> tuple:
    el = ev.element
    if el and el.selector:
        return ("sel", el.selector, ev.url)
    if el:
        return ("el", el.tag, el.text, el.id, ev.url)
    if ev.click:
        return ("pos", round(ev.click.nx, 3), round(ev.click.ny, 3), ev.url)
    return ("none", ev.url)


def _is_noise_click(ev: CaptureEvent) -> bool:
    el = ev.element
    if el is None:
        return False
    return el.tag.lower() in ("html", "body") and pick_label(el) is None


def dedup_events(events: list[CaptureEvent]) -> list[CaptureEvent]:
    kept: list[CaptureEvent] = []
    last_click_ts: int | None = None
    last_click_key: tuple | None = None

    for ev in sorted(events, key=lambda e: e.seq):
        if ev.type == "click":
            if _is_noise_click(ev):
                continue
            key = _click_key(ev)
            if (
                last_click_ts is not None
                and key == last_click_key
                and ev.ts - last_click_ts <= DOUBLE_CLICK_MS
            ):
                last_click_ts = ev.ts  # keep collapsing triple+ clicks
                continue
            kept.append(ev)
            last_click_ts = ev.ts
            last_click_key = key

        elif ev.type == "type":
            if ev.typed is None:
                continue
            if not ev.typed.masked and not ev.typed.value.strip():
                continue
            kept.append(ev)

        else:  # navigate
            if last_click_ts is not None and 0 <= ev.ts - last_click_ts <= NAV_AFTER_CLICK_MS:
                continue
            prev = kept[-1] if kept else None
            if prev is not None and ev.ts - prev.ts <= STANDALONE_NAV_GAP_MS:
                continue
            if prev is not None and prev.type == "navigate" and prev.url == ev.url:
                continue
            kept.append(ev)

    return kept

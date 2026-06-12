"""Synthetic capture-event builders shared by tests."""

from app.schemas import CaptureEvent, ClickPoint, ElementMeta, TypedValue


def click_event(
    seq: int,
    ts: int,
    *,
    selector: str = "#btn",
    tag: str = "button",
    text: str | None = "OK",
    url: str = "https://example.com/page",
    page_title: str = "Example Page",
    region: str | None = None,
    aria_label: str | None = None,
    input_type: str | None = None,
) -> CaptureEvent:
    return CaptureEvent(
        seq=seq,
        type="click",
        ts=ts,
        url=url,
        pageTitle=page_title,
        click=ClickPoint(nx=0.5, ny=0.5, clientX=640, clientY=360),
        element=ElementMeta(
            tag=tag,
            text=text,
            selector=selector,
            region=region,
            ariaLabel=aria_label,
            type=input_type,
        ),
    )


def type_event(
    seq: int,
    ts: int,
    value: str,
    *,
    masked: bool = False,
    label: str = "Search",
    url: str = "https://example.com/page",
) -> CaptureEvent:
    return CaptureEvent(
        seq=seq,
        type="type",
        ts=ts,
        url=url,
        pageTitle="Example Page",
        element=ElementMeta(tag="input", placeholder=label, type="password" if masked else "text"),
        typed=TypedValue(value=value, masked=masked),
    )


def nav_event(seq: int, ts: int, url: str = "https://example.com/next") -> CaptureEvent:
    return CaptureEvent(seq=seq, type="navigate", ts=ts, url=url, pageTitle="Next Page")

from app.processing.dedup import dedup_events
from app.schemas import CaptureEvent, ElementMeta

from .helpers import click_event, nav_event, type_event


def test_double_click_collapses_to_first():
    events = [click_event(0, 1000), click_event(1, 1300)]
    kept = dedup_events(events)
    assert len(kept) == 1
    assert kept[0].seq == 0


def test_triple_click_collapses_to_first():
    events = [click_event(0, 1000), click_event(1, 1400), click_event(2, 1800)]
    assert len(dedup_events(events)) == 1


def test_slow_repeat_click_is_two_steps():
    events = [click_event(0, 1000), click_event(1, 5000)]
    assert len(dedup_events(events)) == 2


def test_clicks_on_different_elements_both_kept():
    events = [
        click_event(0, 1000, selector="#a"),
        click_event(1, 1200, selector="#b"),
    ]
    assert len(dedup_events(events)) == 2


def test_navigation_after_click_is_dropped():
    events = [click_event(0, 1000), nav_event(1, 1400)]
    kept = dedup_events(events)
    assert [e.type for e in kept] == ["click"]


def test_standalone_navigation_becomes_step():
    events = [click_event(0, 1000), nav_event(1, 10000)]
    kept = dedup_events(events)
    assert [e.type for e in kept] == ["click", "navigate"]


def test_leading_navigation_is_kept():
    events = [nav_event(0, 1000), click_event(1, 5000)]
    kept = dedup_events(events)
    assert [e.type for e in kept] == ["navigate", "click"]


def test_consecutive_same_url_navigations_collapse():
    events = [
        nav_event(0, 1000, url="https://a.com"),
        nav_event(1, 9000, url="https://a.com"),
    ]
    assert len(dedup_events(events)) == 1


def test_unlabeled_body_click_dropped():
    body_click = CaptureEvent(
        seq=0,
        type="click",
        ts=1000,
        url="https://a.com",
        element=ElementMeta(tag="body"),
    )
    assert dedup_events([body_click]) == []


def test_labeled_body_click_kept():
    body_click = CaptureEvent(
        seq=0,
        type="click",
        ts=1000,
        url="https://a.com",
        element=ElementMeta(tag="body", ariaLabel="Canvas"),
    )
    assert len(dedup_events([body_click])) == 1


def test_empty_type_event_dropped():
    assert dedup_events([type_event(0, 1000, "   ")]) == []


def test_masked_type_event_kept_despite_empty_value():
    kept = dedup_events([type_event(0, 1000, "", masked=True)])
    assert len(kept) == 1

from datetime import datetime, timezone

from app.processing.generator import RecordingMeta, StepContext, TemplateDescriptionGenerator
from app.schemas import ElementMeta, TypedValue

GEN = TemplateDescriptionGenerator()


def ctx(event_type="click", element=None, typed=None, url="https://example.com/x"):
    return StepContext(event_type=event_type, element=element, typed=typed, url=url)


def test_button_click():
    c = ctx(element=ElementMeta(tag="button", text="Approve"))
    assert GEN.step_instruction(c) == 'Click "Approve"'


def test_click_with_region_hint():
    c = ctx(element=ElementMeta(tag="button", text="Approve", region="top navigation"))
    assert GEN.step_instruction(c) == 'Click "Approve" in the top navigation'


def test_link_click():
    c = ctx(element=ElementMeta(tag="a", text="Documentation"))
    assert GEN.step_instruction(c) == 'Click the "Documentation" link'


def test_text_field_click():
    c = ctx(element=ElementMeta(tag="input", placeholder="Search", type="text"))
    assert GEN.step_instruction(c) == 'Click the "Search" field'


def test_aria_label_beats_visible_text():
    c = ctx(element=ElementMeta(tag="button", text="×", ariaLabel="Close dialog"))
    assert GEN.step_instruction(c) == 'Click "Close dialog"'


def test_unlabeled_click_falls_back_to_tag():
    c = ctx(element=ElementMeta(tag="div"))
    assert GEN.step_instruction(c) == "Click the div element"


def test_type_instruction():
    c = ctx(
        event_type="type",
        element=ElementMeta(tag="input", placeholder="Search"),
        typed=TypedValue(value="Q3 report"),
    )
    assert GEN.step_instruction(c) == 'Type "Q3 report" in the "Search" field'


def test_masked_password_never_includes_value():
    c = ctx(
        event_type="type",
        element=ElementMeta(tag="input", placeholder="Password", type="password"),
        typed=TypedValue(value="", masked=True),
    )
    text = GEN.step_instruction(c)
    assert text == 'Type your password in the "Password" field'


def test_navigate_instruction():
    c = ctx(event_type="navigate", url="https://en.wikipedia.org/wiki/Foo")
    assert GEN.step_instruction(c) == "Navigate to en.wikipedia.org"


def test_guide_meta_uses_first_page_title():
    meta = GEN.guide_meta(
        [],
        RecordingMeta(
            started_at=datetime(2026, 6, 11, tzinfo=timezone.utc),
            domains=["en.wikipedia.org", "example.com"],
            first_page_title="Wikipedia",
            step_count=4,
        ),
    )
    assert meta.title == "Wikipedia — workflow"
    assert "4-step recording" in meta.description
    assert "en.wikipedia.org, example.com" in meta.description
    assert "June 11, 2026" in meta.description


def test_guide_meta_falls_back_to_domain():
    meta = GEN.guide_meta(
        [], RecordingMeta(domains=["app.example.com"], first_page_title=None, step_count=1)
    )
    assert meta.title == "app.example.com workflow"

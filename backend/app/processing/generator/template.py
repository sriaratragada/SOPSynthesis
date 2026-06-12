from urllib.parse import urlparse

from .base import DescriptionGenerator, GuideMeta, RecordingMeta, StepContext, pick_label

FIELD_INPUT_TYPES = {
    "",
    "text",
    "search",
    "email",
    "url",
    "tel",
    "number",
    "password",
    "date",
    "time",
    "datetime-local",
}


def domain_of(url: str) -> str:
    netloc = urlparse(url).netloc
    return netloc or url or "the page"


class TemplateDescriptionGenerator(DescriptionGenerator):
    """Deterministic phrasing built from element metadata. No LLM, no network."""

    def step_instruction(self, ctx: StepContext) -> str:
        if ctx.event_type == "navigate":
            return f"Navigate to {domain_of(ctx.url)}"
        if ctx.event_type == "type":
            base = self._type_phrase(ctx)
        else:
            base = self._click_phrase(ctx)
        region = ctx.element.region if ctx.element else None
        if region:
            base += f" in the {region}"
        return base

    def _type_phrase(self, ctx: StepContext) -> str:
        label = pick_label(ctx.element)
        if ctx.typed and ctx.typed.masked:
            return f'Type your password in the "{label}" field' if label else "Type your password"
        value = ctx.typed.value if ctx.typed else ""
        return f'Type "{value}" in the "{label}" field' if label else f'Type "{value}"'

    def _click_phrase(self, ctx: StepContext) -> str:
        el = ctx.element
        label = pick_label(el)
        tag = (el.tag if el else "").lower()
        role = (el.role or "").lower() if el else ""
        input_type = (el.type or "").lower() if el else ""

        if not label:
            return f"Click the {tag} element" if tag and tag not in ("html", "body") else "Click on the page"
        if tag == "a" or role == "link":
            return f'Click the "{label}" link'
        if tag == "select":
            return f'Click the "{label}" dropdown'
        if tag == "input" and input_type == "checkbox":
            return f'Toggle the "{label}" checkbox'
        if tag == "input" and input_type == "radio":
            return f'Select "{label}"'
        if tag in ("input", "textarea") and input_type in FIELD_INPUT_TYPES:
            return f'Click the "{label}" field'
        return f'Click "{label}"'

    def guide_meta(self, ctxs: list[StepContext], recording: RecordingMeta) -> GuideMeta:
        title = (recording.first_page_title or "").strip()
        if title:
            guide_title = f"{title} — workflow"
        elif recording.domains:
            guide_title = f"{recording.domains[0]} workflow"
        else:
            guide_title = "Recorded workflow"

        domains = ", ".join(recording.domains) if recording.domains else "your browser"
        description = f"Created from a {recording.step_count}-step recording on {domains}"
        if recording.started_at:
            description += f", {recording.started_at.strftime('%B %d, %Y')}"
        description += "."
        return GuideMeta(title=guide_title, description=description)

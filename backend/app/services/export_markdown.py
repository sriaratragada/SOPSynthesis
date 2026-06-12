"""Markdown export: a ZIP of guide.md + assets/ with the full editing state
replayed into pixels — redacted base image, crop, annotations, click marker.
Rich-text (HTML) instructions are converted to Markdown."""

import io
import re
import zipfile

from markdownify import markdownify
from PIL import Image
from sqlalchemy.orm import Session

from ..models import Guide, Screenshot, Step
from ..processing.markers import render_step_image
from .storage import resolve_path

CALLOUT_BADGES = {"info": "ℹ️", "warning": "⚠️", "caution": "🛑"}


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "guide"


def instruction_markdown(text: str) -> str:
    if "<" not in text:
        return text
    return markdownify(text, strip=["span"]).strip().replace("\n\n\n", "\n\n")


def _step_image(step: Step, db: Session, marker_color: str) -> bytes | None:
    # Redacted derivative wins — never export unblurred pixels once redactions exist.
    shot_id = step.redacted_screenshot_id or step.screenshot_id
    if not shot_id:
        return None
    shot = db.get(Screenshot, shot_id)
    if shot is None:
        return None
    with Image.open(resolve_path(shot.file_path)) as img:
        rendered = render_step_image(
            img,
            click=step.click,
            annotations=step.annotations or [],
            crop=step.crop,
            color=marker_color,
        )
    buf = io.BytesIO()
    rendered.save(buf, format="PNG")
    return buf.getvalue()


def build_markdown_zip(guide: Guide, db: Session, marker_color: str) -> tuple[bytes, str]:
    buf = io.BytesIO()
    lines: list[str] = [f"# {guide.title}", ""]
    if guide.description:
        lines += [guide.description, ""]

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for i, step in enumerate(guide.steps, start=1):
            heading = instruction_markdown(step.instruction_text).replace("\n", " ").strip()
            lines += [f"## {i}. {heading}", ""]
            if step.callout_type and step.callout_text:
                badge = CALLOUT_BADGES.get(step.callout_type, "")
                lines += [f"> {badge} **{step.callout_type.title()}:** {step.callout_text}", ""]
            image = _step_image(step, db, marker_color)
            if image is not None:
                asset_name = f"assets/step-{i:02d}.png"
                zf.writestr(asset_name, image)
                lines += [f"![Step {i}]({asset_name})", ""]

        zf.writestr("guide.md", "\n".join(lines).rstrip() + "\n")

    return buf.getvalue(), f"{slugify(guide.title)}.zip"

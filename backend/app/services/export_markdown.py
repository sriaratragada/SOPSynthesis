"""Markdown export: a ZIP of guide.md + assets/ with markers burned into copies."""

import io
import re
import zipfile

from PIL import Image
from sqlalchemy.orm import Session

from ..models import Guide, Screenshot
from ..processing.markers import burn_marker
from .storage import resolve_path

CALLOUT_BADGES = {"info": "ℹ️", "warning": "⚠️", "caution": "🛑"}


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "guide"


def build_markdown_zip(guide: Guide, db: Session, marker_color: str) -> tuple[bytes, str]:
    buf = io.BytesIO()
    lines: list[str] = [f"# {guide.title}", ""]
    if guide.description:
        lines += [guide.description, ""]

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for i, step in enumerate(guide.steps, start=1):
            lines += [f"## {i}. {step.instruction_text}", ""]
            if step.callout_type and step.callout_text:
                badge = CALLOUT_BADGES.get(step.callout_type, "")
                lines += [f"> {badge} **{step.callout_type.title()}:** {step.callout_text}", ""]
            if step.screenshot_id:
                shot = db.get(Screenshot, step.screenshot_id)
                if shot:
                    asset_name = f"assets/step-{i:02d}.png"
                    with Image.open(resolve_path(shot.file_path)) as img:
                        rendered = burn_marker(img, step.click, marker_color) if step.click else img.copy()
                    img_buf = io.BytesIO()
                    rendered.save(img_buf, format="PNG")
                    zf.writestr(asset_name, img_buf.getvalue())
                    lines += [f"![Step {i}]({asset_name})", ""]

        zf.writestr("guide.md", "\n".join(lines).rstrip() + "\n")

    return buf.getvalue(), f"{slugify(guide.title)}.zip"

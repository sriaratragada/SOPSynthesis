"""Server-side redaction: pixelate regions into a DERIVED image.

The original screenshot is never modified — undo is just clearing the step's
redacted_screenshot_id. Derived images are content-addressed like any other
screenshot and garbage-collected when unreferenced.
"""

import io

from PIL import Image
from sqlalchemy.orm import Session

from ..models import Screenshot
from ..schemas import RedactionRect
from .storage import resolve_path, save_screenshot

PIXEL_BLOCK = 14  # pixelation block size divisor — bigger regions, bigger blocks


def apply_redactions(
    original: Screenshot, redactions: list[RedactionRect], db: Session
) -> str | None:
    """Render the pixelated derivative; returns its screenshot id (or None if no-op)."""
    if not redactions:
        return None

    with Image.open(resolve_path(original.file_path)) as src:
        img = src.convert("RGB")
    w, h = img.size

    touched = False
    for rect in redactions:
        x0 = max(0, int(rect.nx * w))
        y0 = max(0, int(rect.ny * h))
        x1 = min(w, int((rect.nx + rect.nw) * w))
        y1 = min(h, int((rect.ny + rect.nh) * h))
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        region = img.crop((x0, y0, x1, y1))
        small = region.resize(
            (max(1, (x1 - x0) // PIXEL_BLOCK), max(1, (y1 - y0) // PIXEL_BLOCK)),
            Image.BILINEAR,
        )
        img.paste(small.resize((x1 - x0, y1 - y0), Image.NEAREST), (x0, y0))
        touched = True

    if not touched:
        return None

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    sha, rel_path, width, height = save_screenshot(buf.getvalue())
    if db.get(Screenshot, sha) is None:
        db.add(
            Screenshot(id=sha, file_path=rel_path, width=width, height=height, dpr=original.dpr)
        )
        db.flush()
    return sha

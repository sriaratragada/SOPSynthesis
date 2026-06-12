"""Content-addressed screenshot store: data/screenshots/{sha[:2]}/{sha}.png.

Identical frames (e.g. the capture cache reusing one screenshot for two rapid
clicks) hash to the same path and are stored once. Paths are stored relative to
the data dir so the whole data/ folder is relocatable.
"""

import hashlib
import io
from pathlib import Path

from PIL import Image

from ..config import get_settings


def save_screenshot(png_bytes: bytes) -> tuple[str, str, int, int]:
    """Persist PNG bytes; returns (sha256, relative_path, width, height)."""
    settings = get_settings()
    sha = hashlib.sha256(png_bytes).hexdigest()
    rel_path = Path("screenshots") / sha[:2] / f"{sha}.png"
    abs_path = settings.data_dir / rel_path
    if not abs_path.exists():
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        abs_path.write_bytes(png_bytes)
    with Image.open(io.BytesIO(png_bytes)) as img:
        width, height = img.size
    return sha, rel_path.as_posix(), width, height


def resolve_path(relative_path: str) -> Path:
    return get_settings().data_dir / relative_path


def delete_screenshot_file(relative_path: str) -> None:
    path = resolve_path(relative_path)
    if path.exists():
        path.unlink()

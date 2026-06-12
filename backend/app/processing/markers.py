"""Burn click markers into screenshot copies — used only at export time.

The web app renders markers as live overlays from normalized coordinates;
originals on disk are never modified.
"""

from PIL import Image, ImageDraw


def _hex_to_rgba(hex_color: str, alpha: int) -> tuple[int, int, int, int]:
    h = hex_color.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), alpha)


def burn_marker(img: Image.Image, click: dict, color: str = "#FF5C35") -> Image.Image:
    base = img.convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    w, h = base.size

    bbox = click.get("bbox")
    if bbox:
        x0, y0 = bbox["nx"] * w, bbox["ny"] * h
        x1, y1 = x0 + bbox["nw"] * w, y0 + bbox["nh"] * h
        pad = 4
        draw.rounded_rectangle(
            [x0 - pad, y0 - pad, x1 + pad, y1 + pad],
            radius=6,
            outline=_hex_to_rgba(color, 230),
            width=3,
        )

    cx, cy = click["nx"] * w, click["ny"] * h
    radius = max(14, int(w * 0.018))
    draw.ellipse(
        [cx - radius, cy - radius, cx + radius, cy + radius],
        fill=_hex_to_rgba(color, 80),
        outline=_hex_to_rgba(color, 230),
        width=max(3, radius // 5),
    )

    return Image.alpha_composite(base, overlay).convert("RGB")

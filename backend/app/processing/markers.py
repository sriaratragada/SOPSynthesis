"""Render a step's visual state into pixels — used only at export time.

The web app renders everything (markers, annotations, crop, redactions) as live
overlays from normalized coordinates; originals on disk are never modified.
Exports replay the same ops here with Pillow: redacted base image → crop →
annotations → click marker, with all coordinates transformed into crop space.
"""

import math

from PIL import Image, ImageDraw, ImageFont


def _hex_to_rgba(hex_color: str, alpha: int) -> tuple[int, int, int, int]:
    h = hex_color.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), alpha)


def _crop_transform(crop: dict | None):
    """Returns (tx, ty) mapping original-image fractions → cropped-image fractions."""
    if not crop:
        return (lambda nx: nx), (lambda ny: ny)
    return (
        lambda nx: (nx - crop["nx"]) / crop["nw"],
        lambda ny: (ny - crop["ny"]) / crop["nh"],
    )


def _load_font(size: int) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


def _draw_arrow(draw: ImageDraw.ImageDraw, x0, y0, x1, y1, color, width: int) -> None:
    draw.line([x0, y0, x1, y1], fill=color, width=width)
    angle = math.atan2(y1 - y0, x1 - x0)
    head = max(10, width * 4)
    for offset in (math.pi / 7, -math.pi / 7):
        draw.line(
            [
                x1,
                y1,
                x1 - head * math.cos(angle + offset),
                y1 - head * math.sin(angle + offset),
            ],
            fill=color,
            width=width,
        )


def render_step_image(
    img: Image.Image,
    click: dict | None,
    annotations: list[dict] | None = None,
    crop: dict | None = None,
    color: str = "#FF5C35",
) -> Image.Image:
    base = img.convert("RGBA")

    if crop:
        w, h = base.size
        box = (
            max(0, int(crop["nx"] * w)),
            max(0, int(crop["ny"] * h)),
            min(w, int((crop["nx"] + crop["nw"]) * w)),
            min(h, int((crop["ny"] + crop["nh"]) * h)),
        )
        if box[2] - box[0] > 1 and box[3] - box[1] > 1:
            base = base.crop(box)

    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    w, h = base.size
    tx, ty = _crop_transform(crop)
    stroke = max(3, int(w * 0.003))

    for ann in annotations or []:
        ann_color = _hex_to_rgba(ann.get("color", color), 230)
        if ann["kind"] == "arrow":
            x0, y0 = tx(ann["nx"]) * w, ty(ann["ny"]) * h
            x1, y1 = tx(ann.get("nx2", ann["nx"])) * w, ty(ann.get("ny2", ann["ny"])) * h
            _draw_arrow(draw, x0, y0, x1, y1, ann_color, stroke)
            continue
        x0, y0 = tx(ann["nx"]) * w, ty(ann["ny"]) * h
        x1, y1 = tx(ann["nx"] + ann["nw"]) * w, ty(ann["ny"] + ann["nh"]) * h
        if x1 < x0:
            x0, x1 = x1, x0
        if y1 < y0:
            y0, y1 = y1, y0
        if ann["kind"] == "rect":
            draw.rounded_rectangle([x0, y0, x1, y1], radius=6, outline=ann_color, width=stroke)
        elif ann["kind"] == "ellipse":
            draw.ellipse([x0, y0, x1, y1], outline=ann_color, width=stroke)
        elif ann["kind"] == "text" and ann.get("text"):
            font = _load_font(max(16, int(w * 0.018)))
            draw.text(
                (x0, y0),
                ann["text"],
                fill=ann_color,
                font=font,
                stroke_width=2,
                stroke_fill=(255, 255, 255, 255),
            )

    if click:
        cx, cy = tx(click["nx"]) * w, ty(click["ny"]) * h
        if -0.05 * w <= cx <= 1.05 * w and -0.05 * h <= cy <= 1.05 * h:
            bbox = click.get("bbox")
            if bbox:
                bx0, by0 = tx(bbox["nx"]) * w, ty(bbox["ny"]) * h
                bx1, by1 = tx(bbox["nx"] + bbox["nw"]) * w, ty(bbox["ny"] + bbox["nh"]) * h
                pad = 4
                draw.rounded_rectangle(
                    [bx0 - pad, by0 - pad, bx1 + pad, by1 + pad],
                    radius=6,
                    outline=_hex_to_rgba(color, 230),
                    width=3,
                )
            radius = max(14, int(w * 0.018))
            draw.ellipse(
                [cx - radius, cy - radius, cx + radius, cy + radius],
                fill=_hex_to_rgba(color, 80),
                outline=_hex_to_rgba(color, 230),
                width=max(3, radius // 5),
            )

    return Image.alpha_composite(base, overlay).convert("RGB")


def burn_marker(img: Image.Image, click: dict, color: str = "#FF5C35") -> Image.Image:
    """Marker-only rendering (kept for callers that need just the click overlay)."""
    return render_step_image(img, click, annotations=None, crop=None, color=color)

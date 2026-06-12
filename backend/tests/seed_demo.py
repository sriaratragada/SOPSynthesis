"""Seed a demo guide through the live HTTP API (backend must be running).

Generates mock-UI screenshots so the click-marker overlay can be verified
visually in the web app. Usage:
    .venv\\Scripts\\python -m tests.seed_demo
"""

import io
import json

import httpx
from PIL import Image, ImageDraw

API = "http://127.0.0.1:8787/api"
W, H = 1280, 720


def mock_page(button_label: str, button_box: tuple[int, int, int, int]) -> bytes:
    img = Image.new("RGB", (W, H), (248, 249, 251))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 56], fill=(32, 38, 50))  # top nav
    d.text((24, 20), "Acme Admin", fill=(255, 255, 255))
    for i, label in enumerate(["Dashboard", "Requests", "Reports"]):
        d.text((180 + i * 110, 20), label, fill=(190, 198, 210))
    d.rounded_rectangle([80, 120, 1200, 660], radius=12, fill=(255, 255, 255),
                        outline=(225, 228, 234))
    d.text((110, 150), "Pending approval requests", fill=(40, 44, 52))
    d.rounded_rectangle([110, 200, 520, 240], radius=8, fill=(244, 245, 247),
                        outline=(210, 214, 222))
    d.text((126, 212), "Search requests…", fill=(150, 155, 165))
    x0, y0, x1, y1 = button_box
    d.rounded_rectangle(button_box, radius=8, fill=(255, 92, 53))
    d.text(((x0 + x1) / 2 - len(button_label) * 3, (y0 + y1) / 2 - 6),
           button_label, fill=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def event(seq, etype, ts, url, title, element=None, click=None, typed=None):
    return {
        "seq": seq, "type": etype, "ts": ts, "url": url, "pageTitle": title,
        "viewport": {"w": W, "h": H, "dpr": 1.0, "scrollX": 0, "scrollY": 0},
        "element": element, "click": click, "typed": typed,
    }


def click_at(x, y, box=None):
    out = {"nx": x / W, "ny": y / H, "clientX": x, "clientY": y}
    if box:
        x0, y0, x1, y1 = box
        out["bbox"] = {"nx": x0 / W, "ny": y0 / H, "nw": (x1 - x0) / W, "nh": (y1 - y0) / H}
    return out


def main() -> None:
    with httpx.Client(timeout=10) as http:
        rec = http.post(f"{API}/recordings").json()["id"]
        url = "https://admin.acme.test/requests"
        title = "Approval Dashboard — Acme Admin"

        page1 = mock_page("Approve", (840, 320, 960, 360))
        page2 = mock_page("Confirm", (560, 400, 700, 440))

        uploads = [
            (event(0, "click", 1000, url, title,
                   element={"tag": "input", "placeholder": "Search requests…", "type": "text",
                            "selector": "#search"},
                   click=click_at(300, 220, (110, 200, 520, 240))), page1),
            (event(1, "type", 2500, url, title,
                   element={"tag": "input", "placeholder": "Search requests…", "type": "text"},
                   typed={"value": "Q3 budget", "masked": False}), None),
            (event(2, "click", 8000, url, title,
                   element={"tag": "button", "text": "Approve", "selector": "#approve",
                            "region": "top navigation"},
                   click=click_at(900, 340, (840, 320, 960, 360))), page1),
            (event(3, "click", 14000, url + "/confirm", title,
                   element={"tag": "button", "text": "Confirm", "selector": "#confirm"},
                   click=click_at(630, 420, (560, 400, 700, 440))), page2),
        ]
        for ev, png in uploads:
            files = {"screenshot": ("shot.png", png, "image/png")} if png else None
            r = http.post(f"{API}/recordings/{rec}/events",
                          data={"event": json.dumps(ev)}, files=files)
            r.raise_for_status()

        guide_id = http.post(f"{API}/recordings/{rec}/finalize").json()["guideId"]
        guide = http.get(f"{API}/guides/{guide_id}").json()
        print(f"guideId: {guide_id}")
        print(f"title:   {guide['title']}")
        for s in guide["steps"]:
            print(f"  {s['position'] + 1}. {s['instructionText']}")


if __name__ == "__main__":
    main()

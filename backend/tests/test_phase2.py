import io
import zipfile

from PIL import Image

from app.processing.sensitive import scan_for_sensitive
from app.services.export_markdown import instruction_markdown

from .helpers import click_event, type_event


def make_guide(client, png_bytes, events=None) -> str:
    recording_id = client.post("/api/recordings").json()["id"]
    for ev, png in events or [
        (click_event(0, 1000, text="Open settings"), png_bytes),
        (click_event(1, 5000, selector="#save", text="Save"), png_bytes),
    ]:
        files = {"screenshot": ("shot.png", png, "image/png")} if png else None
        r = client.post(
            f"/api/recordings/{recording_id}/events",
            data={"event": ev.model_dump_json()},
            files=files,
        )
        assert r.status_code == 200, r.text
    return client.post(f"/api/recordings/{recording_id}/finalize").json()["guideId"]


# ---------- schema migration ----------


def test_ensure_schema_adds_columns_to_v1_db(tmp_path):
    from sqlalchemy import create_engine, text

    from app.db import ensure_schema

    v1_engine = create_engine(f"sqlite:///{tmp_path / 'v1.db'}")
    with v1_engine.begin() as conn:
        conn.execute(
            text(
                """CREATE TABLE steps (
                    id TEXT PRIMARY KEY, guide_id TEXT, position INTEGER,
                    screenshot_id TEXT, instruction_text TEXT,
                    instruction_overridden BOOLEAN, callout_type TEXT,
                    callout_text TEXT, click JSON, meta JSON)"""
            )
        )
        conn.execute(
            text("INSERT INTO steps (id, guide_id, position) VALUES ('s1', 'g1', 0)")
        )

    ensure_schema(v1_engine)

    with v1_engine.connect() as conn:
        columns = {row[1] for row in conn.execute(text("PRAGMA table_info(steps)"))}
        assert {"annotations", "redactions", "crop", "redacted_screenshot_id", "flags"} <= columns
        # existing rows survive with defaults
        row = conn.execute(text("SELECT annotations, flags FROM steps")).fetchone()
        assert row == ("[]", "{}")

    ensure_schema(v1_engine)  # idempotent


# ---------- redaction ----------


def gradient_png() -> bytes:
    """Non-uniform image: pixelation must actually change pixels (a solid-color
    fixture pixelates to identical bytes and content-addresses to the same id)."""
    img = Image.new("RGB", (1280, 720))
    img.putdata([(x % 256, y % 256, (x + y) % 256) for y in range(720) for x in range(1280)])
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_redaction_creates_derived_image_and_is_undoable(client):
    png_bytes = gradient_png()
    guide_id = make_guide(client, png_bytes)
    step = client.get(f"/api/guides/{guide_id}").json()["steps"][0]
    original_id = step["screenshotId"]

    patched = client.patch(
        f"/api/guides/{guide_id}/steps/{step['id']}",
        json={
            "clearCallout": False,
            "redactions": [{"id": "r1", "nx": 0.25, "ny": 0.25, "nw": 0.2, "nh": 0.2}],
        },
    ).json()
    derived_id = patched["redactedScreenshotId"]
    assert derived_id and derived_id != original_id

    original_png = client.get(f"/api/screenshots/{original_id}").content
    derived_png = client.get(f"/api/screenshots/{derived_id}").content
    assert derived_png != original_png
    # original untouched on disk
    assert client.get(f"/api/screenshots/{original_id}").content == original_png

    # undo: clearing redactions drops the derived reference
    cleared = client.patch(
        f"/api/guides/{guide_id}/steps/{step['id']}",
        json={"clearCallout": False, "redactions": []},
    ).json()
    assert cleared["redactedScreenshotId"] is None
    assert cleared["screenshotId"] == original_id


# ---------- annotations / crop persistence ----------


def test_annotations_and_crop_round_trip(client, png_bytes):
    guide_id = make_guide(client, png_bytes)
    step = client.get(f"/api/guides/{guide_id}").json()["steps"][0]

    annotations = [
        {"id": "a1", "kind": "rect", "nx": 0.1, "ny": 0.1, "nw": 0.3, "nh": 0.2,
         "color": "#00AA00"},
        {"id": "a2", "kind": "arrow", "nx": 0.5, "ny": 0.5, "nx2": 0.7, "ny2": 0.3},
        {"id": "a3", "kind": "text", "nx": 0.2, "ny": 0.8, "text": "Check this"},
    ]
    crop = {"nx": 0.05, "ny": 0.05, "nw": 0.8, "nh": 0.7}
    patched = client.patch(
        f"/api/guides/{guide_id}/steps/{step['id']}",
        json={"clearCallout": False, "annotations": annotations, "crop": crop},
    ).json()
    assert [a["id"] for a in patched["annotations"]] == ["a1", "a2", "a3"]
    assert patched["crop"]["nw"] == 0.8

    # crop: null clears it; annotations: [] clears them
    cleared = client.patch(
        f"/api/guides/{guide_id}/steps/{step['id']}",
        json={"clearCallout": False, "crop": None, "annotations": []},
    ).json()
    assert cleared["crop"] is None
    assert cleared["annotations"] == []


# ---------- step operations ----------


def test_duplicate_split_merge(client, png_bytes):
    guide_id = make_guide(client, png_bytes)
    steps = client.get(f"/api/guides/{guide_id}").json()["steps"]
    first, second = steps[0], steps[1]

    dup = client.post(f"/api/guides/{guide_id}/steps/{first['id']}:duplicate").json()
    assert dup["instructionText"] == first["instructionText"]
    assert dup["screenshotId"] == first["screenshotId"]
    order = client.get(f"/api/guides/{guide_id}").json()["steps"]
    assert [s["id"] for s in order] == [first["id"], dup["id"], second["id"]]
    assert [s["position"] for s in order] == [0, 1, 2]

    halves = client.post(f"/api/guides/{guide_id}/steps/{second['id']}:split").json()
    assert halves[0]["id"] == second["id"]
    assert halves[1]["instructionText"] == "Describe this step…"
    assert halves[1]["screenshotId"] == second["screenshotId"]
    assert len(client.get(f"/api/guides/{guide_id}").json()["steps"]) == 4

    merged = client.post(
        f"/api/guides/{guide_id}/steps:merge",
        json={"stepIds": [dup["id"], first["id"]]},  # order-insensitive
    ).json()
    assert merged["id"] == first["id"]  # earlier position wins
    assert merged["instructionText"].count("<p>") == 2
    remaining = client.get(f"/api/guides/{guide_id}").json()["steps"]
    assert len(remaining) == 3
    assert [s["position"] for s in remaining] == [0, 1, 2]

    self_merge = client.post(
        f"/api/guides/{guide_id}/steps:merge", json={"stepIds": [first["id"], first["id"]]}
    )
    assert self_merge.status_code == 422


# ---------- smart-blur ----------


def test_scan_for_sensitive_categories():
    assert scan_for_sensitive("contact me at jo.smith+a@example.co.uk") == ["email"]
    assert scan_for_sensitive("ssn 123-45-6789") == ["ssn"]
    assert scan_for_sensitive("card 4242 4242 4242 4242") == ["card"]
    assert scan_for_sensitive("order number 1234 5678 9012 3456") == []  # fails Luhn
    assert scan_for_sensitive("nothing here", None, "") == []
    assert scan_for_sensitive("a@b.io and 123-45-6789") == ["email", "ssn"]


def test_finalize_flags_sensitive_steps(client, png_bytes):
    events = [
        (click_event(0, 1000, text="Open billing"), png_bytes),
        (type_event(1, 3000, "billing@acme.com", label="Account email"), None),
        (click_event(2, 8000, text="Save"), png_bytes),
    ]
    guide_id = make_guide(client, png_bytes, events)
    steps = client.get(f"/api/guides/{guide_id}").json()["steps"]
    assert steps[1]["flags"]["sensitive"] == ["email"]
    assert steps[0]["flags"]["sensitive"] == []

    # dismissing the flag via PATCH
    dismissed = client.patch(
        f"/api/guides/{guide_id}/steps/{steps[1]['id']}",
        json={"clearCallout": False, "flags": {"sensitive": []}},
    ).json()
    assert dismissed["flags"]["sensitive"] == []


# ---------- export replay ----------


def test_export_replays_crop_redaction_annotations(client, png_bytes):
    guide_id = make_guide(client, png_bytes)
    step = client.get(f"/api/guides/{guide_id}").json()["steps"][0]
    patch_response = client.patch(
        f"/api/guides/{guide_id}/steps/{step['id']}",
        json={
            "clearCallout": False,
            "redactions": [{"id": "r1", "nx": 0.3, "ny": 0.3, "nw": 0.1, "nh": 0.1}],
            "crop": {"nx": 0.0, "ny": 0.0, "nw": 0.5, "nh": 0.5},
            "annotations": [
                {"id": "a1", "kind": "arrow", "nx": 0.1, "ny": 0.1, "nx2": 0.3, "ny2": 0.3}
            ],
        },
    )
    assert patch_response.status_code == 200, patch_response.text

    response = client.get(f"/api/guides/{guide_id}/export/markdown")
    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
        with Image.open(io.BytesIO(zf.read("assets/step-01.png"))) as img:
            width, height = img.size
    # source fixture is 1280x720; a 0.5x0.5 crop must export at 640x360
    assert (width, height) == (640, 360)


def test_instruction_markdown_conversion():
    assert instruction_markdown("plain text") == "plain text"
    assert (
        instruction_markdown("<p>Click <strong>Save</strong></p><p>Then <em>wait</em></p>")
        == "Click **Save**\n\nThen *wait*"
    )


# ---------- settings / branding ----------


def test_settings_and_logo_round_trip(client):
    initial = client.get("/api/settings").json()
    assert initial == {"markerColor": "#FF5C35", "hasLogo": False}

    patched = client.patch("/api/settings", json={"markerColor": "#3366FF"}).json()
    assert patched["markerColor"] == "#3366FF"
    assert client.patch("/api/settings", json={"markerColor": "red"}).status_code == 422

    logo = Image.new("RGB", (64, 64), (10, 20, 30))
    buf = io.BytesIO()
    logo.save(buf, format="PNG")
    uploaded = client.post(
        "/api/settings/logo", files={"logo": ("logo.png", buf.getvalue(), "image/png")}
    ).json()
    assert uploaded["hasLogo"] is True
    assert client.get("/api/settings/logo").status_code == 200

    removed = client.delete("/api/settings/logo").json()
    assert removed["hasLogo"] is False
    assert client.get("/api/settings/logo").status_code == 404

    # restore default color for other tests
    client.patch("/api/settings", json={"markerColor": "#FF5C35"})

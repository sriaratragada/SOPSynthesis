import io
import json
import os
import zipfile
from pathlib import Path

from .helpers import click_event, nav_event, type_event


def post_event(client, recording_id, event, png: bytes | None = None):
    files = {"screenshot": ("shot.png", png, "image/png")} if png else None
    response = client.post(
        f"/api/recordings/{recording_id}/events",
        data={"event": event.model_dump_json()},
        files=files,
    )
    assert response.status_code == 200, response.text
    return response.json()


def record_synthetic_flow(client, png_bytes) -> str:
    """A realistic mini-flow: field click, typing, search click, nav, result click,
    accidental double-click, then a standalone manual navigation."""
    recording_id = client.post("/api/recordings").json()["id"]
    wiki = "https://en.wikipedia.org"
    events = [
        (click_event(0, 1000, selector="#search", tag="input", text=None, url=wiki,
                     page_title="Wikipedia", input_type="text"), png_bytes),
        (type_event(1, 2000, "synthesis", label="Search Wikipedia", url=wiki), None),
        (click_event(2, 9000, selector="#go", text="Search", url=wiki,
                     page_title="Wikipedia"), png_bytes),
        (nav_event(3, 9300, url=f"{wiki}/results"), None),          # dropped: nav-after-click
        (click_event(4, 15000, selector="a.result", tag="a", text="Synthesis",
                     url=f"{wiki}/results", page_title="Search results"), png_bytes),
        (click_event(5, 15100, selector="a.result", tag="a", text="Synthesis",
                     url=f"{wiki}/results", page_title="Search results"), png_bytes),  # double-click
        (nav_event(6, 30000, url="https://example.com/manual"), None),  # standalone nav step
    ]
    for event, png in events:
        post_event(client, recording_id, event, png)
    return recording_id


def test_full_round_trip(client, png_bytes):
    recording_id = record_synthetic_flow(client, png_bytes)

    status = client.get(f"/api/recordings/{recording_id}").json()
    assert status["status"] == "recording"
    assert status["eventCount"] == 7

    # idempotent re-POST of an existing seq
    dup = post_event(client, recording_id, click_event(0, 1000), png_bytes)
    assert dup["duplicate"] is True

    guide_id = client.post(f"/api/recordings/{recording_id}/finalize").json()["guideId"]
    # finalize is idempotent too
    assert client.post(f"/api/recordings/{recording_id}/finalize").json()["guideId"] == guide_id

    guide = client.get(f"/api/guides/{guide_id}").json()
    instructions = [s["instructionText"] for s in guide["steps"]]
    assert instructions == [
        'Click the input element',
        'Type "synthesis" in the "Search Wikipedia" field',
        'Click "Search"',
        'Click the "Synthesis" link',
        "Navigate to example.com",
    ]
    assert guide["title"] == "Wikipedia — workflow"

    # the type step borrows the screenshot of the click that focused the field
    assert guide["steps"][1]["screenshotId"] == guide["steps"][0]["screenshotId"]
    # click steps carry normalized coordinates for the overlay
    assert guide["steps"][0]["click"]["nx"] == 0.5
    # the standalone navigation step has no screenshot
    assert guide["steps"][4]["screenshotId"] is None

    shot_id = guide["steps"][0]["screenshotId"]
    shot = client.get(f"/api/screenshots/{shot_id}")
    assert shot.status_code == 200
    assert shot.headers["content-type"] == "image/png"


def test_editing_and_regenerate(client, png_bytes):
    recording_id = record_synthetic_flow(client, png_bytes)
    guide_id = client.post(f"/api/recordings/{recording_id}/finalize").json()["guideId"]
    guide = client.get(f"/api/guides/{guide_id}").json()
    step = guide["steps"][2]

    # manual edit marks the step overridden
    edited = client.patch(
        f"/api/guides/{guide_id}/steps/{step['id']}",
        json={"instructionText": "Hit the big search button"},
    ).json()
    assert edited["instructionOverridden"] is True

    # regenerate respects the override unless forced
    same = client.post(f"/api/guides/{guide_id}/steps/{step['id']}:regenerate", json={}).json()
    assert same["instructionText"] == "Hit the big search button"
    forced = client.post(
        f"/api/guides/{guide_id}/steps/{step['id']}:regenerate", json={"force": True}
    ).json()
    assert forced["instructionText"] == 'Click "Search"'
    assert forced["instructionOverridden"] is False

    # callouts
    with_callout = client.patch(
        f"/api/guides/{guide_id}/steps/{step['id']}",
        json={"calloutType": "warning", "calloutText": "Check the filters first"},
    ).json()
    assert with_callout["calloutType"] == "warning"

    # reorder: reverse the steps
    step_ids = [s["id"] for s in client.get(f"/api/guides/{guide_id}").json()["steps"]]
    reversed_ids = list(reversed(step_ids))
    reordered = client.post(
        f"/api/guides/{guide_id}/steps:reorder", json={"stepIds": reversed_ids}
    ).json()
    assert [s["id"] for s in reordered] == reversed_ids

    # delete a step → positions reindex contiguously
    assert client.delete(f"/api/guides/{guide_id}/steps/{step_ids[0]}").status_code == 204
    positions = [s["position"] for s in client.get(f"/api/guides/{guide_id}").json()["steps"]]
    assert positions == list(range(len(step_ids) - 1))

    # guide metadata patch
    patched = client.patch(f"/api/guides/{guide_id}", json={"title": "My SOP"}).json()
    assert patched["title"] == "My SOP"


def test_markdown_export(client, png_bytes):
    recording_id = record_synthetic_flow(client, png_bytes)
    guide_id = client.post(f"/api/recordings/{recording_id}/finalize").json()["guideId"]

    response = client.get(f"/api/guides/{guide_id}/export/markdown")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"

    with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
        names = zf.namelist()
        assert "guide.md" in names
        assert any(n.startswith("assets/step-") for n in names)
        markdown = zf.read("guide.md").decode("utf-8")
    assert markdown.startswith("# Wikipedia — workflow")
    assert "## 3. Click \"Search\"" in markdown
    assert "![Step 1](assets/step-01.png)" in markdown


def test_masked_password_value_never_persisted(client, png_bytes):
    recording_id = client.post("/api/recordings").json()["id"]
    secret = "hunter2-super-secret"
    # A buggy/malicious client sends the masked value anyway — server must blank it.
    post_event(client, recording_id, type_event(0, 1000, secret, masked=True, label="Password"))
    post_event(client, recording_id, click_event(1, 5000, text="Sign in"), png_bytes)
    guide_id = client.post(f"/api/recordings/{recording_id}/finalize").json()["guideId"]

    guide = client.get(f"/api/guides/{guide_id}").json()
    assert secret not in json.dumps(guide)
    assert guide["steps"][0]["instructionText"] == 'Type your password in the "Password" field'

    db_path = Path(os.environ["SOPS_DATA_DIR"]) / "sops.db"
    assert secret.encode() not in db_path.read_bytes()


def test_delete_guide_gcs_screenshots(client, png_bytes):
    recording_id = client.post("/api/recordings").json()["id"]
    post_event(client, recording_id, click_event(0, 1000, text="Only"), png_bytes)
    guide_id = client.post(f"/api/recordings/{recording_id}/finalize").json()["guideId"]
    shot_id = client.get(f"/api/guides/{guide_id}").json()["steps"][0]["screenshotId"]

    assert client.delete(f"/api/guides/{guide_id}").status_code == 204
    assert client.get(f"/api/guides/{guide_id}").status_code == 404
    # NOTE: other tests share the same fixture PNG (same sha), so the screenshot
    # row may legitimately survive if still referenced. Verify via the API:
    remaining_refs = [
        step["screenshotId"]
        for summary in client.get("/api/guides").json()
        for step in client.get(f"/api/guides/{summary['id']}").json()["steps"]
    ]
    if shot_id not in remaining_refs:
        assert client.get(f"/api/screenshots/{shot_id}").status_code == 404

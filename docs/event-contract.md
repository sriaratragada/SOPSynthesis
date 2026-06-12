# Capture Event Contract

This is the normative JSON contract for events the extension sends to the backend.
The Pydantic models in `backend/app/schemas.py` are the executable source of truth;
this document explains the semantics.

## Transport

Each event is POSTed individually as it happens:

```
POST /api/recordings/{recordingId}/events
Content-Type: multipart/form-data

event:      JSON string (CaptureEvent, below)
screenshot: PNG bytes (optional — present for click events only)
```

Idempotency: `(recording_id, seq)` is unique. Re-POSTing the same seq is a no-op
returning the original result, which makes the extension's retry queue safe.

## CaptureEvent

```jsonc
{
  "seq": 3,                    // monotonic per recording, assigned by the service worker
  "type": "click",             // "click" | "type" | "navigate"
  "ts": 1760000000000,         // epoch ms, Date.now() at capture
  "url": "https://example.com/page",
  "pageTitle": "Example Page",
  "tabId": 123456,

  // viewport state at the moment of the event
  "viewport": {
    "w": 1536,                 // window.innerWidth (CSS px)
    "h": 695,                  // window.innerHeight (CSS px)
    "dpr": 1.25,               // window.devicePixelRatio
    "scrollX": 0,
    "scrollY": 480
  },

  // click events only
  "click": {
    "nx": 0.4123,              // clientX / viewport.w  — normalized 0..1
    "ny": 0.5511,              // clientY / viewport.h
    "clientX": 633,            // raw values kept for forensics
    "clientY": 383,
    "bbox": {                  // element bounding box, normalized to viewport
      "nx": 0.39, "ny": 0.52, "nw": 0.08, "nh": 0.05
    }
  },

  // click + type events: extracted element metadata
  "element": {
    "tag": "button",
    "text": "Approve",         // trimmed visible text, max 80 chars
    "ariaLabel": null,
    "placeholder": null,
    "name": null,
    "id": "approve-btn",
    "role": null,
    "type": "submit",          // input/button type attribute
    "href": null,
    "alt": null,
    "selector": "#approve-btn",// best-effort robust CSS selector
    "region": "top navigation" // ancestor landmark hint, or null
  },

  // type events only
  "typed": {
    "value": "Q3 report",      // truncated to 100 chars; "" if masked
    "masked": false            // true for password fields — value NEVER captured
  }
}
```

## Coordinate model

`chrome.tabs.captureVisibleTab` captures exactly the visible viewport, so a click at
`clientX / innerWidth = 0.41` is at `0.41 * imageWidth` in the screenshot regardless
of devicePixelRatio or page zoom. All positions are therefore stored as normalized
0–1 fractions of the viewport and rendered as percentage offsets over the image.
Raw client coordinates, viewport size, and dpr are retained in the payload only for
debugging.

## Event semantics

- **click** — one per `pointerdown` on the page. Carries a screenshot taken *before*
  any navigation the click triggers.
- **type** — coalesced text entry for one focused field, flushed on blur, Enter, or
  the next click. Password fields are masked at the source: the value never leaves
  the page.
- **navigate** — emitted by the service worker from `webNavigation` events (full
  loads and SPA history updates). No screenshot. Mostly consumed by dedup; surviving
  standalone navigations become "Navigate to {domain}" steps.

Scrolls do not produce events; they only refresh `scrollX`/`scrollY` on subsequent
events.

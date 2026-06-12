// Content script: arms capture-phase listeners while a recording is active.
// Declared in the manifest for <all_urls>, so it is present on every page; the
// GET_STATE handshake on startup tells it whether to arm — this is what makes
// recording survive navigations and domain changes with no re-injection.

import type { BroadcastMessage, SessionSnapshot } from "../shared/messages";
import type { PageEvent } from "../shared/types";
import { extractElementMeta, normalizedBBox } from "./element-meta";
import { flushTyping, initTypingCapture, resetTyping } from "./typing";

let armed = false;

function send(event: PageEvent): void {
  try {
    void chrome.runtime.sendMessage({ kind: "PAGE_EVENT", event });
  } catch {
    // Extension was reloaded; this page's script is orphaned. Disarm quietly.
    armed = false;
  }
}

function onPointerDown(e: PointerEvent): void {
  if (!armed || e.button !== 0) return;
  const target = e.target;
  if (!(target instanceof Element)) return;

  // Typing in progress becomes its own step BEFORE the click that follows it.
  flushTyping();

  send({
    type: "click",
    ts: Date.now(),
    url: location.href,
    pageTitle: document.title,
    viewport: {
      w: window.innerWidth,
      h: window.innerHeight,
      dpr: window.devicePixelRatio,
      scrollX: Math.round(window.scrollX),
      scrollY: Math.round(window.scrollY),
    },
    click: {
      nx: e.clientX / window.innerWidth,
      ny: e.clientY / window.innerHeight,
      clientX: Math.round(e.clientX),
      clientY: Math.round(e.clientY),
      bbox: normalizedBBox(target),
    },
    element: extractElementMeta(target),
  });
}

function arm(): void {
  armed = true;
}

function disarm(): void {
  armed = false;
  resetTyping();
}

window.addEventListener("pointerdown", onPointerDown, true);
initTypingCapture(send);

chrome.runtime.onMessage.addListener((message: BroadcastMessage) => {
  if (message.kind === "RECORDING_STARTED") arm();
  if (message.kind === "RECORDING_STOPPED") disarm();
});

// Startup handshake: a freshly loaded page joins an in-flight recording.
try {
  chrome.runtime.sendMessage({ kind: "GET_STATE" }, (state: SessionSnapshot | undefined) => {
    if (chrome.runtime.lastError) return;
    if (state?.status === "recording") arm();
  });
} catch {
  // Not connected (e.g. extension reloading) — stay disarmed.
}

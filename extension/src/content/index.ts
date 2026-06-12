// Content script: arms capture-phase listeners while a recording is active and
// shows a floating "Recording" pill so the user always knows capture is on.
//
// It reaches pages two ways — declared in the manifest (new navigations) and
// programmatically injected into already-open tabs when recording starts — so
// a window-level guard makes the second arrival a no-op.

import type { BroadcastMessage, SessionSnapshot } from "../shared/messages";
import type { PageEvent } from "../shared/types";
import { extractElementMeta, normalizedBBox } from "./element-meta";
import { flushTyping, initTypingCapture, resetTyping } from "./typing";

declare global {
  interface Window {
    __sopsContentLoaded?: boolean;
  }
}

function main(): void {
  let armed = false;
  let indicator: HTMLElement | null = null;

  function send(event: PageEvent): void {
    try {
      void chrome.runtime.sendMessage({ kind: "PAGE_EVENT", event });
    } catch {
      // Extension was reloaded; this page's script is orphaned. Disarm quietly.
      disarm();
    }
  }

  // ---- floating recording indicator (shadow DOM so page CSS can't break it) ----

  function showIndicator(): void {
    if (indicator) return;
    const host = document.createElement("div");
    host.id = "sops-recording-indicator";
    host.style.cssText =
      "all:initial;position:fixed;bottom:16px;right:16px;z-index:2147483647;";
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        .pill {
          display: flex; align-items: center; gap: 8px;
          padding: 8px 12px; border-radius: 999px;
          background: rgba(17, 17, 22, 0.92); color: #fff;
          font: 600 12px/1 system-ui, sans-serif;
          box-shadow: 0 4px 16px rgba(0,0,0,0.35);
        }
        .dot {
          width: 9px; height: 9px; border-radius: 50%;
          background: #ff3b30; animation: pulse 1.2s ease-in-out infinite;
        }
        @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.25 } }
        button {
          all: unset; cursor: pointer; padding: 4px 10px; border-radius: 999px;
          background: #ff3b30; color: #fff; font: 600 11px/1 system-ui, sans-serif;
        }
        button:hover { background: #e0322a; }
      </style>
      <div class="pill">
        <span class="dot"></span>
        <span>Recording</span>
        <button type="button">Stop</button>
      </div>`;
    shadow.querySelector("button")?.addEventListener("click", () => {
      try {
        void chrome.runtime.sendMessage({ kind: "STOP_RECORDING" });
      } catch {
        disarm();
      }
    });
    document.documentElement.appendChild(host);
    indicator = host;
  }

  function hideIndicator(): void {
    indicator?.remove();
    indicator = null;
  }

  // ---- capture ----

  function onPointerDown(e: PointerEvent): void {
    if (!armed || e.button !== 0) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    // Never record interactions with our own indicator. (Shadow-DOM
    // retargeting makes the host the event target for clicks inside it.)
    if (indicator && (target === indicator || indicator.contains(target))) return;

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
    showIndicator();
  }

  function disarm(): void {
    armed = false;
    resetTyping();
    hideIndicator();
  }

  window.addEventListener("pointerdown", onPointerDown, true);
  initTypingCapture(send);

  chrome.runtime.onMessage.addListener((message: BroadcastMessage) => {
    if (message.kind === "RECORDING_STARTED") arm();
    if (message.kind === "RECORDING_STOPPED") disarm();
  });

  // Startup handshake: a freshly loaded (or freshly injected) page joins an
  // in-flight recording.
  try {
    chrome.runtime.sendMessage({ kind: "GET_STATE" }, (state: SessionSnapshot | undefined) => {
      if (chrome.runtime.lastError) return;
      if (state?.status === "recording") arm();
    });
  } catch {
    // Not connected (e.g. extension reloading) — stay disarmed.
  }
}

if (!window.__sopsContentLoaded) {
  window.__sopsContentLoaded = true;
  main();
}

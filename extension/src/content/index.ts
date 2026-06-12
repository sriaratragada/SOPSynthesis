// Content script: arms capture-phase listeners while a recording is active,
// shows a floating Recording/Paused pill, and renders the 3-2-1 countdown.
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
  let pillHost: HTMLElement | null = null;
  let pillShadow: ShadowRoot | null = null;
  let countdownHost: HTMLElement | null = null;
  let countdownTimer: number | undefined;

  function send(event: PageEvent): void {
    if (!armed) return; // paused or idle: nothing leaves the page
    try {
      void chrome.runtime.sendMessage({ kind: "PAGE_EVENT", event });
    } catch {
      // Extension was reloaded; this page's script is orphaned. Disarm quietly.
      hidePill();
      armed = false;
    }
  }

  function sendCommand(kind: "STOP_RECORDING" | "PAUSE_RECORDING" | "RESUME_RECORDING"): void {
    try {
      void chrome.runtime.sendMessage({ kind });
    } catch {
      hidePill();
      armed = false;
    }
  }

  // ---- floating pill (shadow DOM so page CSS can't break it) ----

  function showPill(mode: "recording" | "paused"): void {
    if (!pillHost) {
      pillHost = document.createElement("div");
      pillHost.id = "sops-recording-indicator";
      pillHost.style.cssText =
        "all:initial;position:fixed;bottom:16px;right:16px;z-index:2147483647;";
      pillShadow = pillHost.attachShadow({ mode: "closed" });
      document.documentElement.appendChild(pillHost);
    }
    const paused = mode === "paused";
    pillShadow!.innerHTML = `
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
          background: ${paused ? "#f59e0b" : "#ff3b30"};
          ${paused ? "" : "animation: pulse 1.2s ease-in-out infinite;"}
        }
        @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.25 } }
        button {
          all: unset; cursor: pointer; padding: 4px 10px; border-radius: 999px;
          color: #fff; font: 600 11px/1 system-ui, sans-serif;
        }
        .secondary { background: rgba(255,255,255,0.16); }
        .secondary:hover { background: rgba(255,255,255,0.28); }
        .stop { background: #ff3b30; }
        .stop:hover { background: #e0322a; }
      </style>
      <div class="pill">
        <span class="dot"></span>
        <span>${paused ? "Paused" : "Recording"}</span>
        <button type="button" class="secondary" data-action="${paused ? "resume" : "pause"}">
          ${paused ? "Resume" : "Pause"}
        </button>
        <button type="button" class="stop" data-action="stop">Stop</button>
      </div>`;
    pillShadow!.querySelectorAll("button").forEach((btn) =>
      btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-action");
        if (action === "stop") sendCommand("STOP_RECORDING");
        else if (action === "pause") sendCommand("PAUSE_RECORDING");
        else sendCommand("RESUME_RECORDING");
      }),
    );
  }

  function hidePill(): void {
    pillHost?.remove();
    pillHost = null;
    pillShadow = null;
  }

  // ---- 3-2-1 countdown overlay ----

  function hideCountdown(): void {
    if (countdownTimer !== undefined) window.clearInterval(countdownTimer);
    countdownTimer = undefined;
    countdownHost?.remove();
    countdownHost = null;
  }

  function showCountdown(endsAt: number): void {
    hideCountdown();
    const host = document.createElement("div");
    host.style.cssText =
      "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;" +
      "display:flex;align-items:center;justify-content:center;";
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        .ring {
          width: 140px; height: 140px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          background: rgba(17, 17, 22, 0.85);
          color: #fff; font: 700 64px/1 system-ui, sans-serif;
          box-shadow: 0 8px 40px rgba(0,0,0,0.45);
        }
        .hint {
          position: fixed; left: 50%; transform: translateX(-50%);
          margin-top: 190px; color: #fff; font: 600 14px/1 system-ui, sans-serif;
          text-shadow: 0 1px 6px rgba(0,0,0,0.8);
        }
      </style>
      <div class="ring"><span id="n">3</span></div>
      <div class="hint">Recording starts…</div>`;
    const numberEl = shadow.getElementById("n")!;
    document.documentElement.appendChild(host);
    countdownHost = host;

    const tick = () => {
      const remaining = Math.ceil((endsAt - Date.now()) / 1000);
      if (remaining <= 0) {
        hideCountdown();
        return;
      }
      numberEl.textContent = String(remaining);
    };
    tick();
    countdownTimer = window.setInterval(tick, 100);
  }

  // ---- capture ----

  function onPointerDown(e: PointerEvent): void {
    if (!armed || e.button !== 0) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    // Never record interactions with our own indicator. (Shadow-DOM
    // retargeting makes the host the event target for clicks inside it.)
    if (pillHost && (target === pillHost || pillHost.contains(target))) return;

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
    hideCountdown();
    showPill("recording");
  }

  function pause(): void {
    armed = false;
    resetTyping();
    showPill("paused");
  }

  function disarm(): void {
    armed = false;
    resetTyping();
    hideCountdown();
    hidePill();
  }

  window.addEventListener("pointerdown", onPointerDown, true);
  initTypingCapture(send);

  chrome.runtime.onMessage.addListener((message: BroadcastMessage) => {
    switch (message.kind) {
      case "RECORDING_STARTED":
        arm();
        break;
      case "RECORDING_PAUSED":
        pause();
        break;
      case "RECORDING_STOPPED":
        disarm();
        break;
      case "COUNTDOWN_STARTED":
        showCountdown(message.endsAt);
        break;
      case "COUNTDOWN_CANCELLED":
        hideCountdown();
        break;
    }
  });

  // Startup handshake: a freshly loaded (or freshly injected) page joins an
  // in-flight recording in whatever state it's in.
  try {
    chrome.runtime.sendMessage({ kind: "GET_STATE" }, (state: SessionSnapshot | undefined) => {
      if (chrome.runtime.lastError) return;
      if (state?.status === "recording") arm();
      else if (state?.status === "paused") pause();
    });
  } catch {
    // Not connected (e.g. extension reloading) — stay disarmed.
  }
}

if (!window.__sopsContentLoaded) {
  window.__sopsContentLoaded = true;
  main();
}

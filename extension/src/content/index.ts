// Content script: arms capture-phase listeners while a recording is active,
// shows a floating Recording/Paused pill, and renders the 3-2-1 countdown.
//
// It reaches pages two ways — declared in the manifest (new navigations) and
// programmatically injected into already-open tabs when recording starts — so
// a window-level guard makes the second arrival a no-op.
//
// All UI is built with createElement/textContent, never innerHTML: pages with
// a Trusted Types CSP (Google properties and others) make innerHTML throw,
// even from an isolated world.

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
  let countdownHost: HTMLElement | null = null;
  let countdownTimer: number | undefined;

  function send(event: PageEvent): void {
    if (!armed) return; // paused or idle: nothing leaves the page
    try {
      chrome.runtime.sendMessage({ kind: "PAGE_EVENT", event }).catch(() => {});
    } catch {
      // Extension was reloaded; this page's script is orphaned. Disarm quietly.
      hidePill();
      armed = false;
    }
  }

  function sendCommand(kind: "STOP_RECORDING" | "PAUSE_RECORDING" | "RESUME_RECORDING"): void {
    try {
      chrome.runtime.sendMessage({ kind }).catch(() => {});
    } catch {
      hidePill();
      armed = false;
    }
  }

  // ---- floating pill (shadow DOM so page CSS can't break it) ----

  function makeButton(label: string, background: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.cssText =
      "all:unset;cursor:pointer;padding:4px 10px;border-radius:999px;color:#fff;" +
      `font:600 11px/1 system-ui,sans-serif;background:${background};`;
    button.addEventListener("click", onClick);
    return button;
  }

  function showPill(mode: "recording" | "paused"): void {
    hidePill();
    const paused = mode === "paused";

    pillHost = document.createElement("div");
    pillHost.id = "sops-recording-indicator";
    pillHost.style.cssText =
      "all:initial;position:fixed;bottom:16px;right:16px;z-index:2147483647;";
    const shadow = pillHost.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = "@keyframes sops-pulse{0%,100%{opacity:1}50%{opacity:.25}}";
    shadow.appendChild(style);

    const pill = document.createElement("div");
    pill.style.cssText =
      "display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;" +
      "background:rgba(17,17,22,0.92);color:#fff;font:600 12px/1 system-ui,sans-serif;" +
      "box-shadow:0 4px 16px rgba(0,0,0,0.35);";

    const dot = document.createElement("span");
    dot.style.cssText =
      `width:9px;height:9px;border-radius:50%;background:${paused ? "#f59e0b" : "#ff3b30"};` +
      (paused ? "" : "animation:sops-pulse 1.2s ease-in-out infinite;");
    pill.appendChild(dot);

    const label = document.createElement("span");
    label.textContent = paused ? "Paused" : "Recording";
    pill.appendChild(label);

    pill.appendChild(
      makeButton(paused ? "Resume" : "Pause", "rgba(255,255,255,0.16)", () =>
        sendCommand(paused ? "RESUME_RECORDING" : "PAUSE_RECORDING"),
      ),
    );
    pill.appendChild(makeButton("Stop", "#ff3b30", () => sendCommand("STOP_RECORDING")));

    shadow.appendChild(pill);
    document.documentElement.appendChild(pillHost);
  }

  function hidePill(): void {
    pillHost?.remove();
    pillHost = null;
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
      "display:flex;align-items:center;justify-content:center;flex-direction:column;gap:18px;";
    const shadow = host.attachShadow({ mode: "closed" });

    const ring = document.createElement("div");
    ring.style.cssText =
      "width:140px;height:140px;border-radius:50%;display:flex;align-items:center;" +
      "justify-content:center;background:rgba(17,17,22,0.85);color:#fff;" +
      "font:700 64px/1 system-ui,sans-serif;box-shadow:0 8px 40px rgba(0,0,0,0.45);" +
      "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);";
    const numberEl = document.createElement("span");
    numberEl.textContent = "3";
    ring.appendChild(numberEl);
    shadow.appendChild(ring);

    const hint = document.createElement("div");
    hint.textContent = "Recording starts…";
    hint.style.cssText =
      "position:fixed;top:50%;left:50%;transform:translate(-50%,96px);color:#fff;" +
      "font:600 14px/1 system-ui,sans-serif;text-shadow:0 1px 6px rgba(0,0,0,0.8);";
    shadow.appendChild(hint);

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
    if (!pillHost || pillHost.getAttribute("data-mode") !== "recording") {
      showPill("recording");
      pillHost?.setAttribute("data-mode", "recording");
    }
  }

  function pause(): void {
    armed = false;
    resetTyping();
    if (!pillHost || pillHost.getAttribute("data-mode") !== "paused") {
      showPill("paused");
      pillHost?.setAttribute("data-mode", "paused");
    }
  }

  function disarm(): void {
    armed = false;
    resetTyping();
    hideCountdown();
    hidePill();
  }

  /** Sync with the service worker's state — used at load and again whenever the
   * tab regains focus, so a missed broadcast (sleeping tab, SW hiccup) heals. */
  function handshake(): void {
    try {
      chrome.runtime.sendMessage({ kind: "GET_STATE" }, (state: SessionSnapshot | undefined) => {
        if (chrome.runtime.lastError || !state) return;
        if (state.status === "recording") arm();
        else if (state.status === "paused") pause();
        else if (state.status === "idle" || state.status === "finalizing") disarm();
        // countdown: leave the overlay handling to the broadcast
      });
    } catch {
      // Not connected (e.g. extension reloading) — stay disarmed.
    }
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

  handshake();
  window.addEventListener("focus", handshake);
  window.addEventListener("pageshow", handshake);
}

if (!window.__sopsContentLoaded) {
  window.__sopsContentLoaded = true;
  main();
}

// Keystroke coalescing: one "type" event per focused field, flushed on blur,
// Enter, or the next click. Password values are masked AT THE SOURCE — the
// value never leaves the page; only `masked: true` does.

import type { PageEvent } from "../shared/types";
import { extractElementMeta } from "./element-meta";

const MAX_VALUE = 100;

type TextField = HTMLInputElement | HTMLTextAreaElement;

interface PendingTyping {
  field: TextField;
  dirty: boolean;
}

let pending: PendingTyping | null = null;
let emit: ((event: PageEvent) => void) | null = null;

function isTextField(target: EventTarget | null): target is TextField {
  if (target instanceof HTMLTextAreaElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  const nonText = ["checkbox", "radio", "button", "submit", "reset", "file", "range", "color"];
  return !nonText.includes(target.type);
}

function buildViewport() {
  return {
    w: window.innerWidth,
    h: window.innerHeight,
    dpr: window.devicePixelRatio,
    scrollX: Math.round(window.scrollX),
    scrollY: Math.round(window.scrollY),
  };
}

export function flushTyping(): void {
  if (!pending || !pending.dirty || !emit) {
    pending = pending && document.activeElement === pending.field ? pending : null;
    return;
  }
  const field = pending.field;
  const masked = field instanceof HTMLInputElement && field.type === "password";
  const rawValue = masked ? "" : field.value;
  const value = rawValue.length > MAX_VALUE ? rawValue.slice(0, MAX_VALUE) : rawValue;

  if (value.trim() || masked) {
    emit({
      type: "type",
      ts: Date.now(),
      url: location.href,
      pageTitle: document.title,
      viewport: buildViewport(),
      element: extractElementMeta(field),
      typed: { value, masked },
    });
  }
  pending = { field, dirty: false };
}

export function initTypingCapture(emitFn: (event: PageEvent) => void): void {
  emit = emitFn;

  document.addEventListener(
    "focusin",
    (e) => {
      if (isTextField(e.target)) {
        if (pending && pending.field !== e.target) flushTyping();
        pending = { field: e.target, dirty: false };
      }
    },
    true,
  );

  document.addEventListener(
    "input",
    (e) => {
      if (pending && e.target === pending.field) pending.dirty = true;
      else if (isTextField(e.target)) pending = { field: e.target, dirty: true };
    },
    true,
  );

  document.addEventListener(
    "focusout",
    (e) => {
      if (pending && e.target === pending.field) {
        flushTyping();
        pending = null;
      }
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter" && pending && e.target === pending.field) flushTyping();
    },
    true,
  );
}

export function resetTyping(): void {
  pending = null;
}

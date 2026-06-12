// Capture event shapes — mirrors docs/event-contract.md and backend/app/schemas.py.
// These cross the HTTP boundary; the CS↔SW message types live in messages.ts.

export type EventType = "click" | "type" | "navigate";

export interface Viewport {
  w: number;
  h: number;
  dpr: number;
  scrollX: number;
  scrollY: number;
}

export interface BBox {
  nx: number;
  ny: number;
  nw: number;
  nh: number;
}

export interface ClickPoint {
  nx: number;
  ny: number;
  clientX: number;
  clientY: number;
  bbox: BBox | null;
}

export interface ElementMeta {
  tag: string;
  text: string | null;
  ariaLabel: string | null;
  placeholder: string | null;
  name: string | null;
  id: string | null;
  role: string | null;
  type: string | null;
  href: string | null;
  alt: string | null;
  selector: string | null;
  region: string | null;
}

export interface TypedValue {
  value: string;
  masked: boolean;
}

/** Event as emitted by the content script — seq and tabId are assigned by the SW. */
export interface PageEvent {
  type: EventType;
  ts: number;
  url: string;
  pageTitle: string;
  viewport?: Viewport;
  click?: ClickPoint;
  element?: ElementMeta;
  typed?: TypedValue;
}

export interface CaptureEvent extends PageEvent {
  seq: number;
  tabId?: number;
}

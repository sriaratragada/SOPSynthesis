import type { PageEvent } from "./types";

export type SessionStatus = "idle" | "countdown" | "recording" | "paused" | "finalizing";

export interface SessionSnapshot {
  status: SessionStatus;
  recordingId: string | null;
  stepCount: number;
  startedAt: number | null;
  /** Title of the tab the last event was captured in. */
  lastTabTitle: string | null;
  /** Human summary of the last captured action, e.g. `Clicked "Approve"`. */
  lastAction: string | null;
  /** Events waiting in the retry queue (backend unreachable). */
  queuedCount: number;
  /** Last screenshot-capture failure, if any — surfaced in the popup. */
  lastCaptureError: string | null;
  /** When the pre-recording countdown finishes (status === "countdown"). */
  countdownEndsAt: number | null;
  /** Problem detected while attaching to tabs at Start (e.g. blocked site access). */
  startWarning: string | null;
  /** Number of pages with an armed (capturing) content script this session. */
  armedTabCount: number;
  /** When the current pause began (status === "paused"). */
  pausedAt: number | null;
  /** Total time spent paused so far — subtracted from the elapsed timer. */
  pausedAccumMs: number;
}

/** Messages into the service worker (from content scripts and the popup). */
export type InboundMessage =
  | { kind: "PAGE_EVENT"; event: PageEvent }
  | { kind: "CS_ARMED" } // a content script confirms it is live and capturing
  | { kind: "GET_STATE" }
  | { kind: "START_RECORDING" }
  | { kind: "STOP_RECORDING" }
  | { kind: "PAUSE_RECORDING" }
  | { kind: "RESUME_RECORDING" };

/** Broadcasts from the service worker to content scripts. */
export type BroadcastMessage =
  | { kind: "RECORDING_STARTED" }
  | { kind: "RECORDING_PAUSED" }
  | { kind: "RECORDING_STOPPED" }
  | { kind: "COUNTDOWN_STARTED"; endsAt: number }
  | { kind: "COUNTDOWN_CANCELLED" };

export interface StartResponse {
  ok: boolean;
  state: SessionSnapshot;
  error?: string;
}

export interface StopResponse {
  ok: boolean;
  guideId?: string;
  error?: string;
}

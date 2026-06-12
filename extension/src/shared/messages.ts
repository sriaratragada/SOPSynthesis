import type { PageEvent } from "./types";

export type SessionStatus = "idle" | "recording" | "finalizing";

export interface SessionSnapshot {
  status: SessionStatus;
  recordingId: string | null;
  stepCount: number;
}

/** Messages into the service worker (from content scripts and the popup). */
export type InboundMessage =
  | { kind: "PAGE_EVENT"; event: PageEvent }
  | { kind: "GET_STATE" }
  | { kind: "START_RECORDING" }
  | { kind: "STOP_RECORDING" };

/** Broadcasts from the service worker to content scripts. */
export type BroadcastMessage =
  | { kind: "RECORDING_STARTED" }
  | { kind: "RECORDING_STOPPED" };

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

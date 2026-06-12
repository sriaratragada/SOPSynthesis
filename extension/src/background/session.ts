// Recording session state machine. All state lives in chrome.storage.session so it
// survives MV3 service-worker teardown (and correctly dies with the browser).
// Handlers must rehydrate on every call — the SW itself is stateless.

import type { SessionSnapshot, SessionStatus } from "../shared/messages";

const KEY = "session";

export interface SessionState {
  status: SessionStatus;
  recordingId: string | null;
  seq: number;
  stepCount: number;
  startedAt: number | null;
}

export const IDLE: SessionState = {
  status: "idle",
  recordingId: null,
  seq: 0,
  stepCount: 0,
  startedAt: null,
};

export async function getState(): Promise<SessionState> {
  const stored = await chrome.storage.session.get(KEY);
  return (stored[KEY] as SessionState | undefined) ?? IDLE;
}

export async function setState(state: SessionState): Promise<void> {
  await chrome.storage.session.set({ [KEY]: state });
}

export function snapshot(state: SessionState): SessionSnapshot {
  return {
    status: state.status,
    recordingId: state.recordingId,
    stepCount: state.stepCount,
  };
}

// The SW is single-threaded but handlers interleave at awaits; serialize
// read-modify-write sections (seq assignment) through one promise chain.
let chain: Promise<unknown> = Promise.resolve();

export function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

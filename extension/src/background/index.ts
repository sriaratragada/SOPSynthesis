// Service worker entry: message routing, navigation tracking, badge/icon state,
// keyboard commands, and the idle → countdown → recording ⇄ paused lifecycle.

import type {
  BroadcastMessage,
  InboundMessage,
  SessionSnapshot,
  SessionStatus,
  StartResponse,
  StopResponse,
} from "../shared/messages";
import type { CaptureEvent, PageEvent } from "../shared/types";
import { captureTab, clearCaptureError, getLastCaptureError } from "./capture";
import { getState, IDLE, serialized, setState, snapshotBase, type SessionState } from "./session";
import {
  checkHealth,
  createRecording,
  finalizeRecording,
  flushQueue,
  getQueueLength,
  recordingIsOpen,
  uploadEvent,
} from "./uploader";

const START_WARNING_KEY = "startWarning";

const WEB_APP_URL = "http://localhost:5173";
const COUNTDOWN_MS = 3000;

// Pages whose navigations are never part of a workflow being documented.
const IGNORED_URL_PREFIXES = [WEB_APP_URL, "http://127.0.0.1:8787"];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRecordableUrl(url: string): boolean {
  if (!/^https?:\/\//.test(url)) return false;
  return !IGNORED_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

async function buildSnapshot(state: SessionState): Promise<SessionSnapshot> {
  const stored = await chrome.storage.session.get(START_WARNING_KEY);
  return {
    ...snapshotBase(state),
    queuedCount: await getQueueLength(),
    lastCaptureError: await getLastCaptureError(),
    startWarning: (stored[START_WARNING_KEY] as string | undefined) ?? null,
  };
}

const ICONS_DEFAULT = { 16: "icons/icon16.png", 48: "icons/icon48.png", 128: "icons/icon128.png" };
const ICONS_RECORDING = { 16: "icons/rec16.png", 48: "icons/rec48.png", 128: "icons/rec128.png" };
const ICONS_PAUSED = { 16: "icons/pause16.png", 48: "icons/pause48.png", 128: "icons/pause128.png" };

async function setIndicator(status: SessionStatus): Promise<void> {
  if (status === "recording" || status === "finalizing") {
    await chrome.action.setIcon({ path: ICONS_RECORDING });
    await chrome.action.setBadgeBackgroundColor({ color: "#D93025" });
    await chrome.action.setBadgeText({ text: "REC" });
  } else if (status === "paused") {
    await chrome.action.setIcon({ path: ICONS_PAUSED });
    await chrome.action.setBadgeBackgroundColor({ color: "#B45309" });
    await chrome.action.setBadgeText({ text: "❚❚" });
  } else if (status === "countdown") {
    await chrome.action.setIcon({ path: ICONS_RECORDING });
    await chrome.action.setBadgeBackgroundColor({ color: "#D93025" });
    await chrome.action.setBadgeText({ text: "•••" });
  } else {
    await chrome.action.setIcon({ path: ICONS_DEFAULT });
    await chrome.action.setBadgeText({ text: "" });
  }
}

/** Quick human label for the popup's "last action" line. */
function summarizeAction(event: PageEvent): string {
  const el = event.element;
  const label =
    el?.ariaLabel?.trim() || el?.text?.trim() || el?.placeholder?.trim() || el?.tag || "element";
  const short = label.length > 40 ? `${label.slice(0, 39)}…` : label;
  if (event.type === "click") return `Clicked "${short}"`;
  if (event.type === "type")
    return event.typed?.masked ? "Typed a password (masked)" : `Typed in "${short}"`;
  try {
    return `Opened ${new URL(event.url).host}`;
  } catch {
    return "Navigated";
  }
}

async function broadcast(message: BroadcastMessage): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs
      .filter((tab) => tab.id !== undefined && tab.url && isRecordableUrl(tab.url))
      .map((tab) => chrome.tabs.sendMessage(tab.id!, message)),
  );
}

/**
 * Manifest-declared content scripts only land in pages loaded AFTER the
 * extension was installed/reloaded. Tabs that were already open have no
 * content script — clicks there would capture nothing. Inject into every
 * eligible open tab when recording starts; the script's own guard makes
 * double-injection a no-op.
 *
 * Injection failing on the tab the user is looking at is THE classic cause of
 * "nothing records" (usually Site access set to "On click"), so that failure
 * is reported back for the popup to surface.
 */
async function injectIntoOpenTabs(): Promise<{ activeTabError: string | null }> {
  const tabs = await chrome.tabs.query({});
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  let activeTabError: string | null = null;

  await Promise.all(
    tabs
      .filter((tab) => tab.id !== undefined && tab.url && isRecordableUrl(tab.url))
      .map(async (tab) => {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id! },
            files: ["content.js"],
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`content script injection failed for ${tab.url}: ${message}`);
          if (tab.id === active?.id) activeTabError = message;
        }
      }),
  );
  return { activeTabError };
}

async function handlePageEvent(event: PageEvent, sender: chrome.runtime.MessageSender) {
  await serialized(async () => {
    const state = await getState();
    if (state.status !== "recording" || !state.recordingId) return;

    const tabId = sender.tab?.id;
    const capture: CaptureEvent = { ...event, seq: state.seq, tabId };

    let screenshot: string | null = null;
    if (event.type === "click" && tabId !== undefined && sender.tab?.windowId !== undefined) {
      screenshot = await captureTab(sender.tab.windowId, tabId);
    }

    await setState({
      ...state,
      seq: state.seq + 1,
      stepCount: state.stepCount + 1,
      lastTabTitle: event.pageTitle || state.lastTabTitle,
      lastAction: summarizeAction(event),
    });
    await uploadEvent(state.recordingId, capture, screenshot);
  });
}

async function handleNavigation(tabId: number, url: string): Promise<void> {
  if (!isRecordableUrl(url)) return;
  await serialized(async () => {
    const state = await getState();
    if (state.status !== "recording" || !state.recordingId) return;

    let pageTitle = "";
    try {
      pageTitle = (await chrome.tabs.get(tabId)).title ?? "";
    } catch {
      // tab may already be gone
    }

    const capture: CaptureEvent = {
      type: "navigate",
      ts: Date.now(),
      url,
      pageTitle,
      seq: state.seq,
      tabId,
    };
    await setState({
      ...state,
      seq: state.seq + 1,
      lastTabTitle: pageTitle || state.lastTabTitle,
    });
    await uploadEvent(state.recordingId, capture, null);
  });
}

async function startRecording(): Promise<StartResponse> {
  let state = await getState();

  // Self-heal stuck sessions: a "recording" whose backend recording is gone
  // (backend restarted, DB cleared, or a crash mid-finalize) would otherwise
  // make Start a silent no-op forever.
  if (state.status === "recording" || state.status === "paused") {
    if (state.recordingId && (await recordingIsOpen(state.recordingId))) {
      return { ok: true, state: await buildSnapshot(state) };
    }
    console.warn("resetting stale session — backend no longer has the recording open");
    await setState(IDLE);
    await setIndicator("idle");
    await broadcast({ kind: "RECORDING_STOPPED" });
    state = IDLE;
  } else if (state.status !== "idle") {
    // countdown/finalizing left over from a dead service worker
    await setState(IDLE);
    state = IDLE;
  }

  if (!(await checkHealth())) {
    return {
      ok: false,
      state: await buildSnapshot(IDLE),
      error: "Backend is not running on 127.0.0.1:8787 — start it, then try again.",
    };
  }

  await clearCaptureError();
  await chrome.storage.session.remove(START_WARNING_KEY);
  const { activeTabError } = await injectIntoOpenTabs();
  if (activeTabError) {
    await chrome.storage.session.set({
      [START_WARNING_KEY]:
        "Couldn't attach to the current page. Check that Site access is set to " +
        '"On all sites" for SOPSynthesis at chrome://extensions, then reload the tab.',
    });
  }

  // 3-2-1 countdown: nothing is recorded until it finishes, so closing the
  // popup or settling into the page doesn't become step 1.
  const endsAt = Date.now() + COUNTDOWN_MS;
  await setState({ ...IDLE, status: "countdown", countdownEndsAt: endsAt });
  await setIndicator("countdown");

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id !== undefined && activeTab.url && isRecordableUrl(activeTab.url)) {
    chrome.tabs.sendMessage(activeTab.id, { kind: "COUNTDOWN_STARTED", endsAt }).catch(() => {});
  }

  await sleep(COUNTDOWN_MS);

  const current = await getState();
  if (current.status !== "countdown") {
    // Cancelled (stop button / hotkey) during the countdown.
    return { ok: true, state: await buildSnapshot(current) };
  }

  let recordingId: string;
  try {
    recordingId = await createRecording();
  } catch (err) {
    await setState(IDLE);
    await setIndicator("idle");
    await broadcast({ kind: "COUNTDOWN_CANCELLED" });
    return {
      ok: false,
      state: await buildSnapshot(IDLE),
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const next: SessionState = {
    status: "recording",
    recordingId,
    seq: 0,
    stepCount: 0,
    startedAt: Date.now(),
    lastTabTitle: activeTab?.title ?? null,
    lastAction: null,
    countdownEndsAt: null,
    pausedAt: null,
    pausedAccumMs: 0,
  };
  await setState(next);
  await setIndicator("recording");
  await broadcast({ kind: "RECORDING_STARTED" });
  return { ok: true, state: await buildSnapshot(next) };
}

async function pauseRecording(): Promise<StartResponse> {
  const state = await getState();
  if (state.status !== "recording") {
    return { ok: false, state: await buildSnapshot(state), error: "Not recording" };
  }
  const next: SessionState = { ...state, status: "paused", pausedAt: Date.now() };
  await setState(next);
  await setIndicator("paused");
  await broadcast({ kind: "RECORDING_PAUSED" });
  return { ok: true, state: await buildSnapshot(next) };
}

async function resumeRecording(): Promise<StartResponse> {
  const state = await getState();
  if (state.status !== "paused") {
    return { ok: false, state: await buildSnapshot(state), error: "Not paused" };
  }
  const next: SessionState = {
    ...state,
    status: "recording",
    pausedAt: null,
    pausedAccumMs: state.pausedAccumMs + (Date.now() - (state.pausedAt ?? Date.now())),
  };
  await setState(next);
  await setIndicator("recording");
  await broadcast({ kind: "RECORDING_STARTED" });
  return { ok: true, state: await buildSnapshot(next) };
}

async function stopRecording(): Promise<StopResponse> {
  const state = await getState();

  if (state.status === "countdown") {
    await setState(IDLE);
    await setIndicator("idle");
    await broadcast({ kind: "COUNTDOWN_CANCELLED" });
    return { ok: true };
  }

  if ((state.status !== "recording" && state.status !== "paused") || !state.recordingId) {
    return { ok: false, error: "Not recording" };
  }
  const previousStatus = state.status;

  await setState({ ...state, status: "finalizing" });
  await broadcast({ kind: "RECORDING_STOPPED" });
  try {
    const flushed = await flushQueue();
    if (!flushed) throw new Error("Some captured events could not reach the backend");
    const guideId = await finalizeRecording(state.recordingId);
    await setState(IDLE);
    await setIndicator("idle");
    await chrome.tabs.create({ url: `${WEB_APP_URL}/guides/${guideId}` });
    return { ok: true, guideId };
  } catch (err) {
    // Keep the session so a retry after restarting the backend can still finalize.
    await setState({ ...state, status: previousStatus });
    await setIndicator(previousStatus);
    await broadcast({
      kind: previousStatus === "paused" ? "RECORDING_PAUSED" : "RECORDING_STARTED",
    });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

chrome.runtime.onMessage.addListener(
  (message: InboundMessage, sender, sendResponse): boolean | undefined => {
    switch (message.kind) {
      case "PAGE_EVENT":
        void handlePageEvent(message.event, sender);
        return undefined; // fire and forget
      case "GET_STATE":
        void getState()
          .then(buildSnapshot)
          .then((snapshot) => sendResponse(snapshot));
        return true;
      case "START_RECORDING":
        void startRecording().then(sendResponse);
        return true;
      case "STOP_RECORDING":
        void stopRecording().then(sendResponse);
        return true;
      case "PAUSE_RECORDING":
        void pauseRecording().then(sendResponse);
        return true;
      case "RESUME_RECORDING":
        void resumeRecording().then(sendResponse);
        return true;
    }
  },
);

// Keyboard shortcuts (configurable at chrome://extensions/shortcuts).
chrome.commands.onCommand.addListener((command) => {
  void (async () => {
    const state = await getState();
    if (command === "toggle-recording") {
      if (state.status === "idle") await startRecording();
      else await stopRecording();
    } else if (command === "toggle-pause") {
      if (state.status === "recording") await pauseRecording();
      else if (state.status === "paused") await resumeRecording();
    }
  })();
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  void handleNavigation(details.tabId, details.url);
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  void handleNavigation(details.tabId, details.url);
});

// Restore the indicator if the SW restarts mid-recording.
void getState().then((state) => setIndicator(state.status));

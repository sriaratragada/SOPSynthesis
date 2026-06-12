// Service worker entry: message routing, navigation tracking, badge/icon state.

import type {
  BroadcastMessage,
  InboundMessage,
  SessionSnapshot,
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
  uploadEvent,
} from "./uploader";

const WEB_APP_URL = "http://localhost:5173";

// Pages whose navigations are never part of a workflow being documented.
const IGNORED_URL_PREFIXES = [WEB_APP_URL, "http://127.0.0.1:8787"];

function isRecordableUrl(url: string): boolean {
  if (!/^https?:\/\//.test(url)) return false;
  return !IGNORED_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

async function buildSnapshot(state: SessionState): Promise<SessionSnapshot> {
  return {
    ...snapshotBase(state),
    queuedCount: await getQueueLength(),
    lastCaptureError: await getLastCaptureError(),
  };
}

const ICONS_DEFAULT = { 16: "icons/icon16.png", 48: "icons/icon48.png", 128: "icons/icon128.png" };
const ICONS_RECORDING = { 16: "icons/rec16.png", 48: "icons/rec48.png", 128: "icons/rec128.png" };

async function setRecordingIndicator(recording: boolean): Promise<void> {
  await chrome.action.setIcon({ path: recording ? ICONS_RECORDING : ICONS_DEFAULT });
  await chrome.action.setBadgeText({ text: recording ? "REC" : "" });
  if (recording) await chrome.action.setBadgeBackgroundColor({ color: "#D93025" });
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
 */
async function injectIntoOpenTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs
      .filter((tab) => tab.id !== undefined && tab.url && isRecordableUrl(tab.url))
      .map((tab) =>
        chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: ["content.js"] }),
      ),
  );
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
  const state = await getState();
  if (state.status === "recording") return { ok: true, state: await buildSnapshot(state) };

  if (!(await checkHealth())) {
    return {
      ok: false,
      state: await buildSnapshot(IDLE),
      error: "Backend is not running on 127.0.0.1:8787 — start it, then try again.",
    };
  }

  await clearCaptureError();
  const recordingId = await createRecording();

  // Seed "Recording: {tab}" with the tab the user is on right now.
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const next: SessionState = {
    status: "recording",
    recordingId,
    seq: 0,
    stepCount: 0,
    startedAt: Date.now(),
    lastTabTitle: activeTab?.title ?? null,
    lastAction: null,
  };
  await setState(next);
  await setRecordingIndicator(true);
  await injectIntoOpenTabs();
  await broadcast({ kind: "RECORDING_STARTED" });
  return { ok: true, state: await buildSnapshot(next) };
}

async function stopRecording(): Promise<StopResponse> {
  const state = await getState();
  if (state.status !== "recording" || !state.recordingId) {
    return { ok: false, error: "Not recording" };
  }

  await setState({ ...state, status: "finalizing" });
  await broadcast({ kind: "RECORDING_STOPPED" });
  try {
    const flushed = await flushQueue();
    if (!flushed) throw new Error("Some captured events could not reach the backend");
    const guideId = await finalizeRecording(state.recordingId);
    await setState(IDLE);
    await setRecordingIndicator(false);
    await chrome.tabs.create({ url: `${WEB_APP_URL}/guides/${guideId}` });
    return { ok: true, guideId };
  } catch (err) {
    // Keep the session so a retry after restarting the backend can still finalize.
    await setState({ ...state, status: "recording" });
    await broadcast({ kind: "RECORDING_STARTED" });
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
    }
  },
);

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  void handleNavigation(details.tabId, details.url);
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  void handleNavigation(details.tabId, details.url);
});

// Restore the indicator if the SW restarts mid-recording.
void getState().then((state) => setRecordingIndicator(state.status === "recording"));

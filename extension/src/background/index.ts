// Service worker entry: message routing, navigation tracking, badge state.

import type {
  BroadcastMessage,
  InboundMessage,
  StartResponse,
  StopResponse,
} from "../shared/messages";
import type { CaptureEvent, PageEvent } from "../shared/types";
import { captureTab } from "./capture";
import { getState, IDLE, serialized, setState, snapshot } from "./session";
import {
  checkHealth,
  createRecording,
  finalizeRecording,
  flushQueue,
  uploadEvent,
} from "./uploader";

const WEB_APP_URL = "http://localhost:5173";

// Pages whose navigations are never part of a workflow being documented.
const IGNORED_URL_PREFIXES = [WEB_APP_URL, "http://127.0.0.1:8787"];

function isRecordableUrl(url: string): boolean {
  if (!/^https?:\/\//.test(url)) return false;
  return !IGNORED_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

async function setBadge(recording: boolean): Promise<void> {
  await chrome.action.setBadgeText({ text: recording ? "REC" : "" });
  if (recording) await chrome.action.setBadgeBackgroundColor({ color: "#D93025" });
}

async function broadcast(message: BroadcastMessage): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs
      .filter((tab) => tab.id !== undefined && tab.url && isRecordableUrl(tab.url))
      .map((tab) => chrome.tabs.sendMessage(tab.id!, message)),
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
    await setState({ ...state, seq: state.seq + 1 });
    await uploadEvent(state.recordingId, capture, null);
  });
}

async function startRecording(): Promise<StartResponse> {
  const state = await getState();
  if (state.status === "recording") return { ok: true, state: snapshot(state) };

  if (!(await checkHealth())) {
    return {
      ok: false,
      state: snapshot(IDLE),
      error: "Backend is not running on 127.0.0.1:8787 — start it, then try again.",
    };
  }

  const recordingId = await createRecording();
  const next = {
    status: "recording" as const,
    recordingId,
    seq: 0,
    stepCount: 0,
    startedAt: Date.now(),
  };
  await setState(next);
  await setBadge(true);
  await broadcast({ kind: "RECORDING_STARTED" });
  return { ok: true, state: snapshot(next) };
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
    await setBadge(false);
    await chrome.tabs.create({ url: `${WEB_APP_URL}/guides/${guideId}` });
    return { ok: true, guideId };
  } catch (err) {
    // Keep the session so a retry after restarting the backend can still finalize.
    await setState({ ...state, status: "recording" });
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
        void getState().then((state) => sendResponse(snapshot(state)));
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

// Restore the badge if the SW restarts mid-recording.
void getState().then((state) => setBadge(state.status === "recording"));

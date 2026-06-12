// Throttled screenshot capture. Chrome rate-limits captureVisibleTab to ~2/sec;
// a token-interval throttle plus a short-lived per-tab cache makes burst clicks
// degrade to a shared frame instead of throwing (dedup collapses them anyway).
// Failures are recorded so the popup can surface "screenshots are failing".

const MIN_INTERVAL_MS = 600;
const CACHE_MAX_AGE_MS = 700;
const ERROR_KEY = "lastCaptureError";

let lastFrame: { tabId: number; dataUrl: string; ts: number } | null = null;
let lastCaptureAt = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getLastCaptureError(): Promise<string | null> {
  const stored = await chrome.storage.session.get(ERROR_KEY);
  return (stored[ERROR_KEY] as string | undefined) ?? null;
}

export async function clearCaptureError(): Promise<void> {
  await chrome.storage.session.remove(ERROR_KEY);
}

export async function captureTab(windowId: number, tabId: number): Promise<string | null> {
  const now = Date.now();

  if (lastFrame && lastFrame.tabId === tabId && now - lastFrame.ts < CACHE_MAX_AGE_MS) {
    return lastFrame.dataUrl;
  }

  const sinceLast = now - lastCaptureAt;
  if (sinceLast < MIN_INTERVAL_MS) {
    // Inside the throttle window with no fresh cache: prefer a slightly stale
    // frame of the same tab over waiting past the moment that matters.
    if (lastFrame && lastFrame.tabId === tabId) return lastFrame.dataUrl;
    await sleep(MIN_INTERVAL_MS - sinceLast);
  }

  lastCaptureAt = Date.now();
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
    lastFrame = { tabId, dataUrl, ts: Date.now() };
    await chrome.storage.session.remove(ERROR_KEY);
    return dataUrl;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("captureVisibleTab failed:", message);
    await chrome.storage.session.set({ [ERROR_KEY]: message });
    return lastFrame && lastFrame.tabId === tabId ? lastFrame.dataUrl : null;
  }
}

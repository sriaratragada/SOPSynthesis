// Backend client. Events are POSTed immediately as they happen — buffering a
// whole session inside a killable MV3 worker risks losing all of it. Failures
// land in a chrome.storage.session retry queue flushed on the next event or
// on finalize.

import type { CaptureEvent } from "../shared/types";

export const API_BASE = "http://127.0.0.1:8787/api";
const QUEUE_KEY = "retryQueue";

interface QueuedUpload {
  recordingId: string;
  event: CaptureEvent;
  screenshotDataUrl: string | null;
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function createRecording(): Promise<string> {
  const res = await fetch(`${API_BASE}/recordings`, { method: "POST" });
  if (!res.ok) throw new Error(`createRecording failed: ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

export async function finalizeRecording(recordingId: string): Promise<string> {
  const res = await fetch(`${API_BASE}/recordings/${recordingId}/finalize`, { method: "POST" });
  if (!res.ok) throw new Error(`finalize failed: ${res.status}`);
  return ((await res.json()) as { guideId: string }).guideId;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/data:(.*?);/)?.[1] ?? "image/png";
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

async function postOnce(upload: QueuedUpload): Promise<void> {
  const form = new FormData();
  form.set("event", JSON.stringify(upload.event));
  if (upload.screenshotDataUrl) {
    form.set("screenshot", dataUrlToBlob(upload.screenshotDataUrl), "shot.png");
  }
  const res = await fetch(`${API_BASE}/recordings/${upload.recordingId}/events`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`event upload failed: ${res.status}`);
}

async function getQueue(): Promise<QueuedUpload[]> {
  const stored = await chrome.storage.session.get(QUEUE_KEY);
  return (stored[QUEUE_KEY] as QueuedUpload[] | undefined) ?? [];
}

async function setQueue(queue: QueuedUpload[]): Promise<void> {
  await chrome.storage.session.set({ [QUEUE_KEY]: queue });
}

/** Uploads an event; on failure it is queued and uploadEvent resolves normally. */
export async function uploadEvent(
  recordingId: string,
  event: CaptureEvent,
  screenshotDataUrl: string | null,
): Promise<void> {
  const upload: QueuedUpload = { recordingId, event, screenshotDataUrl };
  await flushQueue(); // keep ordering: earlier failures go first
  try {
    await postOnce(upload);
  } catch (err) {
    console.warn(`queueing event seq=${event.seq} after upload failure:`, err);
    await setQueue([...(await getQueue()), upload]);
  }
}

/** Retries everything in the queue, preserving order. Stops at the first failure. */
export async function flushQueue(): Promise<boolean> {
  const queue = await getQueue();
  if (queue.length === 0) return true;
  for (let i = 0; i < queue.length; i++) {
    try {
      await postOnce(queue[i]);
    } catch {
      await setQueue(queue.slice(i));
      return false;
    }
  }
  await setQueue([]);
  return true;
}

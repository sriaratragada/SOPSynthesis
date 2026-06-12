import type { SessionSnapshot, StartResponse, StopResponse } from "../shared/messages";
import { checkHealth } from "../background/uploader";

const toggleBtn = document.getElementById("toggle") as HTMLButtonElement;
const healthDot = document.getElementById("health-dot")!;
const healthText = document.getElementById("health-text")!;
const statusBox = document.getElementById("status")!;
const statusTab = document.getElementById("status-tab")!;
const statusSteps = document.getElementById("status-steps")!;
const statusElapsed = document.getElementById("status-elapsed")!;
const statusLast = document.getElementById("status-last")!;
const warnQueue = document.getElementById("warn-queue")!;
const warnCapture = document.getElementById("warn-capture")!;
const errorBox = document.getElementById("error")!;

let recording = false;
let pollTimer: number | undefined;

function showError(message: string | null): void {
  errorBox.textContent = message ?? "";
  errorBox.classList.toggle("hidden", !message);
}

function formatElapsed(startedAt: number | null): string {
  if (!startedAt) return "0:00";
  const total = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function render(state: SessionSnapshot, healthy: boolean): void {
  recording = state.status === "recording";

  toggleBtn.textContent = recording ? "Stop recording" : "Start recording";
  toggleBtn.classList.toggle("stop", recording);
  // Stopping must stay possible even if the backend just went down.
  toggleBtn.disabled = !recording && !healthy;

  statusBox.classList.toggle("visible", recording);
  if (recording) {
    statusTab.textContent = `Recording: ${state.lastTabTitle ?? "current tab"}`;
    statusTab.title = state.lastTabTitle ?? "";
    statusSteps.textContent = String(state.stepCount);
    statusElapsed.textContent = formatElapsed(state.startedAt);
    statusLast.textContent = state.lastAction ? `Last: ${state.lastAction}` : "";
  }

  const queued = state.queuedCount;
  warnQueue.textContent =
    queued > 0 ? `⏳ ${queued} captured event${queued === 1 ? "" : "s"} waiting to upload — they retry automatically.` : "";
  warnQueue.classList.toggle("visible", queued > 0);

  warnCapture.textContent = state.lastCaptureError
    ? `⚠️ Screenshots may be failing: ${state.lastCaptureError}`
    : "";
  warnCapture.classList.toggle("visible", recording && !!state.lastCaptureError);
}

async function refresh(): Promise<void> {
  const [state, healthy] = await Promise.all([
    chrome.runtime.sendMessage({ kind: "GET_STATE" }) as Promise<SessionSnapshot>,
    checkHealth(),
  ]);
  healthDot.className = `dot ${healthy ? "up" : "down"}`;
  healthText.textContent = healthy
    ? "Backend connected"
    : "Backend offline — start the local server";
  render(state, healthy);
}

toggleBtn.addEventListener("click", async () => {
  toggleBtn.disabled = true;
  showError(null);
  if (!recording) {
    const res = (await chrome.runtime.sendMessage({ kind: "START_RECORDING" })) as StartResponse;
    if (!res.ok) showError(res.error ?? "Could not start recording");
  } else {
    toggleBtn.textContent = "Finalizing…";
    const res = (await chrome.runtime.sendMessage({ kind: "STOP_RECORDING" })) as StopResponse;
    if (!res.ok) showError(res.error ?? "Could not finalize the guide");
  }
  await refresh();
});

void refresh();
pollTimer = window.setInterval(refresh, 1000);
window.addEventListener("unload", () => window.clearInterval(pollTimer));

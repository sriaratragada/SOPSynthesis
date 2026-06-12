import type { SessionSnapshot, StartResponse, StopResponse } from "../shared/messages";
import { checkHealth } from "../background/uploader";

const toggleBtn = document.getElementById("toggle") as HTMLButtonElement;
const pauseBtn = document.getElementById("pause") as HTMLButtonElement;
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

let status: SessionSnapshot["status"] = "idle";
let pollTimer: number | undefined;

function showError(message: string | null): void {
  errorBox.textContent = message ?? "";
  errorBox.classList.toggle("hidden", !message);
}

function formatElapsed(state: SessionSnapshot): string {
  if (!state.startedAt) return "0:00";
  const pausedNow = state.pausedAt ? Date.now() - state.pausedAt : 0;
  const total = Math.max(
    0,
    Math.floor((Date.now() - state.startedAt - state.pausedAccumMs - pausedNow) / 1000),
  );
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function render(state: SessionSnapshot, healthy: boolean): void {
  status = state.status;
  const active = status === "recording" || status === "paused";

  if (status === "countdown") {
    const remaining = state.countdownEndsAt
      ? Math.max(1, Math.ceil((state.countdownEndsAt - Date.now()) / 1000))
      : 3;
    toggleBtn.textContent = `Starting in ${remaining}… (cancel)`;
    toggleBtn.classList.add("stop");
    toggleBtn.disabled = false;
  } else if (active) {
    toggleBtn.textContent = "Stop recording";
    toggleBtn.classList.add("stop");
    // Stopping must stay possible even if the backend just went down.
    toggleBtn.disabled = false;
  } else {
    toggleBtn.textContent = "Start recording";
    toggleBtn.classList.remove("stop");
    toggleBtn.disabled = !healthy;
  }

  pauseBtn.classList.toggle("hidden", !active);
  pauseBtn.textContent = status === "paused" ? "Resume" : "Pause";

  statusBox.classList.toggle("visible", active);
  if (active) {
    statusTab.textContent =
      status === "paused"
        ? "Paused — clicks aren't captured"
        : `Recording: ${state.lastTabTitle ?? "current tab"}`;
    statusTab.title = state.lastTabTitle ?? "";
    statusSteps.textContent = String(state.stepCount);
    statusElapsed.textContent = formatElapsed(state);
    statusLast.textContent = state.lastAction ? `Last: ${state.lastAction}` : "";
  }

  const queued = state.queuedCount;
  warnQueue.textContent =
    queued > 0
      ? `⏳ ${queued} captured event${queued === 1 ? "" : "s"} waiting to upload — they retry automatically.`
      : "";
  warnQueue.classList.toggle("visible", queued > 0);

  warnCapture.textContent = state.lastCaptureError
    ? `⚠️ Screenshots may be failing: ${state.lastCaptureError}`
    : "";
  warnCapture.classList.toggle("visible", active && !!state.lastCaptureError);
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
  if (status === "idle") {
    // The response arrives after the countdown completes (or is cancelled);
    // keep polling meanwhile so the button shows the live countdown.
    void (chrome.runtime.sendMessage({ kind: "START_RECORDING" }) as Promise<StartResponse>).then(
      (res) => {
        if (res && !res.ok) showError(res.error ?? "Could not start recording");
        void refresh();
      },
    );
    window.setTimeout(() => void refresh(), 150);
  } else {
    toggleBtn.textContent = "Finalizing…";
    const res = (await chrome.runtime.sendMessage({ kind: "STOP_RECORDING" })) as StopResponse;
    if (!res.ok) showError(res.error ?? "Could not finalize the guide");
    await refresh();
  }
});

pauseBtn.addEventListener("click", async () => {
  pauseBtn.disabled = true;
  const kind = status === "paused" ? "RESUME_RECORDING" : "PAUSE_RECORDING";
  const res = (await chrome.runtime.sendMessage({ kind })) as StartResponse;
  if (!res.ok) showError(res.error ?? "Could not change pause state");
  pauseBtn.disabled = false;
  await refresh();
});

void refresh();
pollTimer = window.setInterval(refresh, 500);
window.addEventListener("unload", () => window.clearInterval(pollTimer));

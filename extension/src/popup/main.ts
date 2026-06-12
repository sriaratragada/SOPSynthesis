import type { SessionSnapshot, StartResponse, StopResponse } from "../shared/messages";
import { checkHealth } from "../background/uploader";

const toggleBtn = document.getElementById("toggle") as HTMLButtonElement;
const healthDot = document.getElementById("health-dot")!;
const healthText = document.getElementById("health-text")!;
const counter = document.getElementById("counter")!;
const errorBox = document.getElementById("error")!;

let recording = false;
let pollTimer: number | undefined;

function showError(message: string | null): void {
  errorBox.textContent = message ?? "";
  errorBox.classList.toggle("hidden", !message);
}

function render(state: SessionSnapshot, healthy: boolean): void {
  recording = state.status === "recording";
  toggleBtn.textContent = recording ? "Stop recording" : "Start recording";
  toggleBtn.classList.toggle("stop", recording);
  // Stopping must stay possible even if the backend just went down.
  toggleBtn.disabled = !recording && !healthy;
  counter.textContent = `${state.stepCount} step${state.stepCount === 1 ? "" : "s"} captured`;
  counter.classList.toggle("hidden", !recording);
}

async function refresh(): Promise<void> {
  const [state, healthy] = await Promise.all([
    chrome.runtime.sendMessage({ kind: "GET_STATE" }) as Promise<SessionSnapshot>,
    checkHealth(),
  ]);
  healthDot.className = `dot ${healthy ? "up" : "down"}`;
  healthText.textContent = healthy ? "Backend connected" : "Backend offline — start the local server";
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
pollTimer = window.setInterval(refresh, 1500);
window.addEventListener("unload", () => window.clearInterval(pollTimer));

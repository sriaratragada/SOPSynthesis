// End-to-end extension test: launches Chrome with the built extension, drives a
// real recording (popup → countdown → trusted clicks/typing → stop), and asserts
// that events and screenshots reach the backend.
//
// Prereqs: backend running on 127.0.0.1:8787, extension built into extension/dist.
// Usage:   node scripts/e2e-extension.mjs [--headful]

import { createServer } from "node:http";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extDir = path.join(root, "extension", "dist");
const API = "http://127.0.0.1:8787/api";
const TEST_PORT = 8123;
const HEADFUL = process.argv.includes("--headful");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Branded Chrome stable removed --load-extension support; Edge still honors it.
const CHROME_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

const TEST_PAGE = `<!doctype html>
<html><head><title>SOPS Test Page</title></head>
<body style="font-family:sans-serif;padding:40px">
  <h1>Test workflow</h1>
  <input id="search" placeholder="Search things" style="padding:8px;width:240px">
  <button id="approve" style="padding:10px 20px;margin-left:12px">Approve</button>
  <a id="next" href="/page2" style="display:block;margin-top:24px">Go to page 2</a>
</body></html>`;

const TEST_PAGE_2 = `<!doctype html>
<html><head><title>SOPS Test Page 2</title></head>
<body style="font-family:sans-serif;padding:40px">
  <h1>Page two</h1>
  <button id="confirm" style="padding:10px 20px">Confirm</button>
</body></html>`;

async function main() {
  // --- tiny static server for a recordable http page ---
  const server = createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(req.url?.startsWith("/page2") ? TEST_PAGE_2 : TEST_PAGE);
  });
  await new Promise((r) => server.listen(TEST_PORT, "127.0.0.1", r));

  const health = await fetch(`${API}/health`).then((r) => r.ok).catch(() => false);
  if (!health) throw new Error("Backend is not running on 127.0.0.1:8787");

  const executablePath = CHROME_PATHS.find((p) => existsSync(p));
  if (!executablePath) throw new Error("No Chrome/Edge executable found");

  const guidesBefore = await fetch(`${API}/guides`).then((r) => r.json());

  const browser = await puppeteer.launch({
    executablePath,
    headless: HEADFUL ? false : true,
    args: [
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1280,800",
    ],
    defaultViewport: { width: 1280, height: 720 },
  });

  const logs = [];
  const log = (source, text) => {
    logs.push(`[${source}] ${text}`);
    console.log(`[${source}] ${text}`);
  };

  try {
    // --- find the extension service worker + capture its console ---
    const swTarget = await browser.waitForTarget(
      (t) => t.type() === "service_worker" && t.url().includes("background.js"),
      { timeout: 15000 },
    );
    const extensionId = new URL(swTarget.url()).host;
    log("harness", `extension id: ${extensionId}`);
    const sw = await swTarget.worker();
    sw.on("console", (msg) => log("sw", `${msg.type()}: ${msg.text()}`));

    // --- open the test page FIRST (it must be the active tab for screenshots) ---
    const page = await browser.newPage();
    page.on("console", (msg) => log("page", `${msg.type()}: ${msg.text()}`));
    page.on("pageerror", (err) => log("page", `pageerror: ${err.message}`));
    await page.goto(`http://127.0.0.1:${TEST_PORT}/`, { waitUntil: "load" });

    // --- open the popup in a background tab and start recording ---
    const popup = await browser.newPage();
    popup.on("console", (msg) => log("popup", `${msg.type()}: ${msg.text()}`));
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "load" });
    await popup.waitForFunction(
      () => !document.getElementById("toggle")?.disabled,
      { timeout: 5000 },
    );
    await popup.click("#toggle");
    log("harness", "clicked Start");

    // countdown is 3s; make the test page the active tab while it runs
    await page.bringToFront();
    await sleep(4200);

    const status1 = await popup.evaluate(async () => {
      return await chrome.runtime.sendMessage({ kind: "GET_STATE" });
    });
    log("harness", `state after countdown: ${JSON.stringify(status1)}`);
    if (status1?.status !== "recording") {
      throw new Error(`expected status=recording after countdown, got ${status1?.status}`);
    }

    // --- perform a real workflow with trusted input events ---
    await page.bringToFront();
    await page.click("#search");
    await sleep(300);
    await page.type("#search", "quarterly report");
    await sleep(900);
    await page.click("#approve");
    await sleep(900);

    // --- pause: clicks while paused must NOT be captured ---
    await popup.bringToFront();
    await popup.click("#pause");
    await sleep(400);
    const pausedBefore = await popup.evaluate(
      async () => await chrome.runtime.sendMessage({ kind: "GET_STATE" }),
    );
    if (pausedBefore?.status !== "paused") {
      throw new Error(`expected status=paused, got ${pausedBefore?.status}`);
    }
    await page.bringToFront();
    await page.click("#approve"); // off the record
    await sleep(700);
    const pausedAfter = await popup.evaluate(
      async () => await chrome.runtime.sendMessage({ kind: "GET_STATE" }),
    );
    if (pausedAfter.stepCount !== pausedBefore.stepCount) {
      throw new Error(
        `paused click was captured: stepCount ${pausedBefore.stepCount} → ${pausedAfter.stepCount}`,
      );
    }
    log("harness", `pause verified: stepCount stayed at ${pausedAfter.stepCount} while paused`);
    await popup.bringToFront();
    await popup.click("#pause"); // resume
    await sleep(400);

    await page.bringToFront();
    await page.click("#next"); // navigates to /page2
    await page.waitForSelector("#confirm", { timeout: 5000 });
    await sleep(1200); // give the fresh content script time to handshake
    await page.click("#confirm");
    await sleep(900);

    const state2 = await popup.evaluate(async () => {
      return await chrome.runtime.sendMessage({ kind: "GET_STATE" });
    });
    log("harness", `state after clicks: ${JSON.stringify(state2)}`);

    // --- stop and verify the guide on the backend ---
    await popup.bringToFront();
    await popup.click("#toggle");
    await sleep(2500);

    const guidesAfter = await fetch(`${API}/guides`).then((r) => r.json());
    const newGuides = guidesAfter.filter(
      (g) => !guidesBefore.some((b) => b.id === g.id),
    );
    if (newGuides.length === 0) throw new Error("no new guide was created");
    const guide = await fetch(`${API}/guides/${newGuides[0].id}`).then((r) => r.json());

    log("harness", `guide "${guide.title}" with ${guide.steps.length} steps:`);
    for (const s of guide.steps) {
      log(
        "harness",
        `  ${s.position + 1}. ${s.instructionText} [shot=${s.screenshotId ? "yes" : "NO"}]`,
      );
    }

    const clickSteps = guide.steps.filter((s) => s.meta?.eventType === "click");
    const missingShots = clickSteps.filter((s) => !s.screenshotId);
    if (guide.steps.length < 4) {
      throw new Error(`expected >=4 steps, got ${guide.steps.length}`);
    }
    if (missingShots.length > 0) {
      throw new Error(`${missingShots.length}/${clickSteps.length} click steps lack screenshots`);
    }
    log("harness", "phase 1 PASS ✅  fresh-install recording works");

    // ---- phase 2: EXTENSION RELOAD with the page kept open ----
    // This is the real-world path: user reloads the extension at
    // chrome://extensions while tabs stay open, then records. The page now
    // hosts an orphaned content script from the previous extension lifetime.
    log("harness", "phase 2: reloading extension without reloading the page…");
    await sw.evaluate(() => chrome.runtime.reload());
    const swTarget2 = await browser.waitForTarget(
      (t) =>
        t.type() === "service_worker" &&
        t.url().includes("background.js") &&
        t !== swTarget,
      { timeout: 15000 },
    );
    const sw2 = await swTarget2.worker();
    sw2.on("console", (msg) => log("sw2", `${msg.type()}: ${msg.text()}`));
    await sleep(1500);

    const guidesMid = await fetch(`${API}/guides`).then((r) => r.json());

    // old popup page died with the old extension process — open a fresh one
    const popup2 = await browser.newPage();
    popup2.on("console", (msg) => log("popup2", `${msg.type()}: ${msg.text()}`));
    await popup2.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "load" });
    await popup2.waitForFunction(() => !document.getElementById("toggle")?.disabled, {
      timeout: 5000,
    });
    await popup2.click("#toggle");
    await page.bringToFront();
    await sleep(4200);

    await page.click("#confirm");
    await sleep(900);
    await page.click("#confirm");
    await sleep(900);

    const state3 = await popup2.evaluate(
      async () => await chrome.runtime.sendMessage({ kind: "GET_STATE" }),
    );
    log("harness", `phase 2 state after clicks: ${JSON.stringify(state3)}`);

    await popup2.bringToFront();
    await popup2.click("#toggle");
    await sleep(2500);

    const guidesEnd = await fetch(`${API}/guides`).then((r) => r.json());
    const phase2Guides = guidesEnd.filter((g) => !guidesMid.some((b) => b.id === g.id));
    if (phase2Guides.length === 0) throw new Error("phase 2: no guide created");
    const guide2 = await fetch(`${API}/guides/${phase2Guides[0].id}`).then((r) => r.json());
    const clicks2 = guide2.steps.filter((s) => s.meta?.eventType === "click");
    log("harness", `phase 2 guide has ${guide2.steps.length} steps (${clicks2.length} clicks)`);
    for (const s of guide2.steps) {
      log(
        "harness",
        `  ${s.position + 1}. ${s.instructionText} [shot=${s.screenshotId ? "yes" : "NO"}]`,
      );
    }
    if (clicks2.length < 1 || clicks2.some((s) => !s.screenshotId)) {
      throw new Error(
        "phase 2 FAIL: clicks after an extension reload were not captured " +
          "(orphaned content-script takeover is broken)",
      );
    }
    log("harness", "E2E PASS ✅  fresh install AND post-reload recording both work");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(`\nE2E FAIL ❌ ${err.message}`);
  process.exit(1);
});

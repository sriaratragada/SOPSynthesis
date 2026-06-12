# Getting Started with SOPSynthesis

## What is SOPSynthesis?

SOPSynthesis watches you complete a task and automatically writes a step-by-step guide for it. Just click a button to start recording, walk through your workflow normally, and SOPSynthesis captures everything—your clicks, typing, and screenshots. When you're done, it generates a polished guide with annotated screenshots, descriptive text, and the option to edit, reorder, or refine any step before sharing.

## One-Time Setup

SOPSynthesis requires Python 3.12+ and Node 20+ on your machine.

### 1. Install Python and Node

- **Python 3.12+**: Download from [python.org](https://www.python.org/downloads/)
- **Node 20+**: Download from [nodejs.org](https://nodejs.org/)

Verify installation:
```powershell
python --version
node --version
npm --version
```

### 2. Install Dependencies

In PowerShell, from the project root:

```powershell
# Backend Python environment
cd backend
python -m venv .venv
.venv\Scripts\pip install -e ".[dev]"

# Return to project root
cd ..

# Frontend and extension Node dependencies
npm install
```

## Starting the App

Open three separate terminal windows and run these commands in order:

### Terminal 1: Backend (http://127.0.0.1:8787)

```powershell
cd backend
.venv\Scripts\python -m uvicorn app.main:app --port 8787
```

Wait for the message: `Uvicorn running on http://127.0.0.1:8787`. The database (SQLite) and screenshot storage will be created automatically.

### Terminal 2: Web App (http://localhost:5173)

```powershell
npm run dev:web
```

You should see: `Local: http://localhost:5173/`.

### Terminal 3: Build and Load the Extension

```powershell
npm run build:ext
```

Then in Chrome or Edge:
1. Go to `chrome://extensions`
2. Toggle **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/dist` folder from this project

You should see the SOPSynthesis extension icon in your toolbar.

## Recording Your First Guide

1. **Check the health indicator**: Click the SOPSynthesis extension icon. You should see a **green dot**. If it's red, the backend is not running—go back to Terminal 1.

2. **Start recording**: Click **Start recording** in the popup. A 3-2-1 countdown
   appears on the page — capture begins when it finishes, so closing the popup and
   getting settled isn't recorded as step 1. (Click the button again during the
   countdown to cancel.)

3. **Perform your task**: Use the website or application normally. Click buttons, type into forms, navigate between pages—SOPSynthesis captures it all. You can move across different domains; the extension maintains context.

4. **While recording**:
   - The toolbar icon turns **red with a REC badge**, and a floating
     **"Recording" pill** appears in the bottom-right corner of every page with
     Pause and Stop buttons. Clicks on the pill itself are never captured.
   - **Pause** any time (pill button, popup button, or `Alt+Shift+P`) to do
     something off the record — the pill turns amber and says "Paused", and
     nothing is captured until you Resume. The elapsed timer excludes paused time.
   - The popup shows what's being captured: **Recording: {tab name}**, steps
     captured, elapsed time, and the last action (e.g. *Last: Clicked "Approve"*).

5. **Keyboard shortcuts**: `Alt+Shift+S` starts/stops recording and `Alt+Shift+P`
   pauses/resumes — no need to open the popup. Customize them at
   `chrome://extensions/shortcuts`.

6. **Stop recording**: Click **Stop** in the extension popup, on the floating pill, or press `Alt+Shift+S`.

7. **View your guide**: A new browser tab opens showing your newly generated guide. It appears as a list of steps, each with an annotated screenshot and automatically-generated descriptive text.

## Editing Your Guide

In the guide viewer, you can refine every aspect:

### Guide Metadata
- **Title & Description**: Click the title or description text at the top of the page and type — changes save when you click away.

### Step Operations
- **Edit text**: click the step description and type; a small toolbar (bold, italic, link) appears while editing. Saves when you click away.
- **Drag to reorder**: grab the ⠿ handle on the left edge of a step and drag.
- **Delete**: the ✕ button on the step.
- **Regenerate text**: the ↻ button restores the auto-generated description.
- **Add a note/callout**: the ✎ button opens the callout editor (Info / Warning / Caution).
- **In the ⋯ menu**: **Edit screenshot**, **Duplicate**, **Split in two**, **Merge with next**.
  - **Duplicate**: Creates a copy below the current step (useful for similar repeated actions).
  - **Split**: Breaks one step into two, sharing the same screenshot (for complex actions).
  - **Merge**: Combines two consecutive steps into one (the first keeps its screenshot).

### Screenshot Annotations
1. Click **Edit screenshot** on any step to open the visual editor.
2. **Draw**: Select a tool (arrows, boxes, ellipses, or text) and drag on the image to draw; text annotations are placed with a single click, which prompts for the text.
3. **Move the click target**: Select the ◎ (Move click target) tool first, then drag the circle to adjust where you clicked.
4. **Crop**: Use the crop tool to remove unnecessary parts of the screenshot.
5. **Blur**: Select regions that contain sensitive information (passwords, credit cards, etc.) and blur them. Blurring creates a pixelated version on export while keeping the original untouched and undoable.
6. **Save**: click the **Save** button to keep your changes. Pressing Escape or clicking **Cancel** discards them.

### Sensitive Data Detection
- Steps with text that *might* contain an email, SSN, or credit card number are flagged with a yellow **"may contain sensitive data"** badge.
- You can either manually blur those regions using the screenshot editor, or dismiss the badge if it's a false positive.

### Adding Callouts and Notes
- Click the ✎ button on a step to insert an info box, warning, or caution note.
- Useful for highlighting important details or gotchas.

## Exporting Your Guide

Click the **Export Markdown** button at the top of the guide.

- Downloads a ZIP file containing `guide.md` and all associated images (including any crops and blurs you applied).
- The Markdown is ready to share, paste into documentation, or convert to other formats (PDF, HTML, etc.).
- All redacted/blurred regions are baked into the exported images; the original screenshots remain untouched on your machine.

## Settings

Click **Settings** (gear icon) to customize:

- **Marker color**: Choose the color for click targets, step numbers, and exported images (default: orange #FF5C35). Annotation shapes have their own per-shape color chosen in the screenshot editor.
- **Logo**: Upload a PNG, JPG, or WebP logo. The logo appears in the web app header.

## Troubleshooting

### Recording captures nothing (no steps, no screenshots)
Work through these in order — the popup now diagnoses most of them for you:

1. **Stale build**: the popup footer shows the running version (e.g. `v0.2.0`).
   After any rebuild (`npm run build:ext`), click the reload (↻) button on the
   extension at `chrome://extensions` — Chrome does not pick up new builds
   automatically.
2. **Site access**: at `chrome://extensions`, open SOPSynthesis → Details →
   set **Site access** to **"On all sites"**. With "On click", Chrome blocks
   both capture and screenshots; the popup shows a warning if it detects this
   when you press Start.
3. **Non-recordable page**: browser pages (`chrome://…`, the Web Store, the
   new-tab page) and the SOPSynthesis app itself cannot be recorded. The popup
   shows "This page can't be recorded" when your current tab is one of these.
4. Run the automated end-to-end check to prove the pipeline works on your
   machine: `npm run e2e:ext` (requires the backend running; uses Edge).

### Red dot in the extension popup
- The backend is not running. Start it in Terminal 1 (`cd backend; .venv\Scripts\python -m uvicorn app.main:app --port 8787`).

### Guide didn't open after stopping recording
- Check that the web app is running on http://localhost:5173 (Terminal 2).
- Check the browser console for errors (press F12 → Console tab).

### Deleting all your data
- All guides and recordings are stored in the `data/` folder.
- To start completely fresh, delete the `data/` folder and restart the backend. It will be recreated empty.

### Can't find the extension after building
- Verify you ran `npm run build:ext` successfully (look for `extension/dist/manifest.json`).
- In Chrome, go to `chrome://extensions`, enable Developer mode, and click **Load unpacked** to select the `extension/dist` folder.
- If you see an error about the manifest, the build may have failed—check the terminal output for errors.

## Next Steps

- **Record a few guides** to get familiar with the workflow.
- **Export and share** a guide to see how it looks.
- **Explore the roadmap** in `docs/architecture.md` to see what's coming: richer exports (HTML, PDF, GIF), workspaces, cloud sync, and team features.

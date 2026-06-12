# SOPSynthesis

Local-first SOP / process-documentation tool: a Chrome extension records your clicks,
typing, and screenshots as you work through a workflow, and a local backend turns the
recording into an editable step-by-step guide you can view, edit, and export.

## Architecture

| Piece | Stack | Where |
|---|---|---|
| Capture | Chrome MV3 extension, TypeScript | `extension/` |
| Processing + storage | FastAPI + SQLite + filesystem screenshots | `backend/` |
| Viewer / editor | React + Vite + Tailwind | `web/` |
| Shared API types | Generated from FastAPI's OpenAPI | `packages/shared/` |

Everything runs on your machine. No accounts, no cloud. Guides live in `data/`
(SQLite metadata + content-addressed PNGs).

## Dev setup (three terminals)

### 0. One-time setup

```powershell
# Python backend
cd backend
python -m venv .venv
.venv\Scripts\pip install -e ".[dev]"

# Node workspaces (web + extension + shared)
cd ..
npm install
```

### 1. Backend — http://127.0.0.1:8787

```powershell
cd backend
.venv\Scripts\python -m uvicorn app.main:app --port 8787
```

Tables are created automatically on startup (Alembic migration 0001).

### 2. Web app — http://localhost:5173

```powershell
npm run dev:web
```

### 3. Extension

```powershell
npm run build:ext
```

Then in Chrome/Edge: `chrome://extensions` → enable Developer mode → **Load unpacked**
→ select `extension/dist`.

## Using it

1. With the backend running, click the extension icon. The health dot should be green.
2. Click **Start recording**, perform your workflow (clicks and typing are captured,
   across page loads and domains), then click **Stop**.
3. A new tab opens to the generated guide in the web app. Edit step text inline
   (rich text: bold, italic, links), drag to reorder, duplicate/split/merge
   steps, add callouts, regenerate descriptions, or export to Markdown.
4. Hover a screenshot and click **Edit screenshot** to open the editor: draw
   arrows/boxes/ellipses/text, drag the click target, crop, and blur sensitive
   regions (blurs are pixelated server-side into a derived image — the original
   is kept, so blurring is always undoable). Steps whose captured text looks
   like an email, SSN, or card number are flagged for review automatically.
5. **Settings** lets you set the marker color and upload a workspace logo;
   both apply to the viewer and to exported images.

## Regenerating API types

After changing `backend/app/schemas.py` or any router:

```powershell
npm run gen:types
```

This dumps the FastAPI OpenAPI schema and regenerates
`packages/shared/src/api-types.gen.ts` (never hand-edit that file).

## Tests

```powershell
cd backend
.venv\Scripts\python -m pytest
```

## Roadmap

Phase 1 (this code): core capture loop. Later phases: screenshot editor + redaction,
HTML/PDF/GIF exports + share links, workspace folders + search + Pages, Sidekick +
Guide Me walkthroughs, cloud sync + teams. See `docs/` and the plan for details.

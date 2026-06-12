# SOPSynthesis Architecture

## System Overview

SOPSynthesis is a local-first, three-tier application:

```
┌──────────────────────────────┐
│  Chrome Extension (MV3)      │  Capture layer
│  - Records clicks/typing     │
│  - Takes screenshots         │
│  - Handles page transitions  │
└─────────────────┬────────────┘
                  │ POST /api/recordings/{id}/events
                  │ multipart/form-data
                  ↓
┌──────────────────────────────────┐
│  FastAPI Backend + SQLite        │  Processing layer
│  - Deduplicates events           │
│  - Generates step descriptions   │
│  - Stores guides & metadata      │
│  - Manages redactions            │
│  - Exports Markdown + images     │
└─────────────────┬────────────────┘
                  │ REST API
                  ↓
┌──────────────────────────────┐
│  React Web App (Vite)        │  Editor/viewer layer
│  - View guides               │
│  - Edit steps & metadata     │
│  - Screenshot editor         │
│  - Markdown export UI        │
└──────────────────────────────┘
```

## Component Details

### 1. Chrome Extension (`extension/`)

**Stack**: TypeScript, Vite, Chrome MV3  
**Entry points**: Service worker (background), content script, popup UI

**Capture flow**:
1. **Pointerdown listener** captures clicks with a screenshot taken **before** any navigation (via `chrome.tabs.captureVisibleTab`).
2. **Type coalescing**: Detects focused input fields and coalesces text entry into a single `type` event per field. Fires on blur, Enter, or next click.
3. **Password masking**: Password field values are never captured; the `typed.masked` flag is set at the source.
4. **Service worker state management**: Maintains recording session state, increments sequence numbers, and handles page/domain changes via a state handshake.
5. **Retry queue**: Failed POSTs are queued and retried automatically; the backend's idempotency key (`recording_id`, `seq`) ensures safety.

**Screenshot metadata** includes viewport size, devicePixelRatio, and scroll position at the time of capture.

### 2. FastAPI Backend (`backend/`)

**Stack**: FastAPI, SQLite, Python 3.12+  
**Storage**: Filesystem content-addressed PNG store in `data/screenshots/` (gitignored)

#### Event Ingestion
- **Endpoint**: `POST /api/recordings/{recording_id}/events` (multipart: event JSON + screenshot PNG)
- **Idempotency**: `(recording_id, seq)` uniqueness enforced at the DB level.
- **Screenshot deduplication**: Screenshots are SHA256-hashed and stored once; multiple events can reference the same screenshot.

#### Pipeline: Event → Guide
1. **Finalize recording**: `POST /api/recordings/{recording_id}/finalize`
2. **Deduplication**: Filters out double-clicks (same click twice) and post-navigation click artifacts.
3. **Description generation**: Template-based step text (no LLM) from element metadata and event type.
4. **Sensitive data detection**: Flags steps whose captured text looks like an email, SSN (9 digits), or credit-card number (16 digits).
5. **Guide creation**: Stores guide metadata (title, description) and steps with full metadata for undo.

#### Key Invariant: Normalized Coordinates
- All click and annotation coordinates are stored as normalized **0–1 fractions** of the original screenshot viewport.
- Formula: `normalized_x = clientX / viewport.w`, `normalized_y = clientY / viewport.h`
- **Benefit**: Makes markers immune to display scaling, zoom, and devicePixelRatio. Coordinates are re-rendered as percentage offsets over the image on any device.
- Raw `clientX`, `clientY`, `viewport`, and `dpr` are retained in the event payload for forensics, but never used for rendering.

#### Pristine Originals + Derived Redactions
- **Original screenshots**: Stored immutably in the filesystem; never modified.
- **Redaction workflow**: Blur rects are applied to a **derived copy** via pixelation, stored separately as `redacted_screenshot_id`.
- **Undoability**: Original is always recoverable; redactions can be cleared at any time.

#### Main API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/recordings` | Create a new recording session |
| `POST` | `/api/recordings/{id}/events` | Append a capture event (click/type/navigate) + screenshot |
| `POST` | `/api/recordings/{id}/finalize` | Run pipeline, generate guide from events |
| `GET` | `/api/recordings/{id}` | Check recording status |
| `GET` | `/api/guides` | List all guides (sorted by recency) |
| `GET` | `/api/guides/{id}` | Fetch full guide with all steps |
| `PATCH` | `/api/guides/{id}` | Edit guide title/description |
| `DELETE` | `/api/guides/{id}` | Delete guide (cascades to recording + events) |
| `PATCH` | `/api/guides/{id}/steps/{step_id}` | Edit step: instruction, callout, click, annotations, crop, redactions |
| `DELETE` | `/api/guides/{id}/steps/{step_id}` | Delete step (reindexes remaining) |
| `POST` | `/api/guides/{id}/steps:reorder` | Reorder steps by ID list |
| `POST` | `/api/guides/{id}/steps/{step_id}:regenerate` | Regenerate step description from metadata |
| `POST` | `/api/guides/{id}/steps/{step_id}:duplicate` | Clone a step |
| `POST` | `/api/guides/{id}/steps/{step_id}:split` | Split into two steps (shared screenshot) |
| `POST` | `/api/guides/{id}/steps:merge` | Merge two steps (first keeps screenshot) |
| `GET` | `/api/guides/{id}/export/markdown` | Export guide as Markdown ZIP (with images) |
| `GET` | `/api/screenshots/{id}` | Fetch a screenshot PNG (content-addressed, immutable) |
| `GET` | `/api/settings` | Fetch marker color and logo metadata |
| `PATCH` | `/api/settings` | Update marker color |
| `POST` | `/api/settings/logo` | Upload workspace logo (PNG/JPG/WebP) |
| `DELETE` | `/api/settings/logo` | Remove logo |
| `GET` | `/api/settings/logo` | Fetch logo PNG |

### 3. React Web App (`web/`)

**Stack**: React 19, Vite, Tailwind CSS v4, TanStack Query, Konva (screenshot editor)

**Features**:
- **Guide list**: Sorted by recency, click to open for editing.
- **Guide viewer/editor**: Rich-text step instructions (bold, italic, links via TipTap), callout support (info/warning/caution).
- **Drag-to-reorder**: dnd-kit integration for step reordering with drag handles.
- **Sensitive data badges**: Yellow flag on steps flagged by the pipeline; dismiss or re-blur via editor.
- **Screenshot editor** (Konva-based):
  - Draw annotations: arrows, boxes, ellipses, text.
  - Adjust click target position (normalized coordinates).
  - Crop tool.
  - Blur tool (sends redaction rects to backend, stores derived image).
- **Settings**: Marker color picker, logo upload/removal.
- **Markdown export**: Streams a ZIP file containing `guide.md` + images (crops and blurs applied).

## Data Flow Example: Recording a Click

1. **User clicks a button** on example.com/page.
2. **Extension's pointerdown listener** fires:
   - Takes screenshot via `captureVisibleTab` (exactly the visible viewport).
   - Extracts element metadata (tag, text, id, selector, etc.).
   - Normalizes click coordinates: `nx = clientX / innerWidth`, `ny = clientY / innerHeight`.
   - Builds `CaptureEvent` object with type="click".
   - POSTs to `/api/recordings/{id}/events` with event JSON + screenshot PNG.
3. **Backend receives** the event:
   - SHA256-hashes the screenshot; deduplicates if identical hash already exists.
   - Stores `Event` record with normalized click coordinates and element metadata.
   - Idempotency check: if `(recording_id, seq)` already exists, returns duplicate flag (safe for retries).
4. **Later, user clicks Stop**:
   - Backend runs finalization: `POST /api/recordings/{id}/finalize`.
   - Dedup pipeline removes double-clicks and post-navigate artifacts.
   - For each surviving event, generates a step description using a template generator (reads element tag, text, event type, etc.).
   - Creates `Guide` with `title` (from first page title) and `description` (empty, can be edited).
   - Creates `Step` records with normalized coordinates stored in `click` JSON field.
5. **Web app fetches** `GET /api/guides/{guide_id}`:
   - For each step, the click's `nx`, `ny` are rendered as `left: nx*100%`, `top: ny*100%` over the screenshot image.
   - Screenshot editor in Konva applies the same normalization when the user drags markers.
   - Annotations and crop rects also use normalized coordinates.

## Type Generation

**Source of truth**: `backend/app/schemas.py` (Pydantic models)

1. Backend's FastAPI framework auto-generates OpenAPI schema from Pydantic types.
2. Run `npm run gen:types` to dump the schema and regenerate `packages/shared/src/api-types.gen.ts`.
3. Web and extension import types from `packages/shared/src/api-types.gen.ts` (never hand-edit).
4. **This ensures type safety across the full stack.**

## Roadmap

- **Phase 2** (planned): Extended screenshot editor (currently v1), more annotation types.
- **Phase 3** (planned): HTML and PDF exports, GIF recording playback, share links.
- **Phase 4** (planned): Workspace folders, search, Pages (multi-section guides).
- **Phase 5** (planned): Sidekick (AI assistant for editing), Guide Me (interactive walkthroughs).
- **Phase 6** (planned): Cloud sync, user accounts, team collaboration, enterprise features.

**Phase 1** (current) focuses on the core capture, dedup, and local editing loop—everything runs on your machine, no cloud or accounts required.

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { StepOut } from "@sops/shared";
import { lazy, Suspense, useState } from "react";
import {
  useDeleteStep,
  useDuplicateStep,
  useMergeSteps,
  usePatchStep,
  useRegenerateStep,
  useSplitStep,
} from "../hooks/useGuide";
import InstructionEditor from "./InstructionEditor";
import StepScreenshot from "./StepScreenshot";

// Konva is heavy; only load the editor when someone opens it.
const ScreenshotEditor = lazy(() => import("./ScreenshotEditor"));

const CALLOUT_STYLES: Record<string, string> = {
  info: "border-sky-300 bg-sky-50 text-sky-900",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
  caution: "border-red-300 bg-red-50 text-red-900",
};

const SENSITIVE_LABELS: Record<string, string> = {
  email: "an email address",
  ssn: "an SSN",
  card: "a card number",
};

export default function StepCard({
  guideId,
  step,
  index,
  nextStepId,
}: {
  guideId: string;
  step: StepOut;
  index: number;
  nextStepId: string | null;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.id,
  });
  const patchStep = usePatchStep(guideId);
  const deleteStep = useDeleteStep(guideId);
  const regenerate = useRegenerateStep(guideId);
  const duplicate = useDuplicateStep(guideId);
  const split = useSplitStep(guideId);
  const merge = useMergeSteps(guideId);

  const [editingCallout, setEditingCallout] = useState(false);
  const [editorTool, setEditorTool] = useState<"select" | "blur" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const sensitive = step.flags.sensitive ?? [];

  const menuAction = (fn: () => void) => () => {
    setMenuOpen(false);
    fn();
  };

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-xl border border-zinc-200 bg-white p-4 shadow-sm ${
        isDragging ? "z-10 opacity-80 shadow-lg" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <button
          {...attributes}
          {...listeners}
          title="Drag to reorder"
          className="mt-1 cursor-grab rounded p-1 text-zinc-400 hover:bg-zinc-100 active:cursor-grabbing"
        >
          ⠿
        </button>
        <span
          className="mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ background: "var(--marker-color, #FF5C35)" }}
        >
          {index + 1}
        </span>

        <InstructionEditor
          value={step.instructionText}
          onSave={(html) =>
            patchStep.mutate({ stepId: step.id, body: { instructionText: html, clearCallout: false } })
          }
        />

        <div className="relative flex shrink-0 gap-1 text-sm">
          <button
            title={step.instructionOverridden ? "Restore generated text" : "Regenerate text"}
            onClick={() => regenerate.mutate({ stepId: step.id, force: step.instructionOverridden })}
            className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            ↻
          </button>
          <button
            title="Add note"
            onClick={() => setEditingCallout((v) => !v)}
            className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            ✎
          </button>
          <button
            title="More actions"
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            ⋯
          </button>
          <button
            title="Delete step"
            onClick={() => deleteStep.mutate(step.id)}
            className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"
          >
            ✕
          </button>
          {menuOpen && (
            <div className="absolute top-9 right-0 z-20 w-44 rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg">
              {step.screenshotId && (
                <MenuItem onClick={menuAction(() => setEditorTool("select"))}>
                  Edit screenshot
                </MenuItem>
              )}
              {step.screenshotId && (
                <MenuItem onClick={menuAction(() => setEditorTool("blur"))}>
                  Blur a region
                </MenuItem>
              )}
              <MenuItem onClick={menuAction(() => duplicate.mutate(step.id))}>Duplicate</MenuItem>
              <MenuItem onClick={menuAction(() => split.mutate(step.id))}>Split in two</MenuItem>
              {nextStepId && (
                <MenuItem onClick={menuAction(() => merge.mutate([step.id, nextStepId]))}>
                  Merge with next
                </MenuItem>
              )}
            </div>
          )}
        </div>
      </div>

      {sensitive.length > 0 && (
        <div className="mt-3 ml-10 flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>
            ⚠️ This step may contain {sensitive.map((s) => SENSITIVE_LABELS[s] ?? s).join(", ")} —
            review and blur if needed.
          </span>
          {step.screenshotId && (
            <button
              onClick={() => setEditorTool("blur")}
              className="rounded border border-amber-400 px-2 py-0.5 text-xs font-medium hover:bg-amber-100"
            >
              Blur it
            </button>
          )}
          <button
            onClick={() =>
              patchStep.mutate({
                stepId: step.id,
                body: { flags: { sensitive: [] }, clearCallout: false },
              })
            }
            className="rounded px-2 py-0.5 text-xs hover:bg-amber-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {(step.calloutType || editingCallout) && (
        <CalloutEditor
          guideId={guideId}
          step={step}
          editing={editingCallout}
          onDone={() => setEditingCallout(false)}
        />
      )}

      {step.screenshotId && (
        <div className="group/shot relative mt-3 pl-10">
          <StepScreenshot step={step} />
          <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition group-hover/shot:opacity-100">
            <button
              onClick={() => setEditorTool("select")}
              className="rounded-md bg-white/90 px-2 py-1 text-xs font-medium shadow"
            >
              ✎ Edit screenshot
            </button>
            <button
              onClick={() => setEditorTool("blur")}
              title="Blur sensitive parts of this screenshot"
              className="rounded-md bg-white/90 px-2 py-1 text-xs font-medium shadow"
            >
              ▒ Blur
            </button>
          </div>
        </div>
      )}

      {editorTool && (
        <Suspense fallback={null}>
          <ScreenshotEditor
            guideId={guideId}
            step={step}
            initialTool={editorTool}
            onClose={() => setEditorTool(null)}
          />
        </Suspense>
      )}
    </li>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="block w-full px-3 py-1.5 text-left hover:bg-zinc-50">
      {children}
    </button>
  );
}

function CalloutEditor({
  guideId,
  step,
  editing,
  onDone,
}: {
  guideId: string;
  step: StepOut;
  editing: boolean;
  onDone: () => void;
}) {
  const patchStep = usePatchStep(guideId);
  const [type, setType] = useState(step.calloutType ?? "info");
  const [text, setText] = useState(step.calloutText ?? "");

  if (!editing && step.calloutType) {
    return (
      <div
        className={`mt-3 ml-10 rounded-md border px-3 py-2 text-sm ${
          CALLOUT_STYLES[step.calloutType] ?? CALLOUT_STYLES.info
        }`}
      >
        <span className="font-semibold capitalize">{step.calloutType}: </span>
        {step.calloutText}
      </div>
    );
  }

  return (
    <div className="mt-3 ml-10 flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-2 text-sm">
      <select
        value={type}
        onChange={(e) => setType(e.target.value as typeof type)}
        className="rounded border border-zinc-300 bg-white px-2 py-1"
      >
        <option value="info">Info</option>
        <option value="warning">Warning</option>
        <option value="caution">Caution</option>
      </select>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Note for this step…"
        className="min-w-40 flex-1 rounded border border-zinc-300 px-2 py-1"
      />
      <button
        onClick={() => {
          if (text.trim()) {
            patchStep.mutate({
              stepId: step.id,
              body: { calloutType: type, calloutText: text.trim(), clearCallout: false },
            });
          }
          onDone();
        }}
        className="rounded bg-brand px-2.5 py-1 font-medium text-white"
      >
        Save
      </button>
      {step.calloutType && (
        <button
          onClick={() => {
            patchStep.mutate({ stepId: step.id, body: { clearCallout: true } });
            onDone();
          }}
          className="rounded px-2 py-1 text-zinc-500 hover:text-red-600"
        >
          Remove
        </button>
      )}
    </div>
  );
}

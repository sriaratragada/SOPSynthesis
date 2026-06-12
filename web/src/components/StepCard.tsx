import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { StepOut } from "@sops/shared";
import { useEffect, useState } from "react";
import { useDeleteStep, usePatchStep, useRegenerateStep } from "../hooks/useGuide";
import StepScreenshot from "./StepScreenshot";

const CALLOUT_STYLES: Record<string, string> = {
  info: "border-sky-300 bg-sky-50 text-sky-900",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
  caution: "border-red-300 bg-red-50 text-red-900",
};

export default function StepCard({
  guideId,
  step,
  index,
}: {
  guideId: string;
  step: StepOut;
  index: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.id,
  });
  const patchStep = usePatchStep(guideId);
  const deleteStep = useDeleteStep(guideId);
  const regenerate = useRegenerateStep(guideId);

  const [draft, setDraft] = useState(step.instructionText);
  const [editingCallout, setEditingCallout] = useState(false);
  useEffect(() => setDraft(step.instructionText), [step.instructionText]);

  const saveInstruction = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== step.instructionText) {
      patchStep.mutate({ stepId: step.id, body: { instructionText: trimmed, clearCallout: false } });
    } else {
      setDraft(step.instructionText);
    }
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
        <span className="mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">
          {index + 1}
        </span>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={saveInstruction}
          rows={Math.max(1, Math.ceil(draft.length / 70))}
          className="min-w-0 flex-1 resize-none rounded-md border border-transparent px-2 py-1.5 text-[15px] leading-snug hover:border-zinc-200 focus:border-brand focus:outline-none"
        />
        <div className="flex shrink-0 gap-1 text-sm">
          <button
            title={step.instructionOverridden ? "Restore generated text" : "Regenerate text"}
            onClick={() =>
              regenerate.mutate({ stepId: step.id, force: step.instructionOverridden })
            }
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
            title="Delete step"
            onClick={() => deleteStep.mutate(step.id)}
            className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"
          >
            ✕
          </button>
        </div>
      </div>

      {(step.calloutType || editingCallout) && (
        <CalloutEditor
          guideId={guideId}
          step={step}
          editing={editingCallout}
          onDone={() => setEditingCallout(false)}
        />
      )}

      {step.screenshotId && (
        <div className="mt-3 pl-10">
          <StepScreenshot screenshotId={step.screenshotId} click={step.click} />
        </div>
      )}
    </li>
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

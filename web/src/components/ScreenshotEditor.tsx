// Full-screen screenshot editor (react-konva): annotate (arrow/box/ellipse/text),
// redact (server-pixelated on save), crop, and move the click target.
//
// All geometry is stored as 0–1 fractions of the ORIGINAL image. The editor
// always shows the original (so users can see and adjust what's under blur
// rects); the viewer and exports show the redacted derivative.

import type { Annotation, ClickPoint, CropRect, RedactionRect, StepOut } from "@sops/shared";
import type Konva from "konva";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Circle,
  Ellipse,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Stage,
  Text as KonvaText,
  Transformer,
} from "react-konva";
import useImage from "use-image";
import { screenshotUrl } from "../api/client";
import { usePatchStep } from "../hooks/useGuide";

type Tool = "select" | "target" | "arrow" | "rect" | "ellipse" | "text" | "blur" | "crop";
type Selected = { kind: "annotation" | "redaction"; id: string } | null;

const COLORS = ["#FF5C35", "#2563EB", "#16A34A", "#DC2626", "#111827"];
const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: "select", label: "↖", hint: "Select / move" },
  { id: "target", label: "◎", hint: "Move click target" },
  { id: "arrow", label: "↗", hint: "Arrow" },
  { id: "rect", label: "▭", hint: "Box" },
  { id: "ellipse", label: "◯", hint: "Ellipse" },
  { id: "text", label: "T", hint: "Text" },
  { id: "blur", label: "▒", hint: "Blur (redact)" },
  { id: "crop", label: "✂", hint: "Crop" },
];

const newId = () => Math.random().toString(36).slice(2, 10);

export default function ScreenshotEditor({
  guideId,
  step,
  onClose,
}: {
  guideId: string;
  step: StepOut;
  onClose: () => void;
}) {
  const patchStep = usePatchStep(guideId);
  const [image] = useImage(step.screenshotId ? screenshotUrl(step.screenshotId) : "");

  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState(COLORS[0]);
  const [annotations, setAnnotations] = useState<Annotation[]>(step.annotations);
  const [redactions, setRedactions] = useState<RedactionRect[]>(step.redactions);
  const [crop, setCrop] = useState<CropRect | null>(step.crop ?? null);
  const [click, setClick] = useState<ClickPoint | null>(step.click ?? null);
  const [selected, setSelected] = useState<Selected>(null);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null,
  );

  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);

  const naturalW = step.screenshotWidth ?? image?.width ?? 1280;
  const naturalH = step.screenshotHeight ?? image?.height ?? 720;
  const { stageW, stageH } = useMemo(() => {
    const maxW = Math.min(window.innerWidth - 220, 1040);
    const maxH = window.innerHeight - 170;
    const scale = Math.min(maxW / naturalW, maxH / naturalH);
    return { stageW: naturalW * scale, stageH: naturalH * scale };
  }, [naturalW, naturalH]);

  // ---- selection / transformer wiring ----
  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    if (selected) {
      const node = stage.findOne(`.shape-${selected.id}`);
      if (node && (node.className === "Rect" || node.className === "Ellipse")) {
        tr.nodes([node]);
        return;
      }
    }
    tr.nodes([]);
  }, [selected, annotations, redactions]);

  // ---- keyboard: delete selected, escape closes ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        if (selected.kind === "annotation") {
          setAnnotations((list) => list.filter((a) => a.id !== selected.id));
        } else {
          setRedactions((list) => list.filter((r) => r.id !== selected.id));
        }
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, onClose]);

  // ---- pointer → normalized coords ----
  const pointer = (): { x: number; y: number } | null => {
    const pos = stageRef.current?.getPointerPosition();
    if (!pos) return null;
    return {
      x: Math.min(1, Math.max(0, pos.x / stageW)),
      y: Math.min(1, Math.max(0, pos.y / stageH)),
    };
  };

  const isDrawTool = tool === "arrow" || tool === "rect" || tool === "ellipse" ||
    tool === "blur" || tool === "crop";

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool === "select") {
      if (e.target === e.target.getStage() || e.target.className === "Image") setSelected(null);
      return;
    }
    const p = pointer();
    if (!p) return;
    if (isDrawTool) setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };

  const onMouseMove = () => {
    if (!draft) return;
    const p = pointer();
    if (p) setDraft({ ...draft, x1: p.x, y1: p.y });
  };

  const onMouseUp = () => {
    const p = pointer();
    if (tool === "text" && p) {
      const text = window.prompt("Annotation text");
      if (text?.trim()) {
        setAnnotations((list) => [
          ...list,
          { id: newId(), kind: "text", nx: p.x, ny: p.y, nw: 0, nh: 0, text: text.trim(), color },
        ]);
      }
      return;
    }
    if (!draft) return;
    const bounds = {
      nx: Math.min(draft.x0, draft.x1),
      ny: Math.min(draft.y0, draft.y1),
      nw: Math.abs(draft.x1 - draft.x0),
      nh: Math.abs(draft.y1 - draft.y0),
    };
    setDraft(null);
    if (tool === "arrow") {
      if (Math.hypot(draft.x1 - draft.x0, draft.y1 - draft.y0) < 0.01) return;
      setAnnotations((list) => [
        ...list,
        { id: newId(), kind: "arrow", nx: draft.x0, ny: draft.y0, nw: 0, nh: 0,
          nx2: draft.x1, ny2: draft.y1, color },
      ]);
      return;
    }
    if (bounds.nw < 0.01 || bounds.nh < 0.01) return;
    if (tool === "rect" || tool === "ellipse") {
      setAnnotations((list) => [...list, { id: newId(), kind: tool, ...bounds, color }]);
    } else if (tool === "blur") {
      setRedactions((list) => [...list, { id: newId(), ...bounds }]);
    } else if (tool === "crop") {
      setCrop(bounds);
      setTool("select");
    }
  };

  // ---- shape update helpers (drag / transform write back normalized coords) ----
  const updateAnnotation = (id: string, changes: Partial<Annotation>) =>
    setAnnotations((list) => list.map((a) => (a.id === id ? { ...a, ...changes } : a)));
  const updateRedaction = (id: string, changes: Partial<RedactionRect>) =>
    setRedactions((list) => list.map((r) => (r.id === id ? { ...r, ...changes } : r)));

  const boundsFromNode = (node: Konva.Node) => {
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scale({ x: 1, y: 1 });
    return {
      nx: node.x() / stageW,
      ny: node.y() / stageH,
      nw: (node.width() * scaleX) / stageW,
      nh: (node.height() * scaleY) / stageH,
    };
  };

  const save = () => {
    patchStep.mutate(
      {
        stepId: step.id,
        body: {
          clearCallout: false,
          annotations,
          redactions,
          crop,
          ...(click ? { click } : {}),
        },
      },
      { onSuccess: onClose },
    );
  };

  const cursor = isDrawTool || tool === "text" ? "crosshair" : "default";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-full flex-col gap-3 rounded-xl bg-white p-4 shadow-2xl">
        {/* toolbar */}
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-zinc-200 p-1">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                title={t.hint}
                onClick={() => setTool(t.id)}
                disabled={t.id === "target" && !click}
                className={`h-8 w-8 rounded text-sm font-semibold disabled:opacity-30 ${
                  tool === t.id ? "bg-zinc-900 text-white" : "hover:bg-zinc-100"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`h-6 w-6 rounded-full border-2 ${
                  color === c ? "border-zinc-900" : "border-transparent"
                }`}
                style={{ background: c }}
                title={c}
              />
            ))}
          </div>
          {crop && (
            <button
              onClick={() => setCrop(null)}
              className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50"
            >
              Clear crop
            </button>
          )}
          <span className="ml-auto text-xs text-zinc-400">
            Del removes selection · drag to draw
          </span>
          <button onClick={onClose} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={patchStep.isPending}
            className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {patchStep.isPending ? "Saving…" : "Save"}
          </button>
        </div>

        <Stage
          ref={stageRef}
          width={stageW}
          height={stageH}
          style={{ cursor }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
        >
          <Layer>
            {image && <KonvaImage image={image} width={stageW} height={stageH} />}

            {/* redactions (under annotations) */}
            {redactions.map((r) => (
              <Rect
                key={r.id}
                name={`shape-${r.id}`}
                x={r.nx * stageW}
                y={r.ny * stageH}
                width={r.nw * stageW}
                height={r.nh * stageH}
                fill="rgba(110,110,118,0.88)"
                cornerRadius={3}
                draggable={tool === "select"}
                onClick={() => tool === "select" && setSelected({ kind: "redaction", id: r.id })}
                onDragEnd={(e) =>
                  updateRedaction(r.id, { nx: e.target.x() / stageW, ny: e.target.y() / stageH })
                }
                onTransformEnd={(e) => updateRedaction(r.id, boundsFromNode(e.target))}
              />
            ))}

            {/* annotations */}
            {annotations.map((a) => {
              const common = {
                name: `shape-${a.id}`,
                draggable: tool === "select",
                onClick: () => tool === "select" && setSelected({ kind: "annotation", id: a.id }),
              };
              if (a.kind === "arrow") {
                return (
                  <Line
                    key={a.id}
                    {...common}
                    points={[
                      a.nx * stageW, a.ny * stageH,
                      (a.nx2 ?? a.nx) * stageW, (a.ny2 ?? a.ny) * stageH,
                    ]}
                    stroke={a.color}
                    strokeWidth={3}
                    lineCap="round"
                    onDragEnd={(e) => {
                      const dx = e.target.x() / stageW;
                      const dy = e.target.y() / stageH;
                      e.target.position({ x: 0, y: 0 });
                      updateAnnotation(a.id, {
                        nx: a.nx + dx, ny: a.ny + dy,
                        nx2: (a.nx2 ?? a.nx) + dx, ny2: (a.ny2 ?? a.ny) + dy,
                      });
                    }}
                  />
                );
              }
              if (a.kind === "rect") {
                return (
                  <Rect
                    key={a.id}
                    {...common}
                    x={a.nx * stageW}
                    y={a.ny * stageH}
                    width={a.nw * stageW}
                    height={a.nh * stageH}
                    stroke={a.color}
                    strokeWidth={3}
                    cornerRadius={6}
                    onDragEnd={(e) =>
                      updateAnnotation(a.id, { nx: e.target.x() / stageW, ny: e.target.y() / stageH })
                    }
                    onTransformEnd={(e) => updateAnnotation(a.id, boundsFromNode(e.target))}
                  />
                );
              }
              if (a.kind === "ellipse") {
                return (
                  <Ellipse
                    key={a.id}
                    {...common}
                    x={(a.nx + a.nw / 2) * stageW}
                    y={(a.ny + a.nh / 2) * stageH}
                    radiusX={(a.nw / 2) * stageW}
                    radiusY={(a.nh / 2) * stageH}
                    stroke={a.color}
                    strokeWidth={3}
                    onDragEnd={(e) =>
                      updateAnnotation(a.id, {
                        nx: e.target.x() / stageW - a.nw / 2,
                        ny: e.target.y() / stageH - a.nh / 2,
                      })
                    }
                  />
                );
              }
              return (
                <KonvaText
                  key={a.id}
                  {...common}
                  x={a.nx * stageW}
                  y={a.ny * stageH}
                  text={a.text ?? ""}
                  fontSize={Math.max(14, stageW * 0.018)}
                  fontStyle="bold"
                  fill={a.color}
                  stroke="#ffffff"
                  strokeWidth={0.6}
                  onDblClick={() => {
                    const text = window.prompt("Annotation text", a.text ?? "");
                    if (text !== null) updateAnnotation(a.id, { text });
                  }}
                  onDragEnd={(e) =>
                    updateAnnotation(a.id, { nx: e.target.x() / stageW, ny: e.target.y() / stageH })
                  }
                />
              );
            })}

            {/* crop overlay: dim everything outside the crop window */}
            {crop && (
              <>
                {[
                  { x: 0, y: 0, w: 1, h: crop.ny },
                  { x: 0, y: crop.ny + crop.nh, w: 1, h: 1 - crop.ny - crop.nh },
                  { x: 0, y: crop.ny, w: crop.nx, h: crop.nh },
                  { x: crop.nx + crop.nw, y: crop.ny, w: 1 - crop.nx - crop.nw, h: crop.nh },
                ].map((r, i) => (
                  <Rect
                    key={i}
                    x={r.x * stageW}
                    y={r.y * stageH}
                    width={Math.max(0, r.w) * stageW}
                    height={Math.max(0, r.h) * stageH}
                    fill="rgba(0,0,0,0.5)"
                    listening={false}
                  />
                ))}
                <Rect
                  x={crop.nx * stageW}
                  y={crop.ny * stageH}
                  width={crop.nw * stageW}
                  height={crop.nh * stageH}
                  stroke="#ffffff"
                  strokeWidth={2}
                  dash={[8, 6]}
                  listening={false}
                />
              </>
            )}

            {/* click target */}
            {click?.bbox && (
              <Rect
                x={click.bbox.nx * stageW}
                y={click.bbox.ny * stageH}
                width={click.bbox.nw * stageW}
                height={click.bbox.nh * stageH}
                stroke={COLORS[0]}
                strokeWidth={2}
                cornerRadius={4}
                listening={false}
              />
            )}
            {click && (
              <Circle
                x={click.nx * stageW}
                y={click.ny * stageH}
                radius={13}
                fill="rgba(255,92,53,0.3)"
                stroke={COLORS[0]}
                strokeWidth={3}
                draggable={tool === "target"}
                onDragEnd={(e) =>
                  setClick({ ...click, nx: e.target.x() / stageW, ny: e.target.y() / stageH })
                }
              />
            )}

            {/* in-progress drawing preview */}
            {draft && (tool === "rect" || tool === "ellipse" || tool === "blur" || tool === "crop") && (
              <Rect
                x={Math.min(draft.x0, draft.x1) * stageW}
                y={Math.min(draft.y0, draft.y1) * stageH}
                width={Math.abs(draft.x1 - draft.x0) * stageW}
                height={Math.abs(draft.y1 - draft.y0) * stageH}
                stroke={tool === "blur" ? "#555" : tool === "crop" ? "#fff" : color}
                fill={tool === "blur" ? "rgba(110,110,118,0.5)" : undefined}
                dash={[6, 4]}
                strokeWidth={2}
                listening={false}
              />
            )}
            {draft && tool === "arrow" && (
              <Line
                points={[draft.x0 * stageW, draft.y0 * stageH, draft.x1 * stageW, draft.y1 * stageH]}
                stroke={color}
                strokeWidth={3}
                dash={[6, 4]}
                listening={false}
              />
            )}

            <Transformer ref={trRef} rotateEnabled={false} flipEnabled={false} />
          </Layer>
        </Stage>
      </div>
    </div>
  );
}

import type { StepOut } from "@sops/shared";
import { screenshotUrl } from "../api/client";

// Everything renders as live overlays from normalized 0–1 coordinates of the
// ORIGINAL image; crop is applied as a CSS window so originals stay pristine.
// Redactions are the one exception: they're baked server-side into a derived
// image (never ship unblurred pixels), which is what gets displayed here.

const MARKER = "var(--marker-color, #FF5C35)";

export default function StepScreenshot({ step }: { step: StepOut }) {
  const shotId = step.redactedScreenshotId ?? step.screenshotId;
  if (!shotId) return null;

  const crop = step.crop ?? null;
  const width = step.screenshotWidth ?? 1280;
  const height = step.screenshotHeight ?? 720;
  const effWidth = crop ? crop.nw * width : width;
  const effHeight = crop ? crop.nh * height : height;

  // Map original-image fractions into cropped-window fractions.
  const tx = (nx: number) => (crop ? (nx - crop.nx) / crop.nw : nx);
  const ty = (ny: number) => (crop ? (ny - crop.ny) / crop.nh : ny);
  const sx = (nw: number) => (crop ? nw / crop.nw : nw);
  const sy = (nh: number) => (crop ? nh / crop.nh : nh);
  const visible = (nx: number, ny: number) =>
    tx(nx) >= -0.02 && tx(nx) <= 1.02 && ty(ny) >= -0.02 && ty(ny) <= 1.02;

  const click = step.click;
  const bbox = click?.bbox;

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100"
      style={{ aspectRatio: `${effWidth} / ${effHeight}` }}
    >
      <img
        src={screenshotUrl(shotId)}
        alt=""
        draggable={false}
        className="absolute"
        style={
          crop
            ? {
                width: `${100 / crop.nw}%`,
                maxWidth: "none",
                left: `${(-crop.nx / crop.nw) * 100}%`,
                top: `${(-crop.ny / crop.nh) * 100}%`,
              }
            : { width: "100%", left: 0, top: 0 }
        }
      />

      {/* rect / ellipse / arrow annotations */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
      >
        {step.annotations.map((a) => {
          const stroke = a.color || "#FF5C35";
          if (a.kind === "arrow") {
            const x1 = tx(a.nx) * 1000;
            const y1 = ty(a.ny) * 1000;
            const x2 = tx(a.nx2 ?? a.nx) * 1000;
            const y2 = ty(a.ny2 ?? a.ny) * 1000;
            const angle = Math.atan2(y2 - y1, x2 - x1);
            const head = 26;
            return (
              <g key={a.id} stroke={stroke} strokeWidth={4} vectorEffect="non-scaling-stroke">
                <line x1={x1} y1={y1} x2={x2} y2={y2} vectorEffect="non-scaling-stroke" />
                {([Math.PI / 7, -Math.PI / 7] as const).map((offset, i) => (
                  <line
                    key={i}
                    x1={x2}
                    y1={y2}
                    x2={x2 - head * Math.cos(angle + offset)}
                    y2={y2 - head * Math.sin(angle + offset)}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </g>
            );
          }
          if (a.kind === "rect") {
            return (
              <rect
                key={a.id}
                x={tx(a.nx) * 1000}
                y={ty(a.ny) * 1000}
                width={sx(a.nw) * 1000}
                height={sy(a.nh) * 1000}
                rx={8}
                fill="none"
                stroke={stroke}
                strokeWidth={4}
                vectorEffect="non-scaling-stroke"
              />
            );
          }
          if (a.kind === "ellipse") {
            return (
              <ellipse
                key={a.id}
                cx={(tx(a.nx) + sx(a.nw) / 2) * 1000}
                cy={(ty(a.ny) + sy(a.nh) / 2) * 1000}
                rx={(sx(a.nw) / 2) * 1000}
                ry={(sy(a.nh) / 2) * 1000}
                fill="none"
                stroke={stroke}
                strokeWidth={4}
                vectorEffect="non-scaling-stroke"
              />
            );
          }
          return null;
        })}
      </svg>

      {/* text annotations as HTML so they aren't distorted by the SVG scaling */}
      {step.annotations
        .filter((a) => a.kind === "text" && a.text)
        .map((a) => (
          <span
            key={a.id}
            className="absolute text-sm font-semibold"
            style={{
              left: `${tx(a.nx) * 100}%`,
              top: `${ty(a.ny) * 100}%`,
              color: a.color || "#FF5C35",
              textShadow: "0 0 3px #fff, 0 0 3px #fff, 0 0 3px #fff",
            }}
          >
            {a.text}
          </span>
        ))}

      {bbox && visible(bbox.nx + bbox.nw / 2, bbox.ny + bbox.nh / 2) && (
        <div
          className="pointer-events-none absolute rounded border-2"
          style={{
            left: `${tx(bbox.nx) * 100}%`,
            top: `${ty(bbox.ny) * 100}%`,
            width: `${sx(bbox.nw) * 100}%`,
            height: `${sy(bbox.nh) * 100}%`,
            borderColor: MARKER,
          }}
        />
      )}
      {click && visible(click.nx, click.ny) && (
        <div
          className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px]"
          style={{
            left: `${tx(click.nx) * 100}%`,
            top: `${ty(click.ny) * 100}%`,
            borderColor: MARKER,
            background: "color-mix(in srgb, var(--marker-color, #FF5C35) 25%, transparent)",
          }}
        />
      )}
    </div>
  );
}

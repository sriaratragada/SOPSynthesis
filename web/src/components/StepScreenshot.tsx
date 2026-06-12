import type { ClickPoint } from "@sops/shared";
import { screenshotUrl } from "../api/client";

// Markers are live overlays positioned with the normalized 0–1 coordinates
// captured by the extension — resolution- and DPR-independent by construction.
// Screenshots on disk stay pristine; burn-in happens only in exports.
export default function StepScreenshot({
  screenshotId,
  click,
}: {
  screenshotId: string;
  click: ClickPoint | null | undefined;
}) {
  const bbox = click?.bbox;
  return (
    <div className="relative overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
      <img src={screenshotUrl(screenshotId)} alt="" className="block w-full" draggable={false} />
      {bbox && (
        <div
          className="pointer-events-none absolute rounded border-2 border-brand"
          style={{
            left: `${bbox.nx * 100}%`,
            top: `${bbox.ny * 100}%`,
            width: `${bbox.nw * 100}%`,
            height: `${bbox.nh * 100}%`,
          }}
        />
      )}
      {click && (
        <div
          className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-brand bg-brand/25"
          style={{ left: `${click.nx * 100}%`, top: `${click.ny * 100}%` }}
        />
      )}
    </div>
  );
}

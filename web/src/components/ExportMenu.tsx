import { markdownExportUrl } from "../api/client";

export default function ExportMenu({ guideId }: { guideId: string }) {
  return (
    <a
      href={markdownExportUrl(guideId)}
      download
      className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:border-zinc-400"
    >
      ↓ Export Markdown
    </a>
  );
}

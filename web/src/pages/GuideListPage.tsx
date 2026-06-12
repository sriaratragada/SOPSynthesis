import { Link } from "react-router-dom";
import { useDeleteGuide, useGuides } from "../hooks/useGuide";

export default function GuideListPage() {
  const { data: guides, isLoading, error } = useGuides();
  const deleteGuide = useDeleteGuide();

  if (isLoading) return <p className="text-zinc-500">Loading guides…</p>;
  if (error)
    return (
      <p className="text-red-600">
        Could not reach the backend at 127.0.0.1:8787 — is it running?
      </p>
    );

  if (!guides || guides.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center">
        <h2 className="text-lg font-semibold">No guides yet</h2>
        <p className="mt-2 text-zinc-500">
          Click the SOPSynthesis extension in Chrome, press <b>Start recording</b>, and walk
          through a workflow. Your first guide will appear here.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Guides</h1>
      <ul className="grid gap-4 sm:grid-cols-2">
        {guides.map((guide) => (
          <li
            key={guide.id}
            className="group rounded-xl border border-zinc-200 bg-white p-4 shadow-sm hover:border-zinc-300"
          >
            <Link to={`/guides/${guide.id}`} className="block">
              <h2 className="font-semibold group-hover:text-brand">{guide.title}</h2>
              <p className="mt-1 line-clamp-2 text-sm text-zinc-500">{guide.description}</p>
            </Link>
            <div className="mt-3 flex items-center justify-between text-xs text-zinc-400">
              <span>
                {guide.stepCount} step{guide.stepCount === 1 ? "" : "s"} ·{" "}
                {new Date(guide.createdAt).toLocaleDateString()}
              </span>
              <button
                onClick={() => {
                  if (confirm(`Delete "${guide.title}"? This cannot be undone.`)) {
                    deleteGuide.mutate(guide.id);
                  }
                }}
                className="rounded px-2 py-1 opacity-0 transition group-hover:opacity-100 hover:bg-red-50 hover:text-red-600"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

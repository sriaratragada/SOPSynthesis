import type { GuideOut } from "@sops/shared";
import { useEffect, useState } from "react";
import { usePatchGuide } from "../hooks/useGuide";

export default function GuideHeader({ guide }: { guide: GuideOut }) {
  const patchGuide = usePatchGuide(guide.id);
  const [title, setTitle] = useState(guide.title);
  const [description, setDescription] = useState(guide.description);
  useEffect(() => setTitle(guide.title), [guide.title]);
  useEffect(() => setDescription(guide.description), [guide.description]);

  return (
    <div className="mb-6">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          const trimmed = title.trim();
          if (trimmed && trimmed !== guide.title) patchGuide.mutate({ title: trimmed });
          else setTitle(guide.title);
        }}
        className="w-full rounded-md border border-transparent px-2 py-1 text-2xl font-bold hover:border-zinc-200 focus:border-brand focus:outline-none"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() => {
          if (description !== guide.description)
            patchGuide.mutate({ description: description.trim() });
        }}
        rows={2}
        placeholder="Add a description…"
        className="mt-1 w-full resize-none rounded-md border border-transparent px-2 py-1 text-zinc-600 hover:border-zinc-200 focus:border-brand focus:outline-none"
      />
    </div>
  );
}

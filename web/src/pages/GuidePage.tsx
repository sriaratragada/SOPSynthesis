import { Link, useParams } from "react-router-dom";
import ExportMenu from "../components/ExportMenu";
import GuideHeader from "../components/GuideHeader";
import StepList from "../components/StepList";
import { useGuide } from "../hooks/useGuide";

export default function GuidePage() {
  const { guideId } = useParams<{ guideId: string }>();
  const { data: guide, isLoading, error } = useGuide(guideId!);

  if (isLoading) return <p className="text-zinc-500">Loading guide…</p>;
  if (error || !guide)
    return (
      <div>
        <p className="text-red-600">Guide not found.</p>
        <Link to="/" className="text-brand underline">
          Back to all guides
        </Link>
      </div>
    );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <Link to="/" className="text-sm text-zinc-500 hover:text-zinc-800">
          ← All guides
        </Link>
        <ExportMenu guideId={guide.id} />
      </div>
      <GuideHeader guide={guide} />
      <StepList guide={guide} />
    </div>
  );
}

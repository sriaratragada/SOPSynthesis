import { Link, Route, Routes } from "react-router-dom";
import GuideListPage from "./pages/GuideListPage";
import GuidePage from "./pages/GuidePage";

export default function App() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-6 py-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand">
              <span className="h-2.5 w-2.5 rounded-full border-2 border-white" />
            </span>
            SOPSynthesis
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8">
        <Routes>
          <Route path="/" element={<GuideListPage />} />
          <Route path="/guides/:guideId" element={<GuidePage />} />
        </Routes>
      </main>
    </div>
  );
}

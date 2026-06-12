import { useEffect } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { logoUrl, useSettings } from "./hooks/useSettings";
import GuideListPage from "./pages/GuideListPage";
import GuidePage from "./pages/GuidePage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  const { data: settings } = useSettings();

  // Branding marker color is a CSS variable so markers, badges, and step
  // numbers all follow it without prop-drilling.
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--marker-color",
      settings?.markerColor ?? "#FF5C35",
    );
  }, [settings?.markerColor]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-6 py-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            {settings?.hasLogo ? (
              <img src={logoUrl()} alt="" className="h-7 max-w-28 object-contain" />
            ) : (
              <span
                className="flex h-7 w-7 items-center justify-center rounded-lg"
                style={{ background: "var(--marker-color, #FF5C35)" }}
              >
                <span className="h-2.5 w-2.5 rounded-full border-2 border-white" />
              </span>
            )}
            SOPSynthesis
          </Link>
          <Link to="/settings" className="ml-auto text-sm text-zinc-500 hover:text-zinc-800">
            Settings
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8">
        <Routes>
          <Route path="/" element={<GuideListPage />} />
          <Route path="/guides/:guideId" element={<GuidePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}

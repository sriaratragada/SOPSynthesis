import { useRef } from "react";
import { logoUrl, useDeleteLogo, usePatchSettings, useSettings, useUploadLogo } from "../hooks/useSettings";

export default function SettingsPage() {
  const { data: settings, isLoading } = useSettings();
  const patchSettings = usePatchSettings();
  const uploadLogo = useUploadLogo();
  const deleteLogo = useDeleteLogo();
  const fileInput = useRef<HTMLInputElement>(null);

  if (isLoading || !settings) return <p className="text-zinc-500">Loading settings…</p>;

  return (
    <div className="max-w-xl">
      <h1 className="mb-6 text-2xl font-bold">Settings</h1>

      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <h2 className="font-semibold">Branding</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Applied to click markers, step numbers, and exported images.
        </p>

        <div className="mt-4 flex items-center gap-3">
          <label htmlFor="marker-color" className="w-32 text-sm font-medium">
            Marker color
          </label>
          <input
            id="marker-color"
            type="color"
            value={settings.markerColor}
            onChange={(e) => patchSettings.mutate({ markerColor: e.target.value })}
            className="h-9 w-14 cursor-pointer rounded border border-zinc-300"
          />
          <code className="text-sm text-zinc-500">{settings.markerColor}</code>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <span className="w-32 text-sm font-medium">Logo</span>
          {settings.hasLogo ? (
            <>
              <img
                src={`${logoUrl()}?v=${Date.now()}`}
                alt="Workspace logo"
                className="h-9 max-w-32 rounded border border-zinc-200 object-contain"
              />
              <button
                onClick={() => deleteLogo.mutate()}
                className="rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-red-50 hover:text-red-600"
              >
                Remove
              </button>
            </>
          ) : (
            <button
              onClick={() => fileInput.current?.click()}
              disabled={uploadLogo.isPending}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:border-zinc-400 disabled:opacity-50"
            >
              {uploadLogo.isPending ? "Uploading…" : "Upload logo"}
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadLogo.mutate(file);
              e.target.value = "";
            }}
          />
        </div>
      </section>
    </div>
  );
}

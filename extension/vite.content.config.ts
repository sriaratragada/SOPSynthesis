import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false, // first pass already copied public/
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "chrome120",
    lib: {
      entry: resolve(__dirname, "src/content/index.ts"),
      formats: ["iife"],
      name: "SOPSContent",
      fileName: () => "content.js",
    },
  },
});

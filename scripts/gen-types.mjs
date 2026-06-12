// Regenerates packages/shared/src/api-types.gen.ts from the FastAPI OpenAPI schema.
// Pydantic models in backend/app/schemas.py are the source of truth; never edit
// the generated file by hand.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backend = path.join(root, "backend");
const venvPython =
  process.platform === "win32"
    ? path.join(backend, ".venv", "Scripts", "python.exe")
    : path.join(backend, ".venv", "bin", "python");

if (!existsSync(venvPython)) {
  console.error(`Backend venv not found at ${venvPython} — run the one-time setup in README.md`);
  process.exit(1);
}

const openapiJson = path.join(root, "openapi.json");
const outFile = path.join(root, "packages", "shared", "src", "api-types.gen.ts");

execFileSync(venvPython, ["-m", "app.scripts.dump_openapi", openapiJson], {
  cwd: backend,
  stdio: "inherit",
});
execFileSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["openapi-typescript", openapiJson, "-o", outFile],
  { cwd: root, stdio: "inherit", shell: process.platform === "win32" },
);
console.log(`Generated ${path.relative(root, outFile)}`);

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packageRoot = join(repoRoot, "packages", "tex-fuzz");
const sourceRoot = join(packageRoot, "src");
const distEntry = join(packageRoot, "dist", "index.js");

/** @param {string} path */
function newestMtime(path) {
  let newest = statSync(path).mtimeMs;
  if (!statSync(path).isDirectory()) return newest;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    newest = Math.max(newest, newestMtime(join(path, entry.name)));
  }
  return newest;
}

export function ensureTexFuzzBuildFresh() {
  const stale = !existsSync(distEntry) || newestMtime(sourceRoot) > statSync(distEntry).mtimeMs;
  if (stale) {
    execFileSync("npm", ["run", "-w", "@tikz-editor/tex-fuzz", "build"], {
      cwd: repoRoot,
      stdio: "inherit",
    });
  }
  return distEntry;
}

/** @returns {Promise<typeof import("../../packages/tex-fuzz/dist/index.js")>} */
export async function loadTexFuzzModules() {
  const module = /** @type {unknown} */ (await import(pathToFileURL(ensureTexFuzzBuildFresh()).href));
  return /** @type {typeof import("../../packages/tex-fuzz/dist/index.js")} */ (module);
}

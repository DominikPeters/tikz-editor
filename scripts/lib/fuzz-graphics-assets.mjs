import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../test/fixtures/graphics-fuzz/", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "assets.json"), "utf8"));
export const FUZZ_GRAPHICS_ASSET_SHA256 = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");

/** Materialize byte-identical, hashed assets beside each standalone TeX reproduction. */
export function stageFuzzGraphicsAssets(directory) {
  for (const [path, hash] of Object.entries(manifest.files)) {
    if (!path.startsWith("fuzz-images/") || path.includes("..")) throw new Error("Invalid controlled image path");
    const input = join(root, path);
    if (createHash("sha256").update(readFileSync(input)).digest("hex") !== hash) throw new Error(`Image fixture changed: ${path}`);
    const output = join(directory, path);
    mkdirSync(dirname(output), { recursive: true });
    copyFileSync(input, output);
  }
  return { sha256: FUZZ_GRAPHICS_ASSET_SHA256, files: manifest.files };
}

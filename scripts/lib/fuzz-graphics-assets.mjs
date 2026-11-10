import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../test/fixtures/graphics-fuzz/", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "assets.json"), "utf8"));
// Cache keys must change when an image changes; no checked-in checksum list is needed.
const revision = createHash("sha256").update(JSON.stringify(manifest));
for (const path of manifest.files) revision.update(readFileSync(join(root, path)));
export const FUZZ_GRAPHICS_ASSET_SHA256 = revision.digest("hex");

/** Copy the shared image fixtures beside a standalone TeX reproduction. */
export function stageFuzzGraphicsAssets(directory) {
  for (const path of manifest.files) {
    if (!path.startsWith("fuzz-images/") || path.includes("..")) throw new Error("Invalid controlled image path");
    const input = join(root, path);
    const output = join(directory, path);
    mkdirSync(dirname(output), { recursive: true });
    copyFileSync(input, output);
  }
  return { sha256: FUZZ_GRAPHICS_ASSET_SHA256, files: manifest.files };
}

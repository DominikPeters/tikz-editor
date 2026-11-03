#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

// Match the signed bundles produced by the desktop release workflow. Keep the
// primary platform aliases and Tauri's installer-specific aliases together.
const bundles = [
  ["_aarch64.app.tar.gz", ["darwin-aarch64", "darwin-aarch64-app"]],
  ["_x64.app.tar.gz", ["darwin-x86_64", "darwin-x86_64-app"]],
  ["_amd64.AppImage", ["linux-x86_64", "linux-x86_64-appimage"]],
  ["_amd64.deb", ["linux-x86_64-deb"]],
  [".x86_64.rpm", ["linux-x86_64-rpm"]],
  ["_x64_en-US.msi", ["windows-x86_64", "windows-x86_64-msi"]],
  ["_x64-setup.exe", ["windows-x86_64-nsis"]],
];

async function main() {
  const [releasePath, signatureDirectory, outputPath] = process.argv.slice(2);
  if (!releasePath || !signatureDirectory || !outputPath) {
    throw new Error("Usage: node scripts/build-desktop-updater-manifest.mjs <release.json> <signature-directory> <output.json>");
  }
  const release = JSON.parse(await readFile(releasePath, "utf8"));
  const version = /^app-v(.+)$/.exec(release.tag_name)?.[1];
  if (!version) throw new Error(`Unexpected desktop release tag: ${release.tag_name}`);
  const platforms = {};
  for (const [suffix, keys] of bundles) {
    const matching = release.assets.filter(asset => asset.name.endsWith(suffix));
    if (matching.length !== 1) {
      throw new Error(`Expected one ${suffix} asset; found ${matching.length}.`);
    }
    const asset = matching[0];
    const signatureName = `${asset.name}.sig`;
    if (!release.assets.some(candidate => candidate.name === signatureName)) {
      throw new Error(`Missing updater signature asset: ${signatureName}`);
    }
    const signature = (await readFile(path.join(signatureDirectory, signatureName), "utf8")).trim();
    if (!signature) throw new Error(`Empty updater signature: ${signatureName}`);
    // Draft asset URLs contain an untagged placeholder that stops working when
    // the release is published. Every updater entry must use the final tag.
    const url = asset.browser_download_url.replace(/\/download\/[^/]+\//, `/download/${encodeURIComponent(release.tag_name)}/`);
    for (const key of keys) platforms[key] = { signature, url };
  }
  const manifest = {
    version,
    notes: release.body ?? "",
    pub_date: release.published_at ?? new Date().toISOString(),
    platforms,
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(manifest, null, 2) + "\n");
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

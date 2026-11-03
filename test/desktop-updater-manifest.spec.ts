import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const bundleNames = [
  "TikZ.Editor_aarch64.app.tar.gz",
  "TikZ.Editor_x64.app.tar.gz",
  "TikZ.Editor_1.2.3_amd64.AppImage",
  "TikZ.Editor_1.2.3_amd64.deb",
  "TikZ.Editor-1.2.3-1.x86_64.rpm",
  "TikZ.Editor_1.2.3_x64_en-US.msi",
  "TikZ.Editor_1.2.3_x64-setup.exe",
];

function fixtureRelease() {
  return {
    tag_name: "app-v1.2.3",
    body: "Release notes",
    published_at: null,
    assets: bundleNames.flatMap(name => [name, `${name}.sig`]).map(name => ({
      name,
      browser_download_url: `https://github.com/example/editor/releases/download/untagged-draft/${name}`,
    })),
  };
}

describe("desktop updater manifest", () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(path.join(os.tmpdir(), "tikz-updater-manifest-"));
    for (const name of bundleNames) writeFileSync(path.join(directory, `${name}.sig`), `signature:${name}\n`);
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  function build(release = fixtureRelease()) {
    const releasePath = path.join(directory, "release.json");
    const outputPath = path.join(directory, "latest.json");
    writeFileSync(releasePath, JSON.stringify(release));
    return spawnSync(process.execPath, ["scripts/build-desktop-updater-manifest.mjs", releasePath, directory, outputPath], { encoding: "utf8" });
  }

  it("combines every platform and installer using final release URLs and signed asset contents", () => {
    const result = build();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const manifest = JSON.parse(readFileSync(path.join(directory, "latest.json"), "utf8"));
    expect(manifest.version).toBe("1.2.3");
    expect(manifest.notes).toBe("Release notes");
    expect(Number.isNaN(Date.parse(manifest.pub_date))).toBe(false);
    const expectedBundles: Record<string, string> = {
      "darwin-aarch64": bundleNames[0],
      "darwin-aarch64-app": bundleNames[0],
      "darwin-x86_64": bundleNames[1],
      "darwin-x86_64-app": bundleNames[1],
      "linux-x86_64": bundleNames[2],
      "linux-x86_64-appimage": bundleNames[2],
      "linux-x86_64-deb": bundleNames[3],
      "linux-x86_64-rpm": bundleNames[4],
      "windows-x86_64": bundleNames[5],
      "windows-x86_64-msi": bundleNames[5],
      "windows-x86_64-nsis": bundleNames[6],
    };
    expect(manifest.platforms).toEqual(Object.fromEntries(Object.entries(expectedBundles).map(([key, name]) => [key, {
      signature: `signature:${name}`,
      url: `https://github.com/example/editor/releases/download/app-v1.2.3/${name}`,
    }])));
  });

  it("refuses a partial release with a missing platform bundle", () => {
    const release = fixtureRelease();
    release.assets = release.assets.filter(asset => asset.name !== bundleNames[1]);
    const result = build(release);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Expected one _x64.app.tar.gz asset; found 0");
  });

  it("refuses ambiguous bundles", () => {
    const release = fixtureRelease();
    release.assets.push({ name: "Other_aarch64.app.tar.gz", browser_download_url: "https://example.com/other" });
    const result = build(release);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Expected one _aarch64.app.tar.gz asset; found 2");
  });

  it("requires each signature to be attached to the release", () => {
    const release = fixtureRelease();
    release.assets = release.assets.filter(asset => asset.name !== `${bundleNames[0]}.sig`);
    const result = build(release);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Missing updater signature asset");
  });

  it("refuses empty signatures", () => {
    writeFileSync(path.join(directory, `${bundleNames[0]}.sig`), "\n");
    const result = build();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Empty updater signature");
  });
});

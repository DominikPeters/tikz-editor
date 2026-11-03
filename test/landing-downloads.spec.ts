import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../apps/landing/src/App";
import type { ReleaseDownloadMetadata } from "../apps/landing/src/release-downloads";

const release = vi.hoisted((): ReleaseDownloadMetadata => ({
  version: "1.0.0",
  tagName: "app-v1.0.0",
  name: "TikZ Editor v1.0.0",
  publishedAt: "2026-10-23T10:00:00Z",
  url: "https://example.com/releases/v1.0.0",
  downloads: [
    { platform: "mac", arch: "arm64", format: "dmg", name: "mac.dmg", url: "https://example.com/mac.dmg", sizeBytes: 1024 },
    { platform: "linux", arch: "x64", format: "appimage", name: "linux.AppImage", url: "https://example.com/linux.AppImage", sizeBytes: 2048 },
  ],
}));

vi.mock("../apps/landing/src/generated/release-downloads", () => ({ releaseDownloadMetadata: release }));

afterEach(() => vi.unstubAllGlobals());

function renderFor(platform: string) {
  vi.stubGlobal("navigator", { platform, userAgent: platform });
  return renderToString(createElement(App));
}

describe("landing downloads for a partial release", () => {
  it("sends Windows visitors to the release page when no Windows installer exists", () => {
    const html = renderFor("Win32");
    expect(html).toContain(`href="${release.url}" class="landingDownloadLink"`);
    expect(html).toContain("View desktop downloads");
    expect(html).not.toContain("Download for Windows");
    expect(html).not.toContain("Windows Portable");
    expect(html).not.toContain("0.0 MB");
  });

  it("keeps the available Apple Silicon download", () => {
    const html = renderFor("MacIntel");
    expect(html).toContain('href="https://example.com/mac.dmg" class="landingDownloadLink"');
    expect(html).toContain("Download for Mac (Apple Silicon)");
  });

  it("keeps the available Linux download", () => {
    const html = renderFor("Linux x86_64");
    expect(html).toContain('href="https://example.com/linux.AppImage" class="landingDownloadLink"');
    expect(html).toContain("Download AppImage for Linux");
  });

  it("still renders when a release contains no recognized desktop bundles", () => {
    const downloads = release.downloads;
    release.downloads = [];
    try {
      const html = renderFor("Win32");
      expect(html).toContain(`href="${release.url}" class="landingDownloadLink"`);
      expect(html).toContain("View desktop downloads");
    } finally {
      release.downloads = downloads;
    }
  });
});

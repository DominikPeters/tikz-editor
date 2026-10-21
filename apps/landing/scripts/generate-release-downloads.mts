import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ReleaseAsset = {
  name: string;
  size: number;
  url: string;
};

type GhRelease = {
  assets: ReleaseAsset[];
  name: string;
  publishedAt: string;
  tagName: string;
  url: string;
};

type DownloadFormat = "dmg" | "exe" | "msi" | "zip" | "appimage" | "deb" | "rpm";
type DownloadPlatform = "mac" | "windows" | "linux";
type DownloadArch = "arm64" | "x64";

type ReleaseDownload = {
  platform: DownloadPlatform;
  arch?: DownloadArch;
  format: DownloadFormat;
  name: string;
  url: string;
  sizeBytes: number;
};

type ReleaseDownloadMetadata = {
  version: string;
  tagName: string;
  name: string;
  publishedAt: string;
  url: string;
  downloads: ReleaseDownload[];
};

const REPO = "DominikPeters/tikz-editor";

const FALLBACK_RELEASE: GhRelease = {
  tagName: "app-v0.1.0",
  name: "TikZ Editor v0.1.0",
  publishedAt: "2026-05-26T17:55:08Z",
  url: "https://github.com/DominikPeters/tikz-editor/releases/tag/app-v0.1.0",
  assets: [
    asset("TikZ.Editor_0.1.0_aarch64.dmg", 11519438),
    asset("TikZ.Editor_0.1.0_x64.dmg", 11928750),
    asset("TikZ.Editor_0.1.0_x64-setup.exe", 8924888),
    asset("TikZ.Editor_0.1.0_x64_en-US.msi", 10842112),
    asset("TikZ.Editor_0.1.0_amd64.AppImage", 90175992),
    asset("TikZ.Editor_0.1.0_amd64.deb", 13257672),
    asset("TikZ.Editor-0.1.0-1.x86_64.rpm", 13257584)
  ]
};

function asset(name: string, size: number): ReleaseAsset {
  return {
    name,
    size,
    url: `https://github.com/${REPO}/releases/download/app-v0.1.0/${name}`
  };
}

function main() {
  const release = fetchLatestRelease() ?? FALLBACK_RELEASE;
  const metadata = toMetadata(release);
  const outputPath = path.resolve(fileURLToPath(new URL("../src/generated/release-downloads.ts", import.meta.url)));

  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, renderModule(metadata));
  console.log(`[landing-release-downloads] wrote ${outputPath} from ${release.tagName}`);
}

function fetchLatestRelease(): GhRelease | null {
  try {
    const raw = execFileSync("gh", [
      "release",
      "view",
      "--repo",
      REPO,
      "--json",
      "tagName,name,publishedAt,url,assets"
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return JSON.parse(raw) as GhRelease;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[landing-release-downloads] gh release lookup failed, using fallback metadata: ${message}`);
    return null;
  }
}

function toMetadata(release: GhRelease): ReleaseDownloadMetadata {
  return {
    version: versionFromTag(release.tagName),
    tagName: release.tagName,
    name: release.name,
    publishedAt: release.publishedAt,
    url: release.url,
    downloads: release.assets
      .map(classifyAsset)
      .filter((download): download is ReleaseDownload => download !== null)
      .sort(compareDownloads)
  };
}

function versionFromTag(tagName: string): string {
  return tagName.replace(/^app-v/i, "").replace(/^v/i, "");
}

function classifyAsset(asset: ReleaseAsset): ReleaseDownload | null {
  const name = asset.name;

  if (/\.sig$/i.test(name) || /^latest\.json$/i.test(name) || /\.app\.tar\.gz$/i.test(name)) {
    return null;
  }

  if (/_aarch64\.dmg$/i.test(name)) {
    return download(asset, "mac", "dmg", "arm64");
  }
  if (/_x64\.dmg$/i.test(name)) {
    return download(asset, "mac", "dmg", "x64");
  }
  if (/_x64-setup\.exe$/i.test(name)) {
    return download(asset, "windows", "exe", "x64");
  }
  if (/_x64(?:_[a-z]{2}-[A-Z]{2})?\.msi$/i.test(name)) {
    return download(asset, "windows", "msi", "x64");
  }
  if (/_x64-portable\.zip$/i.test(name)) {
    return download(asset, "windows", "zip", "x64");
  }
  if (/_amd64\.AppImage$/i.test(name)) {
    return download(asset, "linux", "appimage", "x64");
  }
  if (/_amd64\.deb$/i.test(name)) {
    return download(asset, "linux", "deb", "x64");
  }
  if (/[._-]x86_64\.rpm$/i.test(name)) {
    return download(asset, "linux", "rpm", "x64");
  }

  return null;
}

function download(
  asset: ReleaseAsset,
  platform: DownloadPlatform,
  format: DownloadFormat,
  arch?: DownloadArch
): ReleaseDownload {
  return {
    platform,
    arch,
    format,
    name: asset.name,
    url: asset.url,
    sizeBytes: asset.size
  };
}

function compareDownloads(left: ReleaseDownload, right: ReleaseDownload): number {
  const platformOrder: Record<DownloadPlatform, number> = { mac: 0, windows: 1, linux: 2 };
  const formatOrder: Record<DownloadFormat, number> = { dmg: 0, exe: 1, msi: 2, zip: 3, appimage: 4, deb: 5, rpm: 6 };
  const platformDelta = platformOrder[left.platform] - platformOrder[right.platform];
  if (platformDelta !== 0) {
    return platformDelta;
  }
  const formatDelta = formatOrder[left.format] - formatOrder[right.format];
  if (formatDelta !== 0) {
    return formatDelta;
  }
  return (left.arch ?? "").localeCompare(right.arch ?? "");
}

function renderModule(metadata: ReleaseDownloadMetadata): string {
  return `/* auto-generated by apps/landing/scripts/generate-release-downloads.mts */\n\nexport const releaseDownloadMetadata = ${JSON.stringify(metadata, null, 2)} as const;\n`;
}

main();

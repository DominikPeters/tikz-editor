export type DownloadFormat = "dmg" | "exe" | "msi" | "zip" | "appimage" | "deb" | "rpm";
export type DownloadPlatform = "mac" | "windows" | "linux";
export type DownloadArch = "arm64" | "x64";

export type ReleaseDownload = {
  platform: DownloadPlatform;
  arch?: DownloadArch;
  format: DownloadFormat;
  name: string;
  url: string;
  sizeBytes: number;
};

export type ReleaseDownloadMetadata = {
  version: string;
  tagName: string;
  name: string;
  publishedAt: string;
  url: string;
  downloads: ReleaseDownload[];
};

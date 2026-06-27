import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

import { invalidateImageAssetPath, prepareImageAssetResolver } from "../packages/app/src/image-asset-cache.js";
import { setActiveEditorPlatform } from "../packages/app/src/platform/current.js";
import type { EditorPlatform } from "../packages/app/src/platform/types.js";
import type { DocumentFileRef } from "../packages/app/src/store/types.js";

function setTestPlatform(platform: Partial<EditorPlatform>): void {
  setActiveEditorPlatform({
    id: "test-platform",
    persistence: {
      load: () => null,
      save: () => {},
    },
    ...platform,
  });
}

describe("image asset cache", () => {
  it("returns placeholders when the active platform has no local asset reader", async () => {
    setTestPlatform({});

    const resolver = await prepareImageAssetResolver({
      source: String.raw`\node {\includegraphics{fig}};`,
      documentFileRef: null,
    });
    const resolution = resolver.resolve({
      filename: "fig",
      options: {},
      source: String.raw`\includegraphics{fig}`,
      sourceStart: 0,
      sourceEnd: 21,
    });

    expect(resolution.status).toBe("missing");
  });

  it("resolves extensionless desktop assets by the first supported existing candidate", async () => {
    const documentFileRef: DocumentFileRef = {
      kind: "file",
      name: "main.tex",
      path: "/tmp/tikz/main.tex",
      provider: "desktop-fs",
    };
    const svgBase64 = Buffer.from('<svg width="10pt" height="5pt" viewBox="0 0 10 5"></svg>').toString("base64");
    const reads: string[] = [];
    let watched: readonly string[] = [];
    setTestPlatform({
      files: {
        readLocalAsset: async (path) => {
          reads.push(path);
          if (path.endsWith(".svg")) {
            return {
              status: "ok",
              path,
              bytesBase64: svgBase64,
              size: svgBase64.length,
              revision: "svg-r1",
            };
          }
          return { status: "missing", path };
        },
        syncLocalAssetWatches: (paths) => {
          watched = [...paths];
        },
      },
    });
    invalidateImageAssetPath("/tmp/tikz/fig.svg");

    const resolver = await prepareImageAssetResolver({
      source: String.raw`\node {\includegraphics{fig}};`,
      documentFileRef,
    });
    const resolution = resolver.resolve({
      filename: "fig",
      options: {},
      source: String.raw`\includegraphics{fig}`,
      sourceStart: 0,
      sourceEnd: 21,
    });

    expect(reads).toEqual([
      "/tmp/tikz/fig.png",
      "/tmp/tikz/fig.jpg",
      "/tmp/tikz/fig.jpeg",
      "/tmp/tikz/fig.svg",
    ]);
    expect(watched).toEqual([...reads].sort());
    expect(resolution).toMatchObject({
      status: "resolved",
      mimeType: "image/svg+xml",
      naturalWidthPt: 10,
      naturalHeightPt: 5,
      dataBase64: svgBase64,
    });
  });
});

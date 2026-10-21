import { Buffer } from "node:buffer";
import { expect, it } from "vitest";
import { invalidateImageAssetPath, prepareDocumentGraphicsContext } from "../packages/app/src/image-asset-cache";
import { getActiveEditorPlatform, setActiveEditorPlatform } from "../packages/app/src/platform/current";
import type { LocalAssetReadResult } from "../packages/app/src/platform/types";

it("retires a pending alias read when native invalidation reports its canonical path", async () => {
  const previous = getActiveEditorPlatform();
  const alias = "/tmp/quality-native-alias/fig.svg";
  const canonical = "/tmp/quality-native-target/fig.svg";
  let finish!: (value: LocalAssetReadResult) => void;
  let start!: () => void;
  let reads = 0;
  const began = new Promise<void>((resolve) => { start = resolve; });
  const image = (revision: string): Extract<LocalAssetReadResult, { status: "ok" }> => ({
    status: "ok", path: canonical, revision, size: 100,
    bytesBase64: Buffer.from(`<svg width="10pt" height="5pt"><rect fill="${revision === "old" ? "red" : "blue"}" width="10" height="5"/></svg>`).toString("base64")
  });
  setActiveEditorPlatform({
    id: "native-path-regression", persistence: { load: () => null, save: () => {} },
    files: {
      readLocalAsset: async (path) => {
        expect(path).toBe(alias);
        reads += 1;
        if (reads === 1) {
          start();
          return await new Promise<LocalAssetReadResult>((resolve) => { finish = resolve; });
        }
        return image("new");
      }
    }
  });
  const request = {
    source: String.raw`\node{\includegraphics{fig.svg}};`,
    documentFileRef: { kind: "file" as const, name: "main.tex", provider: "desktop-fs" as const, path: "/tmp/quality-native-alias/main.tex" }
  };
  try {
    const older = prepareDocumentGraphicsContext(request);
    await began;
    invalidateImageAssetPath(canonical);
    const newerPromise = prepareDocumentGraphicsContext(request);
    await Promise.resolve();
    finish(image("old"));
    const newer = await newerPromise;
    await older;
    const subsequent = await prepareDocumentGraphicsContext(request);
    expect(reads).toBe(2);
    expect(newer.previewBundle.entries[0]?.resolution).toMatchObject({ status: "resolved", dataBase64: image("new").bytesBase64 });
    expect(subsequent.previewBundle.entries).toEqual(newer.previewBundle.entries);
  } finally {
    setActiveEditorPlatform(previous);
  }
});

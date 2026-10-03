import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it } from "vitest";
import { computeSnapshot, type ComputeRequest, type SessionSnapshot } from "../packages/app/src/compute";
import { invalidateImageAssetPath } from "../packages/app/src/image-asset-cache";
import { getActiveEditorPlatform, setActiveEditorPlatform } from "../packages/app/src/platform/current";
import { deriveSingleSourcePatch } from "../packages/app/src/store/source-patch-diff";
import { formatDocumentRootId } from "../packages/core/src/document/root-id";

const previous = getActiveEditorPlatform();
afterEach(() => setActiveEditorPlatform(previous));
const source = String.raw`\begin{tikzpicture}
\draw (0,0) -- (1,0);
\node[draw] (image) at (3,0) {\includegraphics{fig.svg}};
\draw (image.east) -- ++(1,0);
\end{tikzpicture}`;
const next = source.replace("(1,0)", "(1.2,0)");
const ref = (directory: string) => ({ kind: "file" as const, name: "main.tex", provider: "desktop-fs" as const, path: `${directory}/main.tex` });
const images = (snapshot: SessionSnapshot) => snapshot.svg?.svg.match(/<image [^>]+\/>/gu) ?? [];
const paths = (snapshot: SessionSnapshot) => snapshot.scene?.elements.filter((element) => element.kind === "Path").map((element) => element.commands);
// Fresh comparison uses another document owner; all spans/geometry still agree.
const handles = (snapshot: SessionSnapshot) => snapshot.editHandles.map((handle) => ({
  ...handle, sourceRef: { ...handle.sourceRef, sourceFingerprint: undefined }
}));

describe("compute graphics baseline identity", () => {
  for (const variant of ["dimensions", "same-size-bytes", "directory", "missing-to-resolved", "resolved-to-missing"]) {
    it(`matches fresh image bytes, geometry and dependent anchors after ${variant}`, async () => {
      const directory = `/tmp/compute-resource-${variant}`;
      let changed = false;
      let reads = 0;
      setActiveEditorPlatform({ id: variant, persistence: { load: () => null, save() {} }, files: {
        readLocalAsset: async (path) => {
          reads += 1;
          if ((variant === "missing-to-resolved" && !changed) || (variant === "resolved-to-missing" && changed)) return { status: "missing", path };
          const width = variant === "dimensions" && changed ? 30 : 10;
          return { status: "ok", path, revision: changed ? "new" : "old", size: 100,
            bytesBase64: Buffer.from(`<svg width="${width}pt" height="5pt"><rect width="${width}" height="5" fill="${changed ? "blue" : "red"}"/></svg>`).toString("base64") };
        }
      } });
      const documentId = `resource-${variant}`;
      await computeSnapshot({ id: "seed", documentId, source, sourceRevision: 0, documentFileRef: ref(directory) });
      const edit = await computeSnapshot({ id: "edit", documentId, source: next, sourceRevision: 1, documentFileRef: ref(directory), inferSourceChanges: true });
      expect(edit.snapshot.incremental?.replayMode).toBe("selective");
      expect(edit.snapshot.incremental?.reusedStatementCount).toBeGreaterThan(0);
      expect(reads).toBe(1);
      changed = true;
      if (variant !== "directory") invalidateImageAssetPath(`${directory}/fig.svg`);
      const documentFileRef = ref(variant === "directory" ? `${directory}/new` : directory);
      const incremental = await computeSnapshot({ id: "refresh", documentId, source: next, sourceRevision: 1, documentFileRef,
        changedSourceIds: ["path:0"], patches: deriveSingleSourcePatch(source, next), patchBaseRevision: 0 });
      const fresh = await computeSnapshot({ id: "fresh", documentId: `${documentId}-fresh`, source: next, sourceRevision: 1, documentFileRef });
      expect(incremental.snapshot.incremental?.strategy).toBe("full");
      expect(incremental.snapshot.incremental?.reusedStatementCount).toBe(0);
      expect(incremental.snapshot.graphicsPreviewBundleKey).toBe(fresh.snapshot.graphicsPreviewBundleKey);
      expect(images(incremental.snapshot)).toEqual(images(fresh.snapshot));
      expect(paths(incremental.snapshot)).toEqual(paths(fresh.snapshot));
      expect(incremental.snapshot.svg?.viewBox).toEqual(fresh.snapshot.svg?.viewBox);
      expect(handles(incremental.snapshot)).toEqual(handles(fresh.snapshot));
      expect(reads).toBe(2);
    });
  }

  it("retains semantic and text reuse across same-resource source revisions", async () => {
    const documentId = "resource-reuse-control";
    const file = ref("/tmp/compute-resource-reuse");
    let reads = 0;
    setActiveEditorPlatform({ id: "reuse", persistence: { load: () => null, save() {} }, files: {
      readLocalAsset: async (path) => { reads += 1; return { status: "ok", path, revision: "unchanged", size: 100,
        bytesBase64: Buffer.from('<svg width="10pt" height="5pt"/>').toString("base64") }; }
    } });
    const seed = await computeSnapshot({ id: "seed", documentId, source, sourceRevision: 0, documentFileRef: file });
    const edited = await computeSnapshot({ id: "edit", documentId, source: next, sourceRevision: 1, documentFileRef: file, inferSourceChanges: true });
    const stable = await computeSnapshot({ id: "refresh", documentId, source: next, sourceRevision: 1, documentFileRef: file, changedSourceIds: ["path:0"] });
    expect(reads).toBe(1);
    expect(seed.snapshot.graphicsPreviewBundleKey).toBe(edited.snapshot.graphicsPreviewBundleKey);
    expect(stable.snapshot.incremental?.replayMode).toBe("selective");
    expect(stable.snapshot.incremental?.reusedStatementCount).toBeGreaterThan(0);
    expect(images(stable.snapshot)).toEqual(images(edited.snapshot));
    expect(paths(stable.snapshot)).toEqual(paths(edited.snapshot));
    const textInfo = (snapshot: SessionSnapshot) => {
      const info = snapshot.scene?.elements.find((element) => element.kind === "Text")?.textRenderInfo;
      return info?.mode === "tex" ? info : undefined;
    };
    const paragraph = (snapshot: SessionSnapshot) => textInfo(snapshot)?.paragraphId;
    // Prefix edits rebase document spans and source-map keys, while retaining
    // the same native paragraph and current source ownership.
    expect(typeof paragraph(seed.snapshot)).toBe("string");
    expect(paragraph(edited.snapshot)).toBe(paragraph(seed.snapshot));
    expect(paragraph(stable.snapshot)).toBe(paragraph(edited.snapshot));
    const placement = textInfo(stable.snapshot)?.graphicsPlacements?.[0];
    const commandStart = next.indexOf("\\includegraphics");
    const filenameStart = next.indexOf("fig.svg");
    expect(placement?.sourceSpan).toEqual({ start: commandStart, end: commandStart + String.raw`\includegraphics{fig.svg}`.length });
    expect(placement?.filenameSpan).toEqual({ start: filenameStart, end: filenameStart + "fig.svg".length });
  });
});

describe("compute explicit render bounds", () => {
  const box = { x: -40, y: -40, width: 200, height: 100 };
  const simple = String.raw`\begin{tikzpicture}\node at (0,0) {Label};\draw (0,0) -- (1,0);\end{tikzpicture}`;
  for (const mode of ["full", "incremental", "inferred", "masked"] as const) {
    it(`honors the requested viewBox in ${mode} and restores automatic bounds when omitted`, async () => {
      const documentId = `viewbox-${mode}`;
      const extras: Partial<ComputeRequest> = mode === "incremental" ? { changedSourceIds: ["path:0"] }
        : mode === "inferred" ? { inferSourceChanges: true }
          : mode === "masked" ? { textEditMaskSpan: { from: simple.indexOf("Label"), to: simple.indexOf("Label") + 5 } } : {};
      await computeSnapshot({ id: "seed", documentId, source: simple, sourceRevision: 0 });
      const explicit = await computeSnapshot({ id: "explicit", documentId, source: simple, sourceRevision: 0, renderViewBox: box, ...extras });
      expect(explicit.snapshot.svg?.viewBox).toEqual(box);
      expect(explicit.snapshot.svgModel?.viewBox).toEqual(box);
      if (mode === "full" || mode === "masked") expect(explicit.snapshot.incremental).toBeNull();
      else expect(explicit.snapshot.incremental).not.toBeNull();
      const automatic = await computeSnapshot({ id: "automatic", documentId, source: simple, sourceRevision: 0, ...extras });
      expect(automatic.snapshot.svg?.viewBox).not.toEqual(box);
      expect(automatic.snapshot.svg?.viewBox.width).toBeLessThan(box.width);
    });
  }

  it("honors explicit bounds when rendering a nested deck TikZ picture", async () => {
    const source = String.raw`\documentclass{beamer}\begin{document}\begin{frame}\begin{tikzpicture}\draw (0,0)--(1,0);\end{tikzpicture}\end{frame}\end{document}`;
    const result = await computeSnapshot({ id: "nested", documentId: "nested-viewbox", source, renderViewBox: box,
      activeRootId: formatDocumentRootId({ kind: "beamer-frame-tikz", frameIndex: 0, index: 0 }) });
    expect(result.snapshot.deck).toBeNull();
    expect(result.snapshot.svg?.viewBox).toEqual(box);
  });
});

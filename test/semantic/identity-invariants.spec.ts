import { describe, expect, it } from "vitest";
import { renderTikzToSvg } from "../../packages/core/src/render/index.js";

describe("identity invariants", () => {
  it("assigns strict runtime/source identity invariants on scene elements and handles", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[red] (0,0) rectangle (1,1);
  \foreach \x in {0,1,2} {
    \draw (\x,0) -- (\x,1);
  }
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const { elements } = rendered.semantic.scene;
    const { editHandles } = rendered.semantic;

    expect(elements.length).toBeGreaterThan(0);
    expect(editHandles.length).toBeGreaterThan(0);

    for (const element of elements) {
      expect(element.runtimeId.length).toBeGreaterThan(0);
      expect(element.sourceRef.sourceId.length).toBeGreaterThan(0);
      expect(element.sourceRef.sourceSpan.to).toBeGreaterThanOrEqual(element.sourceRef.sourceSpan.from);
      // A reused element whose source did not move must not name an old revision.
      expect("sourceFingerprint" in element.sourceRef).toBe(false);
    }

    for (const handle of editHandles) {
      expect(handle.runtimeId.length).toBeGreaterThan(0);
      expect(handle.sourceRef.sourceId.length).toBeGreaterThan(0);
      expect(handle.sourceRef.sourceSpan.to).toBeGreaterThan(handle.sourceRef.sourceSpan.from);
      expect(handle.sourceRef.sourceFingerprint.length).toBeGreaterThan(0);
    }

    expect(new Set(elements.map((element) => element.runtimeId)).size).toBe(elements.length);
    expect(new Set(editHandles.map((handle) => handle.runtimeId)).size).toBe(editHandles.length);

    const bySourceId = new Map<string, number>();
    for (const element of elements) {
      bySourceId.set(element.sourceRef.sourceId, (bySourceId.get(element.sourceRef.sourceId) ?? 0) + 1);
    }
    expect([...bySourceId.values()].some((count) => count > 1)).toBe(true);
  });

  it("uses caller-provided source fingerprints for semantic source refs", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,1);
\end{tikzpicture}`;
    const sourceFingerprint = `source-revision:doc-a:3:${source.length}`;
    const rendered = renderTikzToSvg(source, {
      evaluate: { sourceFingerprint }
    });

    expect(rendered.semantic.editHandles.length).toBeGreaterThan(0);
    expect(rendered.semantic.editHandles.every((handle) => handle.sourceRef.sourceFingerprint === sourceFingerprint)).toBe(true);
  });
});

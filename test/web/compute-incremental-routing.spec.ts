import { describe, expect, it } from "vitest";
import { computeSnapshot } from "../../packages/app/src/compute.js";
import { executeDocumentEdit } from "../../packages/app/src/edit-execution.js";

const source = String.raw`\begin{tikzpicture}
\draw (0,0) -- (1,0);
\end{tikzpicture}`;

describe("incremental source inference routing", () => {
  it("renders a newly opened document without reporting missing changed IDs", async () => {
    const result = await computeSnapshot({ id: "open", documentId: "inference-cold", source,
      sourceRevision: 0, inferSourceChanges: true });
    expect(result.snapshot.svg).not.toBeNull();
    expect(result.snapshot.incremental).toBeNull();
    expect(result.diagnostics).toEqual([]);
  });

  it("treats an unchanged-source refresh as an ordinary render", async () => {
    const documentId = "inference-refresh";
    await computeSnapshot({ id: "seed", documentId, source, sourceRevision: 0 });
    const result = await computeSnapshot({ id: "refresh", documentId, source,
      sourceRevision: 0, inferSourceChanges: true, renderViewBox: { x: -5, y: -5, width: 20, height: 20 } });
    expect(result.snapshot.incremental).toBeNull();
    expect(result.snapshot.svg?.viewBox).toEqual({ x: -5, y: -5, width: 20, height: 20 });
  });

  it("still infers the changed path for an actual source edit", async () => {
    const documentId = "inference-edited";
    await computeSnapshot({ id: "seed", documentId, source, sourceRevision: 0 });
    const next = source.replace("(1,0)", "(2,0)");
    const result = await computeSnapshot({ id: "edit", documentId, source: next,
      sourceRevision: 1, inferSourceChanges: true });
    expect(result.snapshot.incremental).toMatchObject({ strategy: "incremental", changedSourceIds: ["path:0"] });
    const full = await computeSnapshot({ id: "canonical", documentId: "inference-canonical", source: next, sourceRevision: 1 });
    expect(result.snapshot.svg?.svg).toBe(full.snapshot.svg?.svg);
  });

  for (const kind of ["updateNodeText", "setProperty"] as const) {
    it.each([
      ["command", String.raw`\begin{tikzpicture}\node[draw] at (0,0) {A};\end{tikzpicture}`],
      ["attached", String.raw`\begin{tikzpicture}\draw (0,0) -- (2,0) node[midway] {A};\end{tikzpicture}`],
      ["scope", String.raw`\begin{tikzpicture}\begin{scope}\node[draw] at (0,0) {A};\end{scope}\end{tikzpicture}`]
    ])(`keeps statement ownership for ${kind} on a %s node`, async (name, nodeSource) => {
      const documentId = `inference-node-${kind}-${name}`;
      const seed = await computeSnapshot({ id: "seed", documentId, source: nodeSource, sourceRevision: 0 });
      const target = seed.snapshot.scene!.elements.find(element => element.kind === "Text")!.sourceRef.sourceId;
      const edit = executeDocumentEdit({ documentId, source: nodeSource, sourceRevision: 0,
        activeRootId: seed.snapshot.activeRootId, snapshot: seed.snapshot }, kind === "updateNodeText"
        ? { kind, elementId: target, text: "Updated" }
        : { kind, elementId: target, level: "command", key: "fill", value: "red" });
      if (edit.kind !== "success") throw new Error(JSON.stringify(edit));
      const result = await computeSnapshot({ id: "edit", documentId, source: edit.newSource, sourceRevision: 1,
        activeRootId: seed.snapshot.activeRootId, patches: edit.patches, patchBaseRevision: 0,
        changedSourceIds: edit.changedSourceIds });
      expect(result.snapshot.incremental).toMatchObject({ parseStrategy: "incremental", strategy: "incremental" });
      const full = await computeSnapshot({ id: "canonical", documentId: `${documentId}-canonical`,
        source: edit.newSource, sourceRevision: 1, activeRootId: seed.snapshot.activeRootId });
      expect(result.snapshot.svg?.svg).toBe(full.snapshot.svg?.svg);
    });
  }
});

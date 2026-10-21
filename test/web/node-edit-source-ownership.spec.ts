import { describe, expect, it } from "vitest";
import { computeSnapshot, type SessionSnapshot } from "../../packages/app/src/compute.js";
import { applyEditAction, type EditAction } from "../../packages/core/src/edit/actions.js";
import { createEditGeometrySession } from "../../packages/core/src/edit/geometry-session.js";
import { collectSourceWorldBounds } from "../../packages/core/src/edit/snapping/geometry.js";
import { wp } from "../coords-helpers.js";

const sources = {
  standalone: String.raw`\begin{tikzpicture}
\node[draw] (A) at (0,0) {A};
\node[draw] (B) at (2,0) {B};
\end{tikzpicture}`,
  attached: String.raw`\begin{tikzpicture}
\draw (0,0) -- (2,0) node[draw,midway,label=above:L] (B) {B};
\end{tikzpicture}`,
  tree: String.raw`\begin{tikzpicture}
\node[draw] (R) at (0,0) {R} child { node[draw,label=above:L] (B) {B} };
\end{tikzpicture}`,
  matrix: String.raw`\begin{tikzpicture}
\matrix[matrix of nodes,nodes={draw}] (M) { A & B \\ };
\end{tikzpicture}`
};

type SourceKind = keyof typeof sources;
type Operation = "resize" | "property" | "origin" | "text" | "set-property";

function selectedNodeId(snapshot: SessionSnapshot): string {
  const node = snapshot.scene?.elements.find(element => element.kind === "Text" && element.text.trim() === "B");
  if (!node) throw new Error("Expected selected B node.");
  return node.sourceRef.sourceId;
}

function editFor(operation: Operation, snapshot: SessionSnapshot): EditAction {
  const elementId = selectedNodeId(snapshot);
  if (operation === "text") return { kind: "updateNodeText", elementId, text: "Edited B" };
  if (operation === "set-property") return { kind: "setProperty", elementId, level: "command", key: "draw", value: "blue" };
  if (operation !== "resize") return { kind: "rotateElement", elementId, mode: operation, angleDeg: 15 };
  const bounds = collectSourceWorldBounds(snapshot.scene!.elements).get(elementId);
  if (!bounds) throw new Error("Expected selected node bounds.");
  return { kind: "resizeElement", elementId, role: "right", newWorld: wp(bounds.maxX + 35, (bounds.minY + bounds.maxY) / 2) };
}

const cases: { sourceKind: SourceKind; operation: Operation; geometry?: boolean }[] = [
  { sourceKind: "standalone", operation: "resize" },
  { sourceKind: "standalone", operation: "property" },
  { sourceKind: "standalone", operation: "origin" },
  { sourceKind: "attached", operation: "resize" },
  { sourceKind: "attached", operation: "resize", geometry: true },
  { sourceKind: "attached", operation: "property" },
  { sourceKind: "attached", operation: "origin", geometry: true },
  { sourceKind: "tree", operation: "property" },
  { sourceKind: "tree", operation: "origin" },
  { sourceKind: "matrix", operation: "property" },
  { sourceKind: "matrix", operation: "origin" },
  { sourceKind: "attached", operation: "text" },
  { sourceKind: "standalone", operation: "set-property" },
  { sourceKind: "matrix", operation: "text" }
];

describe("node edit changed-source ownership", () => {
  it.each(cases)("$sourceKind $operation (geometry=$geometry) reparses its owning statement and matches canonical render", async ({ sourceKind, operation, geometry: useGeometry }) => {
    const source = sources[sourceKind];
    const documentId = `node-ownership-${sourceKind}-${operation}-${useGeometry ? "geometry" : "plain"}`;
    const seeded = await computeSnapshot({ id: `${documentId}-seed`, documentId, source, sourceRevision: 0 });
    const action = editFor(operation, seeded.snapshot);
    const sourceFingerprint = `source-revision:${documentId}:0:${source.length}`;
    const geometry = useGeometry ? createEditGeometrySession({
      source, parsed: seeded.snapshot.parseResult!, semantic: seeded.snapshot.semanticResult!
    }, undefined, { sourceFingerprint }) : undefined;
    const result = applyEditAction(source, seeded.snapshot.editHandles, action, { parseOptions: { sourceFingerprint }, geometry });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error(`Expected supported ${sourceKind} ${operation} edit.`);
    expect(result.newSource).not.toBe(source);
    const ownerId = sourceKind === "standalone" ? "path:1" : "path:0";
    expect(result.changedSourceIds).toEqual([ownerId]);
    if (sourceKind !== "standalone") expect(selectedNodeId(seeded.snapshot)).not.toBe(ownerId);
    const reconstructed = [...result.patches].sort((a, b) => b.oldSpan.from - a.oldSpan.from)
      .reduce((text, patch) => text.slice(0, patch.oldSpan.from) + patch.replacement + text.slice(patch.oldSpan.to), source);
    expect(reconstructed).toBe(result.newSource);

    const computed = await computeSnapshot({ id: `${documentId}-edited`, documentId, source: result.newSource, sourceRevision: 1,
      activeRootId: seeded.snapshot.activeRootId, changedSourceIds: result.changedSourceIds,
      patches: result.patches, patchBaseRevision: 0, trigger: operation === "resize" ? "drag-element" : "other" });
    const canonical = await computeSnapshot({ id: `${documentId}-canonical`, documentId: `${documentId}-canonical`, source: result.newSource, sourceRevision: 1 });
    expect(computed.snapshot.incremental?.parseStrategy).toBe("incremental");
    expect(computed.snapshot.incremental?.parseFallbackReason).toBeUndefined();
    expect(computed.snapshot.parseResult?.diagnostics).toEqual(canonical.snapshot.parseResult?.diagnostics);
    expect(computed.snapshot.svg?.svg).toBe(canonical.snapshot.svg?.svg);
  });

  it.each(["tree", "matrix"] as const)("preserves the unsupported %s child resize boundary", async sourceKind => {
    const source = sources[sourceKind];
    const documentId = `node-ownership-unsupported-${sourceKind}`;
    const seeded = await computeSnapshot({ id: documentId, documentId, source, sourceRevision: 0 });
    expect(applyEditAction(source, seeded.snapshot.editHandles, editFor("resize", seeded.snapshot))).toMatchObject({
      kind: "unsupported", reason: "resizeElement currently supports only node-like or shape-path elements."
    });
  });
});

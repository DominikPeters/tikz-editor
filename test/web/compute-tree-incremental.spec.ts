import { describe, expect, it } from "vitest";
import { computeSnapshot, type SessionSnapshot } from "../../packages/app/src/compute.js";
import { applyEditAction } from "../../packages/core/src/edit/actions.js";

function namedText(snapshot: SessionSnapshot, text: string) {
  const element = snapshot.scene?.elements.find(element => element.kind === "Text" && element.text === text);
  if (!element) throw new Error(`Expected ${text} node.`);
  return element;
}

describe("incremental tree paint", () => {
  it.each([
    { name: "child", selected: "B", source: String.raw`\begin{tikzpicture}
\node[draw] (R) at (0,0) {R} child { node[draw,label=above:L] (B) {B} };
\end{tikzpicture}` },
    { name: "nested child", selected: "C", source: String.raw`\begin{tikzpicture}
\node[draw] (R) {R} child { node[draw] (B) {B}
  child { node[draw,label=above:L,pin=right:P] (C) {C} }
  child { node[draw] (D) {D} } };
\end{tikzpicture}` },
    { name: "child with unrelated statements", selected: "B", source: String.raw`\begin{tikzpicture}
\node[draw] (R) {R} child { node[draw] (B) {B} };
\draw (5,0) -- (6,0);
\node[draw] (U) at (7,0) {Unrelated};
\end{tikzpicture}` }
  ])("updates $name paint across consecutive edits using its owning statement", async ({ name, selected, source }) => {
    const documentId = `tree-paint-${name}`;
    let currentSource = source;
    const checks: { snapshot: SessionSnapshot; source: string }[] = [];
    let snapshot = (await computeSnapshot({ id: `${documentId}-seed`, documentId, source, sourceRevision: 0 })).snapshot;
    for (const [index, color] of ["blue", "green"].entries()) {
      const child = namedText(snapshot, selected);
      const edit = applyEditAction(currentSource, snapshot.editHandles, {
        kind: "setProperty", elementId: child.sourceRef.sourceId, level: "command", key: "draw", value: color
      });
      expect(edit.kind).toBe("success");
      if (edit.kind !== "success") throw new Error("Expected supported tree child paint edit.");
      expect(edit.changedSourceIds).toEqual(["path:0"]);
      const result = await computeSnapshot({ id: `${documentId}-${index}`, documentId, source: edit.newSource, sourceRevision: index + 1,
        changedSourceIds: edit.changedSourceIds, patches: edit.patches, patchBaseRevision: index });
      expect(result.snapshot.incremental?.parseStrategy).toBe("incremental");
      expect(result.snapshot.incremental?.strategy).toBe("incremental");
      const childSourceId = namedText(result.snapshot, selected).sourceRef.sourceId;
      const shape = result.snapshot.scene?.elements.find(element => element.kind === "Path" && !element.adornment && element.sourceRef.sourceId === childSourceId);
      expect(shape?.style.stroke).toBe(index === 0 ? "#0000ff" : "#00ff00");
      expect(result.snapshot.svgModel?.parts.find(part => part.elementId === shape?.id)?.markup)
        .toContain(`stroke="${shape?.style.stroke}"`);
      checks.push({ snapshot: result.snapshot, source: edit.newSource });
      currentSource = edit.newSource;
      snapshot = result.snapshot;
    }
    // Canonical computations use independent documents after both edits so
    // they cannot replace the app's single committed incremental baseline.
    for (const [index, check] of checks.entries()) {
      const canonical = await computeSnapshot({ id: `${documentId}-canonical-${index}`, documentId: `${documentId}-canonical-${index}`,
        source: check.source, sourceRevision: index + 1 });
      const child = namedText(check.snapshot, selected);
      expect(namedText(canonical.snapshot, selected).style).toEqual(child.style);
      expect(check.snapshot.svg?.svg).toBe(canonical.snapshot.svg?.svg);
    }
  });

  it.each(["label", "pin"] as const)("updates a tree-child %s outline without changing geometry", async kind => {
    const documentId = `tree-${kind}-paint`;
    const source = String.raw`\begin{tikzpicture}
\node[draw] (R) {R} child { node[draw,${kind}={[draw=red]above:L}] (B) {B} };
\end{tikzpicture}`;
    await computeSnapshot({ id: `${documentId}-seed`, documentId, source, sourceRevision: 0 });
    const next = source.replace("draw=red", "draw=blue");
    const result = await computeSnapshot({ id: `${documentId}-edited`, documentId, source: next, sourceRevision: 1, inferSourceChanges: true });
    const canonical = await computeSnapshot({ id: `${documentId}-canonical`, documentId: `${documentId}-canonical`, source: next, sourceRevision: 1 });
    expect(result.snapshot.incremental?.changedSourceIds).toEqual(["path:0"]);
    expect(result.snapshot.incremental?.parseStrategy).toBe("incremental");
    const outline = result.snapshot.scene?.elements.find(element => element.kind === "Path" && element.adornment?.kind === kind);
    expect(outline?.treeChild?.treeRootSourceId).toBe("path:0");
    expect(outline?.style.stroke).toBe("#0000ff");
    expect(result.snapshot.svgModel?.parts.find(part => part.elementId === outline?.id)?.markup).toContain('stroke="#0000ff"');
    expect(result.snapshot.svg?.viewBox).toEqual(canonical.snapshot.svg?.viewBox);
    expect(result.snapshot.svg?.svg).toBe(canonical.snapshot.svg?.svg);
  });

  it("invalidates generated children when their containing scope paint changes", async () => {
    const documentId = "scoped-tree-paint";
    const source = String.raw`\begin{tikzpicture}
\begin{scope}[every node/.style={draw=red}]
\node[draw] (R) {R} child { node[draw] (B) {B} child { node[draw] (C) {C} } };
\end{scope}
\node[draw] (U) at (5,0) {Unrelated};
\end{tikzpicture}`;
    const seed = await computeSnapshot({ id: `${documentId}-seed`, documentId, source, sourceRevision: 0 });
    const next = source.replace("draw=red", "draw=blue");
    const result = await computeSnapshot({ id: `${documentId}-edited`, documentId, source: next, sourceRevision: 1, inferSourceChanges: true });
    const canonical = await computeSnapshot({ id: `${documentId}-canonical`, documentId: `${documentId}-canonical`, source: next, sourceRevision: 1 });
    expect(result.snapshot.incremental?.parseStrategy).toBe("incremental");
    expect(result.snapshot.incremental?.strategy).toBe("incremental");
    for (const text of ["B", "C"]) {
      const child = namedText(result.snapshot, text);
      const outline = result.snapshot.scene?.elements.find(element => element.kind === "Path" && element.sourceRef.sourceId === child.sourceRef.sourceId);
      expect(outline?.style.stroke).toBe("#0000ff");
      expect(result.snapshot.svgModel?.parts.find(part => part.elementId === outline?.id)?.markup).toContain('stroke="#0000ff"');
    }
    const unrelated = namedText(result.snapshot, "Unrelated");
    expect(unrelated.style).toEqual(namedText(seed.snapshot, "Unrelated").style);
    expect(result.snapshot.incremental?.reusedStatementCount).toBeGreaterThan(0);
    expect(result.snapshot.svg?.svg).toBe(canonical.snapshot.svg?.svg);
  });
});

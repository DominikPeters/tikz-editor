import { expect, it } from "vitest";
import { applySourcePatches, composeSourcePatches } from "../packages/core/src/edit/source-patches.js";
import type { SourcePatch } from "../packages/core/src/edit/types.js";
const patch = (from: number, to: number, replacement: string): SourcePatch => ({ oldSpan: { from, to }, newSpan: { from, to: from + replacement.length }, replacement });

it("preserves untouched gaps between sequential edits", () => {
  const source = "first; unchanged; last;";
  const patches = composeSourcePatches(source, [[patch(0, 5, "one")], [patch(16, 20, "two")]]);
  expect(patches).toEqual([patch(0, 5, "one"), { ...patch(18, 22, "two"), newSpan: { from: 16, to: 19 } }]);
  expect(applySourcePatches(source, patches)).toMatchObject({ source: "one; unchanged; two;" });
});

it("composes overlapping edits inside replacements and drops edits that return to the original", () => {
  const source = "abcdef";
  const patches = composeSourcePatches(source, [[patch(1, 3, "12345")], [patch(2, 5, "XYZ")], [patch(0, 2, "A")]]);
  expect(applySourcePatches(source, patches)).toMatchObject({ source: "AXYZ5def" });
  expect(composeSourcePatches(source, [[patch(1, 3, "12345")], [patch(1, 6, "bc")]])).toEqual([]);
});

it("matches sequential patch application for deterministic random insertions, deletions, and replacements", () => {
  let seed = 17;
  const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
  for (let trial = 0; trial < 100; trial++) {
    const source = "abcdefghijklmnopqrstuvwxyz";
    let current = source;
    const steps: SourcePatch[][] = [];
    for (let step = 0; step < 20; step++) {
      const from = random(current.length + 1);
      const to = from + random(current.length - from + 1);
      const edits = [patch(from, to, "XYZ".slice(0, random(4)))];
      const applied = applySourcePatches(current, edits);
      if (applied.kind !== "success") throw new Error("Invalid test patch");
      current = applied.source;
      steps.push(edits);
    }
    const composed = composeSourcePatches(source, steps);
    expect(applySourcePatches(source, composed)).toEqual({ kind: "success", source: current });
    for (const entry of composed) expect(current.slice(entry.newSpan.from, entry.newSpan.to)).toBe(entry.replacement);
  }
});

it("preserves ordering for multiple patches at the same insertion point", () => {
  const source = "abc";
  const edits = [patch(0, 0, "X"), patch(0, 0, "Y"), patch(0, 1, "A"), patch(2, 3, "C")];
  expect(applySourcePatches(source, composeSourcePatches(source, [edits]))).toEqual(applySourcePatches(source, edits));
});

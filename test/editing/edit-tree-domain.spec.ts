import { describe, expect, it } from "vitest";
import { buildEditTree } from "../../packages/core/src/editing/tree/build.js";
import type { EditTree } from "../../packages/core/src/editing/tree/types.js";
import { createPositionIndex } from "../../packages/core/src/editing/position/index.js";
import { renderedBeamerCorpusScopes } from "./beamer-corpus.js";

/** The node whose own source (a leaf, or a construct's delimiters and values) covers each character. */
function ownerByCharacter(tree: EditTree): Int32Array {
  const owner = new Int32Array(tree.text.length).fill(-1);
  for (const node of tree.nodes) {
    const isLeaf = node.slots.every((slot) => tree.slots[slot].presence === "absent");
    const spans = isLeaf ? [node.span] : node.delimiters;
    for (const span of spans) {
      owner.fill(node.id, span.from, span.to);
    }
  }
  return owner;
}

/**
 * Shadow-mode check against today's behaviour (migration step 3): every
 * caret stop the renderer publishes today must be a place in the tree.
 * Either it resolves to a position, or it lies inside one construct's own
 * source (`\la|mbda`, `\frac|{a}`), which the tree treats as one unit by
 * design (the contract tests ask for exactly that). An environment the
 * tree keeps opaque is not such a unit: stops inside it mean the tree would
 * lose text that is editable today.
 */
describe("edit tree positions against today's rendered caret stops", () => {
  it("has a place for every rendered stop in the Beamer fixtures", async () => {
    const scopes = await renderedBeamerCorpusScopes();
    expect(scopes.length).toBeGreaterThan(300);
    const failures: string[] = [];
    for (const scope of scopes) {
      const tree = buildEditTree(scope.text, { commands: scope.commands });
      const index = createPositionIndex(tree);
      const owner = ownerByCharacter(tree);
      for (const stop of scope.stops) {
        if (index.resolve(stop, "before")) continue;
        const unit = stop > 0 && owner[stop - 1] !== -1 && owner[stop - 1] === owner[stop] ? tree.nodes[owner[stop]] : null;
        // An environment kept opaque would hide editable text, so it does not count as a unit.
        if (unit && !(unit.kind === "atom" && tree.text.startsWith("\\begin", unit.span.from))) continue;
        const context = `${JSON.stringify(scope.text.slice(Math.max(0, stop - 12), stop))}|${JSON.stringify(scope.text.slice(stop, stop + 12))}`;
        failures.push(`${scope.file} frame ${scope.frameIndex} ${scope.kind} at ${stop}: ${context}`);
      }
    }
    expect(failures).toEqual([]);
  }, 60_000);
});

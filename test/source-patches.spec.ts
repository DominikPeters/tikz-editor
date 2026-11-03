import { describe, expect, it } from "vitest";

import type { SourcePatch } from "../packages/core/src/edit/types.js";
import { applySourcePatches, patchesMatchSourceTransition } from "../packages/core/src/edit/source-patches.js";
import { fragment } from "./fragment-helpers.js";

describe("source patch replay", () => {
  it("applies non-overlapping old-source patch spans", () => {
    const source = "abc123xyz";
    const patches: SourcePatch[] = [
      { oldSpan: { from: 3, to: 6 }, newSpan: { from: 3, to: 6 }, replacement: fragment("456") }
    ];
    const replayed = applySourcePatches(source, patches);
    expect(replayed).toEqual({ kind: "success", source: "abc456xyz" });
    expect(patchesMatchSourceTransition(source, "abc456xyz", patches)).toBe(true);
  });

  it("rejects mixed-base/overlapping old spans", () => {
    const source = "abcdefghij";
    const patches: SourcePatch[] = [
      { oldSpan: { from: 2, to: 4 }, newSpan: { from: 2, to: 3 }, replacement: fragment("X") },
      { oldSpan: { from: 3, to: 5 }, newSpan: { from: 3, to: 4 }, replacement: fragment("Y") }
    ];
    const replayed = applySourcePatches(source, patches);
    expect(replayed.kind).toBe("invalid");
    expect(patchesMatchSourceTransition(source, "abXYfghij", patches)).toBe(false);
  });

  it("rejects malformed and out-of-bounds patch spans before replay", () => {
    expect(
      applySourcePatches("abc", [
        { oldSpan: { from: 2, to: 1 }, newSpan: { from: 0, to: 0 }, replacement: fragment("") }
      ])
    ).toEqual({ kind: "invalid", reason: "invalid-span-order" });

    expect(
      applySourcePatches("abc", [
        { oldSpan: { from: 1, to: 4 }, newSpan: { from: 0, to: 0 }, replacement: fragment("") }
      ])
    ).toEqual({ kind: "invalid", reason: "out-of-bounds" });
  });
});

import { describe, expect, it } from "vitest";

import {
  hasMultipleRoots,
  parseWindowRootId,
  reconcileActiveRootSelection
} from "../packages/app/src/root-inventory.js";

describe("root inventory policies", () => {
  it("parseWindowRootId prefers the explicit selection", () => {
    expect(parseWindowRootId("figure:2", 5)).toBe("figure:2");
    expect(parseWindowRootId("figure:0", 1)).toBe("figure:0");
  });

  it("parseWindowRootId defaults single-root and refuses multi-root guessing", () => {
    expect(parseWindowRootId(undefined, 0)).toBeUndefined();
    expect(parseWindowRootId(undefined, 1)).toBeUndefined();
    expect(parseWindowRootId(null, 1)).toBeUndefined();
    expect(parseWindowRootId(undefined, 2)).toBeNull();
    expect(parseWindowRootId(null, 3)).toBeNull();
  });

  it("hasMultipleRoots names the navigation-chrome threshold", () => {
    expect(hasMultipleRoots(0)).toBe(false);
    expect(hasMultipleRoots(1)).toBe(false);
    expect(hasMultipleRoots(2)).toBe(true);
  });

  it("drops selections that vanished from the inventory", () => {
    const result = reconcileActiveRootSelection({
      activeRootId: "figure:5",
      hasInitializedRootSelection: true,
      previousRootCount: 6,
      roots: [{ id: "figure:0" }, { id: "figure:1" }]
    });
    // The stale id clears and the multi-root growth rule does not fire on shrink.
    expect(result).toEqual({
      activeRootId: null,
      hasInitializedRootSelection: true
    });
  });

  it("auto-selects the first root on first inventory arrival", () => {
    const result = reconcileActiveRootSelection({
      activeRootId: null,
      hasInitializedRootSelection: false,
      previousRootCount: 0,
      roots: [{ id: "figure:0" }]
    });
    expect(result).toEqual({
      activeRootId: "figure:0",
      hasInitializedRootSelection: true
    });
  });

  it("auto-selects when a document grows into multi-root without a selection", () => {
    const result = reconcileActiveRootSelection({
      activeRootId: null,
      hasInitializedRootSelection: true,
      previousRootCount: 1,
      roots: [{ id: "figure:0" }, { id: "figure:1" }]
    });
    expect(result).toEqual({
      activeRootId: "figure:0",
      hasInitializedRootSelection: true
    });
  });

  it("keeps a valid explicit selection untouched", () => {
    const result = reconcileActiveRootSelection({
      activeRootId: "figure:1",
      hasInitializedRootSelection: true,
      previousRootCount: 2,
      roots: [{ id: "figure:0" }, { id: "figure:1" }, { id: "figure:2" }]
    });
    expect(result).toEqual({
      activeRootId: "figure:1",
      hasInitializedRootSelection: true
    });
  });
});

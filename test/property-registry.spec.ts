import { describe, expect, it } from "vitest";
import { parseOptionListRaw } from "../packages/core/src/options/parse.js";
import * as inspectorModule from "../packages/core/src/edit/inspector.js";
import {
  PROPERTY_REGISTRY,
  addablePropertyKind,
  buildSetPropertyActionsForTargets,
  candidateKeysForProperty,
  conflictKeysForProperty,
  getPropertySemantics,
  isAddableProperty,
  propertyCleanupKinds,
  propertyIdForOptionEntry,
  propertyIdForStyleContribution,
  shouldOmitDefaultWhenEquivalent,
  buildPropertyMutations,
  buildPropertyMutationsFromRequest
} from "../packages/core/src/edit/property-registry.js";

describe("property registry", () => {
  it("exposes stable metadata for core writable properties", () => {
    expect(PROPERTY_REGISTRY.get("stroke-color")?.primaryKey).toBe("draw");
    expect(candidateKeysForProperty("stroke-color")).toEqual(expect.arrayContaining(["draw", "color"]));
    expect(candidateKeysForProperty("dash-style")).toEqual(expect.arrayContaining(["solid", "dash pattern", "dash phase"]));
    expect(candidateKeysForProperty("rounded-corners")).toEqual(expect.arrayContaining(["rounded corners", "sharp corners"]));
    expect(candidateKeysForProperty("transform.xshift")).toEqual(expect.arrayContaining(["xshift", "shift", "/tikz/xshift"]));
  });

  it("maps option entries to semantic properties only when supported by the target property set", () => {
    const entries = parseOptionListRaw("[draw=red, fill=blue, foo=baz, rounded corners]").entries;
    const [drawEntry, fillEntry, unsupportedEntry, roundedEntry] = entries;
    expect(drawEntry).toBeDefined();
    expect(fillEntry).toBeDefined();
    expect(unsupportedEntry).toBeDefined();
    expect(roundedEntry).toBeDefined();
    if (!drawEntry || !fillEntry || !unsupportedEntry || !roundedEntry) {
      throw new Error("Expected parsed option entries");
    }
    expect(propertyIdForOptionEntry(drawEntry, ["stroke-color", "fill-color"])).toBe("stroke-color");
    expect(propertyIdForOptionEntry(fillEntry, ["stroke-color", "fill-color"])).toBe("fill-color");
    expect(propertyIdForOptionEntry(unsupportedEntry, ["stroke-color", "fill-color"])).toBeNull();
    expect(propertyIdForOptionEntry(roundedEntry, ["rounded-corners"])).toBe("rounded-corners");
  });

  it("maps style contributions through registry metadata", () => {
    expect(propertyIdForStyleContribution("stroke", ["stroke-color"])).toBe("stroke-color");
    expect(propertyIdForStyleContribution("fillPattern", ["fill-pattern", "fill-mode"])).toBe("fill-pattern");
    expect(propertyIdForStyleContribution("fillPattern", ["fill-mode"])).toBe("fill-mode");
    expect(propertyIdForStyleContribution("fontSize", ["node-font"])).toBeNull();
  });

  it("keeps cleanup and default reversion gated by registered semantics", () => {
    expect(propertyCleanupKinds("stroke-color")).toContain("paint-command");
    expect(propertyCleanupKinds("fill-color")).toContain("paint-command");
    expect(shouldOmitDefaultWhenEquivalent("line-cap")).toBe(true);
    expect(shouldOmitDefaultWhenEquivalent("arrow-tip")).toBe(true);
    expect(shouldOmitDefaultWhenEquivalent("decorations.path-morphing")).toBe(true);
    expect(shouldOmitDefaultWhenEquivalent("stroke-color")).toBe(true);
    expect(shouldOmitDefaultWhenEquivalent("fill-color")).toBe(true);
    expect(shouldOmitDefaultWhenEquivalent("grid-step")).toBe(true);
    expect(shouldOmitDefaultWhenEquivalent("grid-xstep")).toBe(true);
    expect(shouldOmitDefaultWhenEquivalent("grid-ystep")).toBe(true);
    expect(shouldOmitDefaultWhenEquivalent("node-shape")).toBe(true);
    expect(shouldOmitDefaultWhenEquivalent("node-inner-sep")).toBe(true);
    expect(shouldOmitDefaultWhenEquivalent("node-minimum-width")).toBe(true);
    expect(shouldOmitDefaultWhenEquivalent("node-minimum-height")).toBe(true);
    expect(shouldOmitDefaultWhenEquivalent("foo")).toBe(false);
  });

  it("identifies addable properties from registry metadata", () => {
    expect(isAddableProperty("line-cap", "lineCap")).toBe(true);
    expect(isAddableProperty("xshift", "number")).toBe(true);
    expect(isAddableProperty("fill-mode", "fillMode")).toBe(true);
    expect(isAddableProperty("arrow-tip")).toBe(false);
    expect(getPropertySemantics("foo")).toBeNull();
  });

  it("keeps mutation builders out of the inspector module", () => {
    expect("buildTransformSetPropertyMutations" in inspectorModule).toBe(false);
    expect("buildFillModeSetPropertyMutations" in inspectorModule).toBe(false);
    expect("buildRoundedCornersSetPropertyMutation" in inspectorModule).toBe(false);
  });

  it("builds line-width mutations through registry-owned writer logic", () => {
    expect(buildPropertyMutations({ propertyId: "line-width", key: "thick", value: "true" })).toEqual([
      {
        key: "thick",
        value: "true",
        propertyId: "line-width",
        clearKeys: ["line width", "ultra thin", "very thin", "thin", "semithick", "very thick", "ultra thick"]
      }
    ]);
    expect(buildPropertyMutations({ propertyId: "line-width", key: "line width", value: "1.7pt" })).toEqual([
      {
        key: "line width",
        value: "1.7pt",
        propertyId: "line-width",
        clearKeys: ["ultra thin", "very thin", "thin", "semithick", "thick", "very thick", "ultra thick"]
      }
    ]);
  });

  it("builds typed style-panel mutation requests through the registry", () => {
    expect(buildPropertyMutationsFromRequest({ kind: "dash-style", value: "dashed" })).toEqual([
      {
        key: "dashed",
        value: "true",
        propertyId: "dash-style",
        clearKeys: ["solid", "dashed", "densely dashed", "loosely dashed", "dotted", "densely dotted", "loosely dotted", "dash pattern", "dash phase", "dash"]
      }
    ]);
    expect(buildPropertyMutationsFromRequest({ kind: "fill-mode", value: "solid", context: { fillColor: "red" } })[0]?.propertyId).toBe("fill-mode");
    expect(buildPropertyMutationsFromRequest({ kind: "line-width-preset", key: "thick" })[0]?.propertyId).toBe("line-width");
  });

  it("maps the remaining option aliases and honors set-based availability filters", () => {
    const aliases: Array<[string, string]> = [
      ["xshift", "transform.xshift"],
      ["/tikz/yshift", "transform.yshift"],
      ["xscale", "transform.xscale"],
      ["/tikz/yscale", "transform.yscale"],
      ["/tikz/rotate", "transform.rotate"],
      ["line width", "line-width"],
      ["line cap", "line-cap"],
      ["line join", "line-join"],
      ["shade", "fill-shading"],
      ["pattern", "fill-pattern"],
      ["pattern color", "fill-pattern-color"],
      ["top color", "fill-axis-top-color"],
      ["bottom color", "fill-axis-bottom-color"],
      ["inner color", "fill-radial-inner-color"],
      ["outer color", "fill-radial-outer-color"],
      ["ball color", "fill-ball-color"],
      ["arrows", "arrow-tip"],
      ["decoration", "decorations.path-morphing"],
      ["shape", "node-shape"],
      ["inner xsep", "node-inner-sep"],
      ["minimum width", "node-minimum-width"],
      ["minimum height", "node-minimum-height"],
      ["node font", "node-font"],
      ["align", "node-text-align"],
      ["text width", "node-text-width"],
      ["draw opacity", "stroke-opacity"],
      ["fill opacity", "fill-opacity"],
      ["text opacity", "text-opacity"],
      ["step", "grid-step"],
      ["x step", "grid-xstep"],
      ["y step", "grid-ystep"],
      ["row sep", "matrix-row-sep"],
      ["column sep", "matrix-column-sep"]
    ];

    for (const [key, id] of aliases) {
      expect(propertyIdForOptionEntry(key)).toBe(id);
      expect(propertyIdForOptionEntry(key, new Set([id]))).toBe(id);
      expect(propertyIdForOptionEntry(key, new Set(["stroke-color"]))).toBeNull();
    }

    expect(propertyIdForOptionEntry("text", ["adornment-text-color"])).toBe("adornment-text-color");
    expect(propertyIdForOptionEntry("thick")).toBe("line-width");
    expect(propertyIdForOptionEntry("thick", ["stroke-color"])).toBeNull();
    expect(propertyIdForOptionEntry("dash phase")).toBe("dash-style");
    expect(propertyIdForOptionEntry("fill", ["matrix-fill-color"])).toBe("matrix-fill-color");
    expect(propertyIdForOptionEntry("draw", ["matrix-draw-color"])).toBe("matrix-draw-color");
    expect(propertyIdForOptionEntry("rounded corners", ["rounded-corners"])).toBe("rounded-corners");
    expect(propertyIdForOptionEntry("->", ["arrow-tip"])).toBe("arrow-tip");
    expect(propertyIdForOptionEntry("node-shape")).toBe("node-shape");
    expect(propertyIdForOptionEntry({ kind: "unknown", raw: "??", span: { from: 0, to: 2 } })).toBeNull();
  });

  it("exposes conflict/addable metadata and falls back for generic writes", () => {
    expect(candidateKeysForProperty("missing")).toEqual([]);
    expect(conflictKeysForProperty("node-inner-sep")).toEqual(["inner xsep", "inner ysep"]);
    expect(conflictKeysForProperty("missing")).toEqual([]);
    expect(addablePropertyKind("stroke-color")).toBe("color");
    expect(addablePropertyKind("missing")).toBeNull();

    expect(buildPropertyMutations({ key: "custom key", value: "42", clearKeys: [" draw ", "draw", ""] })).toEqual([
      {
        key: "custom key",
        value: "42",
        clearKeys: ["draw"],
        propertyId: undefined
      }
    ]);
    expect(buildPropertyMutations({ propertyId: "line-width", key: "not a width key", value: "1pt" })).toEqual([
      {
        key: "not a width key",
        value: "1pt",
        clearKeys: undefined,
        propertyId: "line-width"
      }
    ]);
    expect(buildPropertyMutations({ value: "ignored" })).toEqual([]);
  });

  it("builds set-property actions only for writable concrete targets", () => {
    const actions = buildSetPropertyActionsForTargets([
      { elementId: " n1 ", level: "command", key: "draw", propertyId: "stroke-color", writable: true },
      { elementId: "", level: "command", key: "fill", propertyId: "fill-color", writable: true },
      { elementId: "n2", level: "command", key: "fill", propertyId: "fill-color", writable: false }
    ], {
      value: "red",
      clearKeys: ["draw", " draw "]
    });

    expect(actions).toEqual([
      {
        kind: "setProperty",
        elementId: " n1 ",
        level: "command",
        key: "draw",
        value: "red",
        propertyId: "stroke-color",
        clearKeys: ["draw"]
      }
    ]);
  });

  it("assigns property ids for every typed mutation request", () => {
    const requests = [
      { kind: "fill-pattern", value: "grid" },
      { kind: "fill-shading", value: "axis" },
      { kind: "line-cap", value: "round" },
      { kind: "line-join", value: "bevel" },
      { kind: "line-width-value", value: "2pt" },
      { kind: "node-inner-sep", value: 4 },
      { kind: "node-shape", value: "circle" },
      { kind: "rounded-corners", enabled: false },
      { kind: "transform", current: { rotate: 0, xshift: 0, yshift: 0, xscale: 1, yscale: 1 }, key: "rotate", value: 45 },
      { kind: "transform", current: { rotate: 0, xshift: 0, yshift: 0, xscale: 1, yscale: 1 }, key: "xscale", value: 2 },
      { kind: "transform", current: { rotate: 0, xshift: 0, yshift: 0, xscale: 1, yscale: 1 }, key: "xshift", value: 3 },
      { kind: "transform", current: { rotate: 0, xshift: 0, yshift: 0, xscale: 1, yscale: 1 }, key: "yscale", value: 4 },
      { kind: "transform", current: { rotate: 0, xshift: 0, yshift: 0, xscale: 1, yscale: 1 }, key: "yshift", value: 5 }
    ] as const;

    for (const request of requests) {
      expect(buildPropertyMutationsFromRequest(request)[0]?.propertyId).toBeDefined();
    }
  });
});

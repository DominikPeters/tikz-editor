import { describe, expect, it } from "vitest";

import { diffSvgModels } from "../../packages/core/src/svg/patch.js";
import type { SvgRenderModel, SvgRenderPart, SvgViewBox } from "../../packages/core/src/svg/types.js";

describe("svg model diff", () => {
  it("emits a single upsert for one changed part when scoped by source hint", () => {
    const previous = modelFromParts([
      part("p:a", "source-a", 0, "<path d='M 0 0 L 1 0' />"),
      part("p:b", "source-b", 1, "<path d='M 0 1 L 1 1' />")
    ]);
    const next = modelFromParts([
      part("p:a", "source-a", 0, "<path d='M 0 0 L 1.5 0' />"),
      part("p:b", "source-b", 1, "<path d='M 0 1 L 1 1' />")
    ]);

    const ops = diffSvgModels(previous, next, {
      affectedSourceIds: ["source-a"]
    });
    expect(ops).toEqual([
      {
        kind: "upsertPart",
        part: next.parts[0],
        afterPartId: null
      }
    ]);
  });

  it("falls back to a full diff when scoped hints miss changes", () => {
    const previous = modelFromParts([
      part("p:a", "source-a", 0, "<path d='M 0 0 L 1 0' />"),
      part("p:b", "source-b", 1, "<path d='M 0 1 L 1 1' />")
    ]);
    const next = modelFromParts([
      part("p:a", "source-a", 0, "<path d='M 0 0 L 1 0' />"),
      part("p:b", "source-b", 1, "<path d='M 0 1 L 2 1' />")
    ]);

    const scoped = diffSvgModels(previous, next, {
      affectedSourceIds: ["source-a"]
    });
    const full = diffSvgModels(previous, next);
    expect(scoped).toEqual(full);
    expect(scoped).toContainEqual({
      kind: "upsertPart",
      part: next.parts[1],
      afterPartId: "p:a"
    });
  });

  it("emits add/remove/reorder operations for changed parts", () => {
    const previous = modelFromParts([
      part("p:a", "source-a", 0, "<path d='M 0 0 L 1 0' />"),
      part("p:b", "source-b", 1, "<path d='M 0 1 L 1 1' />")
    ]);
    const next = modelFromParts([
      part("p:b", "source-b", 0, "<path d='M 0 1 L 1 1' />"),
      part("p:c", "source-c", 1, "<circle cx='1' cy='1' r='1' />")
    ]);

    const ops = diffSvgModels(previous, next);
    expect(ops).toContainEqual({ kind: "removePart", partId: "p:a" });
    expect(ops).toContainEqual({
      kind: "upsertPart",
      part: next.parts[0],
      afterPartId: null
    });
    expect(ops).toContainEqual({
      kind: "upsertPart",
      part: next.parts[1],
      afterPartId: "p:b"
    });
  });

  it("emits setViewBox when the viewbox changes", () => {
    const previous = modelFromParts([part("p:a", "source-a", 0, "<path d='M 0 0 L 1 0' />")], {
      x: 0,
      y: 0,
      width: 10,
      height: 10
    });
    const next = modelFromParts([part("p:a", "source-a", 0, "<path d='M 0 0 L 1 0' />")], {
      x: 1,
      y: 0,
      width: 10,
      height: 10
    });

    const ops = diffSvgModels(previous, next);
    expect(ops).toContainEqual({
      kind: "setViewBox",
      viewBox: next.viewBox
    });
  });

  it("emits replaceDefs when defs fingerprint changes", () => {
    const previous = modelFromParts([part("p:a", "source-a", 0, "<path d='M 0 0 L 1 0' />")], undefined, ["<linearGradient id='g1' />"]);
    const next = modelFromParts([part("p:a", "source-a", 0, "<path d='M 0 0 L 1 0' />")], undefined, ["<linearGradient id='g2' />"]);

    const ops = diffSvgModels(previous, next);
    expect(ops).toContainEqual({
      kind: "replaceDefs",
      defs: next.defs,
      defsFingerprint: next.defsFingerprint
    });
  });

  it("appends only the glyph definitions a model adds, and never replaces or removes them", () => {
    const glyph = (id: string) => `<path id="tg-${id}" d="M0 0L1 1"/>`;
    const withGlyphs = (ids: string[], markup: string): SvgRenderModel =>
      ({ ...modelFromParts([part("p:a", "source-a", 0, markup)], undefined, ["<linearGradient id='g' />"]), glyphDefs: ids.map(glyph) });
    const previous = withGlyphs(["a", "b"], "<use href='#tg-a'/>");
    const grown = withGlyphs(["a", "b", "c"], "<use href='#tg-c'/>");
    expect(diffSvgModels(previous, grown).map((op) => op.kind)).toEqual(["appendGlyphDefs", "upsertPart"]);
    expect(diffSvgModels(previous, grown)[0]).toEqual({ kind: "appendGlyphDefs", defs: [glyph("c")] });
    // Glyphs a later model no longer uses stay defined: nothing to patch.
    expect(diffSvgModels(grown, withGlyphs(["a"], "<use href='#tg-a'/>")).map((op) => op.kind)).toEqual(["upsertPart"]);
  });

  it("falls back to replaceAll for invalid models", () => {
    const invalid = modelFromParts([
      part("p:a", "source-a", 0, "<path d='M 0 0 L 1 0' />"),
      part("p:a", "source-a", 1, "<path d='M 0 1 L 1 1' />")
    ]);
    const next = modelFromParts([part("p:c", "source-c", 0, "<circle cx='1' cy='1' r='1' />")]);

    const ops = diffSvgModels(invalid, next);
    expect(ops).toEqual([{ kind: "replaceAll", model: next }]);
  });
});

function modelFromParts(
  parts: SvgRenderPart[],
  viewBox: SvgViewBox = { x: 0, y: 0, width: 100, height: 100 },
  defs: string[] = []
): SvgRenderModel {
  return {
    viewBox,
    defs,
    defsFingerprint: defs.join(""),
    parts,
    diagnostics: []
  };
}

function part(
  partId: string,
  sourceId: string,
  order: number,
  markup: string
): SvgRenderPart {
  return {
    partId,
    sourceId,
    elementId: null,
    order,
    markup,
    fingerprint: markup
  };
}

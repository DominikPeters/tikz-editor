import { expect, expectTypeOf, test } from "vitest";
import type {
  TexHBoxOffsetX,
  TexHBoxOffsetY,
  TexHBoxLocalX,
  TexHBoxLocalY,
  TexLength,
  TexMuLength,
} from "../packages/core/src/text/tex/coordinates.js";
import type {
  TexMathItem,
  TexMathNucleus,
} from "../packages/core/src/text/tex/math/ir.js";
import {
  layoutTexMathList,
  parseTexMath,
  resolveMathGlyph,
} from "../packages/core/src/text/tex/math/index.js";

test("math layout exposes branded HBox geometry without changing numeric values", () => {
  const parsed = parseTexMath("x");
  const laidOut = layoutTexMathList(parsed.list);
  if (!laidOut.supported) {
    throw new Error("Expected simple glyph math to be supported.");
  }

  expectTypeOf(laidOut.hlist.width).toEqualTypeOf<TexLength>();
  expectTypeOf(laidOut.hlist.height).toEqualTypeOf<TexLength>();
  expectTypeOf(laidOut.hlist.depth).toEqualTypeOf<TexLength>();

  const item = laidOut.hlist.items[0];
  if (!item || item.kind !== "glyph") {
    throw new Error("Expected a glyph layout item.");
  }
  expectTypeOf(item.x).toEqualTypeOf<TexHBoxLocalX>();
  expectTypeOf(item.y).toEqualTypeOf<TexHBoxLocalY>();
  expectTypeOf(item.width).toEqualTypeOf<TexLength>();
  expect(item.x).toBe(0);
  expect(Number.isFinite(item.width)).toBe(true);

  const nucleus = parsed.list.items[0];
  if (nucleus?.kind !== "atom" || nucleus.nucleus.kind !== "glyph") {
    throw new Error("Expected a glyph nucleus.");
  }
  const resolved = resolveMathGlyph(nucleus.nucleus);
  if (!resolved) {
    throw new Error("Expected the glyph to resolve.");
  }
  expectTypeOf(resolved.xOffset).toEqualTypeOf<TexHBoxOffsetX>();
  expectTypeOf(resolved.yOffset).toEqualTypeOf<TexHBoxOffsetY>();
  expectTypeOf(resolved.advance).toEqualTypeOf<TexLength>();
});

test("math IR keeps TeX lengths, offsets, and mu dimensions distinct", () => {
  type PtKern = Extract<TexMathItem, { readonly kind: "kern"; readonly command: "kern" }>;
  type MuKern = Extract<TexMathItem, { readonly kind: "kern"; readonly command: "mkern" }>;
  type MuGlue = Extract<TexMathItem, { readonly kind: "mu-glue" }>;
  type Rule = Extract<TexMathNucleus, { readonly kind: "rule" }>;

  expectTypeOf<PtKern["widthPt"]>().toEqualTypeOf<TexLength>();
  expectTypeOf<MuKern["mu"]>().toEqualTypeOf<TexMuLength>();
  expectTypeOf<MuGlue["mu"]>().toEqualTypeOf<TexMuLength>();
  expectTypeOf<Rule["width"]>().toEqualTypeOf<TexLength>();
  expectTypeOf<Rule["raise"]>().toEqualTypeOf<TexHBoxOffsetY>();
});

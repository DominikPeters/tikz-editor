import type { CoordinateBrand } from "../../coords/scalars.js";

/** A TeX point extent: width, height, depth, advance, or spacing. */
export type TexLength = CoordinateBrand<"TexLength">;

/** Absolute inline-axis position in the root TeX vertical-list coordinate space. */
export type TexVListX = CoordinateBrand<"TexVListX">;

/** Inline-axis displacement relative to the containing TeX vertical list. */
export type TexVListLocalX = CoordinateBrand<"TexVListLocalX">;

/** Absolute block-axis position in the root TeX vertical-list coordinate space. */
export type TexVListY = CoordinateBrand<"TexVListY">;

/** Block-axis displacement relative to the containing TeX vertical list. */
export type TexVListLocalY = CoordinateBrand<"TexVListLocalY">;

/** Inline position in a paragraph line/report coordinate space. */
export type TexLineX = CoordinateBrand<"TexLineX">;

/** Inline displacement relative to the start of a paragraph line. */
export type TexLineLocalX = CoordinateBrand<"TexLineLocalX">;

/** Inline position relative to a TeX horizontal box. */
export type TexHBoxX = CoordinateBrand<"TexHBoxX">;

/** Vertical position relative to a TeX horizontal-box baseline. */
export type TexHBoxY = CoordinateBrand<"TexHBoxY">;

export function texLength(value: number): TexLength {
  return value as TexLength;
}

/**
 * Marks a number whose origin is the root TeX vertical list.
 * Keep calls at parsing, measurement, and report boundaries.
 */
export function texVListX(value: number): TexVListX {
  return value as TexVListX;
}

/** Marks an inline displacement relative to the current vertical-list box. */
export function texVListLocalX(value: number): TexVListLocalX {
  return value as TexVListLocalX;
}

export function texVListY(value: number): TexVListY {
  return value as TexVListY;
}

export function texVListLocalY(value: number): TexVListLocalY {
  return value as TexVListLocalY;
}

export function texLineX(value: number): TexLineX {
  return value as TexLineX;
}

export function texLineLocalX(value: number): TexLineLocalX {
  return value as TexLineLocalX;
}

export function texHBoxX(value: number): TexHBoxX {
  return value as TexHBoxX;
}

export function texHBoxY(value: number): TexHBoxY {
  return value as TexHBoxY;
}

/** Translates a root VList position by a child-local inline displacement. */
export function translateTexVListX(
  origin: TexVListX,
  offset: TexVListLocalX
): TexVListX {
  return texVListX(origin + offset);
}

/** Expresses a root VList position relative to a containing VList origin. */
export function texVListLocalXFromOrigin(
  position: TexVListX,
  origin: TexVListX
): TexVListLocalX {
  return texVListLocalX(position - origin);
}

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

/** Block-axis position in a paragraph line/report baseline coordinate space. */
export type TexLineY = CoordinateBrand<"TexLineY">;

/** Inline position in the root TeX horizontal-box coordinate space. */
export type TexHBoxX = CoordinateBrand<"TexHBoxX">;

/** Block-axis position in the root TeX horizontal-box baseline space. */
export type TexHBoxY = CoordinateBrand<"TexHBoxY">;

/** Inline position relative to the immediately containing TeX HList. */
export type TexHBoxLocalX = CoordinateBrand<"TexHBoxLocalX">;

/** Vertical position relative to the immediately containing TeX HList baseline. */
export type TexHBoxLocalY = CoordinateBrand<"TexHBoxLocalY">;

/** Signed inline displacement applied within a TeX horizontal box. */
export type TexHBoxOffsetX = CoordinateBrand<"TexHBoxOffsetX">;

/** Signed vertical displacement applied from a TeX horizontal-box baseline. */
export type TexHBoxOffsetY = CoordinateBrand<"TexHBoxOffsetY">;

/** A TeX math-unit length before conversion into points. */
export type TexMuLength = CoordinateBrand<"TexMuLength">;

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

export function texLineY(value: number): TexLineY {
  return value as TexLineY;
}

export function texHBoxX(value: number): TexHBoxX {
  return value as TexHBoxX;
}

export function texHBoxY(value: number): TexHBoxY {
  return value as TexHBoxY;
}

export function texHBoxLocalX(value: number): TexHBoxLocalX {
  return value as TexHBoxLocalX;
}

export function texHBoxLocalY(value: number): TexHBoxLocalY {
  return value as TexHBoxLocalY;
}

export function texHBoxOffsetX(value: number): TexHBoxOffsetX {
  return value as TexHBoxOffsetX;
}

export function texHBoxOffsetY(value: number): TexHBoxOffsetY {
  return value as TexHBoxOffsetY;
}

export function texMuLength(value: number): TexMuLength {
  return value as TexMuLength;
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

/** Translates a root VList block position by a child-local displacement. */
export function translateTexVListY(
  origin: TexVListY,
  offset: TexVListLocalY
): TexVListY {
  return texVListY(origin + offset);
}

/** Expresses a root VList block position relative to a containing VList origin. */
export function texVListLocalYFromOrigin(
  position: TexVListY,
  origin: TexVListY
): TexVListLocalY {
  return texVListLocalY(position - origin);
}

/** Flattens a child-HList-local inline position into the root HBox space. */
export function translateTexHBoxX(
  origin: TexHBoxX,
  local: TexHBoxLocalX
): TexHBoxX {
  return texHBoxX(origin + local);
}

/** Flattens a child-HList-local baseline position into the root HBox space. */
export function translateTexHBoxY(
  origin: TexHBoxY,
  local: TexHBoxLocalY
): TexHBoxY {
  return texHBoxY(origin + local);
}

/** Expresses a root HBox inline position relative to an HList origin. */
export function texHBoxLocalXFromOrigin(
  position: TexHBoxX,
  origin: TexHBoxX
): TexHBoxLocalX {
  return texHBoxLocalX(position - origin);
}

/** Expresses a root HBox baseline position relative to an HList origin. */
export function texHBoxLocalYFromOrigin(
  position: TexHBoxY,
  origin: TexHBoxY
): TexHBoxLocalY {
  return texHBoxLocalY(position - origin);
}

/** Repositions an HList-local inline coordinate by a signed displacement. */
export function offsetTexHBoxLocalX(
  position: TexHBoxLocalX,
  offset: TexHBoxOffsetX
): TexHBoxLocalX {
  return texHBoxLocalX(position + offset);
}

/** Repositions an HList-local baseline coordinate by a signed displacement. */
export function offsetTexHBoxLocalY(
  position: TexHBoxLocalY,
  offset: TexHBoxOffsetY
): TexHBoxLocalY {
  return texHBoxLocalY(position + offset);
}

/** Projects an HBox-root inline position into a paragraph-line coordinate space. */
export function projectTexHBoxXToLine(
  position: TexHBoxX,
  hboxOrigin: TexHBoxX,
  lineOrigin: TexLineX
): TexLineX {
  return texLineX(lineOrigin + position - hboxOrigin);
}

/** Projects an HBox-root block position into a paragraph-line coordinate space. */
export function projectTexHBoxYToLine(
  position: TexHBoxY,
  hboxOrigin: TexHBoxY,
  lineOrigin: TexLineY
): TexLineY {
  return texLineY(lineOrigin + position - hboxOrigin);
}

/** Projects a paragraph-line inline position into an HBox-root coordinate space. */
export function projectTexLineXToHBox(
  position: TexLineX,
  lineOrigin: TexLineX,
  hboxOrigin: TexHBoxX
): TexHBoxX {
  return texHBoxX(hboxOrigin + position - lineOrigin);
}

/** Projects a paragraph-line block position into an HBox-root coordinate space. */
export function projectTexLineYToHBox(
  position: TexLineY,
  lineOrigin: TexLineY,
  hboxOrigin: TexHBoxY
): TexHBoxY {
  return texHBoxY(hboxOrigin + position - lineOrigin);
}

/** Projects a paragraph-line inline position into the root VList coordinate space. */
export function projectTexLineXToVList(
  position: TexLineX,
  lineOrigin: TexLineX,
  vlistOrigin: TexVListX
): TexVListX {
  return texVListX(vlistOrigin + position - lineOrigin);
}

/** Projects a paragraph-line block position into the root VList coordinate space. */
export function projectTexLineYToVList(
  position: TexLineY,
  lineOrigin: TexLineY,
  vlistOrigin: TexVListY
): TexVListY {
  return texVListY(vlistOrigin + position - lineOrigin);
}

/** Projects a root-VList inline position into a paragraph-line coordinate space. */
export function projectTexVListXToLine(
  position: TexVListX,
  vlistOrigin: TexVListX,
  lineOrigin: TexLineX
): TexLineX {
  return texLineX(lineOrigin + position - vlistOrigin);
}

/** Projects a root-VList block position into a paragraph-line coordinate space. */
export function projectTexVListYToLine(
  position: TexVListY,
  vlistOrigin: TexVListY,
  lineOrigin: TexLineY
): TexLineY {
  return texLineY(lineOrigin + position - vlistOrigin);
}

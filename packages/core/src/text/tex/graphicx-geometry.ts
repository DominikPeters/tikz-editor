import { texLength, type TexLength } from "./coordinates.js";
import type { OptionListAst } from "../../options/types.js";

/**
 * Box geometry of graphics.sty's \Grot@box, \Gscale@box and \Gscale@@box,
 * shared by the \rotatebox family and \includegraphics's own key program.
 */
export type GraphicxMatrix = readonly [number, number, number, number, number, number];
export type GraphicxBoxExtent = { readonly width: number; readonly height: number; readonly depth: number };
export type GraphicxGeometry = { width: number; height: number; depth: number; matrix: GraphicxMatrix };
export type GraphicxTransformSpec =
  | { readonly kind: "rotate"; readonly angle: number; readonly options?: OptionListAst }
  | { readonly kind: "scale"; readonly x: number; readonly y: number }
  | { readonly kind: "resize"; readonly width: string; readonly height: string; readonly totalHeight: boolean; readonly keepAspectRatio?: boolean };

export const IDENTITY_GRAPHICX_MATRIX: GraphicxMatrix = [1, 0, 0, 1, 0, 0];

export const graphicxScaled = (n: number): TexLength => texLength(Math.round(n * 65536) / 65536);
/** TeX's `<factor>\dimen`: the factor's sp value truncates the product. */
export const graphicxFactorProduct = (length: number, factor: number): TexLength =>
  texLength(Math.trunc(Math.round(length * 65536) * Math.round(factor * 65536) / 65536) / 65536);

export const graphicxPoint = (m: GraphicxMatrix, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

export function graphicxBounds(m: GraphicxMatrix, x: number, y: number, width: number, height: number) {
  const corners = [graphicxPoint(m, x, y), graphicxPoint(m, x + width, y), graphicxPoint(m, x, y + height), graphicxPoint(m, x + width, y + height)];
  return { left: Math.min(...corners.map(p => p.x)), right: Math.max(...corners.map(p => p.x)), top: Math.min(...corners.map(p => p.y)), bottom: Math.max(...corners.map(p => p.y)) };
}

/** `outer ∘ inner`: apply `inner` first. */
export function composeGraphicxMatrices(outer: GraphicxMatrix, inner: GraphicxMatrix): GraphicxMatrix {
  return [
    outer[0] * inner[0] + outer[2] * inner[1],
    outer[1] * inner[0] + outer[3] * inner[1],
    outer[0] * inner[2] + outer[2] * inner[3],
    outer[1] * inner[2] + outer[3] * inner[3],
    outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
    outer[1] * inner[4] + outer[3] * inner[5] + outer[5],
  ];
}

/**
 * graphics.sty \Gscale@div: enlarges the numerator before integer division
 * and truncates the denominator independently. Direct floating division
 * does not reproduce the package's selected PDF matrix or box dimensions.
 */
export function graphicxScaleRatio(target: number, original: number): number {
  if (!original) throw new Error("Cannot resize a zero-extent box.");
  let numerator = Math.round(target * 65536);
  let count = numerator < 0 ? -65536 : 65536;
  numerator = Math.abs(numerator);
  if (numerator > 0) {
    while (count >= 2 && numerator < 8192 * 65536) {
      numerator *= 2;
      count = Math.trunc(count / 2);
    }
    const denominator = Math.trunc(Math.round(original * 65536) / count);
    if (!denominator) throw new Error("Cannot resize this box extent.");
    numerator = Math.trunc(numerator / denominator);
  }
  return Number((numerator / 65536).toFixed(5));
}

/** The transformed box's extent and the matrix from body to box coordinates (y down, baseline 0). */
export function graphicxTransformGeometry(
  spec: GraphicxTransformSpec,
  body: GraphicxBoxExtent,
  dimension: (raw: string) => number
): GraphicxGeometry {
  if (spec.kind !== "rotate") {
    let x = spec.kind === "scale" ? spec.x : spec.width.trim() === "!" ? undefined : graphicxScaleRatio(dimension(spec.width), body.width);
    let y = spec.kind === "scale" ? spec.y : spec.height.trim() === "!" ? undefined : graphicxScaleRatio(dimension(spec.height), spec.totalHeight ? body.height + body.depth : body.height);
    // \Gscale@box@dddd: keepaspectratio takes the smaller factor for both axes.
    if (spec.kind === "resize" && spec.keepAspectRatio && x !== undefined && y !== undefined) {
      if (x > y) x = y; else y = x;
    }
    const scaleX = x ?? y ?? 1;
    const scaleY = y ?? x ?? 1;
    const width = graphicxFactorProduct(body.width, Math.abs(scaleX));
    return { width, height: graphicxFactorProduct(scaleY >= 0 ? body.height : body.depth, Math.abs(scaleY)), depth: graphicxFactorProduct(scaleY >= 0 ? body.depth : body.height, Math.abs(scaleY)), matrix: [scaleX, 0, 0, scaleY, scaleX < 0 ? width : 0, 0] };
  }
  let pivotX: number = spec.options ? graphicxFactorProduct(body.width, .5) : 0;
  let pivotY: number = spec.options ? graphicxFactorProduct(body.height - body.depth, .5) : 0;
  let angle = spec.angle;
  for (const option of spec.options?.entries ?? []) {
    if (option.kind === "unknown") throw new Error("Unsupported rotation option.");
    const value = option.kind === "kv" ? option.valueRaw.trim().replace(/^\{(.*)\}$/u, "$1") : "c";
    if (option.key === "origin") for (const char of value) {
      if (char === "l") pivotX = 0; else if (char === "r") pivotX = body.width; else if (char === "t") pivotY = body.height; else if (char === "b") pivotY = -Number(body.depth); else if (char === "B") pivotY = 0; else if (char !== "c") throw new Error("Unsupported rotation origin.");
    }
    else if (option.key === "x") pivotX = dimension(value);
    else if (option.key === "y") pivotY = dimension(value);
    else if (option.key === "units" && Number.isFinite(Number(value)) && Number(value) !== 0) angle = spec.angle * 360 / Number(value);
    else throw new Error(`Unsupported rotation option ${option.key}.`);
  }
  const radians = angle * Math.PI / 180; const cosine = Math.cos(radians); const sine = Math.sin(radians);
  const rotation: GraphicxMatrix = [Math.abs(cosine) < 1e-12 ? 0 : cosine, Math.abs(sine) < 1e-12 ? 0 : -sine, Math.abs(sine) < 1e-12 ? 0 : sine, Math.abs(cosine) < 1e-12 ? 0 : cosine, 0, 0];
  const relative = graphicxBounds(rotation, -Number(pivotX), pivotY - body.height, body.width, body.height + body.depth);
  const pivot = graphicxPoint(rotation, pivotX, -Number(pivotY));
  const matrix: GraphicxMatrix = [rotation[0], rotation[1], rotation[2], rotation[3], -pivot.x - relative.left, -pivot.y - pivotY];
  return { width: graphicxScaled(relative.right - relative.left), height: graphicxScaled(-relative.top + pivotY), depth: graphicxScaled(relative.bottom - pivotY), matrix };
}

export function graphicxSvgMatrix(matrix: GraphicxMatrix, unitScale: number): string {
  return [...matrix.slice(0, 4), matrix[4] * unitScale, matrix[5] * unitScale].map(value => Math.abs(value) < 1e-12 ? 0 : Number(value.toFixed(10))).join(" ");
}

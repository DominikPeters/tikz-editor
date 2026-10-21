import type { NormalizedArrowTip } from "./types.js";

const STROKE_ONLY_KINDS = new Set(["bar", "hooks", "cm-rightarrow", "straight-barb", "arc-barb", "tee-barb", "rays"]);
const CAP_KINDS = new Set(["round-cap", "butt-cap", "triangle-cap"]);

export function resolveTipPaint(tip: NormalizedArrowTip, markerColor: string): {
  stroke: string;
  fill: string;
  strokeWidth: number;
  lineCap: "butt" | "round";
  lineJoin: "miter" | "round";
  miterLimit: number;
} {
  const color = tip.color ?? markerColor;
  const cap = CAP_KINDS.has(tip.kind);
  const strokeOnly = STROKE_ONLY_KINDS.has(tip.kind);
  const stroke = !cap && (strokeOnly || tip.open || tip.lineWidth > 0) ? color : "none";
  const fill = strokeOnly ? "none" : cap ? (tip.fill && tip.fill !== "none" ? tip.fill : color) : tip.fill ?? (tip.open ? "none" : color);
  return {
    stroke,
    fill,
    strokeWidth: stroke === "none" ? 0 : tip.lineWidth,
    lineCap: tip.round || tip.kind === "cm-rightarrow" || tip.kind === "round-cap" ? "round" : "butt",
    lineJoin: tip.round ? "round" : "miter",
    miterLimit: 10
  };
}

import { parseTexDimensionExpression } from "../text/tex/dimensions.js";

/** Only dimensions the column renderer resolves are exposed as draggable values. */
export function resolveBeamerColumnWidth(expression: string, textWidth: number, paperWidth: number): number | null {
  const dimension = parseTexDimensionExpression(expression);
  if (!dimension) return null;
  if (dimension.kind === "absolute") return Math.max(0, dimension.value);
  if (dimension.reference === "em" || dimension.reference === "ex") return null;
  return Math.max(0, dimension.factor * (dimension.reference === "paperwidth" ? paperWidth : textWidth));
}


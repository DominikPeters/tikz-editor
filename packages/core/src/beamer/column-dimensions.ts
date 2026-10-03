import { parseTexDimensionExpression } from "../text/tex/dimensions.js";

/** Only dimensions the column renderer resolves are exposed as draggable values. */
export function resolveBeamerColumnWidth(expression: string, textWidth: number, paperWidth: number): number | null {
  const dimension = parseTexDimensionExpression(expression);
  if (!dimension) return null;
  if (dimension.kind === "absolute") return Math.max(0, dimension.value);
  if (dimension.reference === "em" || dimension.reference === "ex") return null;
  return Math.max(0, dimension.factor * (dimension.reference === "paperwidth" ? paperWidth : textWidth));
}

/** Stock columns has n+1 hfill glues across the text area and both margins.
 * onlytextwidth/totalwidth remove the leading and final glues. */
export function resolveBeamerColumnPositions(params: {
  options?: string;
  widths: readonly number[];
  textWidth: number;
  paperWidth: number;
  textLeft: number;
  leftMargin: number;
  rightMargin: number;
}): number[] {
  const keys = new Map((params.options ?? "").split(",").map(option => {
    const [key, ...value] = option.split("=");
    return [key.trim(), value.join("=").trim()] as const;
  }));
  const totalwidth = keys.get("totalwidth");
  const explicit = totalwidth !== undefined || (keys.has("onlytextwidth") && keys.get("onlytextwidth") !== "false");
  const width = totalwidth === undefined ? params.textWidth
    : resolveBeamerColumnWidth(totalwidth, params.textWidth, params.paperWidth) ?? params.textWidth;
  const available = explicit ? width : width + params.leftMargin + params.rightMargin;
  const free = Math.max(0, available - params.widths.reduce((sum, width) => sum + width, 0));
  const glue = free / (explicit ? Math.max(1, params.widths.length - 1) : params.widths.length + 1);
  let x = params.textLeft + (explicit ? 0 : -params.leftMargin + glue);
  return params.widths.map(width => {
    const position = x;
    x += width + glue;
    return position;
  });
}

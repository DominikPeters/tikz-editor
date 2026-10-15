import { requireArrayValue } from "../../utils/collections.js";
import { layoutTexMathList, parseTexMath, renderTexMathHListSvgBody, TEX_MATH_SVG_UNITS_PER_PT } from "../../text/tex/math/index.js";
import type { CommandTable } from "./table.js";

/**
 * A rendered preview of a math completion (V2): the command set by the
 * math engine, as a standalone SVG in TeX's own fonts. Constructs show
 * with sample arguments (`\frac{x}{y}`), delimiter variants alone
 * (`\left(` as its parenthesis). Null for what has no picture of its own
 * (styles, spacing, user macros, text commands) or does not lay out.
 * Glyph outlines must be loaded: an outline still missing draws nothing.
 */
export function mathCompletionPreview(table: CommandTable, name: string): { readonly svg: string; readonly widthEm: number } | null {
  const variant = /^(?:left|right)(.+)$/u.exec(name);
  if (variant) {
    return render(requireArrayValue(variant, 1));
  }
  const schema = table.command(name, "math");
  // A math alphabet shows a letter in it (`\mathbb{R}`).
  const alphabet = schema?.category === "style" && name.startsWith("math");
  if (!schema || schema.userMacro || !(alphabet || PREVIEWED.has(schema.category))) {
    return null;
  }
  const samples = alphabet ? ["R"] : ["x", "y", "z"];
  let index = 0;
  const args = schema.args
    .filter((arg) => arg.kind === "mandatory" && arg.rendered)
    .map(() => `{${samples[index++ % samples.length]}}`)
    .join("");
  return render(`\\${name}${args}`);
}

const PREVIEWED = new Set(["symbol", "operator", "construct"]);

function render(source: string): { readonly svg: string; readonly widthEm: number } | null {
  const parsed = parseTexMath(source);
  if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return null;
  }
  const result = layoutTexMathList(parsed.list);
  if (!result.supported) {
    return null;
  }
  const { hlist } = result;
  const units = TEX_MATH_SVG_UNITS_PER_PT;
  const width = Number(hlist.width) * units;
  const height = Number(hlist.height) * units;
  const depth = Number(hlist.depth) * units;
  if (!(width > 0) || !(height + depth > 0)) {
    return null;
  }
  // A little room around the ink: a glyph's ink can stand past its box.
  const pad = 1.5 * units;
  const viewBox = [-pad, -height - pad, width + 2 * pad, height + depth + 2 * pad].map((value) => value.toFixed(1)).join(" ");
  const body = renderTexMathHListSvgBody(hlist);
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="currentColor">${body}</svg>`,
    // At 10pt to the em.
    widthEm: (width + 2 * pad) / units / 10,
  };
}

import type { NodeItem, Span, Statement } from "../ast/types.js";
import type { SceneElement, SceneText } from "../semantic/types.js";
import type { ImageCropPlacement } from "../beamer/deck-crop.js";
import { applyFragments, plainNumber, sourceSlice, tikz, type EditedSource, type FragmentEdit, type TikzFragment } from "./fragment.js";
import { shortestDecimal } from "./format.js";

/**
 * A node whose text is a single `\includegraphics`, as inserted images are:
 * resizing it scales the image's size keys rather than setting the node's
 * minimum size, which would only pad the picture.
 */
export type NodeGraphicsSize = {
  /** The numbers of the size keys graphicx reads (width, height, totalheight; else scale). */
  readonly values: readonly { readonly span: Span; readonly value: number }[];
  /** Where a natural-size image gets a `scale` key. */
  readonly insertScale?: { readonly at: number; readonly prefix: TikzFragment; readonly suffix: TikzFragment };
};

const COMMAND = /^(\s*\\includegraphics\*?\s*)(?:\[([^[\]]*)\])?(\s*\{[^{}]*\}\s*)$/u;
const NUMBER = /^(\s*\{?\s*)([+]?(?:\d+(?:\.\d*)?|\.\d+))(\s*(?:\\[a-zA-Z]+|[a-zA-Z]+)?)(\s*\}?\s*)$/u;
// pdftex and LuaTeX reject these; better leave such a node to the generic resize.
const REJECTED = new Set(["natwidth", "natheight", "bbllx", "bblly", "bburx", "bbury"]);

export function nodeGraphicsSize(source: string, textSpan: Span): NodeGraphicsSize | null {
  const match = COMMAND.exec(source.slice(textSpan.from, textSpan.to));
  if (!match) return null;
  const head = match[1] ?? "";
  const optional = match[2];
  if (optional === undefined) {
    return { values: [], insertScale: { at: textSpan.from + head.length, prefix: tikz`[scale=`, suffix: tikz`]` } };
  }
  const contentFrom = textSpan.from + head.length + 1;
  const entries = splitEntries(optional, contentFrom);
  if (entries.some((entry) => REJECTED.has(entry.key))) return null;
  const dimensions = entries.filter((entry) => entry.key === "width" || entry.key === "height" || entry.key === "totalheight");
  const sizes = dimensions.length > 0 ? dimensions : entries.filter((entry) => entry.key === "scale");
  const values: { span: Span; value: number }[] = [];
  for (const entry of sizes) {
    if (!entry.value || sizes.filter((other) => other.key === entry.key).length !== 1) return null;
    const number = NUMBER.exec(source.slice(entry.value.from, entry.value.to));
    if (!number) return null;
    const value = Number(number[2]);
    const unit = (number[3] ?? "").trim();
    // A dimension needs its unit; a scale is a bare number.
    if (!(value > 0) || !Number.isFinite(value) || (entry.key === "scale") !== (unit === "")) return null;
    const from = entry.value.from + (number[1] ?? "").length;
    values.push({ span: { from, to: from + (number[2] ?? "").length }, value });
  }
  if (values.length > 0) return { values };
  const contentTo = contentFrom + optional.length;
  return { values: [], insertScale: { at: contentTo, prefix: optional.trim() === "" ? tikz`scale=` : tikz`, scale=`, suffix: tikz`` } };
}

/**
 * The source with the image scaled by `factor` (both axes). `factorTolerance`
 * is how far the factor may be off: the pointer's tolerance over the distance
 * from the fixed point to the dragged corner. Each number is the shortest
 * decimal within it.
 */
export function scaleNodeGraphics(source: string, size: NodeGraphicsSize, factor: number, factorTolerance: number): EditedSource | null {
  if (!(factor > 0) || !Number.isFinite(factor)) return null;
  // Within tolerance of the current size is no change.
  if (Math.abs(factor - 1) <= factorTolerance) return null;
  const edits: FragmentEdit[] = size.values.map((value) => ({ span: value.span, fragment: formatScaled(source, value, factor, factorTolerance) }));
  if (size.insertScale) {
    const { at, prefix, suffix } = size.insertScale;
    edits.push({ span: { from: at, to: at }, fragment: tikz`${prefix}${plainNumber(Number(shortestDecimal(factor, factorTolerance)), "graphics-scale")}${suffix}` });
  }
  return applyFragments(source, edits);
}

function formatScaled(source: string, value: { span: Span; value: number }, factor: number, factorTolerance: number): TikzFragment {
  const next = Number(shortestDecimal(value.value * factor, value.value * factorTolerance));
  if (next === value.value) return sourceSlice(source, value.span);
  return plainNumber(next, "graphics-length", source[value.span.from] === ".");
}

type Entry = { key: string; value: Span | null };

/** Comma-separated `key=value` entries at brace depth 0, with absolute value spans. */
function splitEntries(text: string, offset: number): Entry[] {
  const entries: Entry[] = [];
  let depth = 0;
  let start = 0;
  const push = (end: number) => {
    const raw = text.slice(start, end);
    const equals = raw.indexOf("=");
    const key = (equals < 0 ? raw : raw.slice(0, equals)).trim();
    if (key) entries.push({ key, value: equals < 0 ? null : { from: offset + start + equals + 1, to: offset + end } });
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (char === "," && depth === 0) { push(index); start = index + 1; }
  }
  push(text.length);
  return entries;
}

/**
 * The `\includegraphics` command of the image node `elementId` (a `\node`
 * statement or a node on a path) when its text is that command alone, as
 * inserted images are; null for any other element.
 */
export function imageNodeCommandSpan(source: string, statements: readonly Statement[], elementId: string): Span | null {
  const node = findNode(statements, elementId);
  if (node?.textSource !== "group") return null;
  const text = source.slice(node.textSpan.from, node.textSpan.to);
  const match = COMMAND.exec(text);
  if (!match) return null;
  const leading = text.length - text.trimStart().length;
  return { from: node.textSpan.from + leading, to: node.textSpan.to - (text.length - text.trimEnd().length) };
}

function findNode(statements: readonly Statement[], id: string): NodeItem | null {
  for (const statement of statements) {
    if (statement.kind === "Scope") {
      const nested = findNode(statement.body, id);
      if (nested) return nested;
      continue;
    }
    if (statement.kind !== "Path") continue;
    const nodes = statement.items.filter((item): item is NodeItem => item.kind === "Node");
    const own = nodes.find((item) => item.id === id);
    if (own) return own;
    if (statement.id === id && statement.command === "node" && nodes.length === 1) return nodes[0] ?? null;
  }
  return null;
}

/**
 * Where an image node's picture is drawn, for cropping it in place: the
 * node's TeX text holds exactly that image, which fills the text block.
 * `toDrawn` maps world points to the space the caller draws and drags in (the
 * canvas's SVG coordinates, y down). Null for a rotated or transformed node,
 * whose picture is not an axis-aligned rectangle there.
 */
export function imageNodeCropPlacement(
  elements: readonly SceneElement[],
  elementId: string,
  commandSpan: Span,
  toDrawn: (x: number, y: number) => { readonly x: number; readonly y: number }
): ImageCropPlacement | null {
  const text = elements.find((element): element is SceneText => element.kind === "Text" && element.sourceRef.sourceId === elementId);
  if (!text || text.transform || Math.abs(text.rotation ?? 0) > 1e-9 || text.textRenderInfo?.mode !== "tex") return null;
  const placements = text.textRenderInfo.graphicsPlacements ?? [];
  const placement = placements.length === 1 ? placements[0] : undefined;
  const width = text.textBlockWidth;
  const height = text.textBlockHeight;
  if (!placement || width === undefined || height === undefined) return null;
  if (Math.abs(placement.bounds.width - width) > 0.05 || Math.abs(placement.bounds.height - height) > 0.05) return null;
  const topLeft = toDrawn(text.position.x - width / 2, text.position.y + height / 2);
  const bottomRight = toDrawn(text.position.x + width / 2, text.position.y - height / 2);
  return {
    id: elementId,
    sourceSpan: commandSpan,
    bounds: { x: topLeft.x, y: topLeft.y, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y },
    asset: placement.asset,
    options: placement.options,
  };
}

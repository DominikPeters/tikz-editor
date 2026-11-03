import { requireArrayValue } from "../utils/collections.js";
import type { Span } from "../ast/types.js";
import { EMPTY_FRAGMENT, layout, tikz, type TikzFragment } from "../edit/fragment.js";
import { parseOptionListRaw } from "../options/parse.js";
import { normalizeOptionValue } from "../semantic/style/option-utils.js";
import {
  concatMappedText,
  createMappedText,
  sliceMappedText,
  type MappedText,
} from "../text/source-map.js";
import {
  beamerEnvironmentBoundariesIn,
  beamerOptionalArgumentAfter,
  beamerSyntaxContext,
  type BeamerSyntaxContext,
} from "./syntax.js";
import type { BeamerParagraphLayout, BeamerRect } from "./types.js";

/**
 * A `tikzpicture` with `overlay` among its own options. PGF drops everything
 * it draws from the picture's size, so it is an empty box (pgfsys.code.tex,
 * `\pgfsys@typesetpicturebox`: `\leavevmode` and a 0pt box). TeX sets that box
 * in the paragraph around it, the box's place is the picture's origin, and
 * with `remember picture` the picture can reach the page through `current page`.
 */
export type BeamerOverlayPicture = {
  span: Span;
  rememberPicture: boolean;
  /** A `tikzlayer` environment: evaluate it with `BEAMER_TIKZ_LAYER_OPTIONS`. */
  tikzLayer?: true;
};

/**
 * The editor's drawing layer environment, defined in the preamble. `\par`
 * and `\nointerlineskip` make its empty box a line of its own that adds no
 * space (with Beamer's 0pt `\parskip`), wherever it stands: after text, a
 * list or a block (checked against LuaLaTeX). Its optional argument adds
 * picture options.
 */
export const BEAMER_TIKZ_LAYER_DEFINITION = tikz`\newenvironment{tikzlayer}[1][]
  {\par\nointerlineskip\begin{tikzpicture}[remember picture, overlay, shift={(current page.south west)}, #1]}
  {\end{tikzpicture}}`;
/** What a `tikzlayer` implies for the picture inside, before its own options. */
export const BEAMER_TIKZ_LAYER_OPTIONS = tikz`remember picture, overlay, shift={(current page.south west)}`;

const TIKZ_LAYER_DEFINITIONS = new RegExp([
  String.raw`\\(?:(?:re)?newenvironment|provideenvironment)\*?\s*\{\s*tikzlayer\s*\}`,
  String.raw`\\(?:New|Renew|Provide|Declare)DocumentEnvironment\s*\{\s*tikzlayer\s*\}`,
  String.raw`\\(?:[gex]?def|let|(?:re)?newcommand\*?|providecommand\*?|DeclareRobustCommand\*?)\s*\{?\s*\\(?:end)?tikzlayer(?![A-Za-z@])`,
].join("|"), "gu");
const withoutSpace = (text: string) => text.replace(/\s+/gu, "");
const OUR_DEFINITION = withoutSpace(BEAMER_TIKZ_LAYER_DEFINITION);
/** Whether a text is exactly the editor's `tikzlayer` definition (up to spacing). */
export function isBeamerTikzLayerDefinition(text: string): boolean {
  return withoutSpace(text) === OUR_DEFINITION;
}
let tikzLayerState: { source: string; state: BeamerTikzLayerState } | null = null;

/**
 * Whether `tikzlayer` is the editor's: "ours" when every definition of the
 * name in the document is exactly `BEAMER_TIKZ_LAYER_DEFINITION` (up to
 * spacing), "theirs" when another is (the environment is then the author's,
 * and not a drawing layer), "none" when nothing defines it.
 */
export type BeamerTikzLayerState = "ours" | "theirs" | "none";
export function beamerTikzLayerState(source: string): BeamerTikzLayerState {
  if (tikzLayerState?.source === source) return tikzLayerState.state;
  let state: BeamerTikzLayerState = "none";
  if (source.includes("tikzlayer")) {
    // Comments define nothing; blank them, keeping offsets.
    const code = source.replace(/(?<!\\)%[^\n]*/gu, comment => " ".repeat(comment.length));
    for (const match of code.matchAll(TIKZ_LAYER_DEFINITIONS)) {
      if (!withoutSpace(code.slice(match.index, match.index + BEAMER_TIKZ_LAYER_DEFINITION.length * 2)).startsWith(OUR_DEFINITION)) {
        state = "theirs";
        break;
      }
      state = "ours";
    }
  }
  tikzLayerState = { source, state };
  return state;
}

/** The empty box TeX sets for an overlay picture: `\rule` is `\leavevmode\hbox{\vrule}`. */
export const BEAMER_OVERLAY_PICTURE_BOX = String.raw`\rule{0pt}{0pt}`;

/**
 * The overlay pictures in a span, with the `tikzlayer` environments when they
 * are the editor's (`tikzLayer`, by default read from the context's source).
 */
export function beamerOverlayPicturesIn(
  context: BeamerSyntaxContext,
  span: Span,
  tikzLayer = beamerTikzLayerState(context.source) === "ours"
): BeamerOverlayPicture[] {
  const text = context.source.slice(span.from, span.to);
  if (!text.includes("tikzpicture") && !(tikzLayer && text.includes("tikzlayer"))) return [];
  const tokens = beamerEnvironmentBoundariesIn(context, span);
  const pictures: BeamerOverlayPicture[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const begin = requireArrayValue(tokens, index);
    if (begin.kind !== "begin" || !(begin.name === "tikzpicture" || (tikzLayer && begin.name === "tikzlayer"))) continue;
    let depth = 0;
    let endIndex = -1;
    for (let next = index; next < tokens.length; next += 1) {
      if (requireArrayValue(tokens, next).name !== begin.name) continue;
      depth += requireArrayValue(tokens, next).kind === "begin" ? 1 : -1;
      if (depth === 0) {
        endIndex = next;
        break;
      }
    }
    if (endIndex < 0) break;
    const end = requireArrayValue(tokens, endIndex);
    if (begin.name === "tikzlayer") {
      pictures.push({ span: { from: begin.span.from, to: end.span.to }, rememberPicture: true, tikzLayer: true });
      index = endIndex;
      continue;
    }
    const flags = pictureOptionBooleans(context, begin.span.to, end.span.from);
    if (flags.get("overlay")) {
      pictures.push({
        span: { from: begin.span.from, to: end.span.to },
        rememberPicture: flags.get("remember picture") ?? false,
      });
    }
    index = endIndex;
  }
  return pictures;
}

/** Whether a picture's source (`\begin{tikzpicture}…\end{tikzpicture}`) is an overlay picture. */
export function readBeamerOverlayPicture(
  context: BeamerSyntaxContext,
  span: Span,
  tikzLayer?: boolean
): BeamerOverlayPicture | null {
  return beamerOverlayPicturesIn(context, span, tikzLayer).find(
    (picture) => picture.span.from === span.from && picture.span.to === span.to
  ) ?? null;
}

/**
 * Sets each overlay picture in a paragraph's text as the empty box TeX sets
 * for it. The box keeps the picture's source range, so the laid-out
 * paragraph reports where the picture's origin is.
 */
export function projectBeamerOverlayPictureBoxes(mapped: MappedText, tikzLayer: boolean,
  /** The document's overlay pictures, found through the text's source map before parsing it. */
  documentPictures?: readonly BeamerOverlayPicture[]): MappedText {
  if (!mapped.text.includes("tikzpicture") && !(tikzLayer && mapped.text.includes("tikzlayer"))) return mapped;
  const pictures = (documentPictures && locateOverlayPictures(mapped, documentPictures, tikzLayer)) ??
    beamerOverlayPicturesIn(beamerSyntaxContext(mapped.text), { from: 0, to: mapped.text.length }, tikzLayer);
  if (pictures.length === 0) return mapped;
  const parts: MappedText[] = [];
  let cursor = 0;
  for (const picture of pictures) {
    parts.push(sliceMappedText(mapped, cursor, picture.span.from));
    const first = mapped.sourceMap.charOrigins[picture.span.from];
    const last = mapped.sourceMap.charOrigins[picture.span.to - 1];
    const box = picture.tikzLayer ? String.raw`\par\nointerlineskip` + BEAMER_OVERLAY_PICTURE_BOX : BEAMER_OVERLAY_PICTURE_BOX;
    if (first?.kind === "direct" && last?.kind === "direct") {
      const projection = { kind: "direct" as const, from: first.from, to: last.to };
      parts.push(createMappedText(
        box,
        Array.from({ length: box.length }, () => projection),
        Array.from({ length: box.length + 1 }, (_, index) => ({
          kind: "offset" as const,
          offset: index === box.length ? last.to : first.from,
        }))
      ));
    } else {
      parts.push(createMappedText(box, Array.from({ length: box.length }, () => ({
        kind: "generated" as const,
        reason: "Beamer overlay picture",
      }))));
    }
    cursor = picture.span.to;
  }
  parts.push(sliceMappedText(mapped, cursor, mapped.text.length));
  return concatMappedText(parts);
}

/**
 * The document's overlay pictures in a paragraph's text, where its source map
 * shows them; null unless every picture the text begins is one of them.
 */
function locateOverlayPictures(mapped: MappedText, documentPictures: readonly BeamerOverlayPicture[], tikzLayer: boolean): BeamerOverlayPicture[] | null {
  const origins = mapped.sourceMap.charOrigins;
  const byStart = new Map(documentPictures.map((picture) => [picture.span.from, picture]));
  const found: BeamerOverlayPicture[] = [];
  for (let index = 0; index < origins.length; index += 1) {
    const origin = origins[index];
    const picture = origin?.kind === "direct" ? byStart.get(origin.from) : undefined;
    if (!picture) continue;
    let end = index;
    while (end < origins.length) {
      const origin = origins[end];
      if (origin?.kind === "direct" && origin.to === picture.span.to) break;
      end += 1;
    }
    if (end === origins.length) return null;
    found.push({ ...picture, span: { from: index, to: end + 1 } });
    index = end;
  }
  for (const match of mapped.text.matchAll(/\\begin\s*\{(tikzpicture|tikzlayer)\}/gu)) {
    if (match[1] === "tikzlayer" && !tikzLayer) continue;
    if (!found.some((picture) => picture.span.from <= match.index && match.index < picture.span.to)) return null;
  }
  return found;
}

function pictureOptionBooleans(
  context: BeamerSyntaxContext,
  from: number,
  limit: number
): Map<string, boolean> {
  const options = beamerOptionalArgumentAfter(context, from, limit);
  if (!options) return new Map();
  const list = parseOptionListRaw(context.source.slice(options.span.from, options.span.to));
  const flags = new Map<string, boolean>();
  for (const entry of list.entries) {
    if (entry.kind === "unknown") continue;
    const key = entry.key.trim().replace(/\s+/gu, " ").replace(/^\/tikz\//u, "");
    if (key !== "overlay" && key !== "remember picture") continue;
    // PGF accepts true/false, and later occurrences override earlier ones.
    const value = entry.kind === "flag" ? "true" : normalizeOptionValue(entry.valueRaw);
    if (value === "true" || value === "false") flags.set(key, value === "true");
  }
  return flags;
}

/**
 * Where TeX set an overlay picture's box in a laid-out paragraph: the
 * picture's origin, in the paragraph's coordinates (pt, y down) offset by
 * `bounds`. Null when the paragraph did not set it (another paragraph's
 * picture, or one an overlay specification removed).
 */
export function beamerOverlayPictureOrigin(
  paragraph: BeamerParagraphLayout,
  bounds: BeamerRect,
  span: Span
): { x: number; y: number } | null {
  for (const line of paragraph.report.lines) {
    const segment = line.segments.find((candidate) =>
      Number(candidate.sourceStartRaw) === span.from && Number(candidate.sourceEndRaw) === span.to
    );
    if (!segment) continue;
    const placement = paragraph.vlistLayout.linePlacements.find((candidate) => candidate.lineIndex === line.lineIndex);
    if (!placement) return null;
    // As graphics placements: a line holding its list label starts at its own left edge.
    const lineRootX = line.segments.some((candidate) => candidate.role === "list-label")
      ? Number(line.xStart)
      : Math.max(Number(line.xStart), Number(placement.x));
    return {
      x: bounds.x + lineRootX + Number(segment.x) - Number(line.xStart),
      y: bounds.y + Number(placement.y) + Number(line.ascent),
    };
  }
  return null;
}

/** A new drawing layer: coordinates in cm from the page's lower-left corner. */
export const BEAMER_TIKZ_LAYER = tikz`\begin{tikzlayer}
\end{tikzlayer}`;
/** The same as a plain picture, where the document has a `tikzlayer` of its own. */
export const BEAMER_DRAWING_LAYER = tikz`\begin{tikzpicture}[remember picture, overlay, shift={(current page.south west)}]
\end{tikzpicture}`;
/** After text, a `%` line keeps the layer's box in the last paragraph. */
const COMMENT_JOIN = tikz`
%
`;
/** After a list or block, the box starts a paragraph without its baseline glue. */
const VERTICAL_JOIN = tikz`
\nointerlineskip
`;
/** Shows the layer on every step of a frame with `\pause`. */
const EVERY_STEP = tikz`\onslide<1->%
`;

/** Environments after whose end TeX is in vertical mode. */
const VERTICAL_ENDS = new Set(["itemize", "enumerate", "description", "block", "alertblock", "exampleblock", "columns", "center", "quote", "quotation", "figure", "table"]);

/**
 * Where a frame's new drawing layer goes, in order of preference, all at the
 * end of the frame's top level, where it must move none of the frame's text
 * (the caller checks by laying the frame out). First a `tikzlayer`, as a
 * paragraph of its own; `definesLayer` when the preamble does not define it
 * yet. Where the document has a `tikzlayer` of its own, a plain picture,
 * whose empty box must not set a line of its own (checked against LuaLaTeX):
 * after text a `%` line keeps it in the last paragraph; after a list or block
 * TeX is in vertical mode and the box starts a paragraph, and
 * `\nointerlineskip` drops that line's baseline glue. Last, a paragraph of its
 * own. After a `\pause`, `\onslide<1->` shows the layer on every step.
 */
export function beamerDrawingLayerInsertions(
  context: BeamerSyntaxContext,
  bodySpan: Span
): Array<{ at: number; text: TikzFragment; definesLayer?: true }> {
  const source = context.source;
  let at = bodySpan.to;
  while (at > bodySpan.from && /\s/u.test(source.charAt(at - 1))) at -= 1;
  // The last material, before trailing comment lines.
  let last = at;
  for (;;) {
    while (last > bodySpan.from && /\s/u.test(source.charAt(last - 1))) last -= 1;
    const lineStart = Math.max(source.lastIndexOf("\n", last - 1) + 1, bodySpan.from);
    if (last > bodySpan.from && /^\s*%/u.test(source.slice(lineStart, last))) last = lineStart;
    else break;
  }
  const covered = context.syntax.controlsIn({ from: bodySpan.from, to: at })
    .some(control => control.name === "pause" || control.name === "onslide");
  const reveal = covered ? EVERY_STEP : EMPTY_FRAGMENT;
  const paragraph = layout(at === bodySpan.from ? "\n" : "\n\n");
  const state = beamerTikzLayerState(source);
  const layers = state === "theirs" ? [] : [{ at, text: tikz`${paragraph}${reveal}${BEAMER_TIKZ_LAYER}`, ...(state === "none" && { definesLayer: true as const }) }];
  const alone = { at, text: tikz`${paragraph}${reveal}${BEAMER_DRAWING_LAYER}` };
  if (last === bodySpan.from) return [...layers, alone];
  const vertical = beamerEnvironmentBoundariesIn(context, bodySpan)
    .some(token => token.kind === "end" && token.span.to === last && VERTICAL_ENDS.has(token.name));
  return [...layers, { at, text: tikz`${vertical ? VERTICAL_JOIN : COMMENT_JOIN}${reveal}${BEAMER_DRAWING_LAYER}` }, alone];
}

/** An empty generated layer with the glue that joined it to the frame. */
export function beamerDrawingLayerRemovalSpan(source: string, span: Span): Span {
  const glue = /(?:\n%\n|\n\\nointerlineskip\n|\n\n?)(?:\\onslide<1->%\n)?$/u.exec(source.slice(0, span.from));
  return glue ? { from: glue.index, to: span.to } : span;
}

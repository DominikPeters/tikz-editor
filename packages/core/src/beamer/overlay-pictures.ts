import type { Span } from "../ast/types.js";
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
};

/** The empty box TeX sets for an overlay picture: `\rule` is `\leavevmode\hbox{\vrule}`. */
export const BEAMER_OVERLAY_PICTURE_BOX = String.raw`\rule{0pt}{0pt}`;

export function beamerOverlayPicturesIn(
  context: BeamerSyntaxContext,
  span: Span
): BeamerOverlayPicture[] {
  if (!context.source.slice(span.from, span.to).includes("tikzpicture")) return [];
  const tokens = beamerEnvironmentBoundariesIn(context, span);
  const pictures: BeamerOverlayPicture[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const begin = tokens[index];
    if (begin.kind !== "begin" || begin.name !== "tikzpicture") continue;
    let depth = 0;
    let endIndex = -1;
    for (let next = index; next < tokens.length; next += 1) {
      if (tokens[next].name !== "tikzpicture") continue;
      depth += tokens[next].kind === "begin" ? 1 : -1;
      if (depth === 0) {
        endIndex = next;
        break;
      }
    }
    if (endIndex < 0) break;
    const end = tokens[endIndex];
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
  span: Span
): BeamerOverlayPicture | null {
  return beamerOverlayPicturesIn(context, span).find(
    (picture) => picture.span.from === span.from && picture.span.to === span.to
  ) ?? null;
}

/**
 * Sets each overlay picture in a paragraph's text as the empty box TeX sets
 * for it. The box keeps the picture's source range, so the laid-out
 * paragraph reports where the picture's origin is.
 */
export function projectBeamerOverlayPictureBoxes(mapped: MappedText): MappedText {
  if (!mapped.text.includes("tikzpicture")) return mapped;
  const context = beamerSyntaxContext(mapped.text);
  const pictures = beamerOverlayPicturesIn(context, { from: 0, to: mapped.text.length });
  if (pictures.length === 0) return mapped;
  const parts: MappedText[] = [];
  let cursor = 0;
  for (const picture of pictures) {
    parts.push(sliceMappedText(mapped, cursor, picture.span.from));
    const first = mapped.sourceMap.charOrigins[picture.span.from];
    const last = mapped.sourceMap.charOrigins[picture.span.to - 1];
    const box = BEAMER_OVERLAY_PICTURE_BOX;
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
export const BEAMER_DRAWING_LAYER = String.raw`\begin{tikzpicture}[remember picture, overlay, shift={(current page.south west)}]` +
  "\n" + String.raw`\end{tikzpicture}`;

/** Environments after whose end TeX is in vertical mode. */
const VERTICAL_ENDS = new Set(["itemize", "enumerate", "description", "block", "alertblock", "exampleblock", "columns", "center", "quote", "quotation", "figure", "table"]);

/**
 * Where a frame's new drawing layer goes, in order of preference, all at the
 * end of the frame's top level. Its empty box must not set a line of its own,
 * which would move the frame's text (checked against LuaLaTeX). After text, a
 * `%` line keeps it in the last paragraph. After a list or block TeX is in
 * vertical mode and the box starts a paragraph; `\nointerlineskip` drops that
 * line's baseline glue, so with Beamer's 0pt `\parskip` it adds nothing. The
 * caller checks by laying the frame out. Last, a paragraph of its own. After
 * a `\pause`, `\onslide<1->` shows the layer on every step.
 */
export function beamerDrawingLayerInsertions(
  context: BeamerSyntaxContext,
  bodySpan: Span
): Array<{ at: number; text: string }> {
  const source = context.source;
  let at = bodySpan.to;
  while (at > bodySpan.from && /\s/u.test(source[at - 1])) at -= 1;
  // The last material, before trailing comment lines.
  let last = at;
  for (;;) {
    while (last > bodySpan.from && /\s/u.test(source[last - 1])) last -= 1;
    const lineStart = Math.max(source.lastIndexOf("\n", last - 1) + 1, bodySpan.from);
    if (last > bodySpan.from && /^\s*%/u.test(source.slice(lineStart, last))) last = lineStart;
    else break;
  }
  const covered = context.syntax.controlsIn({ from: bodySpan.from, to: at })
    .some(control => control.name === "pause" || control.name === "onslide");
  const layer = (covered ? "\\onslide<1->%\n" : "") + BEAMER_DRAWING_LAYER;
  const alone = { at, text: (at === bodySpan.from ? "\n" : "\n\n") + layer };
  if (last === bodySpan.from) return [alone];
  const vertical = beamerEnvironmentBoundariesIn(context, bodySpan)
    .some(token => token.kind === "end" && token.span.to === last && VERTICAL_ENDS.has(token.name));
  return [{ at, text: (vertical ? "\n\\nointerlineskip\n" : "\n%\n") + layer }, alone];
}

/** An empty generated layer with the glue that joined it to the frame. */
export function beamerDrawingLayerRemovalSpan(source: string, span: Span): Span {
  const glue = /(?:\n%\n|\n\\nointerlineskip\n|\n\n?)(?:\\onslide<1->%\n)?$/u.exec(source.slice(0, span.from));
  return glue ? { from: glue.index, to: span.to } : span;
}

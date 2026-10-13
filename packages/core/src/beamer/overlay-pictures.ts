import type { Span } from "../ast/types.js";
import { parseOptionListRaw } from "../options/parse.js";
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
    const flags = pictureOptionFlags(context, begin.span.to, end.span.from);
    if (flags.has("overlay")) {
      pictures.push({
        span: { from: begin.span.from, to: end.span.to },
        rememberPicture: flags.has("remember picture"),
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

function pictureOptionFlags(
  context: BeamerSyntaxContext,
  from: number,
  limit: number
): Set<string> {
  const options = beamerOptionalArgumentAfter(context, from, limit);
  if (!options) return new Set();
  const list = parseOptionListRaw(context.source.slice(options.span.from, options.span.to));
  return new Set(
    list.entries
      .filter((entry) => entry.kind === "flag")
      .map((entry) => entry.key.trim().replace(/\s+/gu, " "))
  );
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

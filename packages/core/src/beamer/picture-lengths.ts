import { matchTexSyntaxEnvironments } from "../text/tex/syntax-index.js";
import { resolveBeamerColumnWidth } from "./column-dimensions.js";
import type { BeamerLengthRegisters } from "./lengths.js";
import { beamerOptionalArgumentAfter, beamerRequiredArgumentAfter, type BeamerSyntaxContext } from "./syntax.js";
import type { Span } from "../ast/types.js";

/** `\textwidth` and `\linewidth` where a picture is set. */
export interface BeamerPictureLengths {
  textwidth: number;
  linewidth: number;
}

/**
 * The document lengths in effect at a picture inside the frame body (measured
 * in LuaLaTeX, design/pgfplots-behaviour.md Y4): a `column` or `minipage` sets
 * `\textwidth`, `\linewidth` and `\columnwidth` to its width; each `itemize` or
 * `enumerate` level narrows `\linewidth` by `\leftmargin` (2em in beamer), a
 * `description` by its 2cm label width plus `\labelsep` (.5em); blocks leave
 * both unchanged. `null` when an enclosing width is not resolvable, so the
 * caller can say so instead of guessing.
 */
export function beamerPictureLengths(params: {
  context: BeamerSyntaxContext;
  span: Span;
  bodySpan: Span;
  textWidth: number;
  paperWidth: number;
  emPt: number;
  listLeftMarginEmByDepth: readonly number[];
  registers?: BeamerLengthRegisters;
}): BeamerPictureLengths | null {
  const ancestors = [...matchTexSyntaxEnvironments(params.context.syntax).values()]
    .filter(env => env.begin.span.from >= params.bodySpan.from && env.end.span.to <= params.bodySpan.to
      && env.begin.span.from < params.span.from && env.end.span.to >= params.span.to)
    .sort((a, b) => a.begin.span.from - b.begin.span.from);
  let textwidth = params.textWidth;
  let linewidth = params.textWidth;
  let listDepth = 0;
  for (const env of ancestors) {
    if (env.name === "column" || env.name === "minipage") {
      // \begin{column}[placement]{width}, \begin{minipage}[pos][height][inner]{width}
      let cursor = env.begin.span.to;
      for (let index = 0; index < 3; index++) {
        const optional = beamerOptionalArgumentAfter(params.context, cursor, env.contentSpan.to);
        if (!optional) break;
        cursor = optional.span.to;
      }
      const dimension = beamerRequiredArgumentAfter(params.context, cursor, env.contentSpan.to);
      if (!dimension) return null;
      const reference = /\\linewidth\b/u.test(dimension.value) ? linewidth : textwidth;
      const width = resolveBeamerColumnWidth(dimension.value, reference, params.paperWidth, params.registers);
      if (width === null) return null;
      textwidth = width;
      linewidth = width;
      listDepth = 0;
    } else if (env.name === "itemize" || env.name === "enumerate") {
      const em = params.listLeftMarginEmByDepth[Math.min(listDepth, params.listLeftMarginEmByDepth.length - 1)] ?? 2;
      linewidth -= em * params.emPt;
      listDepth++;
    } else if (env.name === "description") {
      linewidth -= (2 / 2.54) * 72.27 + .5 * params.emPt;
      listDepth++;
    }
  }
  return { textwidth, linewidth };
}

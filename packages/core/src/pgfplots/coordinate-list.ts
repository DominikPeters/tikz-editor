import type { PlotCoordinateError, PlotCoordinatePoint, PlotSourceText, Span } from "../ast/types.js";

export type CoordinateListReading = {
  points: PlotCoordinatePoint[];
  unparsed: PlotSourceText[];
};

/**
 * Reads the content of `\addplot coordinates {…}` between `from` and `to` in
 * `source`: points `(x,y)` or `(x,y,z)`, each optionally followed by error
 * parts `+- (ex,ey)`, `+= (…)`, `-= (…)` and then `[meta]`. Every part keeps
 * its exact span. `%` comments are skipped as TeX skips them; an empty line
 * (one holding only spaces) marks a jump before the next point.
 *
 * Components are split at commas outside braces and parentheses, and kept as
 * written, so `({sin(0.5)},{\h*8})` and symbolic `(Jan,3)` both read.
 */
export function readCoordinateList(source: string, from: number, to: number): CoordinateListReading {
  const points: PlotCoordinatePoint[] = [];
  const unparsed: PlotSourceText[] = [];
  let cursor = from;
  let afterEmptyLine = false;
  let junkFrom: number | null = null;

  const flushJunk = (end: number): void => {
    if (junkFrom === null) {
      return;
    }
    const span = trimSpan(source, { from: junkFrom, to: end });
    if (span.to > span.from) {
      unparsed.push({ raw: source.slice(span.from, span.to), span });
    }
    junkFrom = null;
  };

  while (cursor < to) {
    const gap = skipGap(source, cursor, to);
    if (gap.emptyLine) {
      afterEmptyLine = true;
    }
    if (gap.to > cursor) {
      flushJunk(cursor);
      cursor = gap.to;
      continue;
    }
    if (source[cursor] !== "(") {
      junkFrom ??= cursor;
      cursor += source[cursor] === "\\" ? Math.min(2, to - cursor) : 1;
      continue;
    }
    flushJunk(cursor);
    const coordinate = readParenthesized(source, cursor, to);
    let end = coordinate.span.to;
    const errors: PlotCoordinateError[] = [];
    let meta: PlotCoordinatePoint["meta"];
    for (;;) {
      const next = skipGap(source, end, to);
      if (next.emptyLine) {
        break;
      }
      const operator = source.slice(next.to, next.to + 2);
      if (operator === "+-" || operator === "+=" || operator === "-=") {
        const afterOperator = skipGap(source, next.to + 2, to);
        if (source[afterOperator.to] !== "(" || afterOperator.emptyLine) {
          break;
        }
        const error = readParenthesized(source, afterOperator.to, to);
        errors.push({
          kind: operator,
          span: { from: next.to, to: error.span.to },
          operatorSpan: { from: next.to, to: next.to + 2 },
          coordinateSpan: error.span,
          components: error.components
        });
        end = error.span.to;
        continue;
      }
      if (source[next.to] === "[" && meta === undefined) {
        const bracketEnd = readBalanced(source, next.to, to, "[", "]");
        const contentTo = source[bracketEnd - 1] === "]" ? bracketEnd - 1 : bracketEnd;
        const contentSpan = trimSpan(source, { from: next.to + 1, to: contentTo });
        meta = {
          raw: source.slice(contentSpan.from, contentSpan.to),
          span: contentSpan,
          bracketSpan: { from: next.to, to: bracketEnd }
        };
        end = bracketEnd;
        continue;
      }
      break;
    }
    points.push({
      index: points.length,
      span: { from: coordinate.span.from, to: end },
      coordinateSpan: coordinate.span,
      components: coordinate.components,
      errors,
      ...(meta ? { meta } : {}),
      afterEmptyLine
    });
    afterEmptyLine = false;
    cursor = end;
  }
  flushJunk(to);
  return { points, unparsed };
}

/** Whitespace and comments from `from`; whether they hold an empty line. */
function skipGap(source: string, from: number, to: number): { to: number; emptyLine: boolean } {
  let cursor = from;
  let emptyLine = false;
  // A newline ends the current line; a second one with only spaces between is an empty line.
  let lineBlank = false;
  while (cursor < to) {
    const char = source[cursor];
    if (char === "%") {
      while (cursor < to && source[cursor] !== "\n") {
        cursor += 1;
      }
      // TeX drops the comment with its newline; what follows starts a line.
      if (cursor < to) {
        cursor += 1;
      }
      lineBlank = true;
      continue;
    }
    if (char === "\n") {
      if (lineBlank) {
        emptyLine = true;
      }
      lineBlank = true;
      cursor += 1;
      continue;
    }
    if (char === " " || char === "\t" || char === "\r") {
      cursor += 1;
      continue;
    }
    break;
  }
  return { to: cursor, emptyLine };
}

/** `( … )` at `from`, components split at top-level commas. An unclosed one runs to `to`. */
function readParenthesized(source: string, from: number, to: number): { span: Span; components: PlotSourceText[] } {
  const components: PlotSourceText[] = [];
  let depth = 0;
  let componentFrom = from + 1;
  let cursor = from;
  const pushComponent = (end: number): void => {
    const span = trimSpan(source, { from: componentFrom, to: end });
    components.push({ raw: source.slice(span.from, span.to), span });
  };
  while (cursor < to) {
    const char = source[cursor];
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (char === "%") {
      while (cursor < to && source[cursor] !== "\n") {
        cursor += 1;
      }
      continue;
    }
    if (char === "{") {
      cursor = readBalanced(source, cursor, to, "{", "}");
      continue;
    }
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        pushComponent(cursor);
        return { span: { from, to: cursor + 1 }, components };
      }
    } else if (char === "," && depth === 1) {
      pushComponent(cursor);
      componentFrom = cursor + 1;
    }
    cursor += 1;
  }
  pushComponent(Math.min(cursor, to));
  return { span: { from, to: Math.min(cursor, to) }, components };
}

/** The end of a balanced `open … close` group at `from` (braces inside a bracket group nest too). */
function readBalanced(source: string, from: number, to: number, open: string, close: string): number {
  let depth = 0;
  let cursor = from;
  while (cursor < to) {
    const char = source[cursor];
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (char === "%") {
      while (cursor < to && source[cursor] !== "\n") {
        cursor += 1;
      }
      continue;
    }
    if (open !== "{" && char === "{") {
      cursor = readBalanced(source, cursor, to, "{", "}");
      continue;
    }
    if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return cursor + 1;
      }
    }
    cursor += 1;
  }
  return Math.min(cursor, to);
}

function trimSpan(source: string, span: Span): Span {
  let { from, to } = span;
  while (from < to && /\s/u.test(source[from] ?? "")) {
    from += 1;
  }
  while (to > from && /\s/u.test(source[to - 1] ?? "")) {
    to -= 1;
  }
  return { from, to };
}

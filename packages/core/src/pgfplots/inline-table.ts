import type { PlotSourceText, Span } from "../ast/types.js";

/**
 * How cells are separated, after the documented `/pgfplots/table/col sep`
 * choices. `space` means any run of spaces and tabs.
 */
export type InlineTableColumnSeparator = "space" | "tab" | "comma" | "colon" | "semicolon" | "ampersand";

export type InlineTableOptions = {
  /** `row sep=newline` (the default) or `row sep=\\`. */
  rowSeparator?: "newline" | "\\\\";
  columnSeparator?: InlineTableColumnSeparator;
  /**
   * `header=true|false`, or the default: the first data line is a header
   * when one of its cells is not a number.
   */
  header?: boolean | "auto";
};

export type InlineTableRow = {
  /** The row's text, without its separator. */
  span: Span;
  cells: PlotSourceText[];
  /** An empty line comes before this row: a jump in the plot (compat 1.4+). */
  afterEmptyLine: boolean;
};

export type InlineTableReading = {
  /** Column names, when the first data line is a header. */
  header?: InlineTableRow;
  rows: InlineTableRow[];
  /** Lines starting with `%` or `#`, which the manual says are ignored. */
  comments: Span[];
};

const SEPARATOR_CHARS: Record<Exclude<InlineTableColumnSeparator, "space">, string> = {
  tab: "\t",
  comma: ",",
  colon: ":",
  semicolon: ";",
  ampersand: "&"
};

/**
 * Reads inline `\addplot table {…}` data between `from` and `to` in `source`
 * into rows and cells with their spans, as the manual describes the format:
 * rows end at newlines (or at `\\` with `row sep=\\`), cells are separated by
 * spaces unless `col sep` says otherwise, lines starting with `%` or `#` are
 * comments, and the first line is a header when a cell in it is not a number.
 * Braces group a cell's text (`{a b}` is one cell).
 */
export function readInlineTable(source: string, from: number, to: number, options: InlineTableOptions = {}): InlineTableReading {
  const rowSeparator = options.rowSeparator ?? "newline";
  const columnSeparator = options.columnSeparator ?? "space";
  const comments: Span[] = [];
  const lines: Array<{ span: Span; afterEmptyLine: boolean }> = [];
  let afterEmptyLine = false;
  let sawRow = false;

  for (const line of splitRows(source, from, to, rowSeparator)) {
    const trimmed = trimSpan(source, line);
    if (trimmed.from === trimmed.to) {
      // A blank line in a newline-separated table is an empty line; leading ones before the first row are not jumps.
      if (sawRow && rowSeparator === "newline") {
        afterEmptyLine = true;
      }
      continue;
    }
    const first = source[trimmed.from];
    if (first === "%" || first === "#") {
      comments.push(trimmed);
      continue;
    }
    // TeX drops a `%` comment when it reads the argument, so it ends the row's text.
    const content = trimSpan(source, { from: trimmed.from, to: commentStart(source, trimmed) });
    if (content.from === content.to) {
      comments.push(trimmed);
      continue;
    }
    lines.push({ span: content, afterEmptyLine });
    afterEmptyLine = false;
    sawRow = true;
  }

  const rows = lines.map((line): InlineTableRow => ({
    span: line.span,
    cells: splitCells(source, line.span, columnSeparator),
    afterEmptyLine: line.afterEmptyLine
  }));
  const headerChoice = options.header ?? "auto";
  const first = rows[0];
  const isHeader = first !== undefined && (headerChoice === true || (headerChoice === "auto" && first.cells.some((cell) => !isTableNumber(cell.raw))));
  if (isHeader) {
    return { header: first, rows: rows.slice(1), comments };
  }
  return { rows, comments };
}

/**
 * Whether a cell reads as a number for header detection: a decimal or
 * scientific number, or the documented placeholders `nan` and `inf`.
 */
export function isTableNumber(raw: string): boolean {
  const text = raw.trim();
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/u.test(text) || /^[+-]?(?:nan|inf|NaN|Inf|INF)$/u.test(text);
}

function splitRows(source: string, from: number, to: number, separator: "newline" | "\\\\"): Span[] {
  const rows: Span[] = [];
  let rowFrom = from;
  let depth = 0;
  for (let cursor = from; cursor < to; cursor += 1) {
    const char = source[cursor];
    if (char === "\\") {
      if (separator === "\\\\" && source[cursor + 1] === "\\" && depth === 0) {
        rows.push({ from: rowFrom, to: cursor });
        cursor += 1;
        rowFrom = cursor + 1;
        continue;
      }
      cursor += 1;
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth = Math.max(0, depth - 1);
    } else if (char === "\n" && depth === 0 && separator === "newline") {
      rows.push({ from: rowFrom, to: source[cursor - 1] === "\r" ? cursor - 1 : cursor });
      rowFrom = cursor + 1;
    }
  }
  rows.push({ from: rowFrom, to });
  if (separator === "\\\\") {
    // With `row sep=\\` newlines are spaces; comment lines are still read per line.
    return rows.flatMap((row) => splitCommentLines(source, row));
  }
  return rows;
}

/** Within a `\\`-separated row, lines that are comments are split off so they can be dropped. */
function splitCommentLines(source: string, row: Span): Span[] {
  const parts: Span[] = [];
  let lineFrom = row.from;
  let content: Span | null = null;
  for (let cursor = row.from; cursor <= row.to; cursor += 1) {
    if (cursor < row.to && source[cursor] !== "\n") {
      continue;
    }
    const line = trimSpan(source, { from: lineFrom, to: cursor });
    const first = source[line.from];
    if (line.from < line.to && (first === "%" || first === "#")) {
      parts.push(line);
    } else if (line.from < line.to) {
      content = content ? { from: content.from, to: line.to } : line;
    }
    lineFrom = cursor + 1;
  }
  if (content) {
    parts.push(content);
  }
  return parts.sort((left, right) => left.from - right.from);
}

function splitCells(source: string, row: Span, separator: InlineTableColumnSeparator): PlotSourceText[] {
  const cells: PlotSourceText[] = [];
  const push = (span: Span): void => {
    const trimmed = trimSpan(source, span);
    cells.push({ raw: source.slice(trimmed.from, trimmed.to), span: trimmed });
  };
  let depth = 0;
  let cellFrom: number | null = separator === "space" ? null : row.from;
  for (let cursor = row.from; cursor < row.to; cursor += 1) {
    const char = source[cursor] ?? "";
    if (char === "\\") {
      cellFrom ??= cursor;
      cursor += 1;
      continue;
    }
    if (char === "%") {
      // A comment inside a `\\`-separated row: it runs to the end of its line.
      if (cellFrom !== null && separator === "space") {
        push({ from: cellFrom, to: cursor });
        cellFrom = null;
      }
      while (cursor + 1 < row.to && source[cursor + 1] !== "\n") {
        cursor += 1;
      }
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth = Math.max(0, depth - 1);
    }
    if (depth > 0 || char === "{" || char === "}") {
      cellFrom ??= cursor;
      continue;
    }
    if (separator === "space") {
      if (char === " " || char === "\t" || char === "\n" || char === "\r") {
        if (cellFrom !== null) {
          push({ from: cellFrom, to: cursor });
          cellFrom = null;
        }
      } else {
        cellFrom ??= cursor;
      }
      continue;
    }
    if (char === SEPARATOR_CHARS[separator]) {
      push({ from: cellFrom ?? cursor, to: cursor });
      cellFrom = cursor + 1;
    }
  }
  if (cellFrom !== null) {
    push({ from: cellFrom, to: row.to });
  }
  return cells;
}

/** Where an unescaped `%` starts in the span, or its end. */
function commentStart(source: string, span: Span): number {
  for (let cursor = span.from; cursor < span.to; cursor += 1) {
    if (source[cursor] === "\\") {
      cursor += 1;
    } else if (source[cursor] === "%") {
      return cursor;
    }
  }
  return span.to;
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

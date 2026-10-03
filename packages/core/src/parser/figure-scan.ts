import {
  readTexBalancedDelimited,
  readTexControlSequence,
  readTexEnvironmentDelimiter,
  skipTexComment,
  skipTexVerbatim,
  skipTexWhitespaceAndComments
} from "./tex-lexical.js";

export type ScannedFigure = {
  span: { from: number; to: number };
  beginSpan: { from: number; to: number };
  endSpan: { from: number; to: number };
  isTemplate: boolean;
};

type FigureCandidate = Omit<ScannedFigure, "isTemplate"> & {
  containsUnresolvedPlaceholder: boolean;
};

export function scanTikzFigures(source: string): ScannedFigure[] {
  const candidates: FigureCandidate[] = [];
  let hasPlaceholderCandidate = false;
  let cursor = 0;
  let begin: { from: number; to: number; name: string } | null = null;

  while (cursor < source.length) {
    if (source.charAt(cursor) === "%") {
      cursor = skipTexComment(source, cursor);
      continue;
    }
    const command = readTexControlSequence(source, cursor);
    if (!command) {
      cursor += 1;
      continue;
    }
    cursor = command.to;
    const verbatimEnd = skipTexVerbatim(source, command);
    if (verbatimEnd !== null) {
      cursor = verbatimEnd;
      continue;
    }
    const environment = readTexEnvironmentDelimiter(source, command.from);
    if (!environment) {
      continue;
    }
    cursor = environment.to;
    if (environment.name !== "tikzpicture" && environment.name !== "tikzpicture*") {
      continue;
    }
    if (environment.kind === "begin") {
      // Preserve the existing recovery boundary for malformed nested pictures.
      begin ??= environment;
      continue;
    }
    if (environment.name !== begin?.name) {
      continue;
    }
    const inner = source.slice(begin.to, environment.from);
    const containsUnresolvedPlaceholder = containsUnresolvedMacroPlaceholder(inner);
    hasPlaceholderCandidate ||= containsUnresolvedPlaceholder;

    candidates.push({
      span: { from: begin.from, to: environment.to },
      beginSpan: { from: begin.from, to: begin.to },
      endSpan: { from: environment.from, to: environment.to },
      containsUnresolvedPlaceholder
    });
    begin = null;
  }

  if (!hasPlaceholderCandidate) {
    return candidates.map(({ containsUnresolvedPlaceholder: _containsUnresolvedPlaceholder, ...figure }) => ({
      ...figure,
      isTemplate: false
    }));
  }

  const macroBodySpans = collectMacroDefinitionBodySpans(source);
  return candidates.map(({ containsUnresolvedPlaceholder, ...figure }) => ({
    ...figure,
    isTemplate: containsUnresolvedPlaceholder && isInsideAnySpan(figure.beginSpan.from, macroBodySpans)
  }));
}

function collectMacroDefinitionBodySpans(source: string): Array<{ from: number; to: number }> {
  const spans: Array<{ from: number; to: number }> = [];
  let cursor = 0;

  while (cursor < source.length) {
    const char = source.charAt(cursor);
    if (char === "%") {
      cursor = skipTexComment(source, cursor);
      continue;
    }
    if (char !== "\\") {
      cursor += 1;
      continue;
    }

    const command = readTexControlSequence(source, cursor);
    if (!command) {
      cursor += 1;
      continue;
    }
    cursor = command.to;

    if (command.raw === "\\def") {
      const body = tryReadDefBodySpan(source, cursor);
      if (body) {
        spans.push(body);
        cursor = body.to + 1;
      }
      continue;
    }

    if (
      command.raw === "\\newcommand" ||
      command.raw === "\\renewcommand" ||
      command.raw === "\\providecommand" ||
      command.raw === "\\DeclareRobustCommand" ||
      command.raw === "\\DeclareMathOperator"
    ) {
      const body = tryReadNewCommandBodySpan(source, cursor);
      if (body) {
        spans.push(body);
        cursor = body.to + 1;
      }
      continue;
    }
  }

  return spans;
}

function containsUnresolvedMacroPlaceholder(source: string): boolean {
  let cursor = 0;
  while (cursor < source.length) {
    const char = source.charAt(cursor);

    if (char === "%") {
      cursor = skipTexComment(source, cursor);
      continue;
    }

    if (char === "\\") {
      cursor = Math.min(source.length, cursor + 2);
      continue;
    }

    if (char === "#") {
      const next = source.charAt(cursor + 1);
      if (next === "#") {
        cursor += 2;
        continue;
      }
      if (/[0-9]/u.test(next)) {
        return true;
      }
    }

    cursor += 1;
  }

  return false;
}

function tryReadDefBodySpan(source: string, fromCursor: number): { from: number; to: number } | null {
  let cursor = skipTexWhitespaceAndComments(source, fromCursor);
  const name = readTexControlSequence(source, cursor);
  if (!name) {
    return null;
  }
  cursor = name.to;

  while (cursor < source.length) {
    cursor = skipTexWhitespaceAndComments(source, cursor);
    const char = source.charAt(cursor);
    if (char === "{") {
      const group = readTexBalancedDelimited(source, cursor, "{", "}");
      return group ? { from: group.from + 1, to: group.to - 1 } : null;
    }
    if (char === "\\") {
      const control = readTexControlSequence(source, cursor);
      if (!control) {
        return null;
      }
      cursor = control.to;
      continue;
    }
    cursor += 1;
  }
  return null;
}

function tryReadNewCommandBodySpan(source: string, fromCursor: number): { from: number; to: number } | null {
  let cursor = skipTexWhitespaceAndComments(source, fromCursor);
  if (source.charAt(cursor) === "*") {
    cursor += 1;
  }
  cursor = skipTexWhitespaceAndComments(source, cursor);

  const directName = readTexControlSequence(source, cursor);
  if (directName) {
    cursor = directName.to;
  } else {
    const nameGroup = readTexBalancedDelimited(source, cursor, "{", "}");
    if (!nameGroup) {
      return null;
    }
    cursor = nameGroup.to;
  }

  cursor = skipTexWhitespaceAndComments(source, cursor);
  const arityGroup = readTexBalancedDelimited(source, cursor, "[", "]");
  if (arityGroup) {
    cursor = arityGroup.to;
  }

  cursor = skipTexWhitespaceAndComments(source, cursor);
  const optionalGroup = readTexBalancedDelimited(source, cursor, "[", "]");
  if (optionalGroup) {
    cursor = optionalGroup.to;
  }

  cursor = skipTexWhitespaceAndComments(source, cursor);
  const body = readTexBalancedDelimited(source, cursor, "{", "}");
  if (!body) {
    return null;
  }
  return { from: body.from + 1, to: body.to - 1 };
}

function isInsideAnySpan(offset: number, spans: readonly { from: number; to: number }[]): boolean {
  for (const span of spans) {
    if (offset >= span.from && offset <= span.to) {
      return true;
    }
  }
  return false;
}

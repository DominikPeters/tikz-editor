import type { Span } from "../ast/types.js";

export type TexControlSequence = Span & { raw: string };
export type TexEnvironmentDelimiter = Span & {
  kind: "begin" | "end";
  name: string;
};

/** Read one ordinary-catcode control word or escaped control symbol. */
export function readTexControlSequence(source: string, from: number): TexControlSequence | null {
  if (source.charAt(from) !== "\\") {
    return null;
  }
  let cursor = from + 1;
  while (cursor < source.length && /[A-Za-z@]/u.test(source.charAt(cursor))) {
    cursor += 1;
  }
  if (cursor === from + 1) {
    cursor = Math.min(source.length, from + 2);
  }
  return { raw: source.slice(from, cursor), from, to: cursor };
}

export function skipTexComment(source: string, from: number): number {
  let cursor = from;
  while (cursor < source.length) {
    const char = source.charAt(cursor);
    cursor += 1;
    if (char === "\n" || char === "\r") {
      break;
    }
  }
  return cursor;
}

export function skipTexWhitespaceAndComments(source: string, from: number, limit = source.length): number {
  let cursor = from;
  while (cursor < limit) {
    const char = source.charAt(cursor);
    if (/\s/u.test(char)) {
      cursor += 1;
    } else if (char === "%") {
      cursor = Math.min(limit, skipTexComment(source, cursor));
    } else {
      break;
    }
  }
  return cursor;
}

/**
 * Read a literal environment name, preserving all original offsets. The
 * current TikZ grammar requires an adjacent argument; callers supporting TeX
 * trivia between the control word and its argument can enable allowTrivia.
 */
export function readTexEnvironmentDelimiter(
  source: string,
  from: number,
  allowTrivia = false
): TexEnvironmentDelimiter | null {
  const command = readTexControlSequence(source, from);
  if (!command || (command.raw !== "\\begin" && command.raw !== "\\end")) {
    return null;
  }
  const nameFrom = allowTrivia ? skipTexWhitespaceAndComments(source, command.to) : command.to;
  if (source.charAt(nameFrom) !== "{") {
    return null;
  }
  let cursor = nameFrom + 1;
  while (cursor < source.length && /[A-Za-z0-9*@-]/u.test(source.charAt(cursor))) {
    cursor += 1;
  }
  if (cursor === nameFrom + 1 || source.charAt(cursor) !== "}") {
    return null;
  }
  return {
    from,
    to: cursor + 1,
    kind: command.raw === "\\begin" ? "begin" : "end",
    name: source.slice(nameFrom + 1, cursor)
  };
}

/** Return the end of a supported verbatim form, whose contents are inert. */
export function skipTexVerbatim(
  source: string,
  command: TexControlSequence,
  allowEnvironmentTrivia = false
): number | null {
  if (command.raw === "\\verb") {
    const delimiterFrom = source.charAt(command.to) === "*" ? command.to + 1 : command.to;
    const delimiter = source.charAt(delimiterFrom);
    if (!delimiter || delimiter === "\n" || delimiter === "\r") {
      return delimiterFrom;
    }
    let cursor = delimiterFrom + 1;
    while (cursor < source.length) {
      const char = source.charAt(cursor);
      if (char === "\n" || char === "\r") return cursor;
      cursor += 1;
      if (char === delimiter) return cursor;
    }
    return cursor;
  }
  const environment = readTexEnvironmentDelimiter(source, command.from, allowEnvironmentTrivia);
  if (environment?.kind !== "begin" || (environment.name !== "verbatim" && environment.name !== "verbatim*")) {
    return null;
  }
  const endToken = `\\end{${environment.name}}`;
  const endFrom = source.indexOf(endToken, environment.to);
  return endFrom < 0 ? source.length : endFrom + endToken.length;
}

/** Read a balanced group or option list, with comments and escapes inert. */
export function readTexBalancedDelimited(
  source: string,
  from: number,
  openChar: "{" | "[",
  closeChar: "}" | "]",
  limit = source.length
): Span | null {
  if (source.charAt(from) !== openChar) {
    return null;
  }
  let depth = 0;
  let braceDepth = 0;
  let cursor = from;
  while (cursor < limit) {
    const char = source.charAt(cursor);
    if (char === "%") {
      cursor = Math.min(limit, skipTexComment(source, cursor));
      continue;
    }
    if (char === "\\") {
      cursor = Math.min(limit, cursor + 2);
      continue;
    }
    if (openChar === "[") {
      if (char === "{") {
        braceDepth += 1;
      } else if (char === "}" && braceDepth > 0) {
        braceDepth -= 1;
      }
      if (braceDepth > 0 || char === "}") {
        cursor += 1;
        continue;
      }
    }
    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return { from, to: cursor + 1 };
      }
    }
    cursor += 1;
  }
  return null;
}

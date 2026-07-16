import type { Span } from "../ast/types.js";
import type { AddonRuntime } from "./runtime.js";

/**
 * A claimed TeX-macro-style command occurrence (e.g. `\pgfplotsset{...}`,
 * `\duck[...]`) that is not semicolon-terminated and therefore cannot parse
 * through the host grammar's UnknownStatement rule. The parser masks these
 * regions before the Lezer parse and the CST->AST layer synthesizes
 * AddonCommand statements for them.
 */
export type AddonMacroRegion = {
  span: Span;
  argsSpan: Span;
  commandName: string;
  addonId: string;
};

/**
 * Scan for claimed macro-command regions at statement level (brace/bracket
 * depth zero) of the parse-window source. Occurrences followed by a
 * semicolon are skipped: those parse through the grammar and route via the
 * ordinary claimed-command path.
 */
export function scanAddonMacroRegions(source: string, runtime: AddonRuntime): AddonMacroRegion[] {
  if (runtime.macroCommandNames.size === 0) {
    return [];
  }
  const regions: AddonMacroRegion[] = [];
  let depth = 0;
  let cursor = 0;

  while (cursor < source.length) {
    const char = source[cursor];
    if (char === "%") {
      cursor = skipComment(source, cursor);
      continue;
    }
    if (char === "{" || char === "[") {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (char === "}" || char === "]") {
      depth = Math.max(0, depth - 1);
      cursor += 1;
      continue;
    }
    if (char !== "\\") {
      cursor += 1;
      continue;
    }

    const commandEnd = readControlSequenceEnd(source, cursor);
    const commandName = source.slice(cursor, commandEnd);
    if (depth > 0 || !runtime.macroCommandNames.has(commandName)) {
      cursor = commandEnd;
      continue;
    }

    const route = runtime.engineForCommand(commandName);
    if (!route) {
      cursor = commandEnd;
      continue;
    }

    let argsEnd = commandEnd;
    let probe = commandEnd;
    while (probe < source.length) {
      const next = skipWhitespaceAndComments(source, probe);
      const nextChar = source[next];
      if (nextChar === "{" || nextChar === "[") {
        const close = readBalanced(source, next, nextChar, nextChar === "{" ? "}" : "]");
        if (close == null) {
          break;
        }
        probe = close;
        argsEnd = close;
        continue;
      }
      break;
    }

    const afterArgs = skipWhitespaceAndComments(source, argsEnd);
    if (source[afterArgs] === ";") {
      // Semicolon-terminated: the grammar parses this as UnknownStatement and
      // the claimed-command routing picks it up. Leave it alone.
      cursor = argsEnd;
      continue;
    }

    regions.push({
      span: { from: cursor, to: argsEnd },
      argsSpan: { from: commandEnd, to: argsEnd },
      commandName,
      addonId: route.addonId
    });
    cursor = argsEnd;
  }

  return regions;
}

/** Replace the recorded regions with spaces (newlines preserved) so the Lezer parse sees no error nodes. */
export function maskAddonMacroRegions(source: string, regions: readonly AddonMacroRegion[]): string {
  if (regions.length === 0) {
    return source;
  }
  let masked = source;
  for (const region of regions) {
    const from = Math.max(0, Math.min(masked.length, region.span.from));
    const to = Math.max(from, Math.min(masked.length, region.span.to));
    masked = masked.slice(0, from) + masked.slice(from, to).replace(/[^\n]/g, " ") + masked.slice(to);
  }
  return masked;
}

function skipComment(source: string, index: number): number {
  let cursor = index;
  while (cursor < source.length && source[cursor] !== "\n") {
    cursor += 1;
  }
  return cursor;
}

function skipWhitespaceAndComments(source: string, index: number): number {
  let cursor = index;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === "%") {
      cursor = skipComment(source, cursor);
      continue;
    }
    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      cursor += 1;
      continue;
    }
    break;
  }
  return cursor;
}

function readControlSequenceEnd(source: string, index: number): number {
  let cursor = index + 1;
  if (cursor < source.length && !/[A-Za-z@]/.test(source[cursor])) {
    // Control symbol like \\ or \{ — two characters total.
    return cursor + 1;
  }
  while (cursor < source.length && /[A-Za-z@]/.test(source[cursor])) {
    cursor += 1;
  }
  return cursor;
}

/** Returns the index just past the matching close delimiter, or null if unbalanced. */
function readBalanced(source: string, index: number, openChar: string, closeChar: string): number | null {
  if (source[index] !== openChar) {
    return null;
  }
  let depth = 0;
  let cursor = index;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === "%") {
      cursor = skipComment(source, cursor);
      continue;
    }
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return cursor + 1;
      }
    }
    cursor += 1;
  }
  return null;
}

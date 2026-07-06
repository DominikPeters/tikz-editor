import type { OptionEntry, OptionListAst } from "./types.js";

export function parseOptionListRaw(raw: string, absoluteFrom = 0): OptionListAst {
  const normalized = raw.trim();
  const openIndex = normalized.indexOf("[");
  const closeIndex = findOptionCloseIndex(normalized);

  const innerFrom = openIndex >= 0 ? openIndex + 1 : 0;
  const innerTo = closeIndex >= 0 ? closeIndex : normalized.length;
  const inner = normalized.slice(innerFrom, innerTo);
  const maskedInner = maskLineComments(inner);

  const entries = splitTopLevelWithRanges(maskedInner, ",")
    .map((part) => {
      const bounds = trimLocalBounds(part.value);
      if (!bounds) {
        return null;
      }
      return {
        token: part.value.slice(bounds.from, bounds.to),
        from: part.from + bounds.from,
        to: part.from + bounds.to
      };
    })
    .filter((part): part is { token: string; from: number; to: number } => part !== null)
    .map((part) =>
      classifyOptionToken(part.token, {
        tokenFrom: absoluteFrom + innerFrom + part.from
      })
    );

  return {
    span: {
      from: absoluteFrom,
      to: absoluteFrom + normalized.length
    },
    raw: normalized,
    entries
  };
}

function maskLineComments(input: string): string {
  let masked = "";
  let inComment = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inComment) {
      if (char === "\n" || char === "\r") {
        inComment = false;
        masked += char;
      } else {
        masked += " ";
      }
      continue;
    }

    if (char === "%" && input[i - 1] !== "\\") {
      inComment = true;
      masked += " ";
      continue;
    }

    masked += char;
  }

  return masked;
}

function classifyOptionToken(
  token: string,
  spanInput: { tokenFrom: number }
): OptionEntry {
  const span = {
    from: spanInput.tokenFrom,
    to: spanInput.tokenFrom + token.length
  };

  const separator = findTopLevelSeparator(token, "=");
  if (separator >= 0) {
    const keyRaw = token.slice(0, separator);
    const valueRawUntrimmed = token.slice(separator + 1);
    const key = keyRaw.trim().toLowerCase();
    const valueRaw = valueRawUntrimmed.trim();
    if (key.length === 0) {
      return { kind: "unknown", span, raw: token };
    }

    const keyBounds = trimLocalBounds(keyRaw);
    if (!keyBounds) {
      return { kind: "unknown", span, raw: token };
    }
    const valueBounds = trimLocalBounds(valueRawUntrimmed);
    const keySpan = {
      from: spanInput.tokenFrom + keyBounds.from,
      to: spanInput.tokenFrom + keyBounds.to
    };
    const valueSpan =
      valueBounds === null
        ? null
        : {
            from: spanInput.tokenFrom + separator + 1 + valueBounds.from,
            to: spanInput.tokenFrom + separator + 1 + valueBounds.to
          };

    return {
      kind: "kv",
      key,
      valueRaw,
      span,
      keySpan,
      valueSpan,
      raw: token
    };
  }

  if (
    /^(-|<-|->|<->|\|-\||[A-Za-z][A-Za-z0-9 -]*)$/.test(token) ||
    looksLikeArrowSpecification(token) ||
    looksLikeColorSpecification(token)
  ) {
    return {
      kind: "flag",
      key: token.trim().toLowerCase(),
      span,
      keySpan: {
        from: spanInput.tokenFrom,
        to: spanInput.tokenFrom + token.length
      },
      raw: token
    };
  }

  return {
    kind: "unknown",
    span,
    raw: token
  };
}

function looksLikeArrowSpecification(token: string): boolean {
  const trimmed = token.trim();
  if (trimmed.length === 0 || !trimmed.includes("-")) {
    return false;
  }

  if (findTopLevelSeparator(trimmed, "-") < 0) {
    return false;
  }

  const hasArrowSyntax = /[<>|{}[\]]/.test(trimmed);
  const hasKnownArrowName =
    /\b(stealth|latex|triangle|bar|hooks|to|implies|rightarrow|kite|square|circle|rays|bracket|parenthesis|diamond|rectangle|ellipse|cap|arc\s+barb|tee\s+barb|straight\s+barb)\b/i.test(
      trimmed
    );
  if (!hasArrowSyntax && !hasKnownArrowName) {
    return false;
  }

  return /^[A-Za-z0-9<>|{}[\].'=,:!# -]+$/.test(trimmed);
}

function looksLikeColorSpecification(token: string): boolean {
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) {
    return true;
  }
  if (!trimmed.includes("!")) {
    return false;
  }

  return /^[A-Za-z][A-Za-z0-9]*\s*!\s*\d+(?:\.\d+)?(?:\s*!\s*[A-Za-z][A-Za-z0-9]*)?(?:\s*!\s*\d+(?:\.\d+)?(?:\s*!\s*[A-Za-z][A-Za-z0-9]*)?)*\s*$/.test(
    trimmed
  );
}

function findOptionCloseIndex(raw: string): number {
  if (!raw.includes("[")) {
    return raw.length;
  }

  let depth = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (char === "\\") {
      i += 1;
      continue;
    }
    if (char === "[") {
      depth += 1;
      continue;
    }
    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }

  return raw.length;
}

function findTopLevelSeparator(input: string, separator: string): number {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (char === "\\") {
      i += 1;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (char === separator && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      return i;
    }
  }

  return -1;
}

export function splitTopLevel(input: string, separator: string): string[] {
  return splitTopLevelWithRanges(input, separator).map((part) => part.value);
}

function splitTopLevelWithRanges(input: string, separator: string): Array<{ value: string; from: number; to: number }> {
  const ranges: Array<{ value: string; from: number; to: number }> = [];
  let cursor = 0;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === "\\") {
      i += 1;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (char === separator && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      ranges.push({ value: input.slice(cursor, i), from: cursor, to: i });
      cursor = i + 1;
    }
  }

  ranges.push({ value: input.slice(cursor), from: cursor, to: input.length });
  return ranges;
}

function trimLocalBounds(value: string): { from: number; to: number } | null {
  let from = 0;
  while (from < value.length && /\s/.test(value[from] ?? "")) {
    from += 1;
  }
  let to = value.length;
  while (to > from && /\s/.test(value[to - 1] ?? "")) {
    to -= 1;
  }
  if (to <= from) {
    return null;
  }
  return { from, to };
}

import type { Span } from "../ast/types.js";

export type ParsedForeachHeaderRaw = {
  headerRaw: string;
  variablesRaw: string;
  listRaw: string;
  optionsRaw?: string;
  optionsSpan?: Span;
  isValid: boolean;
};

export function stripForeachCommandPrefix(raw: string): string {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("\\foreach")) {
    return trimmed.slice("\\foreach".length).trimStart();
  }
  if (trimmed.startsWith("foreach")) {
    return trimmed.slice("foreach".length).trimStart();
  }
  return trimmed;
}

export function parseForeachHeaderRaw(raw: string): ParsedForeachHeaderRaw {
  const headerRaw = raw.trim();
  if (headerRaw.length === 0) {
    return {
      headerRaw,
      variablesRaw: "",
      listRaw: "",
      isValid: false
    };
  }

  const maskedHeaderRaw = maskLineCommentsPreservingLength(headerRaw);
  const inIndex = findTopLevelInKeyword(maskedHeaderRaw);
  if (inIndex < 0) {
    const left = removeTopLevelOptionLists(headerRaw);
    return {
      headerRaw,
      variablesRaw: left.variablesRaw,
      listRaw: "",
      ...(left.firstOptionRaw !== undefined ? { optionsRaw: left.firstOptionRaw } : {}),
      ...(left.firstOptionSpan !== undefined ? { optionsSpan: left.firstOptionSpan } : {}),
      isValid: false
    };
  }

  const leftRaw = headerRaw.slice(0, inIndex);
  const listRaw = headerRaw.slice(inIndex + 2).trim();
  const left = removeTopLevelOptionLists(leftRaw);

  return {
    headerRaw,
    variablesRaw: left.variablesRaw,
    listRaw,
    ...(left.firstOptionRaw !== undefined ? { optionsRaw: left.firstOptionRaw } : {}),
    ...(left.firstOptionSpan !== undefined ? { optionsSpan: left.firstOptionSpan } : {}),
    isValid: left.variablesRaw.length > 0 || listRaw.length > 0
  };
}

function findTopLevelInKeyword(raw: string): number {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw.charAt(index);

    if (char === "\\") {
      index += 1;
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

    if (parenDepth !== 0 || braceDepth !== 0 || bracketDepth !== 0) {
      continue;
    }

    if (!raw.startsWith("in", index)) {
      continue;
    }

    const left = raw.charAt(index - 1);
    const right = raw.charAt(index + 2);
    if (!isWordBoundary(left) || !isWordBoundary(right)) {
      continue;
    }
    return index;
  }

  return -1;
}

function isWordBoundary(value: string): boolean {
  return value.length === 0 || !/[A-Za-z0-9_@]/.test(value);
}

function removeTopLevelOptionLists(raw: string): {
  variablesRaw: string;
  firstOptionRaw?: string;
  firstOptionSpan?: Span;
} {
  const masked = maskLineCommentsPreservingLength(raw);
  let variablesBuilder = "";
  let firstOptionRaw: string | undefined;
  let firstOptionSpan: Span | undefined;

  let index = 0;
  let parenDepth = 0;
  let braceDepth = 0;

  while (index < raw.length) {
    const char = masked[index];

    if (char === "\\") {
      variablesBuilder += char;
      if (index + 1 < raw.length) {
        variablesBuilder += masked[index + 1];
      }
      index += 2;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      variablesBuilder += char;
      index += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      variablesBuilder += char;
      index += 1;
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      variablesBuilder += char;
      index += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      variablesBuilder += char;
      index += 1;
      continue;
    }

    if (char === "[" && parenDepth === 0 && braceDepth === 0) {
      const optionEnd = findMatchingBracket(masked, index);
      if (optionEnd < 0) {
        variablesBuilder += char;
        index += 1;
        continue;
      }

      if (!firstOptionRaw) {
        firstOptionRaw = raw.slice(index, optionEnd + 1);
        firstOptionSpan = { from: index, to: optionEnd + 1 };
      }

      index = optionEnd + 1;
      continue;
    }

    variablesBuilder += char;
    index += 1;
  }

  return {
    variablesRaw: variablesBuilder.trim(),
    ...(firstOptionRaw !== undefined ? { firstOptionRaw } : {}),
    ...(firstOptionSpan !== undefined ? { firstOptionSpan } : {})
  };
}

function findMatchingBracket(raw: string, from: number): number {
  let depth = 0;

  for (let index = from; index < raw.length; index += 1) {
    const char = raw.charAt(index);
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "[") {
      depth += 1;
      continue;
    }
    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function maskLineCommentsPreservingLength(input: string): string {
  let masked = "";
  let inComment = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input.charAt(index);
    if (inComment) {
      if (char === "\n" || char === "\r") {
        inComment = false;
        masked += char;
      } else {
        masked += " ";
      }
      continue;
    }

    if (char === "%" && input[index - 1] !== "\\") {
      inComment = true;
      masked += " ";
      continue;
    }

    masked += char;
  }

  return masked;
}

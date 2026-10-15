import { requireArrayValue } from "../../utils/collections.js";
import type { OptionEntry, OptionListAst } from "../../options/types.js";

export function splitTopLevel(
  raw: string,
  separators: string[],
  from: number
): Array<{ raw: string; from: number }> {
  const parts: Array<{ raw: string; from: number }> = [];
  let partStart = 0;
  let depthBrace = 0;
  let depthSquare = 0;
  let depthParen = 0;
  let inQuote = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw.charAt(index);
    if (char === "\\" && index + 1 < raw.length) {
      index += 1;
      continue;
    }
    if (char === '"' && raw.charAt(index - 1) !== "\\") {
      if (inQuote && raw.charAt(index + 1) === '"') {
        index += 1;
        continue;
      }
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) {
      continue;
    }
    if (isCommentStart(raw, index)) {
      while (index < raw.length && raw.charAt(index) !== "\n" && raw.charAt(index) !== "\r") {
        index += 1;
      }
      continue;
    }

    if (char === "{") {
      depthBrace += 1;
      continue;
    }
    if (char === "}") {
      depthBrace = Math.max(0, depthBrace - 1);
      continue;
    }
    if (char === "[") {
      depthSquare += 1;
      continue;
    }
    if (char === "]") {
      depthSquare = Math.max(0, depthSquare - 1);
      continue;
    }
    if (char === "(") {
      depthParen += 1;
      continue;
    }
    if (char === ")") {
      depthParen = Math.max(0, depthParen - 1);
      continue;
    }

    if (depthBrace === 0 && depthSquare === 0 && depthParen === 0 && separators.includes(char)) {
      parts.push({
        raw: raw.slice(partStart, index),
        from: from + partStart
      });
      partStart = index + 1;
    }
  }

  parts.push({
    raw: raw.slice(partStart),
    from: from + partStart
  });
  return parts;
}

export function readConnector<T extends string>(
  raw: string,
  start: number,
  operators: readonly T[]
): { operator: T; index: number; next: number } | null {
  for (const operator of operators) {
    if (raw.startsWith(operator, start)) {
      return {
        operator,
        index: start,
        next: start + operator.length
      };
    }
  }
  return null;
}

export function findNextConnector<T extends string>(
  raw: string,
  start: number,
  operators: readonly T[]
): { operator: T; index: number } | null {
  let depthBrace = 0;
  let depthSquare = 0;
  let depthParen = 0;
  let inQuote = false;

  for (let index = start; index < raw.length; index += 1) {
    const char = raw.charAt(index);
    if (char === "\\" && index + 1 < raw.length) {
      index += 1;
      continue;
    }
    if (char === '"' && raw.charAt(index - 1) !== "\\") {
      if (inQuote && raw.charAt(index + 1) === '"') {
        index += 1;
        continue;
      }
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) {
      continue;
    }
    if (isCommentStart(raw, index)) {
      while (index < raw.length && raw.charAt(index) !== "\n" && raw.charAt(index) !== "\r") {
        index += 1;
      }
      continue;
    }

    if (char === "{") {
      depthBrace += 1;
      continue;
    }
    if (char === "}") {
      depthBrace = Math.max(0, depthBrace - 1);
      continue;
    }
    if (char === "[") {
      depthSquare += 1;
      continue;
    }
    if (char === "]") {
      depthSquare = Math.max(0, depthSquare - 1);
      continue;
    }
    if (char === "(") {
      depthParen += 1;
      continue;
    }
    if (char === ")") {
      depthParen = Math.max(0, depthParen - 1);
      continue;
    }

    if (depthBrace === 0 && depthSquare === 0 && depthParen === 0) {
      for (const operator of operators) {
        if (raw.startsWith(operator, index)) {
          return { operator, index };
        }
      }
    }
  }

  return null;
}

export function readBalancedSegment(
  raw: string,
  start: number,
  open: string,
  close: string
): { raw: string; next: number } | null {
  if (raw.charAt(start) !== open) {
    return null;
  }

  let depth = 0;
  let inQuote = false;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw.charAt(index);
    if (char === "\\" && index + 1 < raw.length) {
      index += 1;
      continue;
    }
    if (char === '"' && raw.charAt(index - 1) !== "\\") {
      if (inQuote && raw.charAt(index + 1) === '"') {
        index += 1;
        continue;
      }
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) {
      continue;
    }
    if (isCommentStart(raw, index)) {
      while (index < raw.length && raw.charAt(index) !== "\n" && raw.charAt(index) !== "\r") {
        index += 1;
      }
      continue;
    }
    if (char === open) {
      depth += 1;
      continue;
    }
    if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return {
          raw: raw.slice(start, index + 1),
          next: index + 1
        };
      }
    }
  }
  return null;
}

export function findTopLevelChar(raw: string, needle: string): number {
  let depthBrace = 0;
  let depthSquare = 0;
  let depthParen = 0;
  let inQuote = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw.charAt(index);
    if (char === "\\" && index + 1 < raw.length) {
      index += 1;
      continue;
    }
    if (char === '"' && raw.charAt(index - 1) !== "\\") {
      if (inQuote && raw.charAt(index + 1) === '"') {
        index += 1;
        continue;
      }
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) {
      continue;
    }
    if (isCommentStart(raw, index)) {
      while (index < raw.length && raw.charAt(index) !== "\n" && raw.charAt(index) !== "\r") {
        index += 1;
      }
      continue;
    }

    if (char === "{") {
      depthBrace += 1;
      continue;
    }
    if (char === "}") {
      depthBrace = Math.max(0, depthBrace - 1);
      continue;
    }
    if (char === "[") {
      depthSquare += 1;
      continue;
    }
    if (char === "]") {
      depthSquare = Math.max(0, depthSquare - 1);
      continue;
    }
    if (char === "(") {
      depthParen += 1;
      continue;
    }
    if (char === ")") {
      depthParen = Math.max(0, depthParen - 1);
      continue;
    }

    if (depthBrace === 0 && depthSquare === 0 && depthParen === 0 && char === needle) {
      return index;
    }
  }

  return -1;
}

export function mergeOptionLists(optionLists: OptionListAst[]): OptionListAst | undefined {
  if (optionLists.length === 0) {
    return undefined;
  }
  if (optionLists.length === 1) {
    return optionLists[0];
  }

  const first = requireArrayValue(optionLists, 0);
  const last = requireArrayValue(optionLists, optionLists.length - 1);
  return {
    span: {
      from: first.span.from,
      to: last.span.to
    },
    raw: `[${optionLists.map((entry) => stripOptionListBrackets(entry.raw)).join(",")}]`,
    entries: optionLists.flatMap((entry) => entry.entries)
  };
}

export function optionListIfPresent(optionList: OptionListAst | undefined): OptionListAst[] {
  return optionList ? [optionList] : [];
}

export function optionListFromEntries(entries: OptionEntry[], base: OptionListAst): OptionListAst | undefined {
  if (entries.length === 0) {
    return undefined;
  }

  return {
    span: base.span,
    raw: `[${entries.map((entry) => entry.raw).join(",")}]`,
    entries
  };
}

export function stripOptionListBrackets(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]") && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function trimRightIndex(raw: string): number {
  for (let index = raw.length - 1; index >= 0; index -= 1) {
    if (!/\s/.test(raw.charAt(index))) {
      return index;
    }
  }
  return -1;
}

export function skipWhitespace(raw: string, cursor: number): number {
  let index = cursor;
  while (index < raw.length) {
    const char = raw.charAt(index);
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (isCommentStart(raw, index)) {
      while (index < raw.length && raw.charAt(index) !== "\n" && raw.charAt(index) !== "\r") {
        index += 1;
      }
      continue;
    }
    break;
  }
  return index;
}

function isCommentStart(raw: string, index: number): boolean {
  if (raw.charAt(index) !== "%") {
    return false;
  }
  if (index > 0 && raw.charAt(index - 1) === "\\") {
    return false;
  }
  return true;
}

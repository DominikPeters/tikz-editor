import type { SyntaxNode } from "@lezer/common";

import { coordinateItemId } from "../../ast/ids.js";
import type { CoordinateItem, RelativeCoordinatePrefix } from "../../ast/types.js";
import { parseOptionListRaw } from "../../options/parse.js";
import { findFirstChildByName } from "../../syntax/cursor.js";
import type { ParsedCoordinate } from "./types.js";

export function mapCoordinateItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number,
  relativePrefix?: RelativeCoordinatePrefix
): CoordinateItem {
  const raw = source.slice(node.from, node.to);
  const parsed = parseCoordinate(raw);

  return {
    kind: "Coordinate",
    id: coordinateItemId(statementIndex, itemIndex),
    span: { from: node.from, to: node.to },
    ...(parsed.optionsSpan ? {
      optionsSpan: {
        from: node.from + parsed.optionsSpan.from,
        to: node.from + parsed.optionsSpan.to
      }
    } : {}),
    ...(parsed.optionsSpan && parsed.optionsRaw ? { options: parseOptionListRaw(parsed.optionsRaw, node.from + parsed.optionsSpan.from) } : {}),
    ...(relativePrefix !== undefined ? { relativePrefix } : {}),
    x: parsed.x,
    y: parsed.y,
    ...(parsed.z !== undefined ? { z: parsed.z } : {}),
    raw,
    form: parsed.form
  };
}

export function mapRelativeCoordinateItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): CoordinateItem {
  const prefixNode = findFirstChildByName(node, "RelativePrefix");
  const coordinateNode = findFirstChildByName(node, "Coordinate");

  const prefixRaw = prefixNode ? source.slice(prefixNode.from, prefixNode.to) : "+";
  const relativePrefix: RelativeCoordinatePrefix = prefixRaw === "++" ? "++" : "+";

  if (!coordinateNode) {
    return {
      kind: "Coordinate",
      id: coordinateItemId(statementIndex, itemIndex),
      span: { from: node.from, to: node.to },
      relativePrefix,
      x: "",
      y: "",
      raw: source.slice(node.from, node.to),
      form: "unknown"
    };
  }

  return mapCoordinateItem(coordinateNode, source, statementIndex, itemIndex, relativePrefix);
}

export function parseCoordinate(raw: string): ParsedCoordinate & { optionsSpan?: { from: number; to: number }; optionsRaw?: string } {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("(")) {
    return { x: "", y: "", form: "unknown", isWellFormed: false };
  }

  const hasClosingParen = trimmed.endsWith(")");
  if (!hasClosingParen) {
    return { x: "", y: "", form: "unknown", isWellFormed: false };
  }

  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) {
    return { x: "", y: "", form: "unknown", isWellFormed: false };
  }

  const extracted = extractLeadingCoordinateOptions(inner);
  const core = extracted.remainder;

  if (core.length === 0) {
    return { x: "", y: "", form: "unknown", isWellFormed: false };
  }

  const optionsSpan = extracted.optionsRaw
    ? { from: 1 + extracted.optionsOffset, to: 1 + extracted.optionsOffset + extracted.optionsRaw.length }
    : undefined;

  if (isCalcCoordinate(core)) {
    return { x: core, y: "", form: "calc", isWellFormed: true, ...(optionsSpan !== undefined ? { optionsSpan } : {}), optionsRaw: extracted.optionsRaw };
  }

  if (/\bcs\s*:/i.test(core)) {
    return { x: core, y: "", form: "explicit", isWellFormed: true, ...(optionsSpan !== undefined ? { optionsSpan } : {}), optionsRaw: extracted.optionsRaw };
  }

  if (isIntersectionCoordinateExpression(core)) {
    return {
      x: core,
      y: "",
      form: "named",
      isWellFormed: true,
      ...(optionsSpan !== undefined ? { optionsSpan } : {}),
      optionsRaw: extracted.optionsRaw
    };
  }

  const commaParts = splitAllAtTopLevel(core, ",").map((part) => part.trim());
  if (commaParts.length === 2) {
    const [x = "", y = ""] = commaParts;
    return {
      x,
      y,
      form: "cartesian",
      isWellFormed: x.length > 0 && y.length > 0,
      ...(optionsSpan !== undefined ? { optionsSpan } : {}),
      optionsRaw: extracted.optionsRaw
    };
  }

  if (commaParts.length >= 3) {
    const [x = "", y = "", ...rest] = commaParts;
    const z = rest.join(",").trim();
    return {
      x,
      y,
      z,
      form: "xyz",
      isWellFormed: x.length > 0 && y.length > 0 && z.length > 0,
      ...(optionsSpan !== undefined ? { optionsSpan } : {}),
      optionsRaw: extracted.optionsRaw
    };
  }

  const colonSplit = splitAtTopLevel(core, ":");
  if (colonSplit) {
    const angle = colonSplit.left.trim();
    const radius = colonSplit.right.trim();
    return {
      x: angle,
      y: radius,
      form: "polar",
      isWellFormed: angle.length > 0 && radius.length > 0,
      ...(optionsSpan !== undefined ? { optionsSpan } : {}),
      optionsRaw: extracted.optionsRaw
    };
  }

  return {
    x: core,
    y: "",
    form: "named",
    isWellFormed: true,
    ...(optionsSpan !== undefined ? { optionsSpan } : {}),
    optionsRaw: extracted.optionsRaw
  };
}

function isIntersectionCoordinateExpression(core: string): boolean {
  const normalized = unwrapOuterBraces(core.trim());
  return /^intersection(?:\s+\d+)?\s+of\b/i.test(normalized);
}

function unwrapOuterBraces(raw: string): string {
  let normalized = raw.trim();
  while (normalized.startsWith("{") && normalized.endsWith("}") && normalized.length >= 2) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized;
}

type ExtractedOptions = {
  optionsRaw: string;
  optionsOffset: number;
  remainder: string;
};

function extractLeadingCoordinateOptions(inner: string): ExtractedOptions {
  const offset = leadingWhitespace(inner);
  let cursor = offset;

  if (inner[cursor] !== "[") {
    return {
      optionsRaw: "",
      optionsOffset: 0,
      remainder: inner.trim()
    };
  }

  const optionEnd = findMatchingBracket(inner, cursor);
  if (optionEnd === -1) {
    return {
      optionsRaw: "",
      optionsOffset: 0,
      remainder: inner.trim()
    };
  }

  const optionsRaw = inner.slice(cursor, optionEnd + 1);
  cursor = optionEnd + 1;

  while (cursor < inner.length && /\s/.test(inner.charAt(cursor))) {
    cursor += 1;
  }

  return {
    optionsRaw,
    optionsOffset: offset,
    remainder: inner.slice(cursor).trim()
  };
}

function leadingWhitespace(input: string): number {
  let i = 0;
  while (i < input.length && /\s/.test(input.charAt(i))) {
    i += 1;
  }
  return i;
}

function findMatchingBracket(input: string, from: number): number {
  let depth = 0;
  for (let i = from; i < input.length; i += 1) {
    const char = input[i];
    if (char === "\\") {
      i += 1;
      continue;
    }

    if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function isCalcCoordinate(core: string): boolean {
  const trimmed = core.trim();
  return trimmed.startsWith("$") && trimmed.endsWith("$") && trimmed.length >= 2;
}

export function splitAllAtTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
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
      parts.push(input.slice(cursor, i));
      cursor = i + 1;
    }
  }

  parts.push(input.slice(cursor));
  return parts;
}

export function splitAtTopLevel(input: string, separator: string): { left: string; right: string } | null {
  const parts = splitAllAtTopLevel(input, separator);
  if (parts.length < 2) {
    return null;
  }

  return {
    left: parts[0] ?? "",
    right: parts.slice(1).join(separator)
  };
}

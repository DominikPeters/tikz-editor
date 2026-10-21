import { splitAllAtTopLevel } from "../domains/coordinates/parse.js";
import { parseQuantityExpression } from "../semantic/coords/parse-length.js";

export type ForeachListExpansionOptions = {
  parseExpressions: boolean;
};

type DotValue =
  | {
      kind: "number";
      value: number;
    }
  | {
      kind: "alpha";
      value: number;
      upper: boolean;
    };

export function expandForeachList(listRaw: string, opts: ForeachListExpansionOptions): string[] {
  const normalizedList = stripOuterBraces(listRaw.trim());
  if (normalizedList.length === 0) {
    return [];
  }

  const rawEntries = splitAllAtTopLevel(normalizedList, ",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const expanded: string[] = [];
  for (let index = 0; index < rawEntries.length; index += 1) {
    const entry = rawEntries[index];
    if (entry === undefined) {
      throw new Error(`Missing foreach list entry at index ${index}`);
    }
    if (!entry.includes("...")) {
      expanded.push(entry);
      continue;
    }

    const next = rawEntries[index + 1];
    if (!next) {
      expanded.push(entry);
      continue;
    }

    const expandedDots = expandDotsEntry(entry, expanded, next, opts);
    if (!expandedDots.inserted) {
      expanded.push(entry);
      continue;
    }

    if (expandedDots.consumeNext) {
      index += 1;
    }
  }

  return expanded;
}

function expandDotsEntry(
  dotsEntry: string,
  expandedSoFar: string[],
  nextRaw: string,
  opts: ForeachListExpansionOptions
): { inserted: boolean; consumeNext: boolean } {
  const previousRaw = expandedSoFar.at(-1);
  if (previousRaw === undefined) {
    return { inserted: false, consumeNext: false };
  }

  const { prefix, suffix } = splitContext(dotsEntry);
  const previous = extractDotValue(previousRaw, prefix, suffix, opts.parseExpressions);
  if (!previous) {
    return { inserted: false, consumeNext: false };
  }

  const next = extractDotValue(nextRaw, prefix, suffix, opts.parseExpressions);
  if (next?.kind !== previous.kind) {
    return { inserted: false, consumeNext: false };
  }

  let step: number;
  if (expandedSoFar.length >= 2) {
    const prevPrevRaw = expandedSoFar[expandedSoFar.length - 2];
    const prevPrev = prevPrevRaw !== undefined ? extractDotValue(prevPrevRaw, prefix, suffix, opts.parseExpressions) : null;
    if (prevPrev?.kind === previous.kind) {
      step = previous.value - prevPrev.value;
    } else {
      step = next.value > previous.value ? 1 : -1;
    }
  } else {
    step = next.value > previous.value ? 1 : -1;
  }

  const generated: string[] = [];
  if (previous.kind === "number") {
    let value = previous.value + step;
    const epsilon = 1e-9;
    while (step > 0 ? value <= next.value + epsilon : value >= next.value - epsilon) {
      generated.push(`${prefix}${formatNumber(value)}${suffix}`);
      value += step;
    }
  } else {
    let value = previous.value + step;
    while (step > 0 ? value <= next.value : value >= next.value) {
      generated.push(`${prefix}${String.fromCharCode(value)}${suffix}`);
      value += step;
    }
  }

  expandedSoFar.push(...generated);
  return { inserted: true, consumeNext: true };
}

function splitContext(raw: string): { prefix: string; suffix: string } {
  const index = raw.indexOf("...");
  if (index < 0) {
    return { prefix: "", suffix: "" };
  }
  return {
    prefix: raw.slice(0, index),
    suffix: raw.slice(index + 3)
  };
}

function extractDotValue(raw: string, prefix: string, suffix: string, parseExpressions: boolean): DotValue | null {
  if (prefix.length > 0 || suffix.length > 0) {
    if (!raw.startsWith(prefix) || !raw.endsWith(suffix)) {
      return null;
    }
  }

  const core = (prefix.length > 0 || suffix.length > 0
    ? raw.slice(prefix.length, raw.length - suffix.length)
    : raw
  ).trim();
  if (core.length === 0) {
    return null;
  }

  const maybeNumber = parseNumericValue(core, parseExpressions);
  if (maybeNumber != null) {
    return { kind: "number", value: maybeNumber };
  }

  if (/^[A-Za-z]$/.test(core)) {
    const code = core.charCodeAt(0);
    return { kind: "alpha", value: code, upper: core >= "A" && core <= "Z" };
  }

  return null;
}

function parseNumericValue(raw: string, parseExpressions: boolean): number | null {
  if (parseExpressions) {
    const parsed = parseQuantityExpression(raw);
    if (parsed && Number.isFinite(parsed.value)) {
      return parsed.value;
    }
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function stripOuterBraces(raw: string): string {
  if (!raw.startsWith("{") || !raw.endsWith("}")) {
    return raw;
  }

  let depth = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && index !== raw.length - 1) {
        return raw;
      }
    }
  }

  return raw.slice(1, -1).trim();
}

function formatNumber(value: number): string {
  if (Math.abs(value) <= 1e-12) {
    return "0";
  }
  if (Math.abs(value - Math.round(value)) <= 1e-9) {
    return String(Math.round(value));
  }
  return value
    .toFixed(12)
    .replace(/\.?0+$/, "")
    .replace(/^-0$/, "0");
}

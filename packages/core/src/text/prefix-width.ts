import { clamp } from "../utils/math.js";

const TRAILING_ESCAPE_DISCHARGE_SUFFIX = "phantom{}";

export type TeXPrefixMathMode =
  | "none"
  | "dollar"
  | "dollar-double"
  | "paren"
  | "bracket";

export type TeXPrefixState = {
  inMath: boolean;
  mathMode: TeXPrefixMathMode;
  braceDepth: number;
  trailingEscape: boolean;
  unclosedLeftCount: number;
};

export function stabilizePrefixForMeasurement(prefix: string): string {
  let stabilized = prefix;
  let stateSnapshot = scanTeXPrefixState(stabilized);

  if (stateSnapshot.trailingEscape) {
    stabilized += TRAILING_ESCAPE_DISCHARGE_SUFFIX;
    stateSnapshot = scanTeXPrefixState(stabilized);
  }

  if (stateSnapshot.braceDepth > 0) {
    stabilized += "}".repeat(stateSnapshot.braceDepth);
    stateSnapshot = scanTeXPrefixState(stabilized);
  }

  if (stateSnapshot.inMath && stateSnapshot.unclosedLeftCount > 0) {
    stabilized += "\\right.".repeat(stateSnapshot.unclosedLeftCount);
    stateSnapshot = scanTeXPrefixState(stabilized);
  }

  if (stateSnapshot.inMath && hasDanglingMathScriptOperator(stabilized)) {
    stabilized += "{}";
    stateSnapshot = scanTeXPrefixState(stabilized);
  }

  if (stateSnapshot.inMath) {
    if (stateSnapshot.trailingEscape) {
      stabilized += TRAILING_ESCAPE_DISCHARGE_SUFFIX;
    }
    stabilized += closingDelimiterForMathMode(stateSnapshot.mathMode);
  }

  return stabilized;
}

export function scanTeXPrefixState(text: string): TeXPrefixState {
  let braceDepth = 0;
  let mathMode: TeXPrefixMathMode = "none";
  let unclosedLeftCount = 0;
  let trailingEscape = false;

  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);

    if (char === "\\") {
      const nextIndex = index + 1;
      if (nextIndex >= text.length) {
        trailingEscape = true;
        break;
      }

      const nextChar = text.charAt(nextIndex);
      if (nextChar === "(") {
        if (mathMode === "none") {
          mathMode = "paren";
        }
        index += 2;
        continue;
      }

      if (nextChar === ")") {
        if (mathMode === "paren") {
          mathMode = "none";
        }
        index += 2;
        continue;
      }

      if (nextChar === "[") {
        if (mathMode === "none") {
          mathMode = "bracket";
        }
        index += 2;
        continue;
      }

      if (nextChar === "]") {
        if (mathMode === "bracket") {
          mathMode = "none";
        }
        index += 2;
        continue;
      }

      if (/[A-Za-z]/.test(nextChar)) {
        let commandEnd = nextIndex + 1;
        while (commandEnd < text.length && /[A-Za-z]/.test(text.charAt(commandEnd))) {
          commandEnd += 1;
        }
        const command = text.slice(nextIndex, commandEnd);
        if (mathMode !== "none" && command === "left") {
          unclosedLeftCount += 1;
        } else if (mathMode !== "none" && command === "right") {
          unclosedLeftCount = Math.max(0, unclosedLeftCount - 1);
        }
        index = commandEnd;
        continue;
      }

      // Control symbol (e.g. \$, \{, \}, \_, \\): consume escaped char.
      index += 2;
      continue;
    }

    if (char === "$") {
      if (index + 1 < text.length && text.charAt(index + 1) === "$") {
        if (mathMode === "none") {
          mathMode = "dollar-double";
        } else if (mathMode === "dollar-double") {
          mathMode = "none";
        }
        index += 2;
        continue;
      }

      if (mathMode === "none") {
        mathMode = "dollar";
      } else if (mathMode === "dollar") {
        mathMode = "none";
      }
      index += 1;
      continue;
    }

    if (char === "{") {
      braceDepth += 1;
      index += 1;
      continue;
    }

    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      index += 1;
      continue;
    }

    index += 1;
  }

  return {
    inMath: mathMode !== "none",
    mathMode,
    braceDepth,
    trailingEscape,
    unclosedLeftCount
  };
}

function extendControlSequenceEnd(content: string, backslashIndex: number): number {
  let end = backslashIndex + 1;
  if (end >= content.length) {
    return end;
  }

  const nextChar = content.charAt(end);
  if (/[A-Za-z]/.test(nextChar)) {
    end += 1;
    while (end < content.length && /[A-Za-z]/.test(content.charAt(end))) {
      end += 1;
    }
    return end;
  }

  return Math.min(content.length, end + 1);
}

export function extendTeXControlWordPrefixEnd(content: string, prefixLength: number): number {
  const normalizedEnd = clamp(Math.floor(prefixLength), 0, content.length);
  if (normalizedEnd <= 0) {
    return 0;
  }

  let scan = normalizedEnd - 1;
  while (scan >= 0 && /[A-Za-z]/.test(content.charAt(scan))) {
    scan -= 1;
  }

  if (scan >= 0 && content.charAt(scan) === "\\" && scan < normalizedEnd) {
    return extendControlSequenceEnd(content, scan);
  }

  if (content.charAt(normalizedEnd - 1) === "\\") {
    return extendControlSequenceEnd(content, normalizedEnd - 1);
  }

  return normalizedEnd;
}

export function hasDanglingMathScriptOperator(text: string): boolean {
  let index = text.length - 1;
  while (index >= 0 && /\s/.test(text.charAt(index))) {
    index -= 1;
  }
  if (index < 0) {
    return false;
  }

  const char = text.charAt(index);
  if (char !== "^" && char !== "_") {
    return false;
  }

  let backslashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text.charAt(cursor) === "\\"; cursor -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 0;
}

export function seedPrefixWidthTable(sourceLength: number, totalWidthUnits: number): number[] {
  const table = Array.from<number>({ length: sourceLength + 1 });
  table[0] = 0;
  table[sourceLength] = totalWidthUnits;
  return table;
}

export function finalizePrefixWidthTable(table: readonly number[], totalWidthUnits: number): number[] {
  const finalized = table.slice();
  const lastIndex = finalized.length - 1;
  if (lastIndex < 0) {
    return [];
  }

  const boundedTotal = Number.isFinite(totalWidthUnits) && totalWidthUnits > 0 ? totalWidthUnits : 0;
  finalized[0] = 0;
  finalized[lastIndex] = boundedTotal;

  // Fill unknown measurements by local interpolation between nearest known prefixes.
  let index = 0;
  while (index < lastIndex) {
    if (Number.isFinite(finalized[index])) {
      index += 1;
      continue;
    }

    const gapStart = index - 1;
    let gapEnd = index;
    while (gapEnd <= lastIndex && !Number.isFinite(finalized[gapEnd])) {
      gapEnd += 1;
    }

    const leftIndex = Math.max(0, gapStart);
    const rightIndex = Math.min(lastIndex, gapEnd);
    const leftValue = Number.isFinite(finalized[leftIndex]) ? Number(finalized[leftIndex]) : 0;
    const rightValue = Number.isFinite(finalized[rightIndex]) ? Number(finalized[rightIndex]) : boundedTotal;
    const span = Math.max(1, rightIndex - leftIndex);

    for (let cursor = leftIndex + 1; cursor < rightIndex; cursor += 1) {
      const t = (cursor - leftIndex) / span;
      finalized[cursor] = leftValue + (rightValue - leftValue) * t;
    }

    index = rightIndex + 1;
  }

  let previous = 0;
  for (let cursor = 1; cursor < lastIndex; cursor += 1) {
    const raw = finalized[cursor];
    const normalized = Number.isFinite(raw)
      ? Number(raw)
      : boundedTotal * (cursor / Math.max(1, lastIndex));
    const clamped = clamp(normalized, previous, boundedTotal);
    finalized[cursor] = clamped;
    previous = clamped;
  }

  return finalized;
}

export function readPrefixUnitsFromTable(
  index: number,
  sourceLength: number,
  totalWidthUnits: number,
  table: readonly number[] | null | undefined
): number {
  if (index <= 0 || sourceLength === 0) {
    return 0;
  }

  const normalizedIndex = normalizeIndex(index, sourceLength);
  if (table?.length === sourceLength + 1) {
    const measured: number | undefined = table[normalizedIndex];
    if (Number.isFinite(measured)) {
      return Number(measured);
    }
  }

  return totalWidthUnits * (normalizedIndex / sourceLength);
}

export function findNearestPrefixIndexFromTable(
  targetUnits: number,
  sourceLength: number,
  totalWidthUnits: number,
  table: readonly number[] | null | undefined
): number {
  if (sourceLength === 0 || totalWidthUnits <= 0) {
    return 0;
  }

  const boundedTarget = clamp(targetUnits, 0, totalWidthUnits);
  if (!Array.isArray(table) || table.length !== sourceLength + 1) {
    return normalizeIndex(Math.round((boundedTarget / totalWidthUnits) * sourceLength), sourceLength);
  }

  let low = 0;
  let high = sourceLength;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const widthAtMid = Number(table[mid]) || 0;
    if (widthAtMid < boundedTarget) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  const rightIndex = clamp(low, 0, sourceLength);
  const leftIndex = clamp(rightIndex - 1, 0, sourceLength);
  const leftDistance = Math.abs((Number(table[leftIndex]) || 0) - boundedTarget);
  const rightDistance = Math.abs((Number(table[rightIndex]) || totalWidthUnits) - boundedTarget);
  return leftDistance <= rightDistance ? leftIndex : rightIndex;
}

function closingDelimiterForMathMode(mode: TeXPrefixMathMode): string {
  if (mode === "paren") {
    return "\\)";
  }
  if (mode === "bracket") {
    return "\\]";
  }
  if (mode === "dollar-double") {
    return "$$";
  }
  return "$";
}

function normalizeIndex(value: number, max: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return clamp(Math.floor(value), 0, max);
}

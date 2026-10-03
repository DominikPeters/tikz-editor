import { splitAllAtTopLevel } from "../../domains/coordinates/parse.js";
import {
  convertQuantityToLength,
  evaluatePgfMathExpression,
  type PgfMathQuantity
} from "../pgfmath/evaluator.js";

export type ParsedQuantity = PgfMathQuantity;

export type ParsedLength = {
  value: number;
  hasExplicitUnit: boolean;
};

export type ParseLengthOptions = {
  /** Context-dependent TeX unit sizes, expressed in pt. */
  unitFactors?: Readonly<Partial<Record<"em" | "ex", number>>>;
};

/** Preserve simple authored units; expressions with declared units can be rewritten in pt. */
export function coordinateSourceUnit(raw: string): string | undefined {
  const normalized = normalizeLengthInput(raw);
  const match = normalized.match(/(?:\d|\.)\s*(cm|mm|pt|bp|pc|in|dd|cc|sp|em|ex)\s*$/u);
  return match?.[1] ?? (hasExplicitLengthUnit(normalized) ? "pt" : undefined);
}

export function parseLength(
  input: string,
  defaultUnit: "cm" | "pt",
  options: ParseLengthOptions = {}
): number | null {
  const parsed = parseLengthWithInfo(input, defaultUnit, options);
  return parsed?.value ?? null;
}

export function parseLengthWithInfo(
  input: string,
  defaultUnit: "cm" | "pt",
  options: ParseLengthOptions = {}
): ParsedLength | null {
  const normalizedInput = normalizeLengthInput(input);
  const quantity = parseQuantityExpression(normalizedInput, options);
  if (quantity == null) {
    return null;
  }

  const value = convertQuantityToLength(quantity, defaultUnit);
  if (value == null) {
    return null;
  }

  return {
    value,
    hasExplicitUnit: hasExplicitLengthUnit(normalizedInput)
  };
}

export function parseQuantityExpression(
  input: string,
  options: ParseLengthOptions = {}
): ParsedQuantity | null {
  const result = evaluatePgfMathExpression(input, {
    unitFactors: options.unitFactors
  });
  if (result.ok === false) {
    return null;
  }
  return result.quantity;
}

export function parseCoordinateLike(raw: string): { x: string; y: string } | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("(") === false || trimmed.endsWith(")") === false) {
    return null;
  }

  const inner = trimmed.slice(1, -1).trim();
  const parts = splitAllAtTopLevel(inner, ",").map((part) => part.trim());
  if (parts.length < 2) {
    return null;
  }
  return { x: parts[0], y: parts[1] };
}

function normalizeLengthInput(input: string): string {
  let normalized = input.trim();
  while (normalized.length >= 2 && normalized.startsWith("{") && normalized.endsWith("}")) {
    const unwrapped = unwrapSingleOuterBracePair(normalized);
    if (unwrapped == null) {
      break;
    }
    normalized = unwrapped.trim();
  }
  return normalized;
}

function hasExplicitLengthUnit(input: string): boolean {
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (/\s/.test(char) || char === "+" || char === "-") {
      index += 1;
      continue;
    }

    if (isDigit(char) || char === ".") {
      const numberStart = index;
      let hasDigits = false;

      if (char === ".") {
        index += 1;
        while (index < input.length && isDigit(input[index])) {
          hasDigits = true;
          index += 1;
        }
        if (!hasDigits) {
          continue;
        }
      } else {
        while (index < input.length && isDigit(input[index])) {
          hasDigits = true;
          index += 1;
        }
        if (index < input.length && input[index] === ".") {
          index += 1;
          while (index < input.length && isDigit(input[index])) {
            hasDigits = true;
            index += 1;
          }
        }
      }

      if (index < input.length && (input[index] === "e" || input[index] === "E")) {
        const exponentStart = index;
        index += 1;
        if (index < input.length && (input[index] === "+" || input[index] === "-")) {
          index += 1;
        }
        const exponentDigitsStart = index;
        while (index < input.length && isDigit(input[index])) {
          index += 1;
        }
        if (exponentDigitsStart === index) {
          index = exponentStart;
        }
      }

      while (index < input.length && /\s/.test(input[index])) {
        index += 1;
      }

      const unitStart = index;
      while (index < input.length && /[A-Za-z]/.test(input[index])) {
        index += 1;
      }
      if (index > unitStart) {
        return true;
      }
      if (!hasDigits) {
        index = numberStart + 1;
      }
      continue;
    }

    index += 1;
  }

  return false;
}

function unwrapSingleOuterBracePair(raw: string): string | null {
  if (!(raw.startsWith("{") && raw.endsWith("}"))) {
    return null;
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
      if (depth === 0 && index < raw.length - 1) {
        return null;
      }
      if (depth < 0) {
        return null;
      }
    }
  }

  return depth === 0 ? raw.slice(1, -1) : null;
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

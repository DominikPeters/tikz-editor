import { parseOptionListRaw } from "../../options/parse.js";
import { parseLength, parseQuantityExpression } from "../coords/parse-length.js";
import type { LegacyPatternName, ResolvedPattern, ResolvedStyle } from "../types.js";
import { normalizeOptionValue, readOptionalBracketOptions } from "./option-utils.js";

type ParsedPatternValue = {
  pattern: ResolvedPattern | null;
  recognized: boolean;
  disabled: boolean;
  diagnostics: string[];
};

type MetaPatternFamily = "lines" | "hatch" | "dots" | "stars";

type MetaPatternDefaults = {
  distance: number;
  angle: number;
  xshift: number;
  yshift: number;
  lineWidth: number;
  radius: number;
  points: number;
};

type LegacyPatternSpec = {
  name: LegacyPatternName;
  inherentlyColored: boolean;
};

const LEGACY_PATTERN_SPECS: readonly LegacyPatternSpec[] = [
  { name: "horizontal lines", inherentlyColored: false },
  { name: "vertical lines", inherentlyColored: false },
  { name: "north east lines", inherentlyColored: false },
  { name: "north west lines", inherentlyColored: false },
  { name: "grid", inherentlyColored: false },
  { name: "crosshatch", inherentlyColored: false },
  { name: "dots", inherentlyColored: false },
  { name: "crosshatch dots", inherentlyColored: false },
  { name: "fivepointed stars", inherentlyColored: false },
  { name: "sixpointed stars", inherentlyColored: false },
  { name: "bricks", inherentlyColored: false },
  { name: "checkerboard", inherentlyColored: false },
  { name: "checkerboard light gray", inherentlyColored: true },
  { name: "horizontal lines light gray", inherentlyColored: true },
  { name: "horizontal lines gray", inherentlyColored: true },
  { name: "horizontal lines dark gray", inherentlyColored: true },
  { name: "horizontal lines light blue", inherentlyColored: true },
  { name: "horizontal lines dark blue", inherentlyColored: true },
  { name: "crosshatch dots gray", inherentlyColored: true },
  { name: "crosshatch dots light steel blue", inherentlyColored: true }
];

const LEGACY_PATTERN_BY_NAME = new Map<string, LegacyPatternSpec>(
  LEGACY_PATTERN_SPECS.map((spec) => [spec.name.toLowerCase(), spec])
);

const META_PATTERN_FAMILY_BY_NAME = new Map<string, MetaPatternFamily>([
  ["lines", "lines"],
  ["hatch", "hatch"],
  ["dots", "dots"],
  ["stars", "stars"]
]);

const DEFAULT_DISTANCE_PT = parseLength("3pt", "pt") ?? 3;
const DEFAULT_STARS_DISTANCE_PT = parseLength("3mm", "pt") ?? 8.5358;
const DEFAULT_RADIUS_PT = parseLength(".5pt", "pt") ?? 0.5;
const DEFAULT_STARS_RADIUS_PT = parseLength("1mm", "pt") ?? 2.8453;

export const DEFAULT_PATTERN: ResolvedPattern = {
  kind: "legacy",
  name: "dots",
  inherentlyColored: false
};

export function parsePatternValue(valueRaw: string, style: ResolvedStyle): ParsedPatternValue {
  const diagnostics: string[] = [];
  const normalized = normalizeOptionValue(valueRaw);
  const normalizedLower = normalized.toLowerCase();

  if (normalizedLower === "none") {
    return { pattern: null, recognized: true, disabled: true, diagnostics };
  }

  if (normalized.length === 0) {
    return { pattern: style.fillPattern ?? DEFAULT_PATTERN, recognized: true, disabled: false, diagnostics };
  }

  const parsed = parsePatternNameAndOptions(normalized);
  diagnostics.push(...parsed.diagnostics);

  const family = META_PATTERN_FAMILY_BY_NAME.get(parsed.name.toLowerCase());
  if (family && parsed.optionsRaw != null) {
    const resolvedMeta = resolveMetaPattern(family, parsed.optionsRaw, style);
    diagnostics.push(...resolvedMeta.diagnostics);
    return {
      pattern: resolvedMeta.pattern,
      recognized: true,
      disabled: false,
      diagnostics
    };
  }

  const legacy = LEGACY_PATTERN_BY_NAME.get(parsed.name.toLowerCase());
  if (legacy) {
    return {
      pattern: {
        kind: "legacy",
        name: legacy.name,
        inherentlyColored: legacy.inherentlyColored
      },
      recognized: true,
      disabled: false,
      diagnostics
    };
  }

  if (family) {
    const resolvedMeta = resolveMetaPattern(family, parsed.optionsRaw, style);
    diagnostics.push(...resolvedMeta.diagnostics);
    return {
      pattern: resolvedMeta.pattern,
      recognized: true,
      disabled: false,
      diagnostics
    };
  }

  diagnostics.push(`unsupported-pattern:${parsed.name.toLowerCase()}`);
  return {
    pattern: null,
    recognized: false,
    disabled: false,
    diagnostics
  };
}

export function isInherentlyColoredPattern(pattern: ResolvedPattern | null): boolean {
  return pattern?.kind === "legacy" && pattern.inherentlyColored;
}

function parsePatternNameAndOptions(input: string): { name: string; optionsRaw: string | null; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const bracketIndex = findTopLevelOpenBracket(input);
  if (bracketIndex < 0) {
    return {
      name: input.trim(),
      optionsRaw: null,
      diagnostics
    };
  }

  const name = input.slice(0, bracketIndex).trim();
  const parsedBracket = readOptionalBracketOptions(input, bracketIndex);
  if (parsedBracket.optionsRaw == null) {
    diagnostics.push(`invalid-pattern-spec:${input}`);
    return {
      name,
      optionsRaw: null,
      diagnostics
    };
  }

  const trailing = input.slice(parsedBracket.nextIndex).trim();
  if (trailing.length > 0) {
    diagnostics.push(`invalid-pattern-spec:${input}`);
  }

  return {
    name,
    optionsRaw: parsedBracket.optionsRaw,
    diagnostics
  };
}

function findTopLevelOpenBracket(input: string): number {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input.charAt(index);
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
      if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
        return index;
      }
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
  }

  return -1;
}

function resolveMetaPattern(
  family: MetaPatternFamily,
  optionsRaw: string | null,
  style: ResolvedStyle
): { pattern: ResolvedPattern; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const defaults = defaultMetaPatternValues(style);
  const values = { ...defaults };
  if (family === "stars") {
    values.distance = DEFAULT_STARS_DISTANCE_PT;
    values.radius = DEFAULT_STARS_RADIUS_PT;
  }

  if (optionsRaw != null) {
    const optionList = parseOptionListRaw(`[${optionsRaw}]`);
    for (const entry of optionList.entries) {
      if (entry.kind !== "kv") {
        diagnostics.push(`invalid-pattern-option:${family}:${entry.raw}`);
        continue;
      }

      const key = entry.key;
      if (key === "distance") {
        const parsedLength = parseLength(entry.valueRaw, "pt");
        if (parsedLength == null) {
          diagnostics.push(`invalid-pattern-option-value:${family}:distance=${entry.valueRaw}`);
          continue;
        }
        values.distance = parsedLength;
        continue;
      }

      if (key === "angle") {
        const parsedScalar = parseScalar(entry.valueRaw);
        if (parsedScalar == null) {
          diagnostics.push(`invalid-pattern-option-value:${family}:angle=${entry.valueRaw}`);
          continue;
        }
        values.angle = parsedScalar;
        continue;
      }

      if (key === "xshift") {
        const parsedLength = parseLength(entry.valueRaw, "pt");
        if (parsedLength == null) {
          diagnostics.push(`invalid-pattern-option-value:${family}:xshift=${entry.valueRaw}`);
          continue;
        }
        values.xshift = parsedLength;
        continue;
      }

      if (key === "yshift") {
        const parsedLength = parseLength(entry.valueRaw, "pt");
        if (parsedLength == null) {
          diagnostics.push(`invalid-pattern-option-value:${family}:yshift=${entry.valueRaw}`);
          continue;
        }
        values.yshift = parsedLength;
        continue;
      }

      if (key === "line width" && (family === "lines" || family === "hatch")) {
        const parsedLength = parseLength(entry.valueRaw, "pt");
        if (parsedLength == null) {
          diagnostics.push(`invalid-pattern-option-value:${family}:line width=${entry.valueRaw}`);
          continue;
        }
        values.lineWidth = parsedLength;
        continue;
      }

      if (key === "radius" && (family === "dots" || family === "stars")) {
        const parsedLength = parseLength(entry.valueRaw, "pt");
        if (parsedLength == null) {
          diagnostics.push(`invalid-pattern-option-value:${family}:radius=${entry.valueRaw}`);
          continue;
        }
        values.radius = parsedLength;
        continue;
      }

      if (key === "points" && family === "stars") {
        const parsedScalar = parseScalar(entry.valueRaw);
        if (parsedScalar == null || parsedScalar < 2) {
          diagnostics.push(`invalid-pattern-option-value:${family}:points=${entry.valueRaw}`);
          continue;
        }
        values.points = Math.max(2, Math.round(parsedScalar));
        continue;
      }

      diagnostics.push(`unsupported-pattern-option:${family}:${entry.key}`);
    }
  }

  if (family === "lines") {
    return {
      pattern: {
        kind: "meta-lines",
        distance: values.distance,
        angle: values.angle,
        xshift: values.xshift,
        yshift: values.yshift,
        lineWidth: values.lineWidth
      },
      diagnostics
    };
  }

  if (family === "hatch") {
    return {
      pattern: {
        kind: "meta-hatch",
        distance: values.distance,
        angle: values.angle,
        xshift: values.xshift,
        yshift: values.yshift,
        lineWidth: values.lineWidth
      },
      diagnostics
    };
  }

  if (family === "dots") {
    return {
      pattern: {
        kind: "meta-dots",
        distance: values.distance,
        angle: values.angle,
        xshift: values.xshift,
        yshift: values.yshift,
        radius: values.radius
      },
      diagnostics
    };
  }

  return {
    pattern: {
      kind: "meta-stars",
      distance: values.distance,
      angle: values.angle,
      xshift: values.xshift,
      yshift: values.yshift,
      radius: values.radius,
      points: values.points
    },
    diagnostics
  };
}

function defaultMetaPatternValues(style: ResolvedStyle): MetaPatternDefaults {
  return {
    distance: DEFAULT_DISTANCE_PT,
    angle: 0,
    xshift: 0,
    yshift: 0,
    lineWidth: style.lineWidth,
    radius: DEFAULT_RADIUS_PT,
    points: 5
  };
}

function parseScalar(valueRaw: string): number | null {
  const quantity = parseQuantityExpression(normalizeOptionValue(valueRaw));
  if (quantity?.kind !== "scalar" || !Number.isFinite(quantity.value)) {
    return null;
  }
  return quantity.value;
}

import type { TexFuzzCase, TexFuzzFeatureId } from "./model.js";
import type { TexFuzzRandom } from "./random.js";
import { TEX_FUZZ_FEATURE_DEFINITIONS } from "./features.js";

export const TEX_FUZZ_PROFILE_SCHEMA_VERSION = 1 as const;
export const TEX_FUZZ_WEIGHT_SCALE = 10_000 as const;

export interface TexFuzzGenerationProfile {
  readonly version: typeof TEX_FUZZ_PROFILE_SCHEMA_VERSION;
  readonly id: TexFuzzCase["profile"];
  /** Omitted features are deliberately unavailable in this profile. */
  readonly weights: Readonly<Partial<Record<TexFuzzFeatureId, number>>>;
  readonly depth: { readonly typical: number; readonly maximum: number };
  readonly size: { readonly typical: number; readonly maximum: number };
}

const COVERAGE_ALIAS_FEATURES = new Set<TexFuzzFeatureId>(["text.bold", "text.italic", "box.fbox"]);

function rawGeneratedWeights(scope: "inline" | "document"): Readonly<Record<string, number>> {
  const weights: Record<string, number> = {};
  for (const definition of Object.values(TEX_FUZZ_FEATURE_DEFINITIONS)) {
    if (definition === undefined) continue;
    if (definition.support === "oracle-canary" || COVERAGE_ALIAS_FEATURES.has(definition.id)) continue;
    const documentFeature = definition.mode === "document" || definition.id.startsWith("math.display.");
    if (scope === "inline" && documentFeature) continue;
    let weight = 100;
    if (definition.id.startsWith("text.font-command.")) weight = 28;
    else if (definition.id.startsWith("text.font-declaration.")) weight = 18;
    else if (definition.id.startsWith("text.style-declaration.")) weight = 25;
    else if (definition.id.startsWith("box.text.")) weight = 30;
    else if (definition.id.startsWith("box.dimension.")) weight = 45;
    else if (definition.id.startsWith("math.display.")) weight = 45;
    else if (definition.id.startsWith("document.environment.")) weight = 40;
    else if (definition.id.startsWith("document.vertical-glue.")) weight = 45;
    else if (definition.id.startsWith("document.alignment.")) weight = 50;
    weights[definition.id] = weight;
  }
  return weights;
}

function profileWeights(
  scope: "inline" | "document",
  overrides: Readonly<Record<string, number>> = {}
): Readonly<Partial<Record<TexFuzzFeatureId, number>>> {
  return normalizeTexFuzzWeights({ ...rawGeneratedWeights(scope), ...overrides });
}

const VERTICAL_WEIGHTS = profileWeights("inline");
const AGGRESSIVE_WEIGHTS = profileWeights("inline", {
  "text.group": 180,
  "text.line-break": 160,
  "box.raisebox": 140,
  "box.rule": 140,
});
const DOCUMENT_WEIGHTS = profileWeights("document", {
  "document.paragraph-break": 180,
  "document.item": 160,
  "document.penalty": 140,
  "document.vertical-rule": 140,
});
const MALFORMED_WEIGHTS = profileWeights("inline", {
  "text.line-break": 220,
  "text.group": 200,
  "box.raisebox": 160,
  "box.rule": 160,
});

export const TEX_FUZZ_PROFILES: Readonly<Record<TexFuzzCase["profile"], TexFuzzGenerationProfile>> = {
  "vertical-slice": {
    version: TEX_FUZZ_PROFILE_SCHEMA_VERSION,
    id: "vertical-slice",
    weights: VERTICAL_WEIGHTS,
    depth: { typical: 3, maximum: 15 },
    size: { typical: 4, maximum: 64 },
  },
  canary: {
    version: TEX_FUZZ_PROFILE_SCHEMA_VERSION,
    id: "canary",
    weights: profileWeights("inline", { "oracle.supported-command": 9_100 }),
    depth: { typical: 1, maximum: 3 },
    size: { typical: 1, maximum: 8 },
  },
  aggressive: {
    version: TEX_FUZZ_PROFILE_SCHEMA_VERSION,
    id: "aggressive",
    weights: AGGRESSIVE_WEIGHTS,
    depth: { typical: 8, maximum: 15 },
    size: { typical: 16, maximum: 64 },
  },
  "supported-aggressive": {
    version: TEX_FUZZ_PROFILE_SCHEMA_VERSION,
    id: "supported-aggressive",
    // This lane uses the same feature vocabulary as aggressive generation,
    // but smaller individual cases make bounded support-aware rejection
    // sampling practical while retaining real nested generated syntax.
    weights: AGGRESSIVE_WEIGHTS,
    depth: { typical: 3, maximum: 6 },
    size: { typical: 4, maximum: 8 },
  },
  document: {
    version: TEX_FUZZ_PROFILE_SCHEMA_VERSION,
    id: "document",
    weights: DOCUMENT_WEIGHTS,
    depth: { typical: 5, maximum: 12 },
    size: { typical: 12, maximum: 64 },
  },
  malformed: {
    version: TEX_FUZZ_PROFILE_SCHEMA_VERSION,
    id: "malformed",
    weights: MALFORMED_WEIGHTS,
    depth: { typical: 4, maximum: 10 },
    size: { typical: 8, maximum: 32 },
  },
};

export interface TexFuzzWeightedChoice<T extends string> {
  readonly value: T;
  readonly weight: number;
}

/**
 * Converts finite non-negative configuration weights to an exact integer sum.
 * Largest-remainder allocation is deterministic; ties use lexical key order.
 */
export function normalizeTexFuzzWeights<T extends string>(
  weights: Readonly<Record<T, number>>,
  scale: number = TEX_FUZZ_WEIGHT_SCALE
): Readonly<Record<T, number>> {
  if (!Number.isSafeInteger(scale) || scale <= 0) throw new RangeError("Weight scale must be a positive safe integer.");
  const entries = Object.entries(weights) as [T, number][];
  if (entries.length === 0) throw new RangeError("Cannot normalize an empty weight table.");
  let total = 0;
  for (const [key, weight] of entries) {
    if (!Number.isFinite(weight) || weight < 0) throw new RangeError(`Invalid weight ${String(weight)} for ${key}.`);
    total += weight;
  }
  if (!(total > 0)) throw new RangeError("At least one weight must be positive.");

  const allocated = entries.map(([key, weight]) => {
    const exact = weight / total * scale;
    const floor = Math.floor(exact);
    return { key, floor, remainder: exact - floor };
  });
  let remaining = scale - allocated.reduce((sum, entry) => sum + entry.floor, 0);
  allocated.sort((left, right) => right.remainder - left.remainder || left.key.localeCompare(right.key));
  for (let index = 0; index < allocated.length && remaining > 0; index += 1, remaining -= 1) {
    allocated[index].floor += 1;
  }
  return Object.fromEntries(
    allocated.sort((left, right) => left.key.localeCompare(right.key)).map(({ key, floor }) => [key, floor])
  ) as Readonly<Record<T, number>>;
}

export function pickWeightedTexFuzzValue<T extends string>(
  random: TexFuzzRandom,
  path: string,
  choices: readonly TexFuzzWeightedChoice<T>[]
): T {
  if (choices.length === 0) throw new RangeError(`Cannot choose from empty weights at ${path}.`);
  let total = 0;
  for (const choice of choices) {
    if (!Number.isSafeInteger(choice.weight) || choice.weight < 0) {
      throw new RangeError(`Invalid integer weight ${choice.weight} for ${choice.value}.`);
    }
    total += choice.weight;
  }
  if (!Number.isSafeInteger(total) || total <= 0 || total > 0x1_0000_0000) {
    throw new RangeError(`Invalid total integer weight ${total} at ${path}.`);
  }
  const target = random.int(path, total);
  let cursor = 0;
  for (const choice of choices) {
    cursor += choice.weight;
    if (target < cursor) return choice.value;
  }
  throw new Error("Weighted TeX fuzz choice did not resolve.");
}

/** Integer-only novelty boost. Unseen features receive the largest multiplier. */
export function adaptTexFuzzWeights<T extends string>(
  baseWeights: Readonly<Record<T, number>>,
  featureCounts: Readonly<Record<string, number>>,
  options: { readonly noveltyBudget?: number; readonly scale?: number } = {}
): Readonly<Record<T, number>> {
  const noveltyBudget = options.noveltyBudget ?? 16;
  if (!Number.isSafeInteger(noveltyBudget) || noveltyBudget < 0) {
    throw new RangeError("Novelty budget must be a non-negative safe integer.");
  }
  const adjusted = {} as Record<T, number>;
  for (const [feature, base] of Object.entries(baseWeights) as [T, number][]) {
    if (!Number.isSafeInteger(base) || base < 0) throw new RangeError(`Invalid base weight ${base} for ${feature}.`);
    const observed = featureCounts[feature] ?? 0;
    if (!Number.isSafeInteger(observed) || observed < 0) throw new RangeError(`Invalid feature count ${observed} for ${feature}.`);
    adjusted[feature] = base * (1 + Math.floor(noveltyBudget / (observed + 1)));
    if (!Number.isSafeInteger(adjusted[feature])) throw new RangeError(`Adaptive weight overflow for ${feature}.`);
  }
  return normalizeTexFuzzWeights(adjusted, options.scale);
}

/**
 * Samples a bounded budget with a deliberately long, but rare, upper tail.
 *
 * Eighty percent of cases stay in the profile's ordinary band, fifteen
 * percent explore the first tail, and five percent may reach the declared
 * maximum. Keeping the bands integer-only makes a seed replay independent of
 * JavaScript floating-point details.
 */
export function sampleTexFuzzProfileBudget(
  random: TexFuzzRandom,
  path: string,
  distribution: { readonly typical: number; readonly maximum: number }
): number {
  const { typical, maximum } = distribution;
  if (!Number.isSafeInteger(typical) || !Number.isSafeInteger(maximum) || typical < 1 || maximum < typical) {
    throw new RangeError(`Invalid TeX fuzz budget ${typical}..${maximum} at ${path}.`);
  }
  if (typical === maximum) return typical;

  const band = random.int(`${path}/band`, 100);
  const ordinaryMinimum = Math.max(1, Math.floor(typical / 2));
  if (band < 80) return ordinaryMinimum + random.int(`${path}/ordinary`, typical - ordinaryMinimum + 1);

  const firstTailMaximum = Math.min(maximum, Math.max(typical + 1, typical * 2));
  if (band < 95 || firstTailMaximum === maximum) {
    return typical + 1 + random.int(`${path}/first-tail`, firstTailMaximum - typical);
  }
  return firstTailMaximum + 1 + random.int(`${path}/long-tail`, maximum - firstTailMaximum);
}

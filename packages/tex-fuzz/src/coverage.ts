/** Versioned semantic telemetry; adding or renaming a key requires a version bump. */
export const TEX_FUZZ_COVERAGE_SCHEMA_VERSION = 1 as const;

export interface TexFuzzCoverageCase {
  readonly features: readonly string[];
  readonly ast: readonly unknown[];
  readonly source: string;
}

export interface TexFuzzCoverage {
  readonly version: typeof TEX_FUZZ_COVERAGE_SCHEMA_VERSION;
  readonly caseCount: number;
  readonly featureCounts: Readonly<Record<string, number>>;
  readonly featurePairCounts: Readonly<Record<string, number>>;
  readonly featureTripleCounts: Readonly<Record<string, number>>;
  readonly nodeKindCounts: Readonly<Record<string, number>>;
  readonly nodeDepthCounts: Readonly<Record<string, number>>;
  readonly maximumDepthCounts: Readonly<Record<string, number>>;
  readonly boundaryCounts: Readonly<Record<string, number>>;
  readonly unicodeBlockCounts: Readonly<Record<string, number>>;
  readonly unicodeNormalizationCounts: Readonly<Record<string, number>>;
}

type MutableCounts = Record<string, number>;

interface MutableCoverage {
  caseCount: number;
  featureCounts: MutableCounts;
  featurePairCounts: MutableCounts;
  featureTripleCounts: MutableCounts;
  nodeKindCounts: MutableCounts;
  nodeDepthCounts: MutableCounts;
  maximumDepthCounts: MutableCounts;
  boundaryCounts: MutableCounts;
  unicodeBlockCounts: MutableCounts;
  unicodeNormalizationCounts: MutableCounts;
}

export function measureTexFuzzCoverage(cases: readonly TexFuzzCoverageCase[]): TexFuzzCoverage {
  const coverage = emptyMutableCoverage();
  for (const caseData of cases) {
    addCase(coverage, caseData);
  }
  return freezeCoverage(coverage);
}

export function mergeTexFuzzCoverage(reports: readonly TexFuzzCoverage[]): TexFuzzCoverage {
  const merged = emptyMutableCoverage();
  for (const report of reports) {
    if (report.version !== TEX_FUZZ_COVERAGE_SCHEMA_VERSION) {
      throw new RangeError(`Unsupported TeX fuzz coverage schema ${String(report.version)}.`);
    }
    merged.caseCount += report.caseCount;
    mergeCounts(merged.featureCounts, report.featureCounts);
    mergeCounts(merged.featurePairCounts, report.featurePairCounts);
    mergeCounts(merged.featureTripleCounts, report.featureTripleCounts);
    mergeCounts(merged.nodeKindCounts, report.nodeKindCounts);
    mergeCounts(merged.nodeDepthCounts, report.nodeDepthCounts);
    mergeCounts(merged.maximumDepthCounts, report.maximumDepthCounts);
    mergeCounts(merged.boundaryCounts, report.boundaryCounts);
    mergeCounts(merged.unicodeBlockCounts, report.unicodeBlockCounts);
    mergeCounts(merged.unicodeNormalizationCounts, report.unicodeNormalizationCounts);
  }
  return freezeCoverage(merged);
}

/** Stable JSON tuple keys avoid delimiter collisions as feature names evolve. */
export function texFuzzCombinationKey(values: readonly string[]): string {
  return JSON.stringify(values);
}

function addCase(coverage: MutableCoverage, caseData: TexFuzzCoverageCase): void {
  coverage.caseCount += 1;
  const features = [...new Set(caseData.features)].sort();
  for (const feature of features) increment(coverage.featureCounts, feature);
  combinations(features, 2, (values) => {
    increment(coverage.featurePairCounts, texFuzzCombinationKey(values));
  });
  combinations(features, 3, (values) => {
    increment(coverage.featureTripleCounts, texFuzzCombinationKey(values));
  });

  let maximumDepth = 0;
  const visit = (value: unknown, depth: number): void => {
    if (!isRecord(value) || typeof value.kind !== "string") return;
    maximumDepth = Math.max(maximumDepth, depth);
    const kind = value.kind;
    increment(coverage.nodeKindCounts, kind);
    increment(coverage.nodeDepthCounts, `${kind}@${depth}`);
    const children = Array.isArray(value.children) ? value.children : [];
    if ("children" in value) {
      increment(coverage.boundaryCounts, `children:${kind}:${cardinality(children.length)}`);
    }
    for (const child of children) visit(child, depth + 1);
    for (const key of ["body", "base", "numerator", "denominator", "degree", "subscript", "superscript", "script", "above", "below"] as const) {
      visit(value[key], depth + 1);
    }
    if (Array.isArray(value.items)) value.items.forEach((item) => { visit(item, depth + 1); });
    if (Array.isArray(value.cells)) {
      value.cells.forEach((row) => {
        if (Array.isArray(row)) row.forEach((cell) => { visit(cell, depth + 1); });
      });
    }
  };
  increment(coverage.boundaryCounts, `root:${cardinality(caseData.ast.length)}`);
  for (const node of caseData.ast) visit(node, 0);
  increment(coverage.maximumDepthCounts, String(maximumDepth));
  collectSourceBoundaries(caseData.source, coverage.boundaryCounts);
  collectUnicode(caseData.source, coverage.unicodeBlockCounts, coverage.unicodeNormalizationCounts);
}

function collectSourceBoundaries(source: string, counts: MutableCounts): void {
  const points = [...source];
  increment(counts, `source-length:${lengthBucket(points.length)}`);
  if (points.length === 0) {
    increment(counts, "source:start:empty");
    increment(counts, "source:end:empty");
    return;
  }
  const classes = points.map(characterClass);
  increment(counts, `source:start:${classes[0]}`);
  increment(counts, `source:end:${classes[classes.length - 1]}`);
  for (let index = 0; index < classes.length - 1; index += 1) {
    if (classes[index] !== classes[index + 1]) {
      increment(counts, `source-transition:${classes[index]}>${classes[index + 1]}`);
    }
  }
  const tokenBoundaries: Readonly<Record<string, string>> = {
    "{": "group-open",
    "}": "group-close",
    "$": "math-delimiter",
    "\\": "control-sequence",
    "~": "tie",
  };
  for (const point of points) {
    const boundary = tokenBoundaries[point];
    if (boundary !== undefined) increment(counts, `token:${boundary}`);
  }
}

function collectUnicode(source: string, blocks: MutableCounts, normalization: MutableCounts): void {
  if ([...source].every((point) => (point.codePointAt(0) ?? 0) <= 0x7f)) increment(normalization, "ascii");
  if (source === source.normalize("NFC")) increment(normalization, "NFC");
  if (source === source.normalize("NFD")) increment(normalization, "NFD");
  if (source === source.normalize("NFKC")) increment(normalization, "NFKC");
  if (source === source.normalize("NFKD")) increment(normalization, "NFKD");
  const seen = new Set<string>();
  for (const point of source) {
    seen.add(unicodeBlock(point.codePointAt(0) ?? 0));
  }
  for (const block of [...seen].sort()) increment(blocks, block);
}

function unicodeBlock(codePoint: number): string {
  if (codePoint <= 0x007f) return "Basic Latin";
  if (codePoint <= 0x00ff) return "Latin-1 Supplement";
  if (codePoint <= 0x017f) return "Latin Extended-A";
  if (codePoint <= 0x024f) return "Latin Extended-B";
  if (codePoint >= 0x0300 && codePoint <= 0x036f) return "Combining Diacritical Marks";
  if (codePoint >= 0x0370 && codePoint <= 0x03ff) return "Greek and Coptic";
  if (codePoint >= 0x0400 && codePoint <= 0x04ff) return "Cyrillic";
  if (codePoint >= 0x0590 && codePoint <= 0x05ff) return "Hebrew";
  if (codePoint >= 0x0600 && codePoint <= 0x06ff) return "Arabic";
  if (codePoint >= 0x2000 && codePoint <= 0x206f) return "General Punctuation";
  if (codePoint >= 0x2100 && codePoint <= 0x214f) return "Letterlike Symbols";
  if (codePoint >= 0x2200 && codePoint <= 0x22ff) return "Mathematical Operators";
  if (codePoint >= 0x4e00 && codePoint <= 0x9fff) return "CJK Unified Ideographs";
  if (codePoint >= 0xac00 && codePoint <= 0xd7af) return "Hangul Syllables";
  if (codePoint >= 0x1f000 && codePoint <= 0x1faff) return "Symbols and Pictographs";
  return `Other plane ${Math.floor(codePoint / 0x1_0000)}`;
}

function characterClass(point: string): string {
  if (/\p{Mark}/u.test(point)) return "combining-mark";
  if (/\s/u.test(point)) return "whitespace";
  if (point === "\\") return "control";
  if (point === "{" || point === "}") return "group";
  if (point === "$") return "math";
  if (point === "~") return "tie";
  if ((point.codePointAt(0) ?? 0) <= 0x7f) return "ascii";
  return "unicode";
}

function cardinality(length: number): "empty" | "singleton" | "multiple" {
  return length === 0 ? "empty" : length === 1 ? "singleton" : "multiple";
}

function lengthBucket(length: number): string {
  if (length === 0) return "empty";
  if (length === 1) return "singleton";
  if (length <= 8) return "2-8";
  if (length <= 32) return "9-32";
  return "33+";
}

function combinations(values: readonly string[], size: number, emit: (values: readonly string[]) => void): void {
  const selected: string[] = [];
  const choose = (start: number): void => {
    if (selected.length === size) {
      emit([...selected]);
      return;
    }
    for (let index = start; index <= values.length - (size - selected.length); index += 1) {
      selected.push(values[index]);
      choose(index + 1);
      selected.pop();
    }
  };
  choose(0);
}

function emptyMutableCoverage(): MutableCoverage {
  return {
    caseCount: 0,
    featureCounts: {},
    featurePairCounts: {},
    featureTripleCounts: {},
    nodeKindCounts: {},
    nodeDepthCounts: {},
    maximumDepthCounts: {},
    boundaryCounts: {},
    unicodeBlockCounts: {},
    unicodeNormalizationCounts: {},
  };
}

function freezeCoverage(coverage: MutableCoverage): TexFuzzCoverage {
  return {
    version: TEX_FUZZ_COVERAGE_SCHEMA_VERSION,
    caseCount: coverage.caseCount,
    featureCounts: sortedCounts(coverage.featureCounts),
    featurePairCounts: sortedCounts(coverage.featurePairCounts),
    featureTripleCounts: sortedCounts(coverage.featureTripleCounts),
    nodeKindCounts: sortedCounts(coverage.nodeKindCounts),
    nodeDepthCounts: sortedCounts(coverage.nodeDepthCounts),
    maximumDepthCounts: sortedCounts(coverage.maximumDepthCounts),
    boundaryCounts: sortedCounts(coverage.boundaryCounts),
    unicodeBlockCounts: sortedCounts(coverage.unicodeBlockCounts),
    unicodeNormalizationCounts: sortedCounts(coverage.unicodeNormalizationCounts),
  };
}

function sortedCounts(counts: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function increment(counts: MutableCounts, key: string, amount = 1): void {
  counts[key] = (counts[key] ?? 0) + amount;
}

function mergeCounts(target: MutableCounts, source: Readonly<Record<string, number>>): void {
  for (const [key, value] of Object.entries(source)) increment(target, key, value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

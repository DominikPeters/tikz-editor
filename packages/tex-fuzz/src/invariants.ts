import {
  createTexDerivedInlineMathBoxProvider,
  layoutSimpleTexParagraph,
  parseSimpleTexParagraphIr,
} from "@tikz-editor/core/text/tex/index.js";
import type {
  TexFuzzCase,
  TexFuzzFingerprint,
  TexFuzzNode,
  TexFuzzObservation,
  TexFuzzSourceSpan,
} from "./model.js";

interface RangeLike {
  readonly kind?: unknown;
  readonly reason?: unknown;
  readonly sourceStart?: unknown;
  readonly sourceEnd?: unknown;
  readonly children?: unknown;
  readonly nodes?: unknown;
  readonly body?: unknown;
  readonly blocks?: unknown;
  readonly items?: unknown;
}

function collectObjects(value: unknown, seen: Set<object>, output: RangeLike[]): void {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return;
  }
  seen.add(value);
  const record = value as RangeLike;
  output.push(record);
  for (const child of [record.children, record.nodes, record.body, record.blocks, record.items]) {
    if (Array.isArray(child)) {
      child.forEach((item) => {
        collectObjects(item, seen, output);
      });
    } else {
      collectObjects(child, seen, output);
    }
  }
}

function hardFingerprint(caseData: TexFuzzCase, code: string, structuralLocus: string): TexFuzzFingerprint {
  return {
    version: 1,
    resultClass: "hard-invariant",
    code,
    featureTags: caseData.features,
    mode: "text",
    structuralLocus,
  };
}

const noHyphenation = { hyphenate: (): number[] => [] };

export const TEX_FUZZ_HARD_INVARIANT_WIDTHS = [48, 160, 480] as const;

type TexFuzzLayoutResult = ReturnType<typeof layoutSimpleTexParagraph>;

interface ContentObligation {
  readonly path: string;
  readonly kind: string;
  readonly start: number;
  readonly end: number;
  readonly requiresPaintedText: boolean;
}

const TEX_ACCENT_MARKS: Readonly<Record<"'" | "`" | "^", string>> = {
  "'": "\u0301",
  "`": "\u0300",
  "^": "\u0302",
};

/**
 * Canonicalize the semantic prose stream rather than its TeX spelling. TeX
 * collapses ordinary spaces and may discard them at command, box, and line
 * boundaries. Whitespace geometry has separate run/segment invariants, so the
 * preservation stream removes it entirely. NFC makes `\\'{e}` and a
 * precomposed `é` comparable without weakening any non-whitespace content.
 */
function normalizeSemanticProse(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, "");
}

interface SemanticProseLeaf {
  readonly span: TexFuzzSourceSpan;
  readonly text: string;
}

function semanticProseLeaves(caseData: TexFuzzCase): readonly SemanticProseLeaf[] {
  const spansByPath = new Map(caseData.sourceMap.map((span) => [span.path, span]));
  const leaves: SemanticProseLeaf[] = [];
  const add = (path: string, text: string): void => {
    const span = spansByPath.get(path);
    if (span) leaves.push({ span, text });
  };
  const visit = (nodes: readonly TexFuzzNode[], parentPath: string, hidden: boolean): void => {
    for (const [index, node] of nodes.entries()) {
      const path = `${parentPath}/${index}`;
      if (hidden) continue;
      switch (node.kind) {
        case "text": add(path, node.value); break;
        case "space": add(path, " "); break;
        case "accent": add(path, `${node.base}${TEX_ACCENT_MARKS[node.command]}`); break;
        case "oracle-command": add(path, node.command); break;
        case "line-break": add(path, " "); break;
        case "group":
        case "font":
        case "font-declaration":
        case "style-declaration":
        case "color":
        case "box":
        case "raisebox":
        case "document-box":
        case "environment":
          visit(node.children, `${path}/children`, false);
          break;
        case "dimension-box":
          // All phantom variants hide their children. Smash retains painting
          // and changes only the reported vertical dimensions.
          visit(node.children, `${path}/children`, node.command !== "smash");
          break;
        case "item":
          if (node.label) visit(node.label, `${path}/label`, false);
          break;
        case "math":
        case "display-math":
        case "rule":
        case "paragraph-break":
        case "noindent":
        case "alignment":
        case "vertical-glue":
        case "penalty":
        case "vertical-rule":
          break;
      }
    }
  };
  visit(caseData.ast, "root", false);
  return leaves;
}

function expectedSemanticProse(caseData: TexFuzzCase): string {
  return normalizeSemanticProse(semanticProseLeaves(caseData).map((leaf) => leaf.text).join(""));
}

function semanticControlRanges(caseData: TexFuzzCase): {
  readonly hidden: readonly TexFuzzSourceSpan[];
} {
  const spansByPath = new Map(caseData.sourceMap.map((span) => [span.path, span]));
  const hidden: TexFuzzSourceSpan[] = [];
  const visit = (nodes: readonly TexFuzzNode[], parentPath: string): void => {
    nodes.forEach((node, index) => {
      const path = `${parentPath}/${index}`;
      if (node.kind === "line-break") return;
      if (node.kind === "dimension-box" && node.command !== "smash") {
        const span = spansByPath.get(path);
        if (span) hidden.push(span);
        return;
      }
      if ("children" in node) visit(node.children, `${path}/children`);
      if (node.kind === "item" && node.label) visit(node.label, `${path}/label`);
    });
  };
  visit(caseData.ast, "root");
  return { hidden };
}

function paintedSemanticProse(caseData: TexFuzzCase, result: TexFuzzLayoutResult): string {
  const controls = semanticControlRanges(caseData);
  const semanticLeaves = semanticProseLeaves(caseData);
  const lines = result.report?.lines.map((line) => normalizeSemanticProse(
    line.segments
      .filter((segment) => segment.sourceKind !== "math")
      .map((segment) => {
        const range = typeof segment.sourceStartRaw === "number" && typeof segment.sourceEndRaw === "number"
          ? { start: segment.sourceStartRaw, end: segment.sourceEndRaw }
          : null;
        if (range && controls.hidden.some((span) =>
          range.start >= span.start && range.end <= span.end
        )) return "";
        // Text boxes are one atomic `math` report segment whose `text` field is
        // source-like metadata (often including commands), while their SVG
        // paints nested semantic prose. Reconstruct only these atomic segments
        // from their attributed leaves. Ordinary text segments still use the
        // renderer's actual text, so substitutions cannot hide behind spans.
        if (range && segment.kind === "math") {
          return semanticLeaves
            .filter((leaf) => leaf.span.start >= range.start && leaf.span.end <= range.end)
            .map((leaf) => leaf.text)
            .join("");
        }
        return segment.text ?? "";
      })
      .join("")
  )) ?? [];
  // A discarded interword space and an explicit line break are both semantic
  // word boundaries. Empty lines do not add additional prose.
  return normalizeSemanticProse(lines.filter((line) => line.length > 0).join(" "));
}

function levenshteinDistance(left: string, right: string): number | null {
  const a = [...left];
  const b = [...right];
  // Keep an adversarially large literal from turning a diagnostic into a
  // quadratic denial of service. Exact equality remains the pass criterion.
  if (a.length * b.length > 1_000_000) return null;
  let previous = b.map((_, index) => index + 1);
  previous.unshift(0);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        (previous[column] ?? 0) + 1,
        (current[column - 1] ?? 0) + 1,
        (previous[column - 1] ?? 0) + (a[row - 1] === b[column - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

function compactContentDiff(expected: string, actual: string): Readonly<Record<string, unknown>> {
  const expectedPoints = [...expected];
  const actualPoints = [...actual];
  let prefix = 0;
  while (prefix < expectedPoints.length && prefix < actualPoints.length
    && expectedPoints[prefix] === actualPoints[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < expectedPoints.length - prefix && suffix < actualPoints.length - prefix
    && expectedPoints[expectedPoints.length - 1 - suffix] === actualPoints[actualPoints.length - 1 - suffix]) suffix += 1;
  const contextStart = Math.max(0, prefix - 16);
  const expectedEnd = Math.min(expectedPoints.length, expectedPoints.length - suffix + 16);
  const actualEnd = Math.min(actualPoints.length, actualPoints.length - suffix + 16);
  return {
    editDistance: levenshteinDistance(expected, actual),
    expectedLength: expectedPoints.length,
    actualLength: actualPoints.length,
    firstDifference: prefix,
    expectedContext: expectedPoints.slice(contextStart, expectedEnd).join(""),
    actualContext: actualPoints.slice(contextStart, actualEnd).join(""),
  };
}

function visibleContentObligations(caseData: TexFuzzCase): readonly ContentObligation[] {
  const spansByPath = new Map(caseData.sourceMap.map((span) => [span.path, span]));
  const obligations: ContentObligation[] = [];
  const add = (path: string, fallbackKind: string): void => {
    const span = spansByPath.get(path);
    if (span && span.end > span.start) {
      obligations.push({
        path,
        kind: span.kind ?? fallbackKind,
        start: span.start,
        end: span.end,
        requiresPaintedText: fallbackKind === "text",
      });
    }
  };
  const visit = (nodes: readonly TexFuzzNode[], parentPath: string, hidden: boolean): void => {
    nodes.forEach((node, index) => {
      const path = `${parentPath}/${index}`;
      if (hidden) return;
      switch (node.kind) {
        case "text":
          if (node.value.length > 0) add(path, node.kind);
          return;
        case "accent":
        case "math":
        case "oracle-command":
          add(path, node.kind);
          return;
        case "display-math":
          // Display material is represented in the vertical-list report rather
          // than necessarily in the combined paragraph report checked here.
          return;
        case "group":
        case "font":
        case "font-declaration":
        case "style-declaration":
        case "color":
        case "box":
        case "raisebox":
        case "document-box":
        case "environment":
          visit(node.children, `${path}/children`, false);
          return;
        case "dimension-box":
          // Phantom variants deliberately consume content without painting it.
          visit(node.children, `${path}/children`, node.command !== "smash");
          return;
        case "item":
          if (node.label) visit(node.label, `${path}/label`, false);
          return;
        case "space":
        case "line-break":
        case "rule":
        case "paragraph-break":
        case "noindent":
        case "alignment":
        case "vertical-glue":
        case "penalty":
        case "vertical-rule":
          return;
      }
    });
  };
  visit(caseData.ast, "root", false);
  return obligations;
}

function rangesOverlap(left: Pick<TexFuzzSourceSpan, "start" | "end">, right: Pick<TexFuzzSourceSpan, "start" | "end">): boolean {
  return left.start < right.end && right.start < left.end;
}

/**
 * Check one already-computed layout. Exported so renderer mutation tests can
 * prove that a corrupted report is rejected without patching production code.
 */
export function checkTexFuzzLayoutResultInvariants(
  caseData: TexFuzzCase,
  width: number,
  result: TexFuzzLayoutResult
): readonly TexFuzzObservation[] {
  const findings: TexFuzzObservation[] = [];
  // A document report can concatenate paragraphs, list labels, and other
  // vertical-list fragments whose local x coordinates are intentionally not
  // one continuous horizontal flow. Paragraph profiles do have that contract.
  const expectLinearSegmentFlow = caseData.profile !== "document";
  const add = (code: string, locus: string, detail: Readonly<Record<string, unknown>>): void => {
    findings.push({ fingerprint: hardFingerprint(caseData, code, `${locus}/width-${width}`), detail: { width, ...detail } });
  };
  if (!result.report) return findings;

  const finite = (value: number): boolean => Number.isFinite(value);
  const paintedRanges: Array<TexFuzzSourceSpan & { readonly text?: string }> = [];
  for (const line of result.report.lines) {
    const lineMetrics = [line.width, line.targetWidth, line.naturalWidth, line.ascent, line.descent, line.xStart, line.xEnd];
    if (lineMetrics.some((value) => !finite(value))) {
      add("non-finite-layout-geometry", `paragraph/line/${line.lineIndex}`, { lineMetrics });
    }
    if (line.width < 0 || line.targetWidth < 0 || line.naturalWidth < 0 || line.ascent < 0 || line.descent < 0) {
      add("negative-layout-extent", `paragraph/line/${line.lineIndex}`, { lineMetrics });
    }
    for (const [segmentIndex, segment] of line.segments.entries()) {
      if (!finite(segment.x) || !finite(segment.width) || segment.width < 0) {
        add("invalid-segment-geometry", `paragraph/line/${line.lineIndex}/${segment.kind}/${segmentIndex}`, {
          x: segment.x,
          width: segment.width,
        });
      }
      const stops = segment.caretStops ?? [];
      if (stops.some((value) => !finite(value))
        || stops.some((value, index) => index > 0 && value < stops[index - 1])) {
        add("invalid-caret-stops", `paragraph/line/${line.lineIndex}/${segment.kind}`, { stops });
      }
      for (const entry of segment.mathCaretEntries ?? []) {
        if (entry.sourceOffsetRaw < 0 || entry.sourceOffsetRaw > caseData.source.length
          || ![entry.x, entry.y, entry.height, entry.depth].every(finite)) {
          add("invalid-math-caret-entry", `paragraph/line/${line.lineIndex}/math`, { entry });
        }
      }
      if (typeof segment.sourceStartRaw === "number" && typeof segment.sourceEndRaw === "number"
        && segment.sourceEndRaw > segment.sourceStartRaw) {
        paintedRanges.push({
          path: `report/${line.lineIndex}/${segmentIndex}`,
          kind: segment.kind,
          start: segment.sourceStartRaw,
          end: segment.sourceEndRaw,
          text: segment.text,
        });
      }
      const next = line.segments[segmentIndex + 1];
      if (expectLinearSegmentFlow && next && [segment.x, segment.width, next.x].every(finite)
        && Math.abs(segment.x + segment.width - next.x) > 1e-4) {
        add("segment-flow-mismatch", `paragraph/line/${line.lineIndex}/${segmentIndex}`, {
          segmentEnd: segment.x + segment.width,
          nextStart: next.x,
        });
      }
    }
    const last = line.segments.at(-1);
    if (expectLinearSegmentFlow && last && [last.x, last.width, line.xEnd].every(finite)
      && Math.abs(last.x + last.width - line.xEnd) > 1e-4) {
      add("segment-flow-mismatch", `paragraph/line/${line.lineIndex}/end`, {
        segmentEnd: last.x + last.width,
        lineEnd: line.xEnd,
      });
    }
  }

  // Mutated/malformed input has a deliberately stale AST/source map. Document
  // display and vertical material is checked by its dedicated vlist runners.
  // Unsupported fallback output is not expected to preserve painted leaves.
  if (caseData.profile !== "malformed" && caseData.profile !== "document"
    && result.supported && result.fallbackReason === null) {
    for (const obligation of visibleContentObligations(caseData)) {
      if (!paintedRanges.some((range) => rangesOverlap(obligation, range)
        && (!obligation.requiresPaintedText || (range.text?.length ?? 0) > 0))) {
        add("visible-content-loss", `paragraph/content/${obligation.kind}`, { obligation });
      }
    }
    const expected = expectedSemanticProse(caseData);
    const hasLiteralDegradation = result.report.lines.some((line) =>
      line.segments.some((segment) => segment.literal !== undefined)
    );
    const actual = hasLiteralDegradation ? expected : paintedSemanticProse(caseData, result);
    if (!hasLiteralDegradation && expected !== actual) {
      add("visible-content-mismatch", "paragraph/content/semantic-prose", {
        ...compactContentDiff(expected, actual),
      });
    }
  }
  return findings;
}

function layoutInvariantFindings(caseData: TexFuzzCase): readonly TexFuzzObservation[] {
  const mathBoxProvider = createTexDerivedInlineMathBoxProvider();
  const findings: TexFuzzObservation[] = [];
  const results = TEX_FUZZ_HARD_INVARIANT_WIDTHS.flatMap((width) => {
    try {
      return [{
        width,
        result: layoutSimpleTexParagraph(caseData.source, {
          width,
          fallbackPolicy: "placeholder" as const,
          hyphenator: noHyphenation,
          mathBoxProvider,
        }),
      }];
    } catch (error) {
      findings.push({
        fingerprint: hardFingerprint(caseData, "layout-exception", `paragraph/layout/width-${width}`),
        detail: { width, message: error instanceof Error ? error.message : String(error) },
      });
      return [];
    }
  });
  findings.push(...results.flatMap(({ width, result }) =>
    checkTexFuzzLayoutResultInvariants(caseData, width, result)
  ));
  const ordinary = results.find(({ width }) => width === 160)?.result;
  if (!ordinary) return findings;
  let repeated: TexFuzzLayoutResult;
  try {
    repeated = layoutSimpleTexParagraph(caseData.source, {
      width: 160,
      fallbackPolicy: "placeholder" as const,
      hyphenator: noHyphenation,
      mathBoxProvider,
    });
  } catch (error) {
    findings.push({
      fingerprint: hardFingerprint(caseData, "layout-exception", "paragraph/layout/repeat/width-160"),
      detail: { width: 160, message: error instanceof Error ? error.message : String(error) },
    });
    return findings;
  }
  if (JSON.stringify(ordinary.report) !== JSON.stringify(repeated.report)
    || JSON.stringify(ordinary.vlistLayout) !== JSON.stringify(repeated.vlistLayout)
    || ordinary.supported !== repeated.supported
    || ordinary.fallbackReason !== repeated.fallbackReason) {
    findings.push({
      fingerprint: hardFingerprint(caseData, "repeat-layout-nondeterminism", "paragraph/layout/width-160"),
      detail: { width: 160 },
    });
  }
  return findings;
}

export function checkTexFuzzHardInvariants(caseData: TexFuzzCase): readonly TexFuzzObservation[] {
  const findings: TexFuzzObservation[] = [];
  for (const span of caseData.sourceMap) {
    if (span.start < 0 || span.end < span.start || span.end > caseData.source.length) {
      findings.push({
        fingerprint: hardFingerprint(caseData, "fuzz-source-map-range", span.kind),
        detail: { span },
      });
    }
  }

  const parsed = parseSimpleTexParagraphIr(caseData.source);
  const objects: RangeLike[] = [];
  collectObjects(parsed, new Set(), objects);
  for (const object of objects) {
    if (typeof object.sourceStart !== "number" || typeof object.sourceEnd !== "number") {
      continue;
    }
    if (
      !Number.isSafeInteger(object.sourceStart) ||
      !Number.isSafeInteger(object.sourceEnd) ||
      object.sourceStart < 0 ||
      object.sourceEnd < object.sourceStart ||
      object.sourceEnd > caseData.source.length
    ) {
      findings.push({
        fingerprint: hardFingerprint(
          caseData,
          "core-source-range",
          typeof object.kind === "string" ? object.kind : "unknown"
        ),
        detail: { sourceStart: object.sourceStart, sourceEnd: object.sourceEnd },
      });
    }
  }
  findings.push(...layoutInvariantFindings(caseData));
  return findings;
}

export function texFuzzSourceUsesUnsupportedLiteral(source: string): boolean {
  const parsed = parseSimpleTexParagraphIr(source);
  const objects: RangeLike[] = [];
  collectObjects(parsed, new Set(), objects);
  return objects.some((object) => object.kind === "literal" && object.reason === "unsupported-command");
}

export function differentialSupportFingerprint(caseData: TexFuzzCase): TexFuzzFingerprint {
  return {
    version: 1,
    resultClass: "differential",
    code: "support-classification",
    firstDivergentLayer: "support-classification",
    featureTags: caseData.features.includes("oracle.supported-command")
      ? ["oracle.supported-command"]
      : [],
    mode: "text",
    structuralLocus: "paragraph/command",
    oracleEnvironmentFamily: "lualatex",
  };
}

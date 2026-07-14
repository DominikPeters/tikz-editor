import { describe, expect, it } from "vitest";
import type { ParagraphLayoutReport } from "../packages/core/src/text/knuth-plass/paragraph/report.js";
import {
  getKnuthPlassCaretFromPoint,
  getKnuthPlassPlaceholderGeometry,
  getKnuthPlassPointFromOffset,
  getKnuthPlassSelectionRects,
  getKnuthPlassVListBoxFromPoint,
  getKnuthPlassVListBoxGeometry,
  getKnuthPlassVListGeometrySnapshot,
  getKnuthPlassVListItemFromPoint,
  getKnuthPlassVListItemGeometry,
  getKnuthPlassVListLabelFromPoint,
  getKnuthPlassVListLabelGeometry,
  getKnuthPlassVListParagraphGeometry,
  getKnuthPlassVListSourceHitFromSnapshot,
  getKnuthPlassVListTreeHitFromSnapshot,
} from "../packages/core/src/text/knuth-plass/editor/hitmap.js";
import { clientPoint, px } from "../packages/core/src/coords/index.js";
import {
  classicComputerModernTextFontProfile,
  computerModernTexMetricProvider,
  createTexDerivedInlineMathBoxProvider,
  createSimpleTexLayoutDocumentIr,
  layoutSimpleTexParagraph,
  parseSimpleTexParagraphIr,
  parseTexMath,
  type TexMathBoxProvider,
} from "../packages/core/src/text/tex/index.js";
import { texVListX } from "../packages/core/src/text/tex/coordinates.js";
import {
  layoutTexVListFromMeasuredParagraphs,
  registerTexVListLayoutsOnOutputJax,
  texVListBoxLayoutReport,
  type PositionedTexVListItem,
  type TexBoxMetrics,
  type TexVListDocument,
  type TexVListLayout,
  type TexVListParagraphBoxMeasurement,
  type TexVBoxBaseline,
} from "../packages/core/src/text/tex/vlist/index.js";
import { preloadEnglishHyphenator } from "../packages/core/src/text/knuth-plass/paragraph/hyphenate.js";
import {
  caseFromTexFuzzAst,
  generateTexFuzzCase,
  generateTexMathFuzzCase,
  type TexFuzzNode,
} from "../packages/tex-fuzz/src/index.js";

function relayoutFromExistingVListLayout(
  document: TexVListDocument,
  layout: TexVListLayout | null | undefined,
  options: {
    readonly width: number;
    readonly height?: number;
    readonly verticalAlign?: "top" | "center" | "bottom";
    readonly lineHeight: number;
    readonly firstLineAscent: number;
  }
): TexVListLayout | null {
  if (!layout) {
    return null;
  }
  const linePlacementsByIndex = new Map(
    layout.linePlacements.map((placement) => [placement.lineIndex, placement])
  );
  const paragraphMeasurements: TexVListParagraphBoxMeasurement[] =
    layout.paragraphPlacements.map((placement) => {
      const advance = placement.metrics.height + placement.metrics.depth;
      return {
        blockIndex: placement.blockIndex,
        vlistPath: placement.vlistPath,
        lineIndices: placement.lineIndices,
        lineOffsets: placement.lineIndices.map((lineIndex) => ({
          lineIndex,
          y: (linePlacementsByIndex.get(lineIndex)?.y ?? placement.y) - placement.y,
        })),
        standardMetrics: placement.metrics,
        ruleLeadingMetrics: placement.metrics,
        standardAdvance: advance,
        ruleLeadingAdvance: advance,
      };
    });
  return layoutTexVListFromMeasuredParagraphs(document, {
    width: options.width,
    height: options.height,
    verticalAlign: options.verticalAlign,
    lineHeight: options.lineHeight,
    firstLineIndex: layout.linePlacements[0]?.lineIndex,
    firstLineAscent: options.firstLineAscent,
    paragraphMeasurements,
    reports: layout.reports,
    errors: layout.errors,
  });
}

function mathSegmentGlyphSpans(
  segment: ParagraphLayoutReport["lines"][number]["segments"][number]
): { readonly code: number; readonly sourceStart: number; readonly sourceEnd: number }[] {
  if (segment.kind !== "math" || !segment.mathSvgBody) {
    return [];
  }
  return [...segment.mathSvgBody.matchAll(
    /data-tex-glyph="(\d+)"[^>]*data-source-start="(\d+)"[^>]*data-source-end="(\d+)"/g
  )].map((match) => ({
    code: Number(match[1]),
    sourceStart: Number(match[2]),
    sourceEnd: Number(match[3]),
  }));
}

function expectMathSegmentGlyphsWithinSourceSpans(
  report: ParagraphLayoutReport
): void {
  for (const line of report.lines) {
    for (const segment of line.segments) {
      if (segment.kind !== "math") {
        continue;
      }
      const sourceStart = segment.sourceStartRaw ?? 0;
      const sourceEnd = segment.sourceEndRaw ?? sourceStart;
      for (const glyph of mathSegmentGlyphSpans(segment)) {
        expect(glyph.sourceStart, `${segment.text}: glyph starts before fragment`).toBeGreaterThanOrEqual(sourceStart);
        expect(glyph.sourceEnd, `${segment.text}: glyph ends after fragment`).toBeLessThanOrEqual(sourceEnd);
      }
    }
  }
}

interface LocalBounds {
  readonly xStart: number;
  readonly xEnd: number;
  readonly yStart: number;
  readonly yEnd: number;
}

interface PathPoint {
  readonly x: number;
  readonly y: number;
}

function renderedMathGlyphBoundsForText(
  segment: ParagraphLayoutReport["lines"][number]["segments"][number],
  line: ParagraphLayoutReport["lines"][number],
  sourceText: string,
  selectedText: string
): LocalBounds {
  const selectedStart = sourceText.indexOf(selectedText);
  const selectedEnd = selectedStart + selectedText.length;
  expect(selectedStart).toBeGreaterThanOrEqual(0);
  expect(segment.kind).toBe("math");
  expect(segment.mathSvgBody).toBeTruthy();
  const glyphBounds: LocalBounds[] = [];
  for (const pathTagMatch of segment.mathSvgBody?.matchAll(/<path\b[^>]*>/g) ?? []) {
    const attrs = parseSvgAttributes(pathTagMatch[0]);
    const sourceStart = Number(attrs.get("data-source-start"));
    const sourceEnd = Number(attrs.get("data-source-end"));
    if (
      !Number.isFinite(sourceStart) ||
      !Number.isFinite(sourceEnd) ||
      sourceStart < selectedStart ||
      sourceEnd > selectedEnd ||
      sourceEnd <= sourceStart
    ) {
      continue;
    }
    const transform = parseMathGlyphTransform(attrs.get("transform") ?? "");
    expect(transform).not.toBeNull();
    const points = svgPathControlPoints(attrs.get("d") ?? "");
    expect(points.length).toBeGreaterThan(0);
    const transformed = points.map((point) => ({
      x: Number(segment.x) + (transform!.translateX + point.x * transform!.scale) / 100,
      y: Number(line.ascent) + (transform!.translateY + point.y * transform!.scale) / 100,
    }));
    glyphBounds.push({
      xStart: Math.min(...transformed.map((point) => point.x)),
      xEnd: Math.max(...transformed.map((point) => point.x)),
      yStart: Math.min(...transformed.map((point) => point.y)),
      yEnd: Math.max(...transformed.map((point) => point.y)),
    });
  }
  expect(glyphBounds.length).toBe(selectedText.length);
  return {
    xStart: Math.min(...glyphBounds.map((bounds) => bounds.xStart)),
    xEnd: Math.max(...glyphBounds.map((bounds) => bounds.xEnd)),
    yStart: Math.min(...glyphBounds.map((bounds) => bounds.yStart)),
    yEnd: Math.max(...glyphBounds.map((bounds) => bounds.yEnd)),
  };
}

function expectSelectionContainsLineLocalBounds(
  selection: Awaited<ReturnType<typeof getKnuthPlassSelectionRects>>,
  line: ParagraphLayoutReport["lines"][number],
  bounds: LocalBounds
): void {
  const lineStart = Number(line.xStart);
  const epsilon = 1e-6;
  const rect = selection.rects.find((candidate) =>
    Number(candidate.bounds.minX) <= bounds.xStart - lineStart + epsilon &&
    Number(candidate.bounds.maxX) >= bounds.xEnd - lineStart - epsilon &&
    Number(candidate.bounds.minY) <= bounds.yStart + epsilon &&
    Number(candidate.bounds.maxY) >= bounds.yEnd - epsilon
  );
  expect(rect).toBeTruthy();
}

function parseSvgAttributes(tag: string): Map<string, string> {
  return new Map(
    [...tag.matchAll(/\s([-\w:]+)="([^"]*)"/g)].map((match) => [match[1] ?? "", match[2] ?? ""])
  );
}

function parseMathGlyphTransform(transform: string): { readonly translateX: number; readonly translateY: number; readonly scale: number } | null {
  const match = /translate\(\s*([^\s,)]+)[,\s]+([^\s,)]+)\s*\)\s*scale\(\s*([^\s,)]+)\s*\)/.exec(transform);
  if (!match) {
    return null;
  }
  const translateX = Number(match[1]);
  const translateY = Number(match[2]);
  const scale = Number(match[3]);
  return Number.isFinite(translateX) && Number.isFinite(translateY) && Number.isFinite(scale)
    ? { translateX, translateY, scale }
    : null;
}

function svgPathControlPoints(d: string): PathPoint[] {
  const tokens = [...d.matchAll(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi)].map((match) => match[0] ?? "");
  const points: PathPoint[] = [];
  let index = 0;
  let command = "";
  let current: PathPoint = { x: 0, y: 0 };
  let subpathStart: PathPoint = current;
  const isCommand = (token: string | undefined) => Boolean(token && /^[a-zA-Z]$/.test(token));
  const hasNumber = () => index < tokens.length && !isCommand(tokens[index]);
  const readNumber = () => Number(tokens[index++]);
  const addPoint = (x: number, y: number) => {
    current = { x, y };
    points.push(current);
  };
  while (index < tokens.length) {
    if (isCommand(tokens[index])) {
      command = tokens[index++] ?? "";
    }
    const relative = command === command.toLowerCase();
    switch (command.toUpperCase()) {
      case "M": {
        let first = true;
        while (hasNumber()) {
          const x = readNumber();
          const y = readNumber();
          addPoint(relative ? current.x + x : x, relative ? current.y + y : y);
          if (first) {
            subpathStart = current;
            first = false;
          }
        }
        break;
      }
      case "L":
      case "T": {
        while (hasNumber()) {
          const x = readNumber();
          const y = readNumber();
          addPoint(relative ? current.x + x : x, relative ? current.y + y : y);
        }
        break;
      }
      case "H": {
        while (hasNumber()) {
          const x = readNumber();
          addPoint(relative ? current.x + x : x, current.y);
        }
        break;
      }
      case "V": {
        while (hasNumber()) {
          const y = readNumber();
          addPoint(current.x, relative ? current.y + y : y);
        }
        break;
      }
      case "C": {
        while (hasNumber()) {
          const coords = [readNumber(), readNumber(), readNumber(), readNumber(), readNumber(), readNumber()];
          for (let coordIndex = 0; coordIndex < coords.length; coordIndex += 2) {
            addPoint(
              relative ? current.x + (coords[coordIndex] ?? 0) : (coords[coordIndex] ?? 0),
              relative ? current.y + (coords[coordIndex + 1] ?? 0) : (coords[coordIndex + 1] ?? 0)
            );
          }
        }
        break;
      }
      case "S":
      case "Q": {
        while (hasNumber()) {
          const coords = [readNumber(), readNumber(), readNumber(), readNumber()];
          for (let coordIndex = 0; coordIndex < coords.length; coordIndex += 2) {
            addPoint(
              relative ? current.x + (coords[coordIndex] ?? 0) : (coords[coordIndex] ?? 0),
              relative ? current.y + (coords[coordIndex + 1] ?? 0) : (coords[coordIndex + 1] ?? 0)
            );
          }
        }
        break;
      }
      case "A": {
        while (hasNumber()) {
          readNumber();
          readNumber();
          readNumber();
          readNumber();
          readNumber();
          const x = readNumber();
          const y = readNumber();
          addPoint(relative ? current.x + x : x, relative ? current.y + y : y);
        }
        break;
      }
      case "Z": {
        current = subpathStart;
        points.push(current);
        break;
      }
      default:
        index += 1;
    }
  }
  return points;
}

function registeredLayoutWithBoxReport<T extends {
  readonly items: readonly PositionedTexVListItem[];
  readonly metrics: TexBoxMetrics;
  readonly baseline: TexVBoxBaseline;
}>(layout: T): T & { readonly boxReport: ReturnType<typeof texVListBoxLayoutReport> } {
  return {
    ...layout,
    boxReport: texVListBoxLayoutReport(layout.items, layout.metrics, layout.baseline),
  };
}

function makeLineElement(
  bounds: { left: number; top: number; right: number; bottom: number },
  viewBoxWidth: number
): any {
  return {
    getBoundingClientRect: () => ({
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      width: bounds.right - bounds.left,
      height: bounds.bottom - bounds.top,
    }),
    getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    ownerSVGElement: {
      viewBox: {
        baseVal: {
          width: viewBoxWidth,
        },
      },
    },
  };
}

function makeLineElementsFromVListLayout(
  report: ParagraphLayoutReport,
  layout: TexVListLayout | null | undefined
): any[] {
  const placementByLine = new Map(
    (layout?.linePlacements ?? []).map((placement) => [placement.lineIndex, placement])
  );
  return report.lines.map((line, fallbackIndex) => {
    const placement = placementByLine.get(line.lineIndex);
    const top = placement?.y ?? fallbackIndex * 12;
    const height = placement?.height ?? 12;
    return makeLineElement(
      {
        left: placement?.x ?? 0,
        top,
        right: (placement?.x ?? 0) + report.width,
        bottom: top + Math.max(1, height),
      },
      report.width
    );
  });
}

function makeVListBoxElement(
  bounds: { left: number; top: number; right: number; bottom: number },
  attributes: Record<string, string>
): any {
  return {
    getAttribute: (name: string) => attributes[name] ?? null,
    getBoundingClientRect: () => ({
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      width: bounds.right - bounds.left,
      height: bounds.bottom - bounds.top,
    }),
  };
}

function makeShapedTextReport(text: string): ParagraphLayoutReport {
  const shaped = computerModernTexMetricProvider.shapeText(text);
  return {
    paragraphId: "tex:paragraph",
    width: shaped.width,
    alignment: "ragged-right",
    layoutMode: "wrap",
    lines: [
      {
        lineIndex: 0,
        startRun: 0,
        endRun: 0,
        width: shaped.width,
        targetWidth: shaped.width,
        naturalWidth: shaped.width,
        glueSetRatio: 0,
        badness: 0,
        spaceCount: 0,
        spaceDeltaPerGap: 0,
        ascent: 8,
        descent: 2,
        xStart: 0,
        xEnd: shaped.width,
        break: null,
        segments: [
          {
            runIndex: 0,
            kind: "text",
            text,
            startOffset: 0,
            endOffset: text.length,
            x: 0,
            width: shaped.width,
            caretStops: [...shaped.caretStops],
          },
        ],
      },
    ],
    runs: [
      {
        runIndex: 0,
        kind: "text",
        sourceStart: 0,
        sourceEnd: text.length,
        width: shaped.width,
        text,
      },
    ],
    errors: [],
    internalMode: "canonical",
    internalDegradeReason: null,
    externalFallbackUsed: false,
    linebreakingMode: "feasible",
  };
}

function lineTexts(report: ParagraphLayoutReport | null | undefined): string[] {
  return report?.lines.map((line) => line.segments.map((segment) => segment.text ?? "").join("")) ?? [];
}

function visibleLineTexts(report: ParagraphLayoutReport | null | undefined): string[] {
  return lineTexts(report).filter((text) => text.length > 0);
}

function firstVisibleTextX(
  line: ParagraphLayoutReport["lines"][number] | undefined
): number | undefined {
  return line?.segments.find((segment) =>
    segment.kind === "text" && (segment.text ?? "").length > 0
  )?.x;
}

function visibleLines(
  report: ParagraphLayoutReport | null | undefined
): ParagraphLayoutReport["lines"] {
  return report?.lines.filter((line) =>
    line.segments.some((segment) =>
      segment.kind === "text" && (segment.text ?? "").length > 0
    )
  ) ?? [];
}

function firstLineSpaceWidths(
  text: string,
  options: Parameters<typeof layoutSimpleTexParagraph>[1]
): number[] {
  const result = layoutSimpleTexParagraph(text, {
    hyphenator: { hyphenate: () => [] },
    ...options,
  });
  expect(result.supported).toBe(true);
  return result.report?.lines[0]?.segments
    .filter((segment) => segment.kind === "space")
    .map((segment) => segment.width) ?? [];
}

function makeDeterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pickFuzzItem<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length) % items.length];
}

function makeFakeInlineMathBoxProvider(
  widthForContent: (content: string) => number = (content) => 8 + content.length * 4
): TexMathBoxProvider {
  return {
    getInlineMathBox: (params) => ({
      source: params.source,
      content: params.content,
      sourceStart: params.sourceStart,
      sourceEnd: params.sourceEnd,
      contentStart: params.contentStart,
      contentEnd: params.contentEnd,
      width: widthForContent(params.content),
      height: 7,
      depth: 2,
      svgBody: `<g data-fake-inline-math="${params.content}"></g>`,
    }),
  };
}

function makeFakeInlineMathTex2Svg(unitWidth = 1): (tex: string) => {
  readonly querySelector: () => { readonly getAttribute: (name: string) => string | null };
} {
  return (tex: string) => {
    const content = /\\textstyle\{([\s\S]*)\}/.exec(tex)?.[1] ?? tex;
    const width = Math.max(0, content.length * unitWidth);
    return {
      querySelector: () => ({
        getAttribute: (name: string) => (name === "viewBox" ? `0 0 ${width} 1` : null),
      }),
    };
  };
}

type TexHitMapFuzzCase = {
  readonly id: string;
  readonly source: string;
  readonly width: number;
  readonly offsets: readonly number[];
};

type TexMathHitMapFuzzOffset = {
  readonly offset: number;
  readonly kind: "text" | "math";
  readonly label?: string;
  readonly exactRoundTrip: boolean;
};

type TexMathHitMapFuzzFormula = {
  readonly source: string;
  readonly trackedOffsets: readonly {
    readonly offset: number;
    readonly label: string;
    readonly exactRoundTrip: boolean;
  }[];
};

type TexMathHitMapFuzzCase = {
  readonly id: string;
  readonly source: string;
  readonly width: number;
  readonly offsets: readonly TexMathHitMapFuzzOffset[];
};

type TexDisplayAlignHitMapFuzzCase = {
  readonly id: string;
  readonly source: string;
  readonly width: number;
  readonly delimiter: "align" | "align-star" | "gather" | "gather-star" | "multline" | "multline-star";
  readonly rows: readonly string[];
  readonly offsets: readonly TexMathHitMapFuzzOffset[];
};

type TexDocumentMathHitMapFuzzCase = {
  readonly id: string;
  readonly source: string;
  readonly width: number;
  readonly offsets: readonly TexMathHitMapFuzzOffset[];
  readonly delimiter: "align" | "align-star" | "gather" | "gather-star" | "multline" | "multline-star";
  readonly rows: readonly string[];
};

function projectSharedHitMapTextNode(node: TexFuzzNode): TexFuzzNode {
  if (node.kind === "math" || node.kind === "display-math" || node.kind === "oracle-command") {
    return { kind: "text", value: "math" };
  }
  if (node.kind === "line-break") {
    return { kind: "space", nonBreaking: false };
  }
  if ("children" in node) {
    return { ...node, children: node.children.map(projectSharedHitMapTextNode) };
  }
  if (node.kind === "item" && node.label) {
    return { ...node, label: node.label.map(projectSharedHitMapTextNode) };
  }
  return node;
}

function buildTexHitMapFuzzCase(index: number): TexHitMapFuzzCase {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const generated = generateTexFuzzCase(0x54584d00 + index * 200 + attempt, {
      profile: "vertical-slice",
      depth: 3,
      size: 9,
    });
    const projectedAst = generated.ast.map(projectSharedHitMapTextNode);
    const split = 1 + ((index + attempt) % (generated.ast.length - 1));
    const withBreak = caseFromTexFuzzAst([
      { kind: "text", value: "Anchor" },
      { kind: "space", nonBreaking: false },
      ...projectedAst.slice(0, split),
      { kind: "line-break", command: "\\", starred: false },
      { kind: "text", value: "Anchor" },
      { kind: "space", nonBreaking: false },
      ...projectedAst.slice(split),
    ], { seed: generated.seed, profile: generated.profile, choices: generated.choices });
    const offsets = withBreak.sourceMap
      .filter((span) => span.kind === "text" && span.end - span.start > 1)
      .flatMap((span) => [
        span.start + 1,
        span.start + Math.floor((span.end - span.start) / 2),
        span.end - 1,
      ])
      .filter((offset, offsetIndex, all) =>
        offset > 0 && offset < withBreak.source.length && all.indexOf(offset) === offsetIndex
      )
      .sort((left, right) => left - right);
    if (offsets.length === 0) {
      continue;
    }
    const width = [70, 90, 120, 150][index % 4] ?? 120;
    const calibration = layoutSimpleTexParagraph(withBreak.source, {
      paragraphId: `tex-hitmap-fuzz-calibration-${index}`,
      width,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
    });
    if (!calibration.supported || !calibration.report || calibration.report.lines.length < 2) {
      continue;
    }
    // This hard round-trip test has a registered scalar-line domain. Cases
    // producing non-scalar/nested line geometry remain in the broader shared
    // generator and diagnostic fuzz runners, but require the vlist hit path.
    if (calibration.report.lines.some((line) =>
      !Number.isFinite(Number(line.xStart)) || !Number.isFinite(Number(line.xEnd))
    )) {
      continue;
    }
    return {
      id: `tex-hitmap-fuzz-${index}`,
      source: withBreak.source,
      width,
      offsets,
    };
  }
  throw new Error(`Unable to generate supported shared TeX hit-map case ${index}.`);
}
function buildTexMathHitMapFuzzCase(index: number): TexMathHitMapFuzzCase {
  const random = makeDeterministicRandom(0x4d415448 + index);
  const words = [
    "Alpha",
    "beta",
    "canvas",
    "delta",
    "editor",
    "focus",
    "gamma",
    "layout",
    "metric",
    "stable",
  ];
  const formulas = texMathHitMapFuzzFormulas();
  const offsets: TexMathHitMapFuzzOffset[] = [];
  let source = "";

  const appendSeparator = () => {
    if (source.length > 0 && !/\s$/.test(source)) {
      source += " ";
    }
  };
  const appendWord = () => {
    appendSeparator();
    const word = pickFuzzItem(words, random);
    const start = source.length;
    source += word;
    offsets.push({
      offset: start + Math.max(1, Math.floor(word.length / 2)),
      kind: "text",
      label: word,
      exactRoundTrip: true,
    });
    if (word.length > 3) {
      offsets.push({
        offset: start + word.length - 1,
        kind: "text",
        label: word,
        exactRoundTrip: true,
      });
    }
  };
  const appendMath = () => {
    appendSeparator();
    const formula = pickFuzzItem(formulas, random);
    const delimiter = random() < 0.5 ? "dollar" : "paren";
    const rawStart = source.length;
    if (delimiter === "dollar") {
      source += "$" + formula.source + "$";
      const contentStart = rawStart + 1;
      for (const tracked of formula.trackedOffsets) {
        offsets.push({
          offset: contentStart + tracked.offset,
          kind: "math",
          label: tracked.label,
          exactRoundTrip: tracked.exactRoundTrip,
        });
      }
      offsets.push({
        offset: contentStart + formula.source.length,
        kind: "math",
        label: "math-end",
        exactRoundTrip: false,
      });
      return;
    }
    source += "\\(" + formula.source + "\\)";
    const contentStart = rawStart + 2;
    for (const tracked of formula.trackedOffsets) {
      offsets.push({
        offset: contentStart + tracked.offset,
        kind: "math",
        label: tracked.label,
        exactRoundTrip: tracked.exactRoundTrip,
      });
    }
    offsets.push({
      offset: contentStart + formula.source.length,
      kind: "math",
      label: "math-end",
      exactRoundTrip: false,
    });
  };
  const appendForcedBreak = () => {
    appendSeparator();
    source += random() < 0.5 ? "\\\\" : "\\\\[7pt]";
    source += " ";
  };

  const tokenCount = 8 + Math.floor(random() * 5);
  const breakAt = 2 + Math.floor(random() * Math.max(1, tokenCount - 4));
  for (let tokenIndex = 0; tokenIndex < tokenCount; tokenIndex++) {
    if (tokenIndex === breakAt || (tokenIndex > 2 && tokenIndex < tokenCount - 1 && random() < 0.1)) {
      appendForcedBreak();
    }
    if (tokenIndex === 1 || tokenIndex === tokenCount - 2 || random() < 0.42) {
      appendMath();
    } else {
      appendWord();
    }
  }

  const uniqueOffsets = new Map<number, TexMathHitMapFuzzOffset>();
  for (const entry of offsets) {
    if (entry.offset > 0 && entry.offset < source.length) {
      uniqueOffsets.set(entry.offset, entry);
    }
  }

  return {
    id: `tex-math-hitmap-fuzz-${index}`,
    source,
    width: pickFuzzItem([50, 55, 70, 90, 120], random),
    offsets: [...uniqueOffsets.values()].sort((left, right) => left.offset - right.offset),
  };
}

function buildTexDocumentMathHitMapFuzzCase(index: number): TexDocumentMathHitMapFuzzCase {
  const random = makeDeterministicRandom(0x444f434d + index);
  const formulas = texMathHitMapFuzzFormulas();
  const offsets: TexMathHitMapFuzzOffset[] = [];
  let body = pickFuzzItem(["Intro", "Before", "Lead", "Start"], random);

  const appendSpace = () => {
    body += /\s$/.test(body) ? "" : " ";
  };
  const appendInlineMath = () => {
    appendSpace();
    const formula = pickFuzzItem(formulas, random);
    const delimiter = random() < 0.5 ? "dollar" : "paren";
    const rawStart = body.length;
    const open = delimiter === "dollar" ? "$" : String.raw`\(`;
    const close = delimiter === "dollar" ? "$" : String.raw`\)`;
    body += open + formula.source + close;
    const contentStart = rawStart + open.length;
    for (const tracked of formula.trackedOffsets) {
      offsets.push({
        offset: contentStart + tracked.offset,
        kind: "math",
        label: tracked.label,
        exactRoundTrip: tracked.exactRoundTrip,
      });
    }
  };

  appendInlineMath();
  body += ` ${pickFuzzItem(["before", "near", "beside"], random)} `;
  const displayFormula = pickFuzzItem(formulas, random);
  const displayStart = body.length;
  body += String.raw`\[` + displayFormula.source + String.raw`\]`;
  const displayContentStart = displayStart + String.raw`\[`.length;
  for (const tracked of displayFormula.trackedOffsets) {
    offsets.push({
      offset: displayContentStart + tracked.offset,
      kind: "math",
      label: `display:${tracked.label}`,
      exactRoundTrip: tracked.exactRoundTrip,
    });
  }
  body += ` ${pickFuzzItem(["middle", "after", "tail"], random)} `;
  appendInlineMath();

  const displayKind = texDisplayRowFuzzKind(index);
  const rows = documentHitMapDisplayRows(random, displayKind.delimiter);
  body += " ";
  const displayRowsStart = body.length;
  const displayRowsOpen = displayKind.open;
  const displayRowsContent = rows.join(String.raw`\\`);
  body += displayRowsOpen + displayRowsContent + displayKind.close;
  const displayRowsContentStart = displayRowsStart + displayRowsOpen.length;
  let displayRowOffset = 0;
  for (const [rowIndex, row] of rows.entries()) {
    const firstToken = row.match(/[A-Za-z0-9\\]/);
    if (firstToken?.index !== undefined) {
      offsets.push({
        offset: displayRowsContentStart + displayRowOffset + firstToken.index,
        kind: "math",
        label: `display-row-${rowIndex}`,
        exactRoundTrip: false,
      });
    }
    const relation = row.indexOf("=");
    if (relation >= 0) {
      offsets.push({
        offset: displayRowsContentStart + displayRowOffset + relation,
        kind: "math",
        label: `display-row-${rowIndex}:=`,
        exactRoundTrip: false,
      });
    }
    displayRowOffset += row.length + (rowIndex === rows.length - 1 ? 0 : String.raw`\\`.length);
  }
  body += ` ${pickFuzzItem(["Done", "Close", "Finish"], random)} `;
  appendInlineMath();

  const wrappers = [
    { prefix: "", suffix: "" },
    { prefix: String.raw`\begin{quote}`, suffix: String.raw`\end{quote}` },
    { prefix: String.raw`\begin{itemize}\item `, suffix: String.raw`\end{itemize}` },
    { prefix: String.raw`\begin{enumerate}\item `, suffix: String.raw`\end{enumerate}` },
    { prefix: String.raw`\begin{description}\item[Term] `, suffix: String.raw`\end{description}` },
    {
      prefix: String.raw`\begin{quote}\begin{itemize}\item `,
      suffix: String.raw`\end{itemize}\end{quote}`,
    },
  ] as const;
  const wrapper = wrappers[index % wrappers.length] ?? wrappers[0];
  const source = wrapper.prefix + body + wrapper.suffix;
  const shiftedOffsets = offsets
    .map((entry) => ({
      ...entry,
      offset: entry.offset + wrapper.prefix.length,
    }))
    .filter((entry, entryIndex, entries) =>
      entry.offset > 0 &&
      entry.offset < source.length &&
      entries.findIndex((candidate) => candidate.offset === entry.offset) === entryIndex
    )
    .sort((left, right) => left.offset - right.offset);

  return {
    id: `tex-document-math-hitmap-fuzz-${index}`,
    source,
    width: pickFuzzItem([130, 160, 190, 220], random),
    offsets: shiftedOffsets,
    delimiter: displayKind.delimiter,
    rows,
  };
}

let sharedTexMathHitMapFuzzFormulas: readonly TexMathHitMapFuzzFormula[] | undefined;

function texMathHitMapFuzzFormulas(): readonly TexMathHitMapFuzzFormula[] {
  if (sharedTexMathHitMapFuzzFormulas) {
    return sharedTexMathHitMapFuzzFormulas;
  }
  const formulas: TexMathHitMapFuzzFormula[] = [];
  for (let seed = 0; seed < 2_000 && formulas.length < 32; seed += 1) {
    const generated = generateTexMathFuzzCase(0x4d415448 + seed, { depth: 2 });
    if (generated.features.includes("math.matrix") || generated.source.length > 120) {
      continue;
    }
    const parsed = parseTexMath(generated.source);
    if (parsed.diagnostics.some((diagnostic) =>
      diagnostic.severity === "error" || diagnostic.code === "unsupported-command"
    )) {
      continue;
    }
    const trackedOffsets = [...generated.source.matchAll(/\\[A-Za-z]+|[A-Za-z0-9]|[=+-]/gu)]
      .slice(0, 16)
      .map((match) => ({
        offset: match.index,
        label: match[0],
        exactRoundTrip: false,
      }));
    if (trackedOffsets.length === 0) {
      continue;
    }
    const visibleSource = generated.source.replaceAll(/\\[A-Za-z]+/gu, "");
    formulas.push(...(/[A-Za-z0-9]/u.test(visibleSource)
      ? [{ source: generated.source, trackedOffsets }]
      : []));
  }
  if (formulas.length < 32) {
    throw new Error(`Shared math generator yielded only ${formulas.length} supported hit-map formulas.`);
  }
  sharedTexMathHitMapFuzzFormulas = formulas;
  return formulas;
}
function documentHitMapDisplayRows(
  random: () => number,
  delimiter: "align" | "align-star" | "gather" | "gather-star" | "multline" | "multline-star"
): readonly string[] {
  const identifiers = ["a", "b", "c", "x", "y", "z", "m", "n"] as const;
  const rowCount = 1 + Math.floor(random() * 3);
  return Array.from({ length: rowCount }, () => {
    const left = displayRowExpression(random);
    const right = displayRowExpression(random);
    if (delimiter !== "align" && delimiter !== "align-star") {
      return random() < 0.4
        ? String.raw`\frac{` + pickFuzzItem(identifiers, random) + String.raw`}{` + pickFuzzItem(identifiers, random) + String.raw`}+` + displayRowExpression(random)
        : `${left}=${right}`;
    }
    return random() < 0.4
      ? String.raw`\frac{` + pickFuzzItem(identifiers, random) + String.raw`}{` + pickFuzzItem(identifiers, random) + String.raw`}&=` + displayRowExpression(random)
      : `${left}&=${right}`;
  });
}

function displayRowExpression(random: () => number): string {
  const identifiers = ["a", "b", "c", "x", "y", "z", "m", "n"] as const;
  const left = pickFuzzItem(identifiers, random);
  const right = pickFuzzItem(identifiers, random);
  switch (Math.floor(random() * 5)) {
    case 0:
      return `${left}_${right}`;
    case 1:
      return `${left}^2`;
    case 2:
      return String.raw`\sqrt{` + left + "+" + right + "}";
    case 3:
      return String.raw`\binom{` + left + "}{" + right + "}";
    default:
      return left;
  }
}

function texDisplayRowFuzzKind(index: number): {
  readonly delimiter: "align" | "align-star" | "gather" | "gather-star" | "multline" | "multline-star";
  readonly open: string;
  readonly close: string;
} {
  switch (index % 6) {
    case 1:
      return {
        delimiter: "gather-star",
        open: String.raw`\begin{gather*}`,
        close: String.raw`\end{gather*}`,
      };
    case 2:
      return {
        delimiter: "multline-star",
        open: String.raw`\begin{multline*}`,
        close: String.raw`\end{multline*}`,
      };
    case 3:
      return {
        delimiter: "align",
        open: String.raw`\begin{align}`,
        close: String.raw`\end{align}`,
      };
    case 4:
      return {
        delimiter: "gather",
        open: String.raw`\begin{gather}`,
        close: String.raw`\end{gather}`,
      };
    case 5:
      return {
        delimiter: "multline",
        open: String.raw`\begin{multline}`,
        close: String.raw`\end{multline}`,
      };
    default:
      return {
        delimiter: "align-star",
        open: String.raw`\begin{align*}`,
        close: String.raw`\end{align*}`,
      };
  }
}

function buildTexDisplayAlignHitMapFuzzCase(index: number): TexDisplayAlignHitMapFuzzCase {
  const random = makeDeterministicRandom(0x414c4947 + index);
  const displayKind = texDisplayRowFuzzKind(index);
  const operators = ["+", "-", "="] as const;
  const rowCount = 2 + Math.floor(random() * 2);
  const rowOffsets: TexMathHitMapFuzzOffset[] = [];
  const rows = Array.from({ length: rowCount }, (_, rowIndex) => {
    const left = displayRowExpression(random);
    const right = displayRowExpression(random);
    const tail = displayRowExpression(random);
    const operator = pickFuzzItem(operators, random);
    const row = displayKind.delimiter === "align" || displayKind.delimiter === "align-star"
      ? random() < 0.45
        ? String.raw`\frac{${left}}{${right}}&=${tail}`
        : `${left}&${operator}${right}`
      : random() < 0.45
        ? String.raw`\frac{${left}}{${right}}+${tail}`
        : `${left}${operator}${right}`;
    if (displayKind.delimiter !== "align" && displayKind.delimiter !== "align-star") {
      if (displayKind.delimiter === "gather" && rowIndex === 1 && index % 7 === 0) {
        return `${row} \\notag`;
      }
      if (displayKind.delimiter === "gather" && rowIndex === 0 && index % 3 === 0) {
        return `${row} \\tag{A}`;
      }
      if (displayKind.delimiter === "multline" && rowIndex === 1 && index % 7 === 0) {
        return `${row} \\notag`;
      }
      if (displayKind.delimiter === "multline" && rowIndex === 0 && index % 3 === 0) {
        return `${row} \\tag{A}`;
      }
      return row;
    }
    return rowIndex === 0 && index % 3 === 0
      ? `${row} \\tag{A}`
      : rowIndex === 1 && index % 5 === 0
        ? `${row}+a+b+c+d+e+f+g+h+i+j+k+l+m+n \\tag{Long tag}`
        : rowIndex === 1 && displayKind.delimiter === "align" && index % 7 === 0
          ? `${row} \\notag`
        : row;
  });
  const content = rows.join(String.raw`\\`);
  const prefix = pickFuzzItem(["Intro", "Before", "Lead"], random);
  const suffix = pickFuzzItem(["Outro", "After", "Done"], random);
  const body = `${prefix} ${displayKind.open}${content}${displayKind.close} ${suffix}`;
  const wrappers = [
    (inner: string) => String.raw`\begin{quote}` + inner + String.raw`\end{quote}`,
    (inner: string) => String.raw`\begin{itemize}\item ` + inner + String.raw`\end{itemize}`,
    (inner: string) => String.raw`\begin{enumerate}\item ` + inner + String.raw`\end{enumerate}`,
    (inner: string) => String.raw`\begin{description}\item[Term] ` + inner + String.raw`\end{description}`,
    (inner: string) => String.raw`\begin{quote}\begin{itemize}\item ` + inner + String.raw`\end{itemize}\end{quote}`,
    (inner: string) => String.raw`\begin{itemize}\item ` + inner + String.raw`\item Tail\end{itemize}`,
  ] as const;
  const wrapper = wrappers[index % wrappers.length];
  const source = wrapper(body);
  const alignContentStart = source.indexOf(displayKind.open) + displayKind.open.length;
  let rowStart = 0;
  for (const [rowIndex, row] of rows.entries()) {
    for (const token of ["\\frac", "\\sqrt", "\\binom", "_", "^", "&", "=", "A", "Long tag"]) {
      const tokenIndex = row.indexOf(token);
      if (tokenIndex >= 0) {
        rowOffsets.push({
          offset: alignContentStart + rowStart + tokenIndex,
          kind: "math",
          label: `align-row-${rowIndex}:${token}`,
          exactRoundTrip: false,
        });
      }
    }
    const firstIdentifier = row.search(/[a-z]/);
    if (firstIdentifier >= 0) {
      rowOffsets.push({
        offset: alignContentStart + rowStart + firstIdentifier,
        kind: "math",
        label: `align-row-${rowIndex}:identifier`,
        exactRoundTrip: false,
      });
    }
    rowStart += row.length + (rowIndex === rows.length - 1 ? 0 : String.raw`\\`.length);
  }
  return {
    id: `tex-display-align-hitmap-fuzz-${index}`,
    source,
    width: pickFuzzItem([130, 160, 190, 220], random),
    delimiter: displayKind.delimiter,
    rows,
    offsets: [...new Map(rowOffsets.map((entry) => [entry.offset, entry])).values()]
      .filter((entry) => entry.offset > 0 && entry.offset < source.length)
      .sort((left, right) => left.offset - right.offset),
  };
}

const texParagraphRegressionCases = [
  {
    id: "narrow-equal-cost-active-state",
    width: 120,
    text: "Hoyden hippopod grippal millionairism stereoroentgenography blurb parenchyma burro. Subflavor strophomenid reheap hatrail unlogicalness ptyalocele boris thermopleion cinematographer, yoop crownling paleolithy microbiosis, extrascientific quarrelsome, unstitch; saccharonate caste overuberous. Theomantic inexpressible housewifeliness, mussurana. Withhold primiparity macehead sighing. Timeling. Adenotomy. Calistheneum syndactyly chyliform; beaverboard corporosity myomatous enterohepatitis unretaliating, psychophysiologist mesorrhiny passulate criminological chondroid rubeoloid, notoriety macroglossia subjectible endomycetaceae found seabeach.",
    lines: [
      "Hoyden hippopod grip-",
      "pal millionairism stere-",
      "oroentgenography blurb",
      "parenchyma burro. Sub-",
      "flavor strophomenid re-",
      "heap hatrail unlogicalness",
      "ptyalocele boris thermo-",
      "pleion cinematographer,",
      "yoop crownling paleolithy",
      "microbiosis, extrascien-",
      "tific quarrelsome, un-",
      "stitch; saccharonate caste",
      "overuberous. Theomantic",
      "inexpressible housewifeli-",
      "ness, mussurana. With-",
      "hold primiparity macehead",
      "sighing. Timeling. Adeno-",
      "tomy. Calistheneum syn-",
      "dactyly chyliform; beaver-",
      "board corporosity myoma-",
      "tous enterohepatitis un-",
      "retaliating, psychophysi-",
      "ologist mesorrhiny passu-",
      "late criminological chon-",
      "droid rubeoloid, notoriety",
      "macroglossia subjectible",
      "endomycetaceae found",
      "seabeach.",
    ],
  },
  {
    id: "narrow-wiliness-active-state",
    width: 160,
    text: "Brushball. Refoment axillar ugarono ravenhood salmonid emboss, unequalize unenforcedly precipitatedly, draggy unshot gleg precollapse baillonella vomeronasal intercept birdcatching. Envenom. Yangtao. Taratantara thrimp. Oarcock. Unpocket silicious. Epineolithic. Intraneous toryweed. Thiocyano friend, sinuosity graphicalness, advancedness. Houseboat wiliness airliner; enouncement footwear benumbedness devitrify undercook ocellicystic indentwise turntable flaccidness arthropathy usucaptor riskfulness unheired antizymic, reparatory.",
    lines: [
      "Brushball. Refoment axillar",
      "ugarono ravenhood salmonid em-",
      "boss, unequalize unenforcedly pre-",
      "cipitatedly, draggy unshot gleg pre-",
      "collapse baillonella vomeronasal",
      "intercept birdcatching. Envenom.",
      "Yangtao. Taratantara thrimp. Oar-",
      "cock. Unpocket silicious. Epine-",
      "olithic. Intraneous toryweed. Thio-",
      "cyano friend, sinuosity graphical-",
      "ness, advancedness. Houseboat wili-",
      "ness airliner; enouncement footwear",
      "benumbedness devitrify undercook",
      "ocellicystic indentwise turntable",
      "flaccidness arthropathy usucap-",
      "tor riskfulness unheired antizymic,",
      "reparatory.",
    ],
  },
  {
    id: "narrow-overfull-final-tie",
    width: 80,
    text: "Provable katastatic vineyard undervaulted tutty, headworker ladyclock, racketlike. Peshwaship. Platymesocephalic determinator soporiferousness monocardian unexpounded verminicidal hylic unmotivatedness lionesque, shivaism ethicosocial. Boltless, guaconize procurer salinan pendent pancratiast cloyer weathergleam. Lauraldehyde thunderworm duodenotomy microcardius outcaste, imperial plotty predictor. Epoptes. Azotenesis.",
    lines: [
      "Provable",
      "katastatic vine-",
      "yard undervaulted",
      "tutty, headworker",
      "ladyclock, racket-",
      "like. Peshwaship.",
      "Platymesocephalic",
      "determinator",
      "soporiferousness",
      "monocardian",
      "unexpounded",
      "verminicidal hylic",
      "unmotivatedness",
      "lionesque, shiv-",
      "aism ethicosocial.",
      "Boltless, gua-",
      "conize procurer",
      "salinan pendent",
      "pancratiast cloyer",
      "weathergleam.",
      "Lauraldehyde",
      "thunderworm",
      "duodenotomy",
      "microcardius",
      "outcaste, imperial",
      "plotty predictor.",
      "Epoptes. Azoten-",
      "esis.",
    ],
  },
  {
    id: "normal-final-tie-regression",
    width: 200,
    text: "Panegyrical outseam fiberglas; nucleohistone. Orthosubstituted, prestigious abaiser geobiology, monodimetric brownwort, aequiculi peacock.",
    lines: [
      "Panegyrical outseam fiberglas; nucleohistone.",
      "Orthosubstituted, prestigious abaiser geo-",
      "biology, monodimetric brownwort, aequiculi",
      "peacock.",
    ],
  },
];

describe("Computer Modern OT1 text shaping", () => {
  it("uses vendored TFM widths for core Computer Modern fonts", () => {
    const cmr10 = computerModernTexMetricProvider.resolveFont({ fontId: "cmr10" });
    const cmbx10 = computerModernTexMetricProvider.resolveFont({ fontId: "cmbx10" });
    const cmtt10 = computerModernTexMetricProvider.resolveFont({ fontId: "cmtt10" });
    const cmss10 = computerModernTexMetricProvider.resolveFont({ fontId: "cmss10" });
    const cmcsc10 = computerModernTexMetricProvider.resolveFont({ fontId: "cmcsc10" });

    expect(computerModernTexMetricProvider.shapeText("A", cmr10).width).toBeCloseTo(7.50002, 5);
    expect(computerModernTexMetricProvider.shapeText("A", cmbx10).width).toBeGreaterThan(7.50002);
    expect(computerModernTexMetricProvider.shapeText("iiii", cmtt10).width).toBeCloseTo(
      computerModernTexMetricProvider.shapeText("mmmm", cmtt10).width,
      6
    );
    expect(computerModernTexMetricProvider.shapeText("Sans", cmss10).width).toBeGreaterThan(0);
    expect(computerModernTexMetricProvider.shapeText("Small", cmcsc10).width).toBeGreaterThan(0);
  });

  it("applies TeX ligature programs and keeps raw source caret stops", () => {
    const shaped = computerModernTexMetricProvider.shapeText("office");

    expect(shaped.items.filter((item) => item.kind === "glyph").map((item) => item.code)).toEqual([
      111,
      14,
      99,
      101,
    ]);
    expect(shaped.caretStops).toHaveLength("office".length + 1);
    expect(shaped.sourceCaretStops.map((stop) => stop.sourceOffset)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(shaped.caretStops[0]).toBe(0);
    expect(shaped.caretStops.at(-1)).toBeCloseTo(shaped.width, 6);
  });

  it("applies TeX kern programs between shaped glyphs", () => {
    const font = computerModernTexMetricProvider.resolveFont();
    const unkerned = computerModernTexMetricProvider.shapeText("A", font).width
      + computerModernTexMetricProvider.shapeText("V", font).width;
    const shaped = computerModernTexMetricProvider.shapeText("AV", font);
    const kern = shaped.items.find((item) => item.kind === "kern");

    expect(kern).toBeDefined();
    expect(kern?.width).toBeLessThan(0);
    expect(shaped.width).toBeLessThan(unkerned);
    expect(shaped.caretStops[1]).toBeCloseTo(
      computerModernTexMetricProvider.shapeText("A", font).width + (kern?.width ?? 0),
      6
    );
  });

  it("uses the injected metric provider throughout paragraph layout", () => {
    const calls: string[] = [];
    const metricProvider = {
      resolveFont: (options?: Parameters<typeof computerModernTexMetricProvider.resolveFont>[0]) => {
        calls.push(`resolve:${options?.fontId ?? "default"}`);
        return computerModernTexMetricProvider.resolveFont(options);
      },
      shapeText: (
        text: string,
        font = computerModernTexMetricProvider.resolveFont(),
        options?: Parameters<typeof computerModernTexMetricProvider.shapeText>[2]
      ) => {
        calls.push(`shape:${text}`);
        return computerModernTexMetricProvider.shapeText(text, font, options);
      },
    };

    const result = layoutSimpleTexParagraph("Alpha Beta", {
      paragraphId: "tex:provider-seam",
      width: 80,
      metricProvider,
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    expect(calls.some((call) => call === "resolve:default")).toBe(true);
    expect(calls.some((call) => call === "shape:Alpha")).toBe(true);
    expect(calls.some((call) => call === "shape:Beta")).toBe(true);
  });

  it("feeds shaped caret stops into the existing editor hit-map path", async () => {
    const text = "office";
    const shaped = computerModernTexMetricProvider.shapeText(text);
    const report = makeShapedTextReport(text);
    const outputJax = { linebreaks: { getReports: () => [report] } };
    const containerElement = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: shaped.width, bottom: 10 }, report.width),
      ],
    };

    const point = await getKnuthPlassPointFromOffset(outputJax, {
      paragraphId: report.paragraphId,
      sourceText: text,
      containerElement,
      offset: 3,
    });
    const caret = await getKnuthPlassCaretFromPoint(outputJax, {
      paragraphId: report.paragraphId,
      sourceText: text,
      containerElement,
      clientPoint: clientPoint(px(shaped.caretStops[3]), px(2)),
    });
    const selection = await getKnuthPlassSelectionRects(outputJax, {
      paragraphId: report.paragraphId,
      sourceText: text,
      containerElement,
      startOffset: 1,
      endOffset: 4,
    });

    expect(point).toMatchObject({ ok: true, offset: 3, kind: "text" });
    expect(point.lineLocalX).toBeCloseTo(shaped.caretStops[3], 6);
    expect(caret).toMatchObject({ ok: true, offset: 3, kind: "text" });
    expect(selection.ok).toBe(true);
    const bounds = selection.rects[0]?.bounds;
    expect(Number(bounds?.minX)).toBeCloseTo(shaped.caretStops[1], 6);
    expect(Number(bounds?.maxX) - Number(bounds?.minX)).toBeCloseTo(
      shaped.caretStops[4] - shaped.caretStops[1],
      6
    );
  });

  it("maps editor caret hits inside inline font command arguments to argument source offsets", async () => {
    const sourceText = String.raw`Hi this is a \textsf{test}.`;
    const result = layoutSimpleTexParagraph(sourceText, {
      paragraphId: "tex:styled-hit-test",
      width: 120,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
    });
    expect(result.supported).toBe(true);
    const report = result.report;
    expect(report).toBeTruthy();
    const segment = report?.lines
      .flatMap((line) => line.segments)
      .find((entry) => entry.kind === "text" && entry.text === "test");
    expect(segment?.sourceStartRaw).toBe(sourceText.indexOf("test"));
    expect(segment?.sourceEndRaw).toBe(sourceText.indexOf("test") + "test".length);

    const caretStops = segment?.caretStops ?? [];
    const betweenEAndS = caretStops[2];
    expect(Number.isFinite(betweenEAndS)).toBe(true);

    const outputJax = { linebreaks: { getReports: () => report ? [report] : [] } };
    const containerElement = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: report?.width ?? 120, bottom: 10 }, report?.width ?? 120),
      ],
    };

    const caret = await getKnuthPlassCaretFromPoint(outputJax, {
      paragraphId: "tex:styled-hit-test",
      sourceText,
      containerElement,
      clientPoint: clientPoint(px(betweenEAndS ?? 0), px(2)),
    });

    expect(caret).toMatchObject({
      ok: true,
      offset: sourceText.indexOf("test") + 2,
      kind: "text",
    });
  });

  it("keeps editor hit testing usable after a TeX forced line break with styled text", async () => {
    const sourceText = String.raw`Hi this is a \textsf{test}. \\ And another.`;
    const result = layoutSimpleTexParagraph(sourceText, {
      paragraphId: "tex:styled-forced-break-hitmap",
      width: 120,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
    });
    expect(result.supported).toBe(true);
    const report = result.report;
    const vlistLayout = result.vlistLayout;
    expect(report).toBeTruthy();
    expect(vlistLayout).toBeTruthy();
    expect(report?.lines).toHaveLength(2);
    expect(report?.lines[0]?.break).toMatchObject({
      kind: "forced",
      sourceOffset: sourceText.indexOf(String.raw`\\`),
    });

    const outputJax = { linebreaks: { getReports: () => report ? [report] : [] } };
    registerTexVListLayoutsOnOutputJax(outputJax, [{
      paragraphId: "tex:styled-forced-break-hitmap",
      layout: vlistLayout!,
    }]);
    const containerElement = {
      getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      viewBox: { baseVal: { width: report?.width ?? 120 } },
      querySelectorAll: () => {
        throw new Error("registered vlist geometry should avoid rendered linebox queries");
      },
    };

    const anotherOffset = sourceText.indexOf("another") + 3;
    const point = await getKnuthPlassPointFromOffset(outputJax, {
      paragraphId: "tex:styled-forced-break-hitmap",
      sourceText,
      containerElement,
      offset: anotherOffset,
    });
    expect(point.error?.message ?? null).toBeNull();
    expect(point).toMatchObject({
      ok: true,
      offset: anotherOffset,
      lineIndex: 1,
      kind: "text",
    });

    const caret = await getKnuthPlassCaretFromPoint(outputJax, {
      paragraphId: "tex:styled-forced-break-hitmap",
      sourceText,
      containerElement,
      clientPoint: clientPoint(px(point.clientPoint?.x ?? 0), px(point.clientPoint?.y ?? 0)),
    });
    expect(caret).toMatchObject({
      ok: true,
      offset: anotherOffset,
      lineIndex: 1,
      kind: "text",
    });

    const selection = await getKnuthPlassSelectionRects(outputJax, {
      paragraphId: "tex:styled-forced-break-hitmap",
      sourceText,
      containerElement,
      startOffset: sourceText.indexOf("test"),
      endOffset: sourceText.indexOf("another") + "another".length,
    });
    expect(selection.ok).toBe(true);
    expect(selection.rects).toHaveLength(2);
  });

  it("fuzzes TeX-derived editor hit maps for styled text and forced breaks", async () => {
    const cases = Array.from({ length: 40 }, (_, index) => buildTexHitMapFuzzCase(index));
    for (const testCase of cases) {
      const result = layoutSimpleTexParagraph(testCase.source, {
        paragraphId: testCase.id,
        width: testCase.width,
        parindent: 0,
        hyphenator: { hyphenate: () => [] },
      });
      expect(result.supported, testCase.source).toBe(true);
      expect(result.report, testCase.source).toBeTruthy();
      expect(result.vlistLayout, testCase.source).toBeTruthy();
      expect(testCase.offsets.length, testCase.source).toBeGreaterThan(0);

      const report = result.report!;
      const outputJax = { linebreaks: { getReports: () => [report] } };
      registerTexVListLayoutsOnOutputJax(outputJax, [{
        paragraphId: testCase.id,
        layout: result.vlistLayout!,
      }]);
      const containerElement = {
        getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        viewBox: { baseVal: { width: report.width } },
        querySelectorAll: () => {
          throw new Error("registered vlist geometry should avoid rendered linebox queries");
        },
      };

      const sampledOffsets = testCase.offsets.filter((_, index) => index % 3 === 0).slice(0, 8);
      for (const offset of sampledOffsets) {
        const point = await getKnuthPlassPointFromOffset(outputJax, {
          paragraphId: testCase.id,
          sourceText: testCase.source,
          containerElement,
          offset,
        });
        expect(point.error?.message ?? null, `${testCase.id}: ${testCase.source} @ ${offset}`).toBeNull();
        expect(point, `${testCase.id}: ${testCase.source} @ ${offset}`).toMatchObject({
          ok: true,
          offset,
          kind: "text",
        });

        const caret = await getKnuthPlassCaretFromPoint(outputJax, {
          paragraphId: testCase.id,
          sourceText: testCase.source,
          containerElement,
          clientPoint: clientPoint(px(point.clientPoint?.x ?? 0), px(point.clientPoint?.y ?? 0)),
        });
        expect(caret.error?.message ?? null, `${testCase.id}: ${testCase.source} @ ${offset}`).toBeNull();
        expect(caret, `${testCase.id}: ${testCase.source} @ ${offset}`).toMatchObject({
          ok: true,
          offset,
          kind: "text",
        });
      }

      const rangeStart = testCase.offsets[0];
      const rangeEnd = testCase.offsets[testCase.offsets.length - 1];
      if (rangeStart !== undefined && rangeEnd !== undefined && rangeEnd > rangeStart) {
        const selection = await getKnuthPlassSelectionRects(outputJax, {
          paragraphId: testCase.id,
          sourceText: testCase.source,
          containerElement,
          startOffset: rangeStart,
          endOffset: rangeEnd,
        });
        expect(selection.error?.message ?? null, `${testCase.id}: ${testCase.source}`).toBeNull();
        expect(selection.ok, `${testCase.id}: ${testCase.source}`).toBe(true);
        expect(selection.rects.length, `${testCase.id}: ${testCase.source}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("native Unicode prose", () => {
  it("shapes precomposed and combining Latin accents without whole-node fallback", () => {
    for (const source of ["Café déjà vu — naïve", "Cafe\u0301"] as const) {
      const result = layoutSimpleTexParagraph(source, {
        width: 160,
        alignment: "ragged-right",
        hyphenator: { hyphenate: () => [] },
      });
      expect(result.supported, source).toBe(true);
      expect(result.fallbackReason, source).toBeNull();
      expect([...result.shapedRuns.values()].some((run) =>
        run.items.some((item) => item.kind === "glyph" && item.code === 0xe9)
      ), source).toBe(true);
    }
  });

  it("lowers TeX accent and letter commands while retaining their source spans", () => {
    const source = String.raw`Jos\'{e} Mu\~noz, \AA ngstr\"om`;
    const ir = parseSimpleTexParagraphIr(source);
    expect(ir.unsupportedCommand).toBe(false);
    expect(ir.nodes.filter((node) => node.kind === "text").map((node) => node.text).join(""))
      .toContain("é");
    const result = layoutSimpleTexParagraph(source, {
      width: 180,
      alignment: "ragged-right",
      hyphenator: { hyphenate: () => [] },
    });
    expect(result.supported, source).toBe(true);
    const accentStart = source.indexOf(String.raw`\'{e}`);
    const accentEnd = accentStart + String.raw`\'{e}`.length;
    const accentGlyph = [...result.shapedRuns.values()]
      .flatMap((run) => run.items)
      .find((item) => item.kind === "glyph" && item.code === 0xe9);
    expect(accentGlyph).toMatchObject({ sourceStart: accentStart, sourceEnd: accentEnd });
  });

  it("keeps scoped and bare typewriter declarations on the native path", () => {
    const source = String.raw`normal {\ttfamily mono} \texttt{also mono}`;
    const result = layoutSimpleTexParagraph(source, {
      width: 180,
      alignment: "ragged-right",
      hyphenator: { hyphenate: () => [] },
    });
    expect(result.supported, source).toBe(true);
    expect([...result.shapedRuns.values()].filter((run) =>
      run.font.id.startsWith("lmmono")
    ).length).toBeGreaterThanOrEqual(2);
  });
});

describe("simple TeX paragraph layout", () => {
  it("reports unsupported Unicode in a list label without throwing", () => {
    const source = String.raw`\begin{itemize}\item[Ωmega] Body\end{itemize}`;
    const result = layoutSimpleTexParagraph(source, {
      width: 160,
      hyphenator: { hyphenate: () => [] },
    });
    expect(result.supported).toBe(false);
    expect(result.fallbackReason).toContain("no TFM metric");
  });

  it("keeps overfull inline math geometry finite in a narrow minipage", () => {
    const source = String.raw`\begin{minipage}[t]{5bp}$x$\end{minipage}`;
    const result = layoutSimpleTexParagraph(source, {
      width: 160,
      fallbackPolicy: "placeholder",
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });
    expect(result.supported).toBe(true);
    const line = result.report?.lines[0];
    expect(Number.isFinite(line?.xEnd)).toBe(true);
    for (const segment of line?.segments ?? []) {
      expect(Number.isFinite(segment.width)).toBe(true);
      expect(segment.caretStops?.every(Number.isFinite) ?? true).toBe(true);
    }
  });
  // These expected line arrays are cached LuaTeX oracle regressions. Refresh
  // them with `npm run compare:tex-paragraph` before changing the expectations.
  it.each(texParagraphRegressionCases)("matches cached LuaTeX paragraph oracle for $id", async ({ text, width, lines }) => {
    await preloadEnglishHyphenator();
    const result = layoutSimpleTexParagraph(text, {
      paragraphId: "tex:regression",
      width,
      textFontProfile: classicComputerModernTextFontProfile,
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(lines);
  });

  it("matches TeX line breaks and hyphenation for a multi-sentence left-aligned paragraph", async () => {
    await preloadEnglishHyphenator();
    const text = "Consequat, mollis, vivamus, semper. Libero eget ipsum, metus augue. Etiam penatibus, justo. Integer sociis luctus pellentesque rhoncus vivamus montes metus vitae, massa, amet sem rhoncus nisi sed, feugiat. Augue ullamcorper amet sapien commodo semper tellus sed cras eleifend penatibus.";
    const result = layoutSimpleTexParagraph(text, {
      paragraphId: "tex:target",
      width: 120,
      tolerance: 200,
      textFontProfile: classicComputerModernTextFontProfile,
    });

    expect(result.supported).toBe(true);
    expect(result.report?.linebreakingMode).toBe("feasible");
    expect(lineTexts(result.report)).toEqual([
      "Consequat, mollis, vi-",
      "vamus, semper. Libero",
      "eget ipsum, metus augue.",
      "Etiam penatibus, justo.",
      "Integer sociis luctus pel-",
      "lentesque rhoncus viva-",
      "mus montes metus vitae,",
      "massa, amet sem rhoncus",
      "nisi sed, feugiat. Augue",
      "ullamcorper amet sapien",
      "commodo semper tellus",
      "sed cras eleifend penatibus.",
    ]);
  });

  it("renders TeX discretionary pre- and post-break material inside ligatures", async () => {
    await preloadEnglishHyphenator();
    const result = layoutSimpleTexParagraph("snuffless", {
      paragraphId: "tex:discretionary-ligature",
      width: 24,
      tolerance: 9999,
      textFontProfile: classicComputerModernTextFontProfile,
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["snuff-", "less"]);
    expect(result.report?.lines[0]?.segments.map((segment) => segment.text)).toEqual([
      "snu",
      "ff-",
    ]);
    expect(result.report?.lines[1]?.segments.map((segment) => segment.text)).toEqual([
      "l",
      "ess",
    ]);
  });

  it("positions simple discretionary hyphens with TeX font kerns", () => {
    const font = computerModernTexMetricProvider.resolveFont();
    const result = layoutSimpleTexParagraph("manual", {
      paragraphId: "tex:discretionary-hyphen-kern",
      width: 23,
      tolerance: 9999,
      hyphenator: { hyphenate: () => [3] },
      font,
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["man-", "ual"]);
    const firstLineSegments = result.report?.lines[0]?.segments ?? [];
    const prefixSegment = firstLineSegments.find((segment) => segment.text === "man");
    const hyphenSegment = firstLineSegments.find((segment) => segment.text === "-");
    const hyphenWidth = computerModernTexMetricProvider.shapeText("-", font).width;
    const expectedHyphenX = (prefixSegment?.x ?? 0) +
      (prefixSegment?.width ?? 0) +
      (result.report?.lines[0]?.break?.width ?? hyphenWidth) -
      hyphenWidth;
    expect(Math.abs((hyphenSegment?.x ?? 0) - expectedHyphenX)).toBeLessThan(0.005);
    expect(hyphenSegment?.x).not.toBeCloseTo(
      (prefixSegment?.x ?? 0) + (prefixSegment?.width ?? 0),
      6
    );
  });

  it("treats single newlines as interword spaces in simple TeX paragraphs", () => {
    const result = layoutSimpleTexParagraph("Alpha\nBeta Gamma", {
      paragraphId: "tex:newline-space",
      width: 150,
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["Alpha Beta Gamma"]);
  });

  it("treats TeX double backslash commands as forced line breaks", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha \\ Beta`, {
      paragraphId: "tex:forced-break",
      width: 150,
      tolerance: 200,
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["Alpha", "Beta"]);
    expect(result.report?.lines[0]?.break).toMatchObject({
      kind: "forced",
      lineLeading: undefined,
    });
  });

  it("preserves optional leading on TeX double backslash line breaks", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha \\[7pt] Beta`, {
      paragraphId: "tex:forced-break-leading",
      width: 150,
      tolerance: 200,
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["Alpha", "Beta"]);
    expect(result.report?.lines[0]?.break).toMatchObject({
      kind: "forced",
      lineLeading: "7pt",
    });
  });

  it("consumes the star and optional leading on starred TeX line breaks", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha \\*[7pt] Beta`, {
      paragraphId: "tex:starred-forced-break-leading",
      width: 150,
      tolerance: 200,
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["Alpha", "Beta"]);
    expect(result.report?.lines[0]?.break).toMatchObject({
      kind: "forced",
      lineLeading: "7pt",
    });
  });

  it("treats the LaTeX newline control word as a forced line break", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha \newline Beta`, {
      paragraphId: "tex:newline-control-word",
      width: 150,
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["Alpha", "Beta"]);
    expect(result.report?.lines[0]?.break).toMatchObject({ kind: "forced" });
    expect(result.report?.lines.flatMap((line) => line.segments).some((segment) => segment.literal)).toBe(false);
  });

  it("consumes LaTeX linebreak priorities without swallowing following prose", () => {
    const optional = layoutSimpleTexParagraph(String.raw`Alpha\linebreak[0]{Beta}`, {
      paragraphId: "tex:linebreak-priority-zero",
      width: 150,
      hyphenator: { hyphenate: () => [] },
    });
    expect(optional.supported).toBe(true);
    expect(lineTexts(optional.report)).toEqual(["AlphaBeta"]);
    expect(optional.report?.lines.flatMap((line) => line.segments).some((segment) => segment.literal)).toBe(false);

    const forced = layoutSimpleTexParagraph(String.raw`Alpha\linebreak[4]Beta`, {
      paragraphId: "tex:linebreak-priority-four",
      width: 150,
      hyphenator: { hyphenate: () => [] },
    });
    expect(lineTexts(forced.report)).toEqual(["Alpha", "Beta"]);
  });

  it("models TikZ text-width node indentation around par and forced line breaks", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha Beta Gamma \par \noindent Delta \\[7pt] Epsilon`, {
      paragraphId: "tex:tikz-node-indent",
      width: 150,
      parindent: 10,
      tikzTextWidthNode: true,
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["Alpha Beta Gamma", "Delta", "Epsilon"]);
    expect(result.report?.lines.map((line) => line.xStart)).toEqual([
      expect.closeTo(0, 6),
      expect.closeTo(0, 6),
      expect.closeTo(10, 6),
    ]);
  });

  it("breaks before a forced line break when the pre-break segment would be overfull", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha Beta Gamma Delta \\ Epsilon`, {
      paragraphId: "tex:forced-break-overfull-prefix",
      width: 80,
      tikzTextWidthNode: true,
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["Alpha Beta", "Gamma Delta", "Epsilon"]);
    expect(result.report?.lines[1]?.break).toMatchObject({ kind: "forced" });
  });

  it("uses TeX paragraph-final linebreaking before non-justified forced breaks", async () => {
    await preloadEnglishHyphenator();
    const result = layoutSimpleTexParagraph(String.raw`Actual careful normal paragraph natural quoted epsilon pattern. \\[4pt] Kernel editor natural modern spacing metric basic faithful shape spacing compact future,. Classic screen paragraph metric, precise careful lattice paper,.`, {
      paragraphId: "tex:forced-break-terminal-prefix",
      width: 120,
      parindent: 10,
      tikzTextWidthNode: true,
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual([
      "Actual careful normal",
      "paragraph natural quoted",
      "epsilon pattern.",
      "Kernel editor natural",
      "modern spacing metric ba-",
      "sic faithful shape spacing",
      "compact future,. Classic",
      "screen paragraph metric,",
      "precise careful lattice pa-",
      "per,.",
    ]);
    expect(result.report?.lines[2]?.break).toMatchObject({
      kind: "forced",
      lineLeading: "4pt",
    });
  });

  it("does not indent the line after a forced break in justified TikZ text-width nodes", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha Beta \\[7pt] Gamma Delta`, {
      paragraphId: "tex:justified-forced-break-indent",
      width: 240,
      alignment: "justified",
      parindent: 15,
      tikzTextWidthNode: true,
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["Alpha Beta", "Gamma Delta"]);
    expect(result.report?.lines.map((line) => line.xStart)).toEqual([
      expect.closeTo(0, 6),
      expect.closeTo(0, 6),
    ]);
  });

  it("keeps justified forced breaks in one TeX paragraph for global demerits", async () => {
    await preloadEnglishHyphenator();
    const result = layoutSimpleTexParagraph(String.raw`Model sample normal sentence anchor single pattern quoted output. \par \noindent Gamma beta position editor final faithful manual, hyphenation. \\[7pt] Quoted quoted canvas layout visible basic wide reader, sample chapter efficient.`, {
      paragraphId: "tex:justified-forced-break-demerits",
      width: 100,
      alignment: "justified",
      parindent: 10,
      tikzTextWidthNode: true,
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual([
      "Model sample normal",
      "sentence anchor single",
      "pattern quoted output.",
      "Gamma beta position",
      "editor final faithful",
      "manual, hyphenation.",
      "Quoted quoted canvas",
      "layout visible basic",
      "wide reader, sample",
      "chapter efficient.",
    ]);
    expect(result.report?.lines[5]?.break).toMatchObject({
      kind: "forced",
      lineLeading: "7pt",
    });
  });

  it("distributes justified stretch according to each TeX space glue node", () => {
    const result = layoutSimpleTexParagraph(String.raw`Canvas position screen alignment rendering modern control language final. \par \noindent Precise quoted direct manual beta beta editor, paragraph normal output gamma. Editor paper screen table semantic layout.`, {
      paragraphId: "tex:justified-spacefactor-glue",
      width: 120,
      alignment: "justified",
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    const sentenceSpaceLine = result.report?.lines.find((line) =>
      line.segments.map((segment) => segment.text ?? "").join("") === "gamma. Editor paper"
    );
    expect(sentenceSpaceLine).toBeDefined();
    const spaces = sentenceSpaceLine?.segments.filter((segment) => segment.kind === "space") ?? [];
    expect(spaces).toHaveLength(2);
    expect(spaces[0]?.width).toBeGreaterThan((spaces[1]?.width ?? 0) * 2);
    const lastSegment = sentenceSpaceLine?.segments.at(-1);
    expect((lastSegment?.x ?? 0) + (lastSegment?.width ?? 0)).toBeCloseTo(120, 5);
  });

  it("uses TeX sentence spacefactor for justified final-line glue", () => {
    const normalSpace = firstLineSpaceWidths("Alpha Beta", {
      paragraphId: "tex:normal-spacefactor",
      width: 300,
      alignment: "justified",
    })[0];
    const [sentenceSpace, followingNormalSpace] = firstLineSpaceWidths("Alpha. Beta Gamma", {
      paragraphId: "tex:sentence-spacefactor",
      width: 300,
      alignment: "justified",
    });
    const [questionSpace, exclamationSpace] = firstLineSpaceWidths("Alpha? Beta! Gamma", {
      paragraphId: "tex:question-exclamation-spacefactor",
      width: 300,
      alignment: "justified",
    });

    expect(sentenceSpace).toBeGreaterThan(normalSpace ?? 0);
    expect(questionSpace).toBeCloseTo(sentenceSpace ?? 0, 6);
    expect(exclamationSpace).toBeCloseTo(sentenceSpace ?? 0, 6);
    expect(followingNormalSpace).toBeCloseTo(normalSpace ?? 0, 6);
  });

  it("matches TeX spacefactor for uppercase abbreviations and closing punctuation", () => {
    const normalSpace = firstLineSpaceWidths("Alpha Beta", {
      paragraphId: "tex:normal-spacefactor-baseline",
      width: 300,
      alignment: "justified",
    })[0];
    const sentenceSpace = firstLineSpaceWidths("Alpha. Beta", {
      paragraphId: "tex:sentence-spacefactor-baseline",
      width: 300,
      alignment: "justified",
    })[0];
    const [
      uppercasePeriodSpace,
      uppercaseWordSpace,
      uppercaseAcronymPeriodSpace,
      lowercaseWordSpace,
      closingParenSpace,
      followingNormalSpace,
      closingQuoteSpace,
    ] =
      firstLineSpaceWidths(String.raw`A. B NASA. Rover Alpha.) Beta Alpha." Gamma`, {
        paragraphId: "tex:uppercase-closing-spacefactor",
        width: 500,
        alignment: "justified",
      });

    expect(uppercasePeriodSpace).toBeCloseTo(normalSpace ?? 0, 6);
    expect(uppercaseWordSpace).toBeCloseTo(normalSpace ?? 0, 6);
    expect(uppercaseAcronymPeriodSpace).toBeCloseTo(normalSpace ?? 0, 6);
    expect(lowercaseWordSpace).toBeCloseTo(normalSpace ?? 0, 6);
    expect(closingParenSpace).toBeCloseTo(sentenceSpace ?? 0, 6);
    expect(followingNormalSpace).toBeCloseTo(normalSpace ?? 0, 6);
    expect(closingQuoteSpace).toBeCloseTo(sentenceSpace ?? 0, 6);
  });

  it("scales justified stretch for comma, semicolon, and colon spacefactors", () => {
    const result = layoutSimpleTexParagraph(
      "Alpha, Beta; Gamma: Delta Epsilon Zeta Eta Theta Iota Kappa.",
      {
        paragraphId: "tex:punctuation-spacefactor-stretch",
        width: 130,
        alignment: "justified",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)[0]).toBe("Alpha, Beta; Gamma: Delta");
    const spaces = result.report?.lines[0]?.segments.filter((segment) => segment.kind === "space") ?? [];
    expect(spaces).toHaveLength(3);
    expect(spaces[1]?.width).toBeGreaterThan(spaces[0]?.width ?? 0);
    expect(spaces[2]?.width).toBeGreaterThan(spaces[1]?.width ?? 0);
  });

  it("uses TikZ fixed sentence spacing for non-justified text-width node glue", () => {
    const font = computerModernTexMetricProvider.resolveFont();
    const [sentenceSpace, normalSpace] = firstLineSpaceWidths("Alpha. Beta Gamma", {
      paragraphId: "tex:tikz-fixed-spacefactor",
      width: 300,
      alignment: "ragged-right",
      tikzTextWidthNode: true,
      font,
    });

    expect(sentenceSpace).toBeCloseTo(0.5 * font.atPt, 5);
    expect(normalSpace).toBeCloseTo(0.3333 * font.atPt, 5);
  });

  it("starts a fresh TeX paragraph after a blank line", () => {
    const result = layoutSimpleTexParagraph("Alpha\n\nGamma", {
      paragraphId: "tex:blank-line",
      width: 150,
      parindent: 10,
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["Alpha", "Gamma"]);
    expect(result.report?.lines.map((line) => line.xStart)).toEqual([
      expect.closeTo(10, 6),
      expect.closeTo(10, 6),
    ]);
  });

  it("treats TeX par commands as paragraph boundaries", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha \par Gamma`, {
      paragraphId: "tex:par-command",
      width: 150,
      parindent: 10,
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["Alpha", "Gamma"]);
    expect(result.report?.lines.map((line) => line.xStart)).toEqual([
      expect.closeTo(10, 6),
      expect.closeTo(10, 6),
    ]);
  });

  it("inserts TeX interline glue between explicit par paragraphs before display math", () => {
    const source = String.raw`Alpha $x^2$ first. \par \noindent Second \[\sqrt{y+1}\] tail \(z_1\).`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:explicit-par-before-display",
      width: 170,
      alignment: "ragged-right",
      rightskipStretch: 170,
      spaceGlueProfile: "font",
      tikzTextWidthNode: true,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });

    expect(result.supported).toBe(true);
    const paragraphs = result.vlistLayout?.paragraphPlacements ?? [];
    expect(paragraphs.length).toBeGreaterThanOrEqual(2);
    const firstParagraph = paragraphs[0];
    const secondParagraph = paragraphs[1];
    if (!firstParagraph || !secondParagraph) {
      throw new Error("expected explicit par to produce two paragraphs");
    }
    const expectedInterlineGlue = 12 -
      firstParagraph.metrics.depth -
      secondParagraph.metrics.height;
    const interlineGlue = result.vlistLayout?.boxReport.items.find((item) =>
      item.glue?.origin?.kind === "paragraph-boundary-interline" &&
      item.glue.origin.boundary === "plain"
    );

    expect(interlineGlue?.glue).toEqual({
      size: expect.closeTo(expectedInterlineGlue, 6),
      stretchOrder: "normal",
      shrinkOrder: "normal",
      origin: {
        kind: "paragraph-boundary-interline",
        boundary: "plain",
      },
    });
    expect(secondParagraph.y).toBeCloseTo(
      firstParagraph.metrics.height +
        firstParagraph.metrics.depth +
        expectedInterlineGlue,
      6
    );
  });

  it("suppresses paragraph indentation after TeX noindent commands", () => {
    const result = layoutSimpleTexParagraph(String.raw`\noindent Alpha \par Gamma \par \noindent Delta`, {
      paragraphId: "tex:noindent-command",
      width: 150,
      parindent: 10,
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["Alpha", "Gamma", "Delta"]);
    expect(result.report?.lines.map((line) => line.xStart)).toEqual([
      expect.closeTo(0, 6),
      expect.closeTo(10, 6),
      expect.closeTo(0, 6),
    ]);
  });

  it("lays out LaTeX quote blocks with article-class list margins", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{quote} Alpha Beta Gamma Delta Epsilon Zeta \end{quote}`,
      {
        paragraphId: "tex:quote-block",
        width: 120,
        alignment: "ragged-right",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(result.report?.lines.length).toBeGreaterThan(1);
    expect(result.vlistLayout?.linePlacements[0]?.y).toBe(10);
    for (const line of result.report?.lines ?? []) {
      expect(line.xStart).toBeCloseTo(25, 5);
      expect(line.xEnd).toBeLessThanOrEqual(95.00001);
    }
  });

  it("lays out LaTeX quotation blocks with article-class paragraph indentation", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{quotation} Alpha \par Beta \end{quotation}`,
      {
        paragraphId: "tex:quotation-block",
        width: 120,
        alignment: "ragged-right",
        parindent: 0,
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["Alpha", "Beta"]);
    expect(result.report?.lines.map((line) => firstVisibleTextX(line))).toEqual([
      expect.closeTo(40, 5),
      expect.closeTo(40, 5),
    ]);
  });

  it("matches TeX's tiny-minipage quotation first-item label break", async () => {
    await preloadEnglishHyphenator();
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{minipage}{90pt}\begin{quotation}Normal document \par Figure natural.\end{quotation}\end{minipage}`,
      {
        paragraphId: "tex:quotation-minipage-tiny-indent",
        width: 240,
        alignment: "justified",
        parindent: 0,
        tikzTextWidthNode: true,
        textFontProfile: classicComputerModernTextFontProfile,
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)[0]).toBe("");
    expect(visibleLineTexts(result.report)).toEqual([
      "Normal",
      "docu-",
      "ment",
      "Fig-",
      "ure",
      "natural.",
    ]);
    expect(visibleLines(result.report).map((line) => firstVisibleTextX(line))).toEqual([
      expect.closeTo(25, 5),
      expect.closeTo(25, 5),
      expect.closeTo(25, 5),
      expect.closeTo(40, 5),
      expect.closeTo(25, 5),
      expect.closeTo(25, 5),
    ]);
  });

  it("matches TeX when the first quotation item label stays with a hyphenated word", async () => {
    await preloadEnglishHyphenator();
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{minipage}{90pt}\begin{quotation}Position actual logic final logic output. \par Narrow basic source sentence semantic editor document.\end{quotation}\end{minipage}`,
      {
        paragraphId: "tex:quotation-minipage-position-label",
        width: 160,
        alignment: "justified",
        parindent: 0,
        tikzTextWidthNode: true,
        textFontProfile: classicComputerModernTextFontProfile,
      }
    );

    expect(result.supported).toBe(true);
    expect(visibleLineTexts(result.report)).toEqual([
      "Po-",
      "sition",
      "actual",
      "logic fi-",
      "nal logic",
      "output.",
      "Nar-",
      "row basic",
      "source",
      "sentence",
      "semantic",
      "editor",
      "docu-",
      "ment.",
    ]);
    const lines = visibleLines(result.report);
    expect(firstVisibleTextX(lines[0])).toBeCloseTo(40, 5);
    expect(firstVisibleTextX(lines[1])).toBeCloseTo(25, 5);
    expect(firstVisibleTextX(lines[6])).toBeCloseTo(40, 5);
  });

  it("can keep the first quotation item label on the first visible line", async () => {
    await preloadEnglishHyphenator();
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{minipage}{100pt}\begin{quotation}Alignment double alpha screen screen document chapter gamma, control. \par Initial classic control chapter spacing, wide careful.\end{quotation}\end{minipage}`,
      {
        paragraphId: "tex:quotation-minipage-indented",
        width: 240,
        alignment: "ragged-left",
        parindent: 0,
        tikzTextWidthNode: true,
        textFontProfile: classicComputerModernTextFontProfile,
      }
    );

    expect(result.supported).toBe(true);
    expect(visibleLineTexts(result.report)).toEqual([
      "Align-",
      "ment",
      "double al-",
      "pha screen",
      "screen",
      "document",
      "chapter",
      "gamma,",
      "control.",
      "Initial",
      "classic",
      "control",
      "chapter",
      "spacing,",
      "wide care-",
      "ful.",
    ]);
    const lines = visibleLines(result.report);
    expect(firstVisibleTextX(lines[0])).toBeCloseTo(40, 5);
    expect(firstVisibleTextX(lines[1])).toBeCloseTo(25, 5);
    expect(firstVisibleTextX(lines[9])).toBeCloseTo(40, 5);
  });

  it("keeps LaTeX quotation paragraph indentation after forced breaks", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{quotation} Alpha \\[7pt] Beta \end{quotation}`,
      {
        paragraphId: "tex:quotation-forced-break-indent",
        width: 120,
        alignment: "ragged-right",
        parindent: 0,
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["Alpha", "Beta"]);
    expect(result.report?.lines.map((line) => firstVisibleTextX(line))).toEqual([
      expect.closeTo(40, 5),
      expect.closeTo(40, 5),
    ]);
  });

  it("keeps first quotation item indentation after justified forced breaks", async () => {
    await preloadEnglishHyphenator();
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{quotation} Future local precise nested table analysis, option initial document. \\[7pt] Option chapter method layout analysis, affinity, paper. \end{quotation}`,
      {
        paragraphId: "tex:quotation-justified-forced-break-indent",
        width: 240,
        alignment: "ragged-left",
        parindent: 15,
        tikzTextWidthNode: true,
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual([
      "Future local precise nested table analy-",
      "sis, option initial document.",
      "Option chapter method layout analysis,",
      "affinity, paper.",
    ]);
    const lines = visibleLines(result.report);
    expect(firstVisibleTextX(lines[0])).toBeCloseTo(40, 5);
    expect(firstVisibleTextX(lines[1])).toBeCloseTo(25, 5);
    expect(firstVisibleTextX(lines[2])).toBeCloseTo(40, 5);
    expect(firstVisibleTextX(lines[3])).toBeCloseTo(25, 5);
  });

  it("does not double-indent the first quotation item after an outer paragraph", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`Chapter default default rendering semantic output layout affinity. \par \begin{quotation} Spacing office anchor default compact, anchor. \par Pattern sample semantic option natural initial. \end{quotation}`,
      {
        paragraphId: "tex:quotation-first-item-after-par",
        width: 320,
        alignment: "justified",
        parindent: 10,
        tikzTextWidthNode: true,
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual([
      "Chapter default default rendering semantic output layout affinity.",
      "Spacing office anchor default compact, anchor.",
      "Pattern sample semantic option natural initial.",
    ]);
    const lines = visibleLines(result.report);
    expect(firstVisibleTextX(lines[0])).toBeCloseTo(0, 5);
    expect(firstVisibleTextX(lines[1])).toBeCloseTo(40, 5);
    expect(firstVisibleTextX(lines[2])).toBeCloseTo(40, 5);
  });

  it("positions LaTeX quote list vertical skips across paragraph boundaries", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`Alpha \par \begin{quote} Beta \par Gamma \end{quote} \par Delta`,
      {
        paragraphId: "tex:quote-vertical-skips",
        width: 150,
        alignment: "justified",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([
      0,
      22.33,
      38.11,
      60.22,
    ]);
  });

  it("uses TikZ node topsep when a leading quote is followed by another paragraph", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{quote} Beta \end{quote} \par Delta`,
      {
        paragraphId: "tex:tikz-node-leading-quote-vertical-skips",
        width: 150,
        alignment: "justified",
        tikzTextWidthNode: true,
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([
      8,
      27.89,
    ]);
  });

  it("exposes vlist layout metrics for quote/list vertical skips", () => {
    const source = String.raw`Alpha \par \begin{quote} Beta \par Gamma \end{quote} \par Delta`;
    const result = layoutSimpleTexParagraph(
      source,
      {
        paragraphId: "tex:vlist-quote-vertical-skips",
        width: 150,
        alignment: "justified",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(result.vlistLayout?.baseline).toEqual({ kind: "explicit", y: 8.5 });
    expect(result.vlistLayout?.metrics).toEqual({
      width: 150,
      height: 8.5,
      depth: 58.77,
    });
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 22.33, 38.11, 60.22]);
    expect(result.vlistLayout?.paragraphPlacements.map((placement) => ({
      blockIndex: placement.blockIndex,
      lineIndices: placement.lineIndices,
      y: placement.y,
    }))).toEqual([
      { blockIndex: 0, lineIndices: [0], y: 0 },
      { blockIndex: 1, lineIndices: [1], y: 22.33 },
      { blockIndex: 2, lineIndices: [2], y: 38.11 },
      { blockIndex: 3, lineIndices: [3], y: 60.22 },
    ]);
    expect(result.vlistLayout?.items.map((item) => ({
      kind: item.item.kind,
      role: item.item.kind === "vbox" ? item.item.role : undefined,
      y: item.y,
      height: item.metrics.height,
    }))).toEqual([
      { kind: "paragraph", role: undefined, y: 0, height: expect.closeTo(7.16, 2) },
      { kind: "vbox", role: { kind: "quote", depth: 1 }, y: 9.1, height: expect.closeTo(20.06, 2) },
      { kind: "glue", role: undefined, y: 45.38, height: 10 },
      { kind: "glue", role: undefined, y: 55.38, height: 4.84 },
      { kind: "paragraph", role: undefined, y: 60.22, height: expect.closeTo(6.94, 2) },
    ]);
    expect(result.vlistLayout?.reports).toEqual([result.report]);

    expect(result.report).not.toBeNull();
  });

  it("positions vlist paragraph items across TeX forced-break leading", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha \\[7pt] Beta \par Gamma`, {
      paragraphId: "tex:vlist-forced-break-leading",
      width: 150,
      alignment: "ragged-right",
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 19.33, 31.11]);
    expect(result.vlistLayout?.items.map((item) => ({
      kind: item.item.kind,
      y: item.y,
      depth: item.metrics.depth,
      interlineBoundary: item.item.kind === "glue" && item.item.origin?.kind === "paragraph-boundary-interline"
        ? item.item.origin.boundary
        : undefined,
    }))).toEqual([
      { kind: "paragraph", y: 0, depth: expect.closeTo(19.11, 2), interlineBoundary: undefined },
      { kind: "glue", y: 26.27, depth: 0, interlineBoundary: "plain" },
      { kind: "paragraph", y: 31.11, depth: expect.closeTo(0.22, 2), interlineBoundary: undefined },
    ]);
  });

  it("positions explicit vertical glue commands in the TeX vlist layout", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`Alpha \par \smallskip Beta \par \vspace{7pt} Gamma`,
      {
        paragraphId: "tex:vlist-explicit-vertical-glue",
        width: 150,
        alignment: "ragged-right",
      }
    );

    expect(result.supported).toBe(true);
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 15.33, 34.11]);
    expect(result.vlistLayout?.items.map((item) => ({
      kind: item.item.kind,
      y: item.y,
      height: item.item.kind === "glue" ? item.metrics.height : undefined,
      text: item.item.kind === "paragraph" ? item.item.paragraph.text : undefined,
      stretch: item.item.kind === "glue" ? item.item.stretch : undefined,
      interlineBoundary: item.item.kind === "glue" && item.item.origin?.kind === "paragraph-boundary-interline"
        ? item.item.origin.boundary
        : undefined,
    }))).toEqual([
      { kind: "paragraph", y: 0, height: undefined, text: "Alpha", stretch: undefined, interlineBoundary: undefined },
      { kind: "glue", y: 9.1, height: 3, text: undefined, stretch: 1, interlineBoundary: undefined },
      { kind: "glue", y: 12.1, height: 3.23, text: undefined, stretch: undefined, interlineBoundary: "plain" },
      { kind: "paragraph", y: 15.33, height: undefined, text: "Beta", stretch: undefined, interlineBoundary: undefined },
      { kind: "glue", y: 22.27, height: 7, text: undefined, stretch: undefined, interlineBoundary: undefined },
      { kind: "glue", y: 29.27, height: 4.84, text: undefined, stretch: undefined, interlineBoundary: "plain" },
      { kind: "paragraph", y: 34.11, height: undefined, text: "Gamma", stretch: undefined, interlineBoundary: undefined },
    ]);
  });

  it("positions explicit TeX hrule commands in the vlist layout", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`Alpha \par \hrule width 24pt height 2pt depth 1pt Beta`,
      {
        paragraphId: "tex:vlist-explicit-rule",
        width: 150,
        alignment: "ragged-right",
      }
    );

    expect(result.supported).toBe(true);
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 12.1]);
    expect(result.vlistLayout?.items.map((item) => ({
      kind: item.item.kind,
      y: item.y,
      width: item.item.kind === "rule" ? item.metrics.width : undefined,
      height: item.item.kind === "rule" ? item.metrics.height : undefined,
      depth: item.item.kind === "rule" ? item.metrics.depth : undefined,
      text: item.item.kind === "paragraph" ? item.item.paragraph.text : undefined,
    }))).toEqual([
      { kind: "paragraph", y: 0, width: undefined, height: undefined, depth: undefined, text: "Alpha" },
      { kind: "rule", y: 9.1, width: 24, height: 2, depth: 1, text: undefined },
      { kind: "paragraph", y: 12.1, width: undefined, height: undefined, depth: undefined, text: "Beta" },
    ]);
  });

  it("positions explicit TeX penalty commands as zero-height vlist items", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`Alpha \par \penalty -50 Beta`,
      {
        paragraphId: "tex:vlist-explicit-penalty",
        width: 150,
        alignment: "ragged-right",
      }
    );

    expect(result.supported).toBe(true);
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 12.33]);
    expect(result.vlistLayout?.items.map((item) => ({
      kind: item.item.kind,
      y: item.y,
      height: item.item.kind === "penalty" ? item.metrics.height : undefined,
      depth: item.item.kind === "penalty" ? item.metrics.depth : undefined,
      penalty: item.item.kind === "penalty" ? item.item.penalty : undefined,
      text: item.item.kind === "paragraph" ? item.item.paragraph.text : undefined,
      interlineBoundary: item.item.kind === "glue" && item.item.origin?.kind === "paragraph-boundary-interline"
        ? item.item.origin.boundary
        : undefined,
    }))).toEqual([
      { kind: "paragraph", y: 0, height: undefined, depth: undefined, penalty: undefined, text: "Alpha", interlineBoundary: undefined },
      { kind: "penalty", y: 9.1, height: 0, depth: 0, penalty: -50, text: undefined, interlineBoundary: undefined },
      { kind: "glue", y: 9.1, height: undefined, depth: undefined, penalty: undefined, text: undefined, interlineBoundary: "plain" },
      { kind: "paragraph", y: 12.33, height: undefined, depth: undefined, penalty: undefined, text: "Beta", interlineBoundary: undefined },
    ]);
  });

  it("honors negative explicit vertical glue in the TeX vlist layout", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`Alpha \par \vspace{-4pt} Beta \par \vskip -2pt Gamma`,
      {
        paragraphId: "tex:vlist-negative-explicit-vertical-glue",
        width: 150,
        alignment: "ragged-right",
      }
    );

    expect(result.supported).toBe(true);
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 8.33, 18.11]);
    expect(result.vlistLayout?.items.map((item) => ({
      kind: item.item.kind,
      y: item.y,
      height: item.item.kind === "glue" ? item.metrics.height : undefined,
      text: item.item.kind === "paragraph" ? item.item.paragraph.text : undefined,
      size: item.item.kind === "glue" ? item.item.size : undefined,
      interlineBoundary: item.item.kind === "glue" && item.item.origin?.kind === "paragraph-boundary-interline"
        ? item.item.origin.boundary
        : undefined,
    }))).toEqual([
      { kind: "paragraph", y: 0, height: undefined, text: "Alpha", size: undefined, interlineBoundary: undefined },
      { kind: "glue", y: 9.1, height: 0, text: undefined, size: -4, interlineBoundary: undefined },
      { kind: "glue", y: 5.1, height: 3.23, text: undefined, size: 3.23, interlineBoundary: "plain" },
      { kind: "paragraph", y: 8.33, height: undefined, text: "Beta", size: undefined, interlineBoundary: undefined },
      { kind: "glue", y: 15.27, height: 0, text: undefined, size: -2, interlineBoundary: undefined },
      { kind: "glue", y: 13.27, height: 4.84, text: undefined, size: 4.84, interlineBoundary: "plain" },
      { kind: "paragraph", y: 18.11, height: undefined, text: "Gamma", size: undefined, interlineBoundary: undefined },
    ]);
  });

  it("includes trailing vertical items in root vlist metrics", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`Alpha \par \vspace{7pt}`,
      {
        paragraphId: "tex:vlist-trailing-vertical-glue",
        width: 150,
        alignment: "ragged-right",
      }
    );

    expect(result.supported).toBe(true);
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0]);
    expect(result.vlistLayout?.metrics).toEqual({
      width: 150,
      height: 8.5,
      depth: 7.6,
    });
    expect(result.vlistLayout?.items.map((item) => ({
      kind: item.item.kind,
      y: item.y,
      height: item.item.kind === "glue" ? item.metrics.height : undefined,
      text: item.item.kind === "paragraph" ? item.item.paragraph.text : undefined,
    }))).toEqual([
      { kind: "paragraph", y: 0, height: undefined, text: "Alpha" },
      { kind: "glue", y: 9.1, height: 7, text: undefined },
    ]);
  });

  it("sets vfill glue before lower-order finite stretch when a vlist target height is explicit", () => {
    const source = String.raw`Alpha \par \smallskip \vfill Beta`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:vlist-vfill-natural",
      width: 150,
      alignment: "ragged-right",
    });
    const parsed = parseSimpleTexParagraphIr(source);
    const layoutIr = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      items: parsed.items,
      defaultAlignment: "ragged-right",
      font: computerModernTexMetricProvider.resolveFont(),
      options: {},
    });

    expect(result.supported).toBe(true);
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 15.33]);

    const constrained = relayoutFromExistingVListLayout(
      layoutIr.vlist,
      result.vlistLayout,
      {
        width: 150,
        height: 60,
        lineHeight: 12,
        firstLineAscent: 8.5,
      }
    );

    expect(constrained && {
      linePlacementYs: constrained.linePlacements.map((placement) => placement.y),
      metrics: constrained.metrics,
      items: constrained.items.map((item) => ({
        kind: item.item.kind,
        y: item.y,
        height: item.item.kind === "glue" ? item.metrics.height : undefined,
        stretchOrder: item.item.kind === "glue" ? item.item.stretchOrder : undefined,
        size: item.item.kind === "glue" ? item.item.size : undefined,
        text: item.item.kind === "paragraph" ? item.item.paragraph.text : undefined,
      })),
    }).toEqual({
      linePlacementYs: [0, 53.06],
      metrics: { width: 150, height: 8.5, depth: 51.5 },
      items: [
        { kind: "paragraph", y: 0, height: undefined, stretchOrder: undefined, size: undefined, text: "Alpha" },
        { kind: "glue", y: 9.1, height: 3, stretchOrder: "normal", size: 3, text: undefined },
        { kind: "glue", y: 12.1, height: 40.96, stretchOrder: "fill", size: 0, text: undefined },
        { kind: "paragraph", y: 53.06, height: undefined, stretchOrder: undefined, size: undefined, text: "Beta" },
      ],
    });
  });

  it("sets finite vertical stretch and shrink under explicit vlist heights", () => {
    const source = String.raw`Alpha \par \vskip 6pt plus 2pt minus 3pt Beta`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:vlist-finite-glue-set",
      width: 150,
      alignment: "ragged-right",
    });
    const parsed = parseSimpleTexParagraphIr(source);
    const layoutIr = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      items: parsed.items,
      defaultAlignment: "ragged-right",
      font: computerModernTexMetricProvider.resolveFont(),
      options: {},
    });

    expect(result.supported).toBe(true);
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 18.33]);

    const stretched = relayoutFromExistingVListLayout(
      layoutIr.vlist,
      result.vlistLayout,
      {
        width: 150,
        height: 32,
        lineHeight: 12,
        firstLineAscent: 8.5,
      }
    );
    const shrunk = relayoutFromExistingVListLayout(
      layoutIr.vlist,
      result.vlistLayout,
      {
        width: 150,
        height: 27,
        lineHeight: 12,
        firstLineAscent: 8.5,
      }
    );

    expect(stretched?.linePlacements.map((placement) => placement.y)).toEqual([0, 25.06]);
    expect(stretched?.items.map((item) =>
      item.item.kind === "glue" ? item.metrics.height : null
    )).toEqual([null, 15.96, null]);
    expect(stretched?.metrics).toEqual({ width: 150, height: 8.5, depth: 23.5 });

    expect(shrunk?.linePlacements.map((placement) => placement.y)).toEqual([0, 20.06]);
    expect(shrunk?.items.map((item) =>
      item.item.kind === "glue" ? item.metrics.height : null
    )).toEqual([null, 10.96, null]);
    expect(shrunk?.metrics).toEqual({ width: 150, height: 8.5, depth: 18.5 });
  });

  it("aligns a shorter vlist inside an explicit root height", () => {
    const source = String.raw`Alpha \par Beta`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:vlist-root-align",
      width: 150,
      alignment: "ragged-right",
    });
    const parsed = parseSimpleTexParagraphIr(source);
    const layoutIr = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      items: parsed.items,
      defaultAlignment: "ragged-right",
      font: computerModernTexMetricProvider.resolveFont(),
      options: {},
    });

    expect(result.supported).toBe(true);
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 12.33]);

    const center = relayoutFromExistingVListLayout(
      layoutIr.vlist,
      result.vlistLayout,
      {
        width: 150,
        height: 50,
        verticalAlign: "center",
        lineHeight: 12,
        firstLineAscent: 8.5,
      }
    );
    const bottom = relayoutFromExistingVListLayout(
      layoutIr.vlist,
      result.vlistLayout,
      {
        width: 150,
        height: 50,
        verticalAlign: "bottom",
        lineHeight: 12,
        firstLineAscent: 8.5,
      }
    );

    expect(center && {
      baseline: center.baseline,
      linePlacementYs: center.linePlacements.map((placement) => placement.y),
      metrics: center.metrics,
      itemY: center.items.map((item) => item.y),
    }).toEqual({
      baseline: { kind: "explicit", y: 25.48 },
      linePlacementYs: [16.98, 26.08],
      metrics: { width: 150, height: 25.48, depth: 24.52 },
      itemY: [16.98, 26.08],
    });
    expect(bottom && {
      baseline: bottom.baseline,
      linePlacementYs: bottom.linePlacements.map((placement) => placement.y),
      metrics: bottom.metrics,
      itemY: bottom.items.map((item) => item.y),
    }).toEqual({
      baseline: { kind: "explicit", y: 42.46 },
      linePlacementYs: [33.96, 43.06],
      metrics: { width: 150, height: 42.46, depth: 7.54 },
      itemY: [33.96, 43.06],
    });
  });

  it("positions literal paragraphs from unsupported commands between supported paragraphs", () => {
    const source = String.raw`Alpha \par \unsupportedgraphics[width=1cm]{plot.pdf} \par Beta`;
    const parsed = parseSimpleTexParagraphIr(source);
    const supported = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:vlist-literal-reference",
      width: 150,
      alignment: "ragged-right",
    });

    expect(parsed.unsupportedCommand).toBe(false);
    expect(supported.supported).toBe(true);
    const vlistLayout = supported.vlistLayout;
    if (!vlistLayout) {
      throw new Error("expected vlist layout");
    }

    const items = vlistLayout.items
      .filter((item) => item.item.kind === "paragraph")
      .map((item) => ({
        kind: item.item.kind,
        y: item.y,
        text: item.item.kind === "paragraph" ? item.item.paragraph.text : undefined,
        sourceSpan: item.item.sourceSpan,
      }));
    expect(items.map((item) => [item.kind, item.text])).toEqual([
      ["paragraph", "Alpha"],
      ["paragraph", String.raw`\unsupportedgraphics[width=1cm]{plot.pdf}`],
      ["paragraph", "Beta"],
    ]);
    expect(items[0]?.sourceSpan).toEqual({ start: 0, end: 5 });
    expect(items[1]?.sourceSpan?.start).toBe(source.indexOf(String.raw`\unsupportedgraphics`));
    expect(items[2]?.sourceSpan).toEqual({ start: source.indexOf("Beta"), end: source.length });
    expect(items[0].y).toBeLessThan(items[1].y);
    expect(items[1].y).toBeLessThan(items[2].y);

    const segments = supported.report?.lines.flatMap((line) => line.segments) ?? [];
    const literalSegments = segments.filter((segment) => segment.literal);
    expect(literalSegments.length).toBeGreaterThan(0);
    expect(literalSegments.every(
      (segment) => segment.literal?.reason === "unsupported-command"
    )).toBe(true);
    expect(literalSegments.every(
      (segment) => segment.fontId?.includes("mono") || segment.fontId?.includes("tt")
    )).toBe(true);
  });

  it("renders unknown commands through the TeX path regardless of fallback policy", () => {
    const source = String.raw`Alpha \par \unsupportedgraphics[width=1cm]{plot.pdf} \par Beta`;
    const defaultResult = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:vlist-literal-default",
      width: 150,
      alignment: "ragged-right",
    });
    const placeholderPolicyResult = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:vlist-literal-placeholder-policy",
      width: 150,
      alignment: "ragged-right",
      fallbackPolicy: "placeholder",
    });

    for (const result of [defaultResult, placeholderPolicyResult]) {
      expect(result.supported).toBe(true);
      expect(result.fallbackReason).toBeNull();
      expect(result.report?.errors ?? []).toEqual([]);
      const paragraphTexts = (result.vlistLayout?.items ?? [])
        .filter((item) => item.item.kind === "paragraph")
        .map((item) => (item.item.kind === "paragraph" ? item.item.paragraph.text : ""));
      expect(paragraphTexts).toEqual([
        "Alpha",
        String.raw`\unsupportedgraphics[width=1cm]{plot.pdf}`,
        "Beta",
      ]);
    }
  });

  it("keeps explicit vertical glue inside quote vbox metadata", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{quote}\smallskip Alpha\end{quote}`,
      {
        paragraphId: "tex:vlist-quote-explicit-glue",
        width: 150,
        alignment: "ragged-right",
      }
    );

    expect(result.supported).toBe(true);
    const quote = result.vlistLayout?.items[0];
    expect(quote?.item).toMatchObject({
      kind: "vbox",
      role: { kind: "quote", depth: 1 },
    });
    expect(quote?.children?.map((item) => ({
      kind: item.item.kind,
      size: item.item.kind === "glue" ? item.item.size : undefined,
      text: item.item.kind === "paragraph" ? item.item.paragraph.text : undefined,
    }))).toEqual([
      { kind: "glue", size: 3, text: undefined },
      { kind: "glue", size: 10, text: undefined },
      { kind: "paragraph", size: undefined, text: "Alpha" },
    ]);
  });

  it("does not infer TeX vlist box geometry from rendered SVG metadata without a registered layout", () => {
    const boxes = [
      makeVListBoxElement(
        { left: 100, top: 40, right: 20, bottom: 10 },
        {
          "data-tex-vbox-role": "quote",
          "data-tex-vlist-path": "0",
          "data-tex-local-x": "3",
          "data-tex-local-y": "5",
          "data-tex-local-width": "40",
          "data-tex-local-height": "12",
          "data-tex-vbox-depth": "1",
          "data-tex-list-kind": "enumerate",
          "data-tex-list-label-depth": "9",
          "data-tex-list-left-margin-em": "99",
          "data-tex-list-item-index": "99",
          "data-source-start": "7",
          "data-source-end": "42",
        }
      ),
      makeVListBoxElement(
        { left: 10, top: 20, right: 70, bottom: 90 },
        {
          "data-tex-vbox-role": "list",
          "data-tex-vlist-path": "0.2",
          "data-tex-local-x": "11",
          "data-tex-local-y": "17",
          "data-tex-local-width": "20",
          "data-tex-local-height": "8",
          "data-tex-list-kind": "enumerate",
          "data-tex-vbox-depth": "2",
          "data-tex-list-label-depth": "1",
          "data-tex-list-left-margin-em": "2.2",
          "data-source-start": "12",
          "data-source-end": "39",
        }
      ),
      makeVListBoxElement(
        { left: 30, top: 24, right: 50, bottom: 34 },
        {
          "data-tex-vbox-role": "list-item",
          "data-tex-vlist-path": "0.2.0",
          "data-tex-local-x": "13",
          "data-tex-local-y": "19",
          "data-tex-local-width": "16",
          "data-tex-local-height": "5",
          "data-tex-list-kind": "enumerate",
          "data-tex-vbox-depth": "2",
          "data-tex-list-label-depth": "1",
          "data-tex-list-item-index": "1",
          "data-source-start": "20",
          "data-source-end": "30",
        }
      ),
    ];

    expect(getKnuthPlassVListBoxGeometry({
      containerElement: {
        querySelectorAll: (selector: string) =>
          selector === '[data-tex-vbox="true"]' ? boxes : [],
      },
    })).toEqual([]);
    expect(getKnuthPlassVListBoxFromPoint({
      containerElement: {
        querySelectorAll: (selector: string) =>
          selector === '[data-tex-vbox="true"]' ? boxes : [],
      },
      clientPoint: clientPoint(px(40), px(30)),
    })).toBeNull();
    expect(getKnuthPlassVListBoxFromPoint({
      containerElement: {
        querySelectorAll: (selector: string) =>
          selector === '[data-tex-vbox="true"]' ? boxes : [],
      },
      clientPoint: clientPoint(px(5), px(5)),
    })).toBeNull();
  });

  it("reads TeX vlist box geometry from registered positioned layouts", () => {
    const outputJax = {};
    registerTexVListLayoutsOnOutputJax(outputJax, [{
      paragraphId: "tex:registered-vbox",
      layout: registeredLayoutWithBoxReport({
        metrics: { width: 100, height: 20, depth: 10 },
        baseline: { kind: "explicit", y: 8 },
        paragraphPlacements: [],
        linePlacements: [],
        reports: [],
        errors: [],
        items: [
          {
            item: {
              kind: "vbox",
              role: { kind: "quote", depth: 1 },
              sourceSpan: { start: 7, end: 42 },
              items: [],
            },
            path: [0],
            x: texVListX(3),
            y: 5,
            metrics: { width: 40, height: 8, depth: 4 },
            children: [
              {
                item: {
                  kind: "vbox",
                  role: {
                    kind: "list",
                    listKind: "enumerate",
                    depth: 2,
                    labelDepth: 1,
                    ownLeftMarginEm: 2.2,
                    totalLeftMarginEm: 2.2,
                  },
                  sourceSpan: { start: 12, end: 39 },
                  items: [],
                },
                path: [0, 0],
                x: texVListX(11),
                y: 17,
                metrics: { width: 20, height: 6, depth: 2 },
                children: [
                  {
                    item: {
                      kind: "vbox",
                      role: {
                        kind: "list-item",
                        listKind: "enumerate",
                        depth: 2,
                        labelDepth: 1,
                        itemIndex: 1,
                      },
                      sourceSpan: { start: 20, end: 30 },
                      items: [],
                    },
                    path: [0, 0, 0],
                    x: texVListX(13),
                    y: 19,
                    metrics: { width: 16, height: 3, depth: 2 },
                  },
                ],
              },
            ],
          },
        ],
      }),
    }]);

    expect(getKnuthPlassVListBoxGeometry({
      outputJax,
      paragraphId: "tex:registered-vbox",
      containerElement: {
        getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 }),
        querySelectorAll: () => {
          throw new Error("registered vlist geometry should not query DOM metadata");
        },
      },
    })).toEqual([
      {
        role: "quote",
        vlistPath: [0],
        localLeft: 3,
        localRight: 43,
        localTop: 5,
        localBottom: 17,
        depth: 1,
        listKind: null,
        listLabelDepth: null,
        listLeftMarginEm: null,
        listItemIndex: null,
        sourceStart: 7,
        sourceEnd: 42,
        clientLeft: 16,
        clientRight: 96,
        clientTop: 35,
        clientBottom: 71,
      },
      {
        role: "list",
        vlistPath: [0, 0],
        localLeft: 11,
        localRight: 31,
        localTop: 17,
        localBottom: 25,
        depth: 2,
        listKind: "enumerate",
        listLabelDepth: 1,
        listLeftMarginEm: 2.2,
        listItemIndex: null,
        sourceStart: 12,
        sourceEnd: 39,
        clientLeft: 32,
        clientRight: 72,
        clientTop: 71,
        clientBottom: 95,
      },
      {
        role: "list-item",
        vlistPath: [0, 0, 0],
        localLeft: 13,
        localRight: 29,
        localTop: 19,
        localBottom: 24,
        depth: 2,
        listKind: "enumerate",
        listLabelDepth: 1,
        listLeftMarginEm: null,
        listItemIndex: 1,
        sourceStart: 20,
        sourceEnd: 30,
        clientLeft: 36,
        clientRight: 68,
        clientTop: 77,
        clientBottom: 92,
      },
    ]);
    expect(getKnuthPlassVListBoxFromPoint({
      outputJax,
      paragraphId: "tex:registered-vbox",
      containerElement: {
        getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 }),
        querySelectorAll: () => {
          throw new Error("registered vlist box hit-testing should not query DOM metadata");
        },
      },
      clientPoint: clientPoint(px(40), px(80)),
    })).toEqual(expect.objectContaining({
      role: "list-item",
      vlistPath: [0, 0, 0],
      sourceStart: 20,
      sourceEnd: 30,
    }));
    expect(getKnuthPlassVListBoxFromPoint({
      outputJax,
      paragraphId: "tex:registered-vbox",
      containerElement: {
        getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 }),
      },
      clientPoint: clientPoint(px(4), px(4)),
    })).toBeNull();
  });

  it("reads TeX paragraph placement geometry from registered vlist layouts", () => {
    const outputJax = {};
    registerTexVListLayoutsOnOutputJax(outputJax, [{
      paragraphId: "tex:registered-paragraph-placements",
      layout: registeredLayoutWithBoxReport({
        metrics: { width: 100, height: 20, depth: 10 },
        baseline: { kind: "explicit", y: 8 },
        paragraphPlacements: [
          {
            blockIndex: 0,
            vlistPath: [0],
            sourceSpan: { start: 0, end: 5 },
            sourceHitPolicy: "caret",
            lineIndices: [0],
            x: 0,
            y: 3,
            metrics: { width: 80, height: 7, depth: 5 },
          },
          {
            blockIndex: 1,
            vlistPath: [1],
            sourceSpan: { start: 7, end: 16 },
            sourceHitPolicy: "caret",
            lineIndices: [1, 2],
            x: 6,
            y: 19,
            metrics: { width: 90, height: 8, depth: 16 },
          },
        ],
        linePlacements: [
          { lineIndex: 0, x: 0, y: 3, height: 12 },
          { lineIndex: 1, x: 6, y: 19, height: 12 },
          { lineIndex: 2, x: 6, y: 31, height: 12 },
        ],
        reports: [],
        errors: [],
        items: [],
      }),
    }]);

    expect(getKnuthPlassVListParagraphGeometry({
      outputJax,
      paragraphId: "tex:registered-paragraph-placements",
      containerElement: {
        getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 }),
        querySelectorAll: () => {
          throw new Error("registered paragraph placement geometry should not query DOM metadata");
        },
      } as any,
    })).toEqual([
      {
        blockIndex: 0,
        vlistPath: [0],
        localLeft: 0,
        localRight: 80,
        localTop: 3,
        localBottom: 15,
        lineIndices: [0],
        sourceHitPolicy: "caret",
        sourceStart: 0,
        sourceEnd: 5,
        clientLeft: 10,
        clientRight: 170,
        clientTop: 29,
        clientBottom: 65,
      },
      {
        blockIndex: 1,
        vlistPath: [1],
        localLeft: 6,
        localRight: 96,
        localTop: 19,
        localBottom: 43,
        lineIndices: [1, 2],
        sourceHitPolicy: "caret",
        sourceStart: 7,
        sourceEnd: 16,
        clientLeft: 22,
        clientRight: 202,
        clientTop: 77,
        clientBottom: 149,
      },
    ]);
  });

  it("does not infer TeX placeholder geometry from rendered SVG metadata without a registered layout", () => {
    const placeholders = [
      makeVListBoxElement(
        { left: 120, top: 44, right: 40, bottom: 12 },
        {
          "data-tex-vlist-item": "placeholder",
          "data-tex-placeholder-reason": "Unsupported TeX command in vertical mode.",
          "data-tex-vlist-path": "1",
          "data-tex-local-x": "18",
          "data-tex-local-y": "21",
          "data-tex-local-width": "12",
          "data-tex-local-height": "6",
          "data-source-start": "11",
          "data-source-end": "48",
        }
      ),
      makeVListBoxElement(
        { left: 5, top: 5, right: 5, bottom: 20 },
        {
          "data-tex-vlist-item": "placeholder",
          "data-tex-placeholder-reason": "empty",
          "data-source-start": "1",
          "data-source-end": "2",
        }
      ),
    ];

    expect(getKnuthPlassPlaceholderGeometry({
      containerElement: {
        querySelectorAll: (selector: string) =>
          selector === "[data-tex-vlist-item]" ? placeholders : [],
      } as any,
    })).toEqual([]);
  });

  it("reads TeX placeholder geometry from registered positioned layouts", () => {
    const outputJax = {};
    registerTexVListLayoutsOnOutputJax(outputJax, [{
      paragraphId: "tex:registered-placeholder",
      layout: registeredLayoutWithBoxReport({
        metrics: { width: 100, height: 20, depth: 10 },
        baseline: { kind: "explicit", y: 8 },
        paragraphPlacements: [],
        linePlacements: [],
        reports: [],
        errors: [],
        items: [
          {
            item: {
              kind: "vbox",
              items: [],
            },
            path: [0],
            x: texVListX(0),
            y: 0,
            metrics: { width: 30, height: 10, depth: 5 },
            children: [
              {
                item: {
                  kind: "placeholder",
                  sourceSpan: { start: 11, end: 48 },
                  reason: "Unsupported TeX command in vertical mode.",
                  estimated: { width: 12, height: 4, depth: 2 },
                },
                path: [0, 0],
                x: texVListX(18),
                y: 21,
                metrics: { width: 12, height: 4, depth: 2 },
              },
            ],
          },
        ],
      }),
    }]);

    expect(getKnuthPlassPlaceholderGeometry({
      outputJax,
      paragraphId: "tex:registered-placeholder",
      containerElement: {
        getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 }),
        querySelectorAll: () => {
          throw new Error("registered placeholder geometry should not query DOM metadata");
        },
      } as any,
    })).toEqual([
      {
        reason: "Unsupported TeX command in vertical mode.",
        vlistPath: [0, 0],
        localLeft: 18,
        localRight: 30,
        localTop: 21,
        localBottom: 27,
        sourceStart: 11,
        sourceEnd: 48,
        clientLeft: 46,
        clientRight: 70,
        clientTop: 83,
        clientBottom: 101,
      },
    ]);
  });

  it("does not infer generic TeX vlist item geometry from rendered SVG metadata without a registered layout", () => {
    const items = [
      makeVListBoxElement(
        { left: 20, top: 15, right: 80, bottom: 30 },
        {
          "data-tex-vlist-item": "hbox",
          "data-tex-vlist-path": "0",
          "data-tex-local-x": "2",
          "data-tex-local-y": "3",
          "data-tex-local-width": "12",
          "data-tex-local-height": "4",
          "data-tex-hbox-role": "list-label",
          "data-tex-list-label-kind": "custom",
          "data-tex-list-label-placement": "margin",
          "data-tex-list-kind": "enumerate",
          "data-tex-vbox-depth": "2",
          "data-tex-list-label-depth": "1",
          "data-tex-list-item-index": "3",
          "data-tex-list-label-block-index": "8",
          "data-source-start": "4",
          "data-source-end": "13",
        }
      ),
      makeVListBoxElement(
        { left: 12, top: 34, right: 22, bottom: 39 },
        {
          "data-tex-vlist-item": "rule",
          "data-tex-vlist-path": "1",
          "data-tex-local-x": "10",
          "data-tex-local-y": "12",
          "data-tex-local-width": "7",
          "data-tex-local-height": "3",
        }
      ),
      makeVListBoxElement(
        { left: 40, top: 44, right: 120, bottom: 76 },
        {
          "data-tex-vlist-item": "placeholder",
          "data-tex-vlist-path": "2",
          "data-tex-local-x": "18",
          "data-tex-local-y": "21",
          "data-tex-local-width": "9",
          "data-tex-local-height": "6",
          "data-tex-placeholder-reason": "Unsupported TeX command in vertical mode.",
          "data-source-start": "11",
          "data-source-end": "48",
        }
      ),
    ];

    expect(getKnuthPlassVListItemGeometry({
      containerElement: {
        querySelectorAll: (selector: string) =>
          selector === "[data-tex-vlist-item]" ? items : [],
      } as any,
    })).toEqual([]);
    expect(getKnuthPlassVListLabelGeometry({
      containerElement: {
        querySelectorAll: (selector: string) =>
          selector === "[data-tex-vlist-item]" ? items : [],
      } as any,
    })).toEqual([]);
    expect(getKnuthPlassVListItemFromPoint({
      containerElement: {
        querySelectorAll: (selector: string) =>
          selector === "[data-tex-vlist-item]" ? items : [],
      } as any,
      clientPoint: clientPoint(px(16), px(36)),
    })).toBeNull();
    expect(getKnuthPlassVListItemFromPoint({
      containerElement: {
        querySelectorAll: (selector: string) =>
          selector === "[data-tex-vlist-item]" ? items : [],
      } as any,
      clientPoint: clientPoint(px(5), px(5)),
    })).toBeNull();
    expect(getKnuthPlassVListLabelFromPoint({
      containerElement: {
        querySelectorAll: (selector: string) =>
          selector === "[data-tex-vlist-item]" ? items : [],
      } as any,
      clientPoint: clientPoint(px(40), px(20)),
    })).toBeNull();
    expect(getKnuthPlassVListLabelFromPoint({
      containerElement: {
        querySelectorAll: (selector: string) =>
          selector === "[data-tex-vlist-item]" ? items : [],
      } as any,
      clientPoint: clientPoint(px(39), px(42)),
    })).toBeNull();
  });

  it("does not build a TeX vlist geometry snapshot from rendered SVG metadata without a registered layout", () => {
    const boxes = [
      makeVListBoxElement(
        { left: 10, top: 20, right: 80, bottom: 60 },
        {
          "data-tex-vbox-role": "list",
          "data-tex-vlist-path": "0",
          "data-tex-local-x": "4",
          "data-tex-local-y": "5",
          "data-tex-local-width": "20",
          "data-tex-local-height": "12",
          "data-tex-list-kind": "itemize",
          "data-tex-vbox-depth": "1",
          "data-tex-list-label-depth": "0",
          "data-tex-list-left-margin-em": "2.5",
        }
      ),
    ];
    const items = [
      makeVListBoxElement(
        { left: 12, top: 24, right: 32, bottom: 36 },
        {
          "data-tex-vlist-item": "hbox",
          "data-tex-vlist-path": "0.0",
          "data-tex-hbox-role": "list-label",
          "data-tex-list-label-kind": "default",
          "data-tex-list-label-placement": "margin",
          "data-tex-list-kind": "itemize",
          "data-tex-vbox-depth": "1",
          "data-tex-list-label-depth": "0",
          "data-tex-list-item-index": "0",
          "data-tex-list-label-block-index": "3",
        }
      ),
      makeVListBoxElement(
        { left: 40, top: 44, right: 120, bottom: 76 },
        {
          "data-tex-vlist-item": "placeholder",
          "data-tex-vlist-path": "0.1",
          "data-tex-placeholder-reason": "Unsupported TeX command in vertical mode.",
          "data-source-start": "11",
          "data-source-end": "48",
        }
      ),
    ];

    const snapshot = getKnuthPlassVListGeometrySnapshot({
      containerElement: {
        querySelectorAll: (selector: string) => {
          if (selector === '[data-tex-vbox="true"]') {
            return boxes;
          }
          if (selector === "[data-tex-vlist-item]") {
            return items;
          }
          return [];
        },
      },
    });

    expect(snapshot.source).toBe("empty");
    expect(snapshot.boxes).toEqual([]);
    expect(snapshot.items).toEqual([]);
    expect(snapshot.labels).toEqual([]);
    expect(snapshot.placeholders).toEqual([]);
    expect(snapshot.paragraphs).toEqual([]);
    expect(snapshot.tree).toEqual([]);
  });

  it("reads generic TeX vlist item geometry from registered positioned layouts", () => {
    const outputJax = {};
    registerTexVListLayoutsOnOutputJax(outputJax, [{
      paragraphId: "tex:registered-items",
      layout: registeredLayoutWithBoxReport({
        metrics: { width: 100, height: 20, depth: 10 },
        baseline: { kind: "explicit", y: 8 },
        paragraphPlacements: [],
        linePlacements: [],
        reports: [],
        errors: [],
        items: [
          {
            item: {
              kind: "hbox",
              sourceSpan: { start: 4, end: 13 },
              role: {
                kind: "list-label",
                labelKind: "default",
                placement: "margin",
                listKind: "enumerate",
                depth: 1,
                labelDepth: 1,
                itemIndex: 2,
                blockIndex: 0,
              },
              box: {
                metrics: { width: 12, height: 3, depth: 1 },
                renderItems: [],
              },
            },
            path: [0],
            x: texVListX(2),
            y: 3,
            metrics: { width: 12, height: 3, depth: 1 },
          },
          {
            item: {
              kind: "vbox",
              items: [],
            },
            path: [1],
            x: texVListX(0),
            y: 0,
            metrics: { width: 30, height: 10, depth: 5 },
            children: [
              {
                item: {
                  kind: "rule",
                  width: 7,
                  height: 2,
                  depth: 1,
                },
                path: [1, 0],
                x: texVListX(10),
                y: 12,
                metrics: { width: 7, height: 2, depth: 1 },
              },
              {
                item: {
                  kind: "penalty",
                  sourceSpan: { start: 20, end: 31 },
                  penalty: -50,
                },
                path: [1, 1],
                x: texVListX(14),
                y: 16,
                metrics: { width: 0, height: 0, depth: 0 },
              },
              {
                item: {
                  kind: "placeholder",
                  sourceSpan: { start: 40, end: 52 },
                  reason: "Unsupported TeX command in vertical mode.",
                  estimated: { width: 9, height: 4, depth: 2 },
                },
                path: [1, 2],
                x: texVListX(18),
                y: 21,
                metrics: { width: 9, height: 4, depth: 2 },
              },
            ],
          },
        ],
      }),
    }]);

    expect(getKnuthPlassVListItemGeometry({
      outputJax,
      paragraphId: "tex:registered-items",
      containerElement: {
        getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 }),
        querySelectorAll: () => {
          throw new Error("registered vlist item geometry should not query DOM metadata");
        },
      } as any,
    })).toEqual([
      {
        kind: "hbox",
        vlistPath: [0],
        localLeft: 2,
        localRight: 14,
        localTop: 3,
        localBottom: 7,
        sourceStart: 4,
        sourceEnd: 13,
        placeholderReason: null,
        hboxRole: "list-label",
        listLabelKind: "default",
        listLabelPlacement: "margin",
        listKind: "enumerate",
        listDepth: 1,
        listLabelDepth: 1,
        listItemIndex: 2,
        listLabelBlockIndex: 0,
        displayAlignDelimiter: null,
        displayAlignRowIndex: null,
        clientLeft: 14,
        clientRight: 38,
        clientTop: 29,
        clientBottom: 41,
      },
      {
        kind: "rule",
        vlistPath: [1, 0],
        localLeft: 10,
        localRight: 17,
        localTop: 12,
        localBottom: 15,
        sourceStart: null,
        sourceEnd: null,
        placeholderReason: null,
        hboxRole: null,
        listLabelKind: null,
        listLabelPlacement: null,
        listKind: null,
        listDepth: null,
        listLabelDepth: null,
        listItemIndex: null,
        listLabelBlockIndex: null,
        displayAlignDelimiter: null,
        displayAlignRowIndex: null,
        clientLeft: 30,
        clientRight: 44,
        clientTop: 56,
        clientBottom: 65,
      },
      {
        kind: "penalty",
        vlistPath: [1, 1],
        localLeft: 14,
        localRight: 14,
        localTop: 16,
        localBottom: 16,
        sourceStart: 20,
        sourceEnd: 31,
        placeholderReason: null,
        hboxRole: null,
        listLabelKind: null,
        listLabelPlacement: null,
        listKind: null,
        listDepth: null,
        listLabelDepth: null,
        listItemIndex: null,
        listLabelBlockIndex: null,
        displayAlignDelimiter: null,
        displayAlignRowIndex: null,
        clientLeft: 38,
        clientRight: 38,
        clientTop: 68,
        clientBottom: 68,
      },
      {
        kind: "placeholder",
        vlistPath: [1, 2],
        localLeft: 18,
        localRight: 27,
        localTop: 21,
        localBottom: 27,
        sourceStart: 40,
        sourceEnd: 52,
        placeholderReason: "Unsupported TeX command in vertical mode.",
        hboxRole: null,
        listLabelKind: null,
        listLabelPlacement: null,
        listKind: null,
        listDepth: null,
        listLabelDepth: null,
        listItemIndex: null,
        listLabelBlockIndex: null,
        displayAlignDelimiter: null,
        displayAlignRowIndex: null,
        clientLeft: 46,
        clientRight: 64,
        clientTop: 83,
        clientBottom: 101,
      },
    ]);
    expect(getKnuthPlassVListLabelGeometry({
      outputJax,
      paragraphId: "tex:registered-items",
      containerElement: {
        getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 }),
        querySelectorAll: () => {
          throw new Error("registered vlist label geometry should not query DOM metadata");
        },
      } as any,
    })).toEqual([
      expect.objectContaining({
        kind: "hbox",
        hboxRole: "list-label",
        vlistPath: [0],
        listLabelKind: "default",
        listLabelPlacement: "margin",
        listKind: "enumerate",
        listDepth: 1,
        listLabelDepth: 1,
        listItemIndex: 2,
        listLabelBlockIndex: 0,
      }),
    ]);
    expect(getKnuthPlassVListItemFromPoint({
      outputJax,
      paragraphId: "tex:registered-items",
      containerElement: {
        getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 }),
        querySelectorAll: () => {
          throw new Error("registered vlist item hit-testing should not query DOM metadata");
        },
      } as any,
      clientPoint: clientPoint(px(50), px(90)),
    })).toEqual(expect.objectContaining({
      kind: "placeholder",
      vlistPath: [1, 2],
      sourceStart: 40,
      sourceEnd: 52,
      placeholderReason: "Unsupported TeX command in vertical mode.",
    }));
  });

  it("uses vlist tree depth for registered item hit-testing when bounds tie", () => {
    const outputJax = {};
    registerTexVListLayoutsOnOutputJax(outputJax, [{
      paragraphId: "tex:registered-item-depth-hit",
      layout: registeredLayoutWithBoxReport({
        metrics: { width: 100, height: 20, depth: 10 },
        baseline: { kind: "explicit", y: 8 },
        paragraphPlacements: [],
        linePlacements: [],
        reports: [],
        errors: [],
        items: [
          {
            item: {
              kind: "placeholder",
              sourceSpan: { start: 10, end: 90 },
              reason: "Outer fallback.",
              estimated: { width: 20, height: 8, depth: 2 },
            },
            path: [0],
            x: texVListX(4),
            y: 5,
            metrics: { width: 20, height: 8, depth: 2 },
            children: [
              {
                item: {
                  kind: "rule",
                  sourceSpan: { start: 30, end: 40 },
                  width: 20,
                  height: 8,
                  depth: 2,
                },
                path: [0, 0],
                x: texVListX(4),
                y: 5,
                metrics: { width: 20, height: 8, depth: 2 },
              },
            ],
          },
        ],
      }),
    }]);

    expect(getKnuthPlassVListItemFromPoint({
      outputJax,
      paragraphId: "tex:registered-item-depth-hit",
      containerElement: {
        getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 }),
        querySelectorAll: () => {
          throw new Error("registered vlist item depth hit-testing should not query DOM metadata");
        },
      } as any,
      clientPoint: clientPoint(px(20), px(40)),
    })).toEqual(expect.objectContaining({
      kind: "rule",
      vlistPath: [0, 0],
      sourceStart: 30,
      sourceEnd: 40,
    }));
  });

  it("hits registered TeX vlist labels and resolves their paragraph owner", () => {
    const outputJax = {};
    registerTexVListLayoutsOnOutputJax(outputJax, [{
      paragraphId: "tex:registered-label-hit",
      layout: registeredLayoutWithBoxReport({
        metrics: { width: 100, height: 20, depth: 10 },
        baseline: { kind: "explicit", y: 8 },
        paragraphPlacements: [{
          blockIndex: 2,
          vlistPath: [1],
          sourceSpan: { start: 14, end: 30 },
          sourceHitPolicy: "caret",
          lineIndices: [0],
          x: 25,
          y: 3,
          metrics: { width: 60, height: 7, depth: 3 },
        }],
        linePlacements: [],
        reports: [],
        errors: [],
        items: [
          {
            item: {
              kind: "hbox",
              role: {
                kind: "list-label",
                labelKind: "default",
                placement: "margin",
                listKind: "enumerate",
                depth: 1,
                labelDepth: 1,
                itemIndex: 3,
                blockIndex: 2,
              },
              box: {
                metrics: { width: 12, height: 3, depth: 1 },
                renderItems: [],
              },
            },
            path: [0],
            x: texVListX(2),
            y: 3,
            metrics: { width: 12, height: 3, depth: 1 },
          },
        ],
      }),
    }]);

    const containerElement = {
      getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 }),
      querySelectorAll: () => {
        throw new Error("registered vlist label hit-testing should not query DOM metadata");
      },
    } as any;

    expect(getKnuthPlassVListLabelFromPoint({
      outputJax,
      paragraphId: "tex:registered-label-hit",
      containerElement,
      clientPoint: clientPoint(px(20), px(34)),
    })).toEqual({
      label: expect.objectContaining({
        kind: "hbox",
        hboxRole: "list-label",
        listLabelBlockIndex: 2,
        sourceStart: null,
        sourceEnd: null,
      }),
      paragraph: expect.objectContaining({
        blockIndex: 2,
        sourceStart: 14,
        sourceEnd: 30,
      }),
    });
    expect(getKnuthPlassVListLabelFromPoint({
      outputJax,
      paragraphId: "tex:registered-label-hit",
      containerElement,
      clientPoint: clientPoint(px(44), px(34)),
    })).toBeNull();
  });

  it("builds a coherent TeX vlist geometry snapshot from registered positioned layouts", () => {
    const outputJax = {};
    registerTexVListLayoutsOnOutputJax(outputJax, [{
      paragraphId: "tex:registered-snapshot",
      layout: registeredLayoutWithBoxReport({
        metrics: { width: 100, height: 20, depth: 10 },
        baseline: { kind: "explicit", y: 8 },
        paragraphPlacements: [{
          blockIndex: 2,
          vlistPath: [0, 2],
          sourceSpan: { start: 14, end: 30 },
          sourceHitPolicy: "caret",
          lineIndices: [0],
          x: 25,
          y: 3,
          metrics: { width: 60, height: 7, depth: 3 },
        }],
        linePlacements: [],
        reports: [],
        errors: [],
        items: [
          {
            item: {
              kind: "vbox",
              role: {
                kind: "list",
                listKind: "enumerate",
                depth: 1,
                labelDepth: 1,
                ownLeftMarginEm: 2,
                totalLeftMarginEm: 2,
              },
              items: [],
            },
            path: [0],
            x: texVListX(0),
            y: 0,
            metrics: { width: 30, height: 10, depth: 5 },
            children: [
              {
                item: {
                  kind: "hbox",
                  role: {
                    kind: "list-label",
                    labelKind: "default",
                    placement: "margin",
                    listKind: "enumerate",
                    depth: 1,
                    labelDepth: 1,
                    itemIndex: 2,
                    blockIndex: 2,
                  },
                  box: {
                    metrics: { width: 12, height: 3, depth: 1 },
                    renderItems: [],
                  },
                },
                path: [0, 0],
                x: texVListX(2),
                y: 3,
                metrics: { width: 12, height: 3, depth: 1 },
              },
              {
                item: {
                  kind: "placeholder",
                  sourceSpan: { start: 40, end: 52 },
                  reason: "Unsupported TeX command in vertical mode.",
                  estimated: { width: 9, height: 4, depth: 2 },
                },
                path: [0, 1],
                x: texVListX(18),
                y: 21,
                metrics: { width: 9, height: 4, depth: 2 },
              },
              {
                item: {
                  kind: "paragraph",
                  sourceSpan: { start: 14, end: 30 },
                  blockIndex: 2,
                  paragraph: {
                    blockIndex: 2,
                    text: "Paragraph body",
                    sourceSpan: { start: 14, end: 30 },
                    nodes: [],
                    noIndent: false,
                    quoteDepth: 0,
                  },
                },
                path: [0, 2],
                x: texVListX(25),
                y: 3,
                metrics: { width: 60, height: 7, depth: 3 },
              },
            ],
          },
        ],
      }),
    }]);

    const snapshot = getKnuthPlassVListGeometrySnapshot({
      outputJax,
      paragraphId: "tex:registered-snapshot",
      containerElement: {
        getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 }),
        querySelectorAll: () => {
          throw new Error("registered vlist snapshot should not query DOM metadata");
        },
      },
    });

    expect(snapshot.source).toBe("registered");
    expect(snapshot.boxes).toEqual([
      expect.objectContaining({
        role: "list",
        vlistPath: [0],
        listKind: "enumerate",
      }),
    ]);
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.labels).toEqual([
      expect.objectContaining({
        hboxRole: "list-label",
        listLabelBlockIndex: 2,
      }),
    ]);
    expect(snapshot.paragraphs).toEqual([
      expect.objectContaining({
        blockIndex: 2,
        vlistPath: [0, 2],
        sourceStart: 14,
        sourceEnd: 30,
      }),
    ]);
    expect(snapshot.placeholders).toEqual([
      expect.objectContaining({
        reason: "Unsupported TeX command in vertical mode.",
        vlistPath: [0, 1],
        sourceStart: 40,
        sourceEnd: 52,
      }),
    ]);
    expect(snapshot.tree).toEqual([
      expect.objectContaining({
        itemKind: "vbox",
        vlistPath: [0],
        box: expect.objectContaining({
          role: "list",
          listKind: "enumerate",
        }),
        item: null,
        paragraph: null,
        children: [
          expect.objectContaining({
            itemKind: "hbox",
            vlistPath: [0, 0],
            item: expect.objectContaining({
              hboxRole: "list-label",
              listLabelBlockIndex: 2,
            }),
            paragraph: null,
          }),
          expect.objectContaining({
            itemKind: "placeholder",
            vlistPath: [0, 1],
            item: expect.objectContaining({
              placeholderReason: "Unsupported TeX command in vertical mode.",
            }),
            paragraph: null,
          }),
          expect.objectContaining({
            itemKind: "paragraph",
            vlistPath: [0, 2],
            item: null,
            paragraph: expect.objectContaining({
              blockIndex: 2,
              sourceStart: 14,
              sourceEnd: 30,
            }),
          }),
        ],
      }),
    ]);
    expect(getKnuthPlassVListTreeHitFromSnapshot({
      snapshot,
      clientPoint: clientPoint(px(20), px(34)),
    })).toEqual(expect.objectContaining({
      path: [
        expect.objectContaining({ itemKind: "vbox", vlistPath: [0] }),
        expect.objectContaining({ itemKind: "hbox", vlistPath: [0, 0] }),
      ],
      box: expect.objectContaining({
        role: "list",
        vlistPath: [0],
      }),
      item: expect.objectContaining({
        hboxRole: "list-label",
        vlistPath: [0, 0],
      }),
      label: expect.objectContaining({
        hboxRole: "list-label",
        listLabelBlockIndex: 2,
      }),
      labelParagraph: expect.objectContaining({
        blockIndex: 2,
        sourceStart: 14,
        sourceEnd: 30,
      }),
    }));
  });

  it("renders enumerate labels in the article list margin", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{enumerate}\item Alpha Beta\item Gamma\end{enumerate}`,
      {
        paragraphId: "tex:enumerate-list",
        width: 150,
        alignment: "ragged-right",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["1.Alpha Beta", "2.Gamma"]);
    expect(result.report?.lines.map((line) => line.xStart)).toEqual([
      expect.closeTo(25, 6),
      expect.closeTo(25, 6),
    ]);
    expect(result.report?.lines[0]?.segments[0]).toMatchObject({
      kind: "text",
      text: "1.",
      fontId: "lmroman10-regular",
    });
    expect(result.report?.lines[0]?.segments[0]?.x ?? 0).toBeLessThan(20);
    expect(result.report?.lines[0]?.segments[1]).toMatchObject({
      kind: "text",
      text: "Alpha",
      x: expect.closeTo(25, 6),
    });
  });

  it("keeps glyphless list-label lines explicit for TeX oracle comparisons", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{minipage}{90pt}\begin{quotation}Stable gamma vector faithful modern lattice, quoted single lattice. \par Reader local lattice actual spacing double manual,.\end{quotation}\end{minipage}`,
      {
        paragraphId: "tex:glyphless-list-label-oracle-fixture",
        width: 160,
        alignment: "ragged-left",
        parindent: 0,
        tikzTextWidthNode: true,
      }
    );

    expect(result.supported).toBe(true);
    const reportLines = result.report?.lines ?? [];
    const glyphlessListLabelLines = reportLines.filter((line) =>
      line.segments.length > 0 &&
      line.segments.every((segment) => segment.role === "list-label") &&
      line.segments.map((segment) => segment.text ?? "").join("").length === 0
    );

    expect(glyphlessListLabelLines.map((line) => ({
      text: line.segments.map((segment) => segment.text ?? "").join(""),
      ascent: line.ascent,
      descent: line.descent,
      segmentKinds: line.segments.map((segment) => segment.kind),
      segmentRoles: line.segments.map((segment) => segment.role),
    }))).toEqual([
      {
        text: "",
        ascent: 0,
        descent: 0,
        segmentKinds: ["math"],
        segmentRoles: ["list-label"],
      },
    ]);
    expect(lineTexts(result.report)[0]).toBe("");
    expect(reportLines.find((line) =>
      line.segments.map((segment) => segment.text ?? "").join("") === "Reader"
    )?.xStart).toBeCloseTo(40, 6);
    expect(reportLines
      .filter((line) => !glyphlessListLabelLines.includes(line))
      .map((line) => line.segments.map((segment) => segment.text ?? "").join("")))
      .toEqual([
        "Stable",
        "gamma",
        "vector",
        "faithful",
        "modern",
        "lattice,",
        "quoted",
        "single",
        "lattice.",
        "Reader",
        "local lat-",
        "tice",
        "actual",
        "spacing",
        "double",
        "manual,.",
      ]);
  });

  it("represents multi-paragraph list item bodies as nested vboxes", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{enumerate}\item Alpha \par Beta\item Gamma\end{enumerate}`,
      {
        paragraphId: "tex:vlist-list-item-boxes",
        width: 150,
        alignment: "ragged-right",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(result.vlistLayout?.boxReport.items
      .filter((item) => item.role?.kind === "list-item")
      .map((item) => ({
        path: item.path,
        role: item.role,
        listItem: item.listItem,
        sourceSpan: item.sourceSpan,
      }))).toEqual([
      {
        path: [0, 0],
        role: {
          kind: "list-item",
          listKind: "enumerate",
          depth: 1,
          labelDepth: 1,
          itemIndex: 1,
        },
        listItem: {
          itemIndex: 1,
          label: {
            kind: "default",
            placement: "margin",
            content: { kind: "text", text: "1." },
            rightEdge: 20,
          },
        },
        sourceSpan: {
          start: expect.any(Number),
          end: expect.any(Number),
        },
      },
      {
        path: [0, 1],
        role: {
          kind: "list-item",
          listKind: "enumerate",
          depth: 1,
          labelDepth: 1,
          itemIndex: 2,
        },
        listItem: {
          itemIndex: 2,
          label: {
            kind: "default",
            placement: "margin",
            content: { kind: "text", text: "2." },
            rightEdge: 20,
          },
        },
        sourceSpan: {
          start: expect.any(Number),
          end: expect.any(Number),
        },
      },
    ]);
    expect(result.vlistLayout?.boxReport.items
      .filter((item) => item.itemKind === "hbox")
      .map((item) => ({
        path: item.path,
        hboxRole: item.hboxRole,
        width: item.width,
        totalHeight: item.totalHeight,
      }))).toEqual([
      {
        path: [0, 0, 1],
        hboxRole: {
          kind: "list-label",
          labelKind: "default",
          placement: "margin",
          listKind: "enumerate",
          depth: 1,
          labelDepth: 1,
          itemIndex: 1,
          blockIndex: 0,
        },
        width: expect.any(Number),
        totalHeight: expect.any(Number),
      },
      {
        path: [0, 1, 2],
        hboxRole: {
          kind: "list-label",
          labelKind: "default",
          placement: "margin",
          listKind: "enumerate",
          depth: 1,
          labelDepth: 1,
          itemIndex: 2,
          blockIndex: 2,
        },
        width: expect.any(Number),
        totalHeight: expect.any(Number),
      },
    ]);
    const listBox = result.vlistLayout?.boxReport.tree.find((item) =>
      item.role?.kind === "list"
    );
    expect(listBox?.children?.map((item) => ({
      itemKind: item.itemKind,
      path: item.path,
      role: item.role?.kind,
    }))).toEqual([
      { itemKind: "vbox", path: [0, 0], role: "list-item" },
      { itemKind: "vbox", path: [0, 1], role: "list-item" },
    ]);
    expect(listBox?.children?.[0]?.children?.map((item) => ({
      itemKind: item.itemKind,
      path: item.path,
      blockIndex: item.blockIndex,
      hboxRole: item.hboxRole?.kind,
    }))).toEqual([
      { itemKind: "glue", path: [0, 0, 0], blockIndex: undefined, hboxRole: undefined },
      { itemKind: "hbox", path: [0, 0, 1], blockIndex: undefined, hboxRole: "list-label" },
      { itemKind: "paragraph", path: [0, 0, 2], blockIndex: 0, hboxRole: undefined },
      { itemKind: "glue", path: [0, 0, 3], blockIndex: undefined, hboxRole: undefined },
      { itemKind: "glue", path: [0, 0, 4], blockIndex: undefined, hboxRole: undefined },
      { itemKind: "paragraph", path: [0, 0, 5], blockIndex: 1, hboxRole: undefined },
    ]);
    expect(result.vlistLayout?.paragraphPlacements.map((placement) => ({
      blockIndex: placement.blockIndex,
      vlistPath: placement.vlistPath,
    }))).toEqual([
      { blockIndex: 0, vlistPath: [0, 0, 2] },
      { blockIndex: 1, vlistPath: [0, 0, 5] },
      { blockIndex: 2, vlistPath: [0, 1, 3] },
    ]);
  });

  it("renders custom item labels and nested list margins", () => {
    const source = String.raw`\begin{enumerate}\item[Step] Alpha \begin{enumerate}\item Nested\end{enumerate}\end{enumerate}`;
    const result = layoutSimpleTexParagraph(
      source,
      {
        paragraphId: "tex:nested-list",
        width: 150,
        alignment: "ragged-right",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["StepAlpha", "(a)Nested"]);
    expect(result.report?.lines.map((line) => line.xStart)).toEqual([
      expect.closeTo(25, 6),
      expect.closeTo(47, 6),
    ]);
    expect(result.report?.lines[0]?.segments[0]).toMatchObject({
      kind: "text",
      text: "Step",
      fontId: "lmroman10-regular",
    });
    expect(result.report?.lines[1]?.segments[0]).toMatchObject({
      kind: "text",
      text: "(a)",
      fontId: "lmroman10-regular",
    });
    expect(result.vlistLayout?.boxReport.items
      .filter((item) => item.itemKind === "hbox")
      .map((item) => ({
        path: item.path,
        hboxRole: item.hboxRole,
        sourceSpan: item.sourceSpan,
      }))).toEqual([
      {
        path: [0, 0, 1],
        hboxRole: {
          kind: "list-label",
          labelKind: "custom",
          placement: "margin",
          listKind: "enumerate",
          depth: 1,
          labelDepth: 1,
          itemIndex: 1,
          blockIndex: 0,
        },
        sourceSpan: {
          start: source.indexOf("Step"),
          end: source.indexOf("Step") + "Step".length,
        },
      },
      {
        path: [1, 0, 2],
        hboxRole: {
          kind: "list-label",
          labelKind: "default",
          placement: "margin",
          listKind: "enumerate",
          depth: 2,
          labelDepth: 2,
          itemIndex: 1,
          blockIndex: 1,
        },
        sourceSpan: undefined,
      },
    ]);
  });

  it("renders description labels as bold in-flow labels with hanging continuation", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{description}\item[Term] Alpha Beta Gamma Delta Epsilon Zeta\item Plain Entry\end{description}`,
      {
        paragraphId: "tex:description-list",
        width: 90,
        alignment: "ragged-right",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)[0]).toBe("TermAlpha Beta");
    expect(lineTexts(result.report).at(-1)).toBe("Plain Entry");
    expect(result.report?.lines[0]?.xStart).toEqual(expect.closeTo(5, 6));
    expect(result.report?.lines[1]?.xStart).toEqual(expect.closeTo(25, 6));
    expect(result.report?.lines.at(-1)?.xStart).toEqual(expect.closeTo(0, 6));
    expect(result.report?.lines[0]?.segments[0]).toMatchObject({
      kind: "text",
      role: "list-label",
      text: "Term",
      fontId: "lmroman10-bold",
      x: expect.closeTo(5, 6),
    });
    expect(result.report?.lines[0]?.segments[1]).toMatchObject({
      kind: "text",
      text: "Alpha",
      fontId: "lmroman10-regular",
    });
  });

  it("renders first-slice itemize labels in the article list margin", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{itemize}\item Alpha\item Beta\end{itemize}`,
      {
        paragraphId: "tex:itemize-list",
        width: 150,
        alignment: "ragged-right",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["•Alpha", "•Beta"]);
    expect(result.report?.lines.map((line) => line.xStart)).toEqual([
      expect.closeTo(25, 6),
      expect.closeTo(25, 6),
    ]);
    expect(result.report?.lines[0]?.segments[0]).toMatchObject({
      kind: "text",
      text: "•",
      fontId: "lmroman10-regular",
      glyphCode: 0x2022,
    });
    const reportLabelXs = result.report?.lines.map((line) =>
      line.segments.find((segment) => segment.role === "list-label")?.x
    ) ?? [];
    const positionedLabelXs = result.vlistLayout?.boxReport.items
      .filter((item) => item.hboxRole?.kind === "list-label")
      .map((item) => item.x) ?? [];
    expect(positionedLabelXs).toHaveLength(2);
    expect(positionedLabelXs).toEqual(
      reportLabelXs.map((x) => expect.closeTo(x ?? Number.NaN, 6))
    );
  });

  it("renders nested itemize labels with LaTeX article font/code choices", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{itemize}\item Alpha \begin{itemize}\item Beta \begin{itemize}\item Gamma \begin{itemize}\item Delta\end{itemize}\end{itemize}\end{itemize}\end{itemize}`,
      {
        paragraphId: "tex:nested-itemize-list",
        width: 180,
        alignment: "ragged-right",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(result.report?.lines.map((line) => line.segments[0]))
      .toMatchObject([
        { text: "•", fontId: "lmroman10-regular", glyphCode: 0x2022 },
        { text: "–", fontId: "lmroman10-bold", glyphCode: 0x2013 },
        { text: "*", fontId: "tcrm1000", glyphCode: 42 },
        { text: ".", fontId: "tcrm1000", glyphCode: 183 },
      ]);
    expect(result.report?.lines.map((line) => line.xStart)).toEqual([
      expect.closeTo(25, 6),
      expect.closeTo(47, 6),
      expect.closeTo(65.7, 6),
      expect.closeTo(82.7, 6),
    ]);
    const reportLabelXs = result.report?.lines.map((line) =>
      line.segments.find((segment) => segment.role === "list-label")?.x
    ) ?? [];
    const positionedLabelXs = result.vlistLayout?.boxReport.items
      .filter((item) => item.hboxRole?.kind === "list-label")
      .map((item) => item.x) ?? [];
    expect(positionedLabelXs).toEqual(
      reportLabelXs.map((x) => expect.closeTo(x ?? Number.NaN, 6))
    );
  });

  it("positions natural LaTeX article list vertical spacing", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`Before \par \begin{itemize}\item Alpha \par More \item Beta \begin{itemize}\item Nested\end{itemize}\end{itemize} \par After`,
      {
        paragraphId: "tex:list-vertical-spacing",
        width: 180,
        alignment: "ragged-right",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual([
      "Before",
      "•Alpha",
      "More",
      "•Beta",
      "–Nested",
      "After",
    ]);
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([
      0,
      21.89,
      38.22,
      58.22,
      78.11,
      99.89,
    ]);
  });

  it("does not add TikZ forced-break paragraph indent inside list item bodies", async () => {
    await preloadEnglishHyphenator();
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{enumerate}\item option precise model \textit{shape}. \item Language double double. \\[4pt] Result reader metric computer baseline language. \item Visible precise gamma shape epsilon. \par Control gamma sentence screen.\end{enumerate}`,
      {
        paragraphId: "tex:list-forced-break-indent",
        width: 220,
        alignment: "ragged-left",
        parindent: 15,
        tikzTextWidthNode: true,
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual([
      "1.option precise model shape.",
      "2.Language double double.",
      "Result reader metric computer baseline lan-",
      "guage.",
      "3.Visible precise gamma shape epsilon.",
      "Control gamma sentence screen.",
    ]);
    expect(result.report?.lines[1]?.break).toMatchObject({
      kind: "forced",
      lineLeading: "4pt",
    });
    expect(result.report?.lines[2]?.xStart).toBeCloseTo(25, 6);
  });

  it("uses LaTeX list ragged-right stretch for item line breaking", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{itemize}\item Computer compact alignment, normal baseline paper output classic.\end{itemize}`,
      {
        paragraphId: "tex:list-ragged-breaks",
        width: 180,
        alignment: "ragged-right",
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual([
      "•Computer compact alignment,",
      "normal baseline paper output",
      "classic.",
    ]);
  });

  it("uses LaTeX list ragged-left skips for item line breaking", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{enumerate}\item Careful control paragraph language local, chapter.\end{enumerate}`,
      {
        paragraphId: "tex:list-ragged-left-breaks",
        width: 120,
        alignment: "ragged-left",
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual([
      "1.Careful control para-",
      "graph language local,",
      "chapter.",
    ]);
  });

  it("preserves nested inline font command fonts in line segments", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`A \textit{B \emph{C} \textbf{D}} \textnormal{\textbf{E}} \textrm{F} \textsf{G \textbf{H \textit{I}} \textsc{J}} \textsc{K \textsf{L} \textbf{M}} \textsf{\textbf{\textsc{N}}}`,
      {
        paragraphId: "tex:inline-fonts",
        width: 500,
        alignment: "justified",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["A B C D E F G H I J K L M N"]);
    expect(result.report?.lines[0]?.segments
      .filter((segment) => segment.kind === "text")
      .map((segment) => ({ text: segment.text, fontId: segment.fontId }))).toEqual([
        { text: "A", fontId: "lmroman10-regular" },
        { text: "B", fontId: "lmroman10-italic" },
        { text: "C", fontId: "lmroman10-regular" },
        { text: "D", fontId: "lmroman10-bolditalic" },
        { text: "E", fontId: "lmroman10-bold" },
        { text: "F", fontId: "lmroman10-regular" },
        { text: "G", fontId: "lmsans10-regular" },
        { text: "H", fontId: "lmsans10-bold" },
        { text: "I", fontId: "lmsans10-boldoblique" },
        { text: "J", fontId: "lmromancaps10-regular" },
        { text: "K", fontId: "lmromancaps10-regular" },
        { text: "L", fontId: "lmromancaps10-regular" },
        { text: "M", fontId: "lmroman10-bold" },
        { text: "N", fontId: "lmsans10-bold" },
      ]);
  });

  it("measures styled discretionary post-break text with the run font", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`Natural basic computer position. \textbf{efficient baseline faithful} \textrm{model wide}. \par Canvas narrow canvas natural, rendering. \emph{reader rendering \emph{control vector layout} modern alpha output}.`,
      {
        paragraphId: "tex:styled-discretionary-post-break",
        width: 320,
        alignment: "ragged-left",
        parindent: 0,
        tikzTextWidthNode: true,
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual([
      "Natural basic computer position. ef-",
      "ficient baseline faithful model wide.",
      "Canvas narrow canvas natural, rendering. reader ren-",
      "dering control vector layout modern alpha output.",
    ]);
    expect(result.report?.lines[1]?.xEnd).toBeCloseTo(320, 5);
  });

  it("preserves same-font kerns across text font command boundaries", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\textnormal{wide lattice affinity}.`,
      {
        paragraphId: "tex:same-font-command-boundary-kern",
        width: 200,
        alignment: "center",
      }
    );

    const line = result.report?.lines[0];
    const hiddenKern = line?.segments.find((segment) => segment.kind === "space" && segment.text === "");
    const fontId = line?.segments.find((segment) => segment.kind === "text")?.fontId;
    const font = computerModernTexMetricProvider.resolveFont({
      fontId,
      atPt: 10,
    });
    const expectedKern =
      computerModernTexMetricProvider.shapeText("y.", font).width -
      computerModernTexMetricProvider.shapeText("y", font).width -
      computerModernTexMetricProvider.shapeText(".", font).width;
    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["wide lattice affinity."]);
    expect(hiddenKern?.width).toBeCloseTo(expectedKern, 5);
  });

  it("preserves scoped font declaration fonts in line segments", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`A {\it B {\bf C} D} {\itshape E {\bfseries F}} {\sf G {\bf H} {\bfseries I} {\sc J}} {\scshape K {\sffamily L} {\bfseries M}} {\em N {\em O} P} Q`,
      {
        paragraphId: "tex:inline-font-declarations",
        width: 500,
        alignment: "justified",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["A B C D E F G H I J K L M N O P Q"]);
    expect(result.report?.lines[0]?.segments
      .filter((segment) => segment.kind === "text")
      .map((segment) => ({ text: segment.text, fontId: segment.fontId }))).toEqual([
        { text: "A", fontId: "lmroman10-regular" },
        { text: "B", fontId: "lmroman10-italic" },
        { text: "C", fontId: "lmroman10-bold" },
        { text: "D", fontId: "lmroman10-italic" },
        { text: "E", fontId: "lmroman10-italic" },
        { text: "F", fontId: "lmroman10-bolditalic" },
        { text: "G", fontId: "lmsans10-regular" },
        { text: "H", fontId: "lmroman10-bold" },
        { text: "I", fontId: "lmsans10-bold" },
        { text: "J", fontId: "lmromancaps10-regular" },
        { text: "K", fontId: "lmromancaps10-regular" },
        { text: "L", fontId: "lmromancaps10-regular" },
        { text: "M", fontId: "lmroman10-bold" },
        { text: "N", fontId: "lmroman10-italic" },
        { text: "O", fontId: "lmroman10-regular" },
        { text: "P", fontId: "lmroman10-italic" },
        { text: "Q", fontId: "lmroman10-regular" },
      ]);
  });

  it("uses LaTeX quote-local paragraph skips under centered nodes", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{quote} Alpha Beta Gamma Delta Epsilon Zeta \end{quote}`,
      {
        paragraphId: "tex:centered-quote-block",
        width: 120,
        alignment: "center",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(result.report?.lines.length).toBeGreaterThan(1);
    expect(result.report?.lines.map((line) => line.xStart)).toEqual(
      Array.from({ length: result.report?.lines.length ?? 0 }, () => expect.closeTo(25, 5))
    );
  });

  it("honors TeX paragraph alignment declarations at paragraph start", () => {
    const centered = layoutSimpleTexParagraph(String.raw`\centering Alpha Beta`, {
      paragraphId: "tex:centering",
      width: 120,
      alignment: "ragged-right",
      hyphenator: { hyphenate: () => [] },
    });
    const raggedLeft = layoutSimpleTexParagraph(String.raw`\raggedleft Alpha Beta`, {
      paragraphId: "tex:raggedleft",
      width: 120,
      alignment: "ragged-right",
      hyphenator: { hyphenate: () => [] },
    });
    const raggedRight = layoutSimpleTexParagraph(String.raw`\raggedright Alpha Beta`, {
      paragraphId: "tex:raggedright",
      width: 120,
      alignment: "center",
      hyphenator: { hyphenate: () => [] },
    });

    expect(centered.supported).toBe(true);
    expect(centered.report?.alignment).toBe("center");
    expect(centered.report?.lines[0]?.xStart).toBeCloseTo(34.9285, 5);
    expect(raggedLeft.supported).toBe(true);
    expect(raggedLeft.report?.alignment).toBe("ragged-left");
    expect(raggedLeft.report?.lines[0]?.xEnd).toBeCloseTo(120, 5);
    expect(raggedRight.supported).toBe(true);
    expect(raggedRight.report?.alignment).toBe("ragged-right");
    expect(raggedRight.report?.lines[0]?.xStart).toBeCloseTo(0, 6);
  });

  it("honors scoped center and flush environments without leaking alignment", () => {
    const scopedCenter = layoutSimpleTexParagraph(
      String.raw`Alpha \par \begin{center} Beta \end{center} \par Delta`,
      {
        paragraphId: "tex:center-environment-scope",
        width: 120,
        alignment: "ragged-right",
        hyphenator: { hyphenate: () => [] },
      }
    );
    const flushLeft = layoutSimpleTexParagraph(String.raw`\begin{flushleft}Alpha Beta\end{flushleft}`, {
      paragraphId: "tex:flushleft-environment",
      width: 120,
      alignment: "center",
      hyphenator: { hyphenate: () => [] },
    });
    const flushRight = layoutSimpleTexParagraph(String.raw`\begin{flushright}Alpha Beta\end{flushright}`, {
      paragraphId: "tex:flushright-environment",
      width: 120,
      alignment: "ragged-right",
      hyphenator: { hyphenate: () => [] },
    });

    expect(scopedCenter.supported).toBe(true);
    expect(lineTexts(scopedCenter.report)).toEqual(["Alpha", "Beta", "Delta"]);
    expect(scopedCenter.report?.lines[0]?.xStart).toBeCloseTo(0, 6);
    expect(scopedCenter.report?.lines[1]?.xStart).toBeGreaterThan(0);
    expect(scopedCenter.report?.lines[1]?.xEnd).toBeLessThan(120);
    expect(scopedCenter.report?.lines[2]?.xStart).toBeCloseTo(0, 6);

    expect(flushLeft.supported).toBe(true);
    expect(flushLeft.report?.lines[0]?.xStart).toBeCloseTo(0, 6);
    expect(flushRight.supported).toBe(true);
    expect(flushRight.report?.lines[0]?.xEnd).toBeCloseTo(120, 5);
  });

  it("allows paragraph alignment declarations after TeX paragraph boundaries", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha Beta \par \centering Gamma Delta`, {
      paragraphId: "tex:paragraph-centering",
      width: 120,
      alignment: "ragged-right",
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["Alpha Beta", "Gamma Delta"]);
    expect(result.report?.lines[0]?.xStart).toBeCloseTo(0, 6);
    expect(result.report?.lines[1]?.xStart).toBeGreaterThan(0);
    expect(result.report?.lines[1]?.xEnd).toBeLessThan(120);
  });

  it("keeps TikZ text-width alignment when LaTeX declarations appear after par", () => {
    const centeredInRightNode = layoutSimpleTexParagraph(
      String.raw`Alignment position baseline editor, beta. \par \centering Computer vector semantic visible wide manual, office beta, result basic final.`,
      {
        paragraphId: "tex:tikz-right-centering-declaration",
        width: 240,
        alignment: "ragged-left",
        parindent: 10,
        tikzTextWidthNode: true,
        hyphenator: { hyphenate: () => [] },
      }
    );
    const raggedRightInRightNode = layoutSimpleTexParagraph(
      String.raw`Normal table figure vector quoted, lattice wide compact result. \par \raggedright Paper normal basic, reader, quoted sentence wide manual normal lattice. Classic computer classic single screen faithful actual nested,.`,
      {
        paragraphId: "tex:tikz-right-raggedright-declaration",
        width: 240,
        alignment: "ragged-left",
        parindent: 15,
        tikzTextWidthNode: true,
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(centeredInRightNode.supported).toBe(true);
    expect(centeredInRightNode.report?.alignment).toBe("ragged-left");
    expect(lineTexts(centeredInRightNode.report)).toEqual([
      "Alignment position baseline editor, beta.",
      "Computer vector semantic visible wide",
      "manual, office beta, result basic final.",
    ]);
    expect(raggedRightInRightNode.supported).toBe(true);
    expect(raggedRightInRightNode.report?.alignment).toBe("ragged-left");
    expect(lineTexts(raggedRightInRightNode.report)).toEqual([
      "Normal table figure vector quoted,",
      "lattice wide compact result.",
      "Paper normal basic, reader, quoted sentence",
      "wide manual normal lattice. Classic computer",
      "classic single screen faithful actual nested,.",
    ]);
  });

  it("resets TikZ text-width declaration alignment for following list items", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`Rendering anchor beta office wide sample precise alpha classic nested sample,. \par \raggedleft Kernel manual editor classic local. \textbf{anchor double pattern model screen} \textrm{rendering chapter chapter}. \par \begin{itemize}\item office direct normal \textit{rendering epsilon figure}. \item \textbf{final rendering modern} Anchor spacing vector result pattern position.\end{itemize}`,
      {
        paragraphId: "tex:tikz-declaration-list-reset",
        width: 120,
        alignment: "justified",
        parindent: 15,
        tikzTextWidthNode: true,
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual([
      "Rendering anchor beta of-",
      "fice wide sample precise al-",
      "pha classic nested sample,.",
      "Kernel manual editor",
      "classic local. anchor",
      "double pattern model",
      "screen rendering chapter",
      "chapter.",
      "•office direct normal",
      "rendering epsilon fig-",
      "ure.",
      "•final rendering",
      "modern Anchor",
      "spacing vector result",
      "pattern position.",
    ]);
  });

  it("falls back when TeX noindent appears inside a paragraph", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha \noindent Beta`, {
      paragraphId: "tex:noindent-mid-paragraph",
      width: 150,
      parindent: 10,
    });

    expect(result.supported).toBe(false);
    expect(result.fallbackReason).toContain("TeX syntax");
  });

  it("falls back when TeX alignment declarations appear inside a paragraph", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha \centering Beta`, {
      paragraphId: "tex:centering-mid-paragraph",
      width: 150,
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(false);
    expect(result.fallbackReason).toContain("TeX syntax");
  });

  it("wraps plain text with TeX-shaped Computer Modern word widths", () => {
    const font = computerModernTexMetricProvider.resolveFont();
    const alphaWidth = computerModernTexMetricProvider.shapeText("Alpha", font).width;
    const betaWidth = computerModernTexMetricProvider.shapeText("Beta", font).width;
    const result = layoutSimpleTexParagraph("Alpha Beta", {
      paragraphId: "tex:wrap",
      width: Math.max(alphaWidth, betaWidth) + 0.01,
      font,
      textFontProfile: classicComputerModernTextFontProfile,
    });

    expect(result.supported).toBe(true);
    expect(result.fallbackReason).toBeNull();
    expect(result.report?.lines).toHaveLength(2);
    expect(result.report?.lines[0]?.segments.map((segment) => segment.text).join("")).toBe("Alpha");
    expect(result.report?.lines[1]?.segments.map((segment) => segment.text).join("")).toBe("Beta");
    expect(result.report?.runs.filter((run) => run.kind === "text").map((run) => run.width)).toEqual(
      expect.arrayContaining([
        expect.closeTo(alphaWidth, 6),
        expect.closeTo(betaWidth, 6),
      ])
    );
  });

  it("lays out inline math as an atomic TeX run when a math box provider is available", () => {
    const sourceText = String.raw`Alpha $x^2$ beta \(y+1\).`;
    const result = layoutSimpleTexParagraph(sourceText, {
      paragraphId: "tex:inline-math",
      width: 160,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: makeFakeInlineMathBoxProvider((content) => content === "x^2" ? 23 : 19),
    });

    expect(result.supported).toBe(true);
    expect(result.report?.runs.map((run) => run.kind)).toEqual([
      "text",
      "space",
      "math",
      "space",
      "text",
      "space",
      "math",
      "text",
    ]);
    const mathSegments = result.report?.lines.flatMap((line) => line.segments)
      .filter((segment) => segment.kind === "math") ?? [];
    expect(mathSegments).toHaveLength(2);
    expect(mathSegments[0]).toMatchObject({
      text: "x^2",
      sourceStartRaw: sourceText.indexOf("$x^2$"),
      sourceEndRaw: sourceText.indexOf("$x^2$") + "$x^2$".length,
      sourceKind: "math",
      width: 23,
      mathSvgBody: `<g data-fake-inline-math="x^2"></g>`,
    });
    expect(mathSegments[1]).toMatchObject({
      text: "y+1",
      sourceStartRaw: sourceText.indexOf(String.raw`\(y+1\)`),
      sourceEndRaw: sourceText.indexOf(String.raw`\(y+1\)`) + String.raw`\(y+1\)`.length,
      sourceKind: "math",
      width: 19,
      mathSvgBody: `<g data-fake-inline-math="y+1"></g>`,
    });
    expect(result.report?.lines[0]?.ascent).toBeGreaterThanOrEqual(7);
    expect(result.report?.lines[0]?.descent).toBeGreaterThanOrEqual(2);
  });

  it("maps editor caret positions inside TeX-derived inline math source spans", async () => {
    const sourceText = String.raw`Alpha $xyz$ beta`;
    const result = layoutSimpleTexParagraph(sourceText, {
      paragraphId: "tex:inline-math-hitmap",
      width: 160,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: makeFakeInlineMathBoxProvider(() => 30),
    });
    const report = result.report;
    expect(result.supported).toBe(true);
    expect(report).toBeTruthy();
    const mathSegment = report?.lines[0]?.segments.find((segment) => segment.kind === "math");
    expect(mathSegment).toBeTruthy();

    const outputJax = {
      tex2svg: makeFakeInlineMathTex2Svg(1),
      linebreaks: { getReports: () => report ? [report] : [] },
    };
    const containerElement = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: report?.width ?? 160, bottom: 10 }, report?.width ?? 160),
      ],
    };
    const offsetInsideMath = sourceText.indexOf("xyz") + 2;
    const point = await getKnuthPlassPointFromOffset(outputJax, {
      paragraphId: "tex:inline-math-hitmap",
      sourceText,
      containerElement,
      offset: offsetInsideMath,
    });
    expect(point.error?.message ?? null).toBeNull();
    expect(point).toMatchObject({
      ok: true,
      offset: offsetInsideMath,
      kind: "math",
    });
    expect(point.lineLocalX).toBeCloseTo(
      (mathSegment?.x ?? 0) + (2 / 3) * (mathSegment?.width ?? 0),
      6
    );

    const caret = await getKnuthPlassCaretFromPoint(outputJax, {
      paragraphId: "tex:inline-math-hitmap",
      sourceText,
      containerElement,
      clientPoint: clientPoint(px(point.clientPoint?.x ?? 0), px(point.clientPoint?.y ?? 0)),
    });
    expect(caret.error?.message ?? null).toBeNull();
    expect(caret).toMatchObject({
      ok: true,
      offset: offsetInsideMath,
      kind: "math",
    });
  });

  it("maps supported TeX-derived inline math carets without MathJax prefix measurement", async () => {
    const sourceText = String.raw`Alpha $x-y$ beta`;
    const result = layoutSimpleTexParagraph(sourceText, {
      paragraphId: "tex:inline-math-real-hitmap",
      width: 160,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });
    const report = result.report;
    expect(result.supported).toBe(true);
    expect(report).toBeTruthy();
    const mathSegments = report?.lines[0]?.segments.filter((segment) => segment.kind === "math") ?? [];
    const mathContentStart = sourceText.indexOf("x-y");
    const mathContentEnd = mathContentStart + "x-y".length;
    const mathCaretEntries = mathSegments.flatMap((segment) => segment.mathCaretEntries ?? []);
    for (let offset = mathContentStart; offset <= mathContentEnd; offset += 1) {
      expect(mathCaretEntries.some((entry) => entry.sourceOffsetRaw === offset)).toBe(true);
    }

    const outputJax = {
      tex2svg: () => {
        throw new Error("MathJax prefix measurement should not be used for TeX-derived math.");
      },
      linebreaks: { getReports: () => report ? [report] : [] },
    };
    const containerElement = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: report?.width ?? 160, bottom: 10 }, report?.width ?? 160),
      ],
    };
    const offsetBeforeMinus = sourceText.indexOf("-");
    const point = await getKnuthPlassPointFromOffset(outputJax, {
      paragraphId: "tex:inline-math-real-hitmap",
      sourceText,
      containerElement,
      offset: offsetBeforeMinus,
    });
    expect(point.error?.message ?? null).toBeNull();
    const expectedMinusEntry = mathCaretEntries.find((entry) =>
      entry.sourceOffsetRaw === offsetBeforeMinus &&
      entry.sourceStartRaw === offsetBeforeMinus
    );
    expect(expectedMinusEntry).toBeTruthy();
    expect(point).toMatchObject({
      ok: true,
      offset: offsetBeforeMinus,
      kind: "math",
      snappedToMathPrefix: false,
    });
    expect(point.lineLocalX).toBeCloseTo(expectedMinusEntry?.x ?? 0, 6);

    const caret = await getKnuthPlassCaretFromPoint(outputJax, {
      paragraphId: "tex:inline-math-real-hitmap",
      sourceText,
      containerElement,
      clientPoint: clientPoint(px(point.clientPoint?.x ?? 0), px(point.clientPoint?.y ?? 0)),
    });
    expect(caret.error?.message ?? null).toBeNull();
    expect(caret).toMatchObject({
      ok: true,
      offset: offsetBeforeMinus,
      kind: "math",
      snappedToMathPrefix: false,
    });
  });

  it("uses row-local selections and caret centers inside TeX-derived fractions", async () => {
    const sourceText = String.raw`A fraction: $\frac{1234}{98765}$`;
    const result = layoutSimpleTexParagraph(sourceText, {
      paragraphId: "tex:inline-math-fraction-row-selection",
      width: 160,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });
    const report = result.report;
    expect(result.supported).toBe(true);
    expect(report).toBeTruthy();
    const mathSegment = report?.lines[0]?.segments.find((segment) => segment.kind === "math");
    const fractionConstruct = mathSegment?.mathConstructRanges?.[0];
    const fractionCaretEntries = mathSegment?.mathCaretEntries ?? [];
    expect(fractionConstruct).toBeTruthy();
    expect(fractionCaretEntries.length).toBeGreaterThan(0);

    const outputJax = {
      tex2svg: () => {
        throw new Error("MathJax prefix measurement should not be used for TeX-derived math selections.");
      },
      linebreaks: { getReports: () => report ? [report] : [] },
    };
    const containerElement = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: report?.width ?? 160, bottom: 10 }, report?.width ?? 160),
      ],
    };

    const numeratorSelection = await getKnuthPlassSelectionRects(outputJax, {
      paragraphId: "tex:inline-math-fraction-row-selection",
      sourceText,
      containerElement,
      startOffset: sourceText.indexOf("1234"),
      endOffset: sourceText.indexOf("1234") + "1234".length,
    });
    expect(numeratorSelection.error?.message ?? null).toBeNull();
    expect(numeratorSelection.ok).toBe(true);
    expect(numeratorSelection.rects).toHaveLength(1);
    expect(Number(numeratorSelection.rects[0]?.bounds.minX)).toBeGreaterThan(fractionConstruct?.xStart ?? 0);
    expect(Number(numeratorSelection.rects[0]?.bounds.maxX)).toBeLessThan(fractionConstruct?.xEnd ?? Number.POSITIVE_INFINITY);
    expectSelectionContainsLineLocalBounds(
      numeratorSelection,
      report!.lines[0],
      renderedMathGlyphBoundsForText(mathSegment!, report!.lines[0], sourceText, "1234")
    );

    const denominatorSelection = await getKnuthPlassSelectionRects(outputJax, {
      paragraphId: "tex:inline-math-fraction-row-selection",
      sourceText,
      containerElement,
      startOffset: sourceText.indexOf("98765"),
      endOffset: sourceText.indexOf("98765") + "98765".length,
    });
    expect(denominatorSelection.error?.message ?? null).toBeNull();
    expect(denominatorSelection.ok).toBe(true);
    expect(denominatorSelection.rects).toHaveLength(1);
    expect(Number(numeratorSelection.rects[0]?.bounds.maxY)).toBeLessThan(
      Number(denominatorSelection.rects[0]?.bounds.minY)
    );
    expectSelectionContainsLineLocalBounds(
      denominatorSelection,
      report!.lines[0],
      renderedMathGlyphBoundsForText(mathSegment!, report!.lines[0], sourceText, "98765")
    );

    const crossRowSelection = await getKnuthPlassSelectionRects(outputJax, {
      paragraphId: "tex:inline-math-fraction-row-selection",
      sourceText,
      containerElement,
      startOffset: sourceText.indexOf("34"),
      endOffset: sourceText.indexOf("98") + "98".length,
    });
    expect(crossRowSelection.error?.message ?? null).toBeNull();
    expect(crossRowSelection.ok).toBe(true);
    expect(crossRowSelection.rects).toHaveLength(2);
    expectSelectionContainsLineLocalBounds(
      crossRowSelection,
      report!.lines[0],
      renderedMathGlyphBoundsForText(mathSegment!, report!.lines[0], sourceText, "34")
    );
    expectSelectionContainsLineLocalBounds(
      crossRowSelection,
      report!.lines[0],
      renderedMathGlyphBoundsForText(mathSegment!, report!.lines[0], sourceText, "98")
    );
    expect(Math.min(...crossRowSelection.rects.map((rect) => Number(rect.bounds.maxY)))).toBeLessThan(
      Math.max(...crossRowSelection.rects.map((rect) => Number(rect.bounds.minY)))
    );

    const caretOffsetBetweenTwoAndThree = sourceText.indexOf("3");
    const caretPoint = await getKnuthPlassPointFromOffset(outputJax, {
      paragraphId: "tex:inline-math-fraction-row-selection",
      sourceText,
      containerElement,
      offset: caretOffsetBetweenTwoAndThree,
    });
    const threeSelection = await getKnuthPlassSelectionRects(outputJax, {
      paragraphId: "tex:inline-math-fraction-row-selection",
      sourceText,
      containerElement,
      startOffset: caretOffsetBetweenTwoAndThree,
      endOffset: caretOffsetBetweenTwoAndThree + 1,
    });
    expect(caretPoint.error?.message ?? null).toBeNull();
    expect(threeSelection.error?.message ?? null).toBeNull();
    expect(caretPoint.clientPoint?.y).toBeCloseTo(
      (Number(threeSelection.rects[0]?.bounds.minY) + Number(threeSelection.rects[0]?.bounds.maxY)) / 2,
      6
    );
  });

  it("uses line-height selection fallback for source-only TeX math gaps", async () => {
    const sourceText = String.raw`$x^2 = y$`;
    const result = layoutSimpleTexParagraph(sourceText, {
      paragraphId: "tex:inline-math-source-gap-selection",
      width: 160,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });
    const report = result.report;
    expect(result.supported).toBe(true);
    expect(report).toBeTruthy();

    const outputJax = {
      tex2svg: () => {
        throw new Error("MathJax prefix measurement should not be used for TeX-derived math selections.");
      },
      linebreaks: { getReports: () => report ? [report] : [] },
    };
    const containerElement = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: report?.width ?? 160, bottom: 10 }, report?.width ?? 160),
      ],
    };

    const sourceSpaceAfterSuperscript = sourceText.indexOf(" =");
    const sourceGapSelection = await getKnuthPlassSelectionRects(outputJax, {
      paragraphId: "tex:inline-math-source-gap-selection",
      sourceText,
      containerElement,
      startOffset: sourceSpaceAfterSuperscript,
      endOffset: sourceSpaceAfterSuperscript + 1,
    });

    expect(sourceGapSelection.error?.message ?? null).toBeNull();
    expect(sourceGapSelection.ok).toBe(true);
    expect(sourceGapSelection.rects).toHaveLength(1);
    expect(
      Number(sourceGapSelection.rects[0].bounds.maxY) - Number(sourceGapSelection.rects[0].bounds.minY)
    ).toBeGreaterThan(4);
  });

  it("uses 2-D TeX math caret geometry for fraction hit testing", async () => {
    const sourceText = String.raw`$\frac{1}{2}$`;
    const result = layoutSimpleTexParagraph(sourceText, {
      paragraphId: "tex:inline-math-fraction-2d-hitmap",
      width: 160,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });
    const report = result.report;
    expect(result.supported).toBe(true);
    expect(report).toBeTruthy();

    const outputJax = {
      tex2svg: () => {
        throw new Error("MathJax prefix measurement should not be used for TeX-derived fraction hit testing.");
      },
      linebreaks: { getReports: () => report ? [report] : [] },
    };
    const containerElement = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: -12, right: report?.width ?? 160, bottom: 12 }, report?.width ?? 160),
      ],
    };
    const numeratorOffset = sourceText.indexOf("1");
    const denominatorOffset = sourceText.indexOf("2");
    const numeratorPoint = await getKnuthPlassPointFromOffset(outputJax, {
      paragraphId: "tex:inline-math-fraction-2d-hitmap",
      sourceText,
      containerElement,
      offset: numeratorOffset,
    });
    const denominatorPoint = await getKnuthPlassPointFromOffset(outputJax, {
      paragraphId: "tex:inline-math-fraction-2d-hitmap",
      sourceText,
      containerElement,
      offset: denominatorOffset,
    });
    expect(numeratorPoint.error?.message ?? null).toBeNull();
    expect(denominatorPoint.error?.message ?? null).toBeNull();
    expect(numeratorPoint.clientPoint?.y).toBeLessThan(denominatorPoint.clientPoint?.y ?? 0);

    const numeratorCaret = await getKnuthPlassCaretFromPoint(outputJax, {
      paragraphId: "tex:inline-math-fraction-2d-hitmap",
      sourceText,
      containerElement,
      clientPoint: clientPoint(px(numeratorPoint.clientPoint?.x ?? 0), px(numeratorPoint.clientPoint?.y ?? 0)),
    });
    const denominatorCaret = await getKnuthPlassCaretFromPoint(outputJax, {
      paragraphId: "tex:inline-math-fraction-2d-hitmap",
      sourceText,
      containerElement,
      clientPoint: clientPoint(px(denominatorPoint.clientPoint?.x ?? 0), px(denominatorPoint.clientPoint?.y ?? 0)),
    });
    expect(numeratorCaret.error?.message ?? null).toBeNull();
    expect(denominatorCaret.error?.message ?? null).toBeNull();
    expect(numeratorCaret).toMatchObject({ ok: true, offset: numeratorOffset, kind: "math" });
    expect(denominatorCaret).toMatchObject({ ok: true, offset: denominatorOffset, kind: "math" });
  });

  it("keeps hit testing coherent for inline math fragmented across line breaks", async () => {
    const sourceText = String.raw`Alpha $x+y=z+m+n$ beta`;
    const result = layoutSimpleTexParagraph(sourceText, {
      paragraphId: "tex:inline-math-fragment-hitmap",
      width: 40,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });
    const report = result.report;
    expect(result.supported).toBe(true);
    expect(report).toBeTruthy();
    expect(report?.lines.length).toBeGreaterThan(2);
    expect(report?.lines.some((line) =>
      line.segments.some((segment) =>
        segment.kind === "math" &&
        (segment.sourceStartRaw ?? 0) > sourceText.indexOf("x") &&
        (segment.sourceEndRaw ?? 0) < sourceText.indexOf("$ beta")
      )
    )).toBe(true);

    const outputJax = {
      tex2svg: () => {
        throw new Error("MathJax prefix measurement should not be used for fragmented TeX-derived math hit testing.");
      },
      linebreaks: { getReports: () => report ? [report] : [] },
    };
    const containerElement = {
      querySelectorAll: () => makeLineElementsFromVListLayout(report!, result.vlistLayout),
    };
    const sampledOffsets = [
      sourceText.indexOf("x"),
      sourceText.indexOf("y"),
      sourceText.indexOf("z"),
      sourceText.indexOf("m"),
      sourceText.indexOf("n"),
    ];
    const seenVisualCaretPoints = new Set<string>();

    for (const offset of sampledOffsets) {
      const point = await getKnuthPlassPointFromOffset(outputJax, {
        paragraphId: "tex:inline-math-fragment-hitmap",
        sourceText,
        containerElement,
        offset,
      });
      expect(point.error?.message ?? null, `${sourceText} @ ${offset}`).toBeNull();
      expect(point).toMatchObject({
        ok: true,
        offset,
        kind: "math",
        snappedToMathPrefix: false,
      });

      const caret = await getKnuthPlassCaretFromPoint(outputJax, {
        paragraphId: "tex:inline-math-fragment-hitmap",
        sourceText,
        containerElement,
        clientPoint: clientPoint(px(point.clientPoint?.x ?? 0), px(point.clientPoint?.y ?? 0)),
      });
      expect(caret.error?.message ?? null, `${sourceText} @ ${offset}`).toBeNull();
      const visualPointKey = [
        point.lineIndex,
        (point.clientPoint?.x ?? Number.NaN).toFixed(6),
        (point.clientPoint?.y ?? Number.NaN).toFixed(6),
      ].join(":");
      if (seenVisualCaretPoints.has(visualPointKey)) {
        expect(caret).toMatchObject({
          ok: true,
          lineIndex: point.lineIndex,
          kind: "math",
          snappedToMathPrefix: false,
        });
      } else {
        expect(caret).toMatchObject({
          ok: true,
          offset,
          kind: "math",
          snappedToMathPrefix: false,
        });
      }
      seenVisualCaretPoints.add(visualPointKey);
    }

    const crossFragmentSelection = await getKnuthPlassSelectionRects(outputJax, {
      paragraphId: "tex:inline-math-fragment-hitmap",
      sourceText,
      containerElement,
      startOffset: sourceText.indexOf("y"),
      endOffset: sourceText.indexOf("m") + 1,
    });
    expect(crossFragmentSelection.error?.message ?? null).toBeNull();
    expect(crossFragmentSelection.ok).toBe(true);
    expect(crossFragmentSelection.rects.length).toBeGreaterThan(1);
  });

  it("keeps inline math fragment SVG glyphs inside their source spans", () => {
    const sourceText = String.raw`Where \(p_i=\{x,y\}\) is the unordered pair of alternatives swapped when going
from \(R_{i-1}\) to \(R_i\).  We usually write \(p_i=(x,y)\), but the pair is
unordered.`;
    const result = layoutSimpleTexParagraph(sourceText, {
      paragraphId: "tex:inline-math-fragment-svg-spans",
      width: 150,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });
    const report = result.report;
    expect(result.supported).toBe(true);
    expect(report).toBeTruthy();
    expectMathSegmentGlyphsWithinSourceSpans(report!);

    const lastFormulaStart = sourceText.lastIndexOf("p_i=(x,y)");
    const firstFragment = report?.lines.flatMap((line) => line.segments).find((segment) =>
      segment.kind === "math" &&
      segment.sourceStartRaw === lastFormulaStart &&
      segment.sourceEndRaw === lastFormulaStart + "p_i=".length
    );
    const secondFragment = report?.lines.flatMap((line) => line.segments).find((segment) =>
      segment.kind === "math" &&
      segment.sourceStartRaw === lastFormulaStart + "p_i=".length &&
      segment.sourceEndRaw === lastFormulaStart + "p_i=(x,y)".length
    );
    expect(firstFragment).toBeTruthy();
    expect(secondFragment).toBeTruthy();
    expect(mathSegmentGlyphSpans(firstFragment!).map((glyph) => glyph.code)).toEqual([112, 105, 61]);
    expect(mathSegmentGlyphSpans(secondFragment!).map((glyph) => glyph.code)).toEqual([40, 120, 59, 121, 41]);
  });

  it("fuzzes editor hit maps for mixed TeX-derived text and inline math", async () => {
    const cases = Array.from({ length: 96 }, (_, index) => buildTexMathHitMapFuzzCase(index));
    for (const testCase of cases) {
      const result = layoutSimpleTexParagraph(testCase.source, {
        paragraphId: testCase.id,
        width: testCase.width,
        parindent: 0,
        hyphenator: { hyphenate: () => [] },
        mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
      });
      expect(result.supported, testCase.source).toBe(true);
      expect(result.report, testCase.source).toBeTruthy();
      expect(testCase.offsets.length, testCase.source).toBeGreaterThan(0);

      const report = result.report!;
      expectMathSegmentGlyphsWithinSourceSpans(report);
      const outputJax = {
        tex2svg: () => {
          throw new Error("MathJax prefix measurement should not be used for TeX-derived mixed hit-map fuzz.");
        },
        linebreaks: { getReports: () => [report] },
      };
      const containerElement = {
        querySelectorAll: () => makeLineElementsFromVListLayout(report, result.vlistLayout),
      };

      const sampledOffsets = testCase.offsets.slice(0, 24);
      for (const { offset, kind, label, exactRoundTrip } of sampledOffsets) {
        const point = await getKnuthPlassPointFromOffset(outputJax, {
          paragraphId: testCase.id,
          sourceText: testCase.source,
          containerElement,
          offset,
        });
        expect(point.error?.message ?? null, `${testCase.id}: ${testCase.source} @ ${offset} (${label ?? "offset"})`).toBeNull();
        expect(point, `${testCase.id}: ${testCase.source} @ ${offset} (${label ?? "offset"})`).toMatchObject({
          ok: true,
          offset,
          kind,
        });

        const caret = await getKnuthPlassCaretFromPoint(outputJax, {
          paragraphId: testCase.id,
          sourceText: testCase.source,
          containerElement,
          clientPoint: clientPoint(px(point.clientPoint?.x ?? 0), px(point.clientPoint?.y ?? 0)),
        });
        expect(caret.error?.message ?? null, `${testCase.id}: ${testCase.source} @ ${offset} (${label ?? "offset"})`).toBeNull();
        expect(caret, `${testCase.id}: ${testCase.source} @ ${offset} (${label ?? "offset"})`).toMatchObject({
          ok: true,
        });
        if (exactRoundTrip) {
          expect(caret, `${testCase.id}: ${testCase.source} @ ${offset} (${label ?? "offset"})`).toMatchObject({
            offset,
            kind,
          });
        }
      }

      const rangeStart = testCase.offsets[0]?.offset ?? 0;
      const rangeEnd = testCase.offsets.at(-1)?.offset ?? 0;
      if (rangeEnd > rangeStart) {
        const selection = await getKnuthPlassSelectionRects(outputJax, {
          paragraphId: testCase.id,
          sourceText: testCase.source,
          containerElement,
          startOffset: rangeStart,
          endOffset: rangeEnd,
        });
        expect(selection.error?.message ?? null, `${testCase.id}: ${testCase.source}`).toBeNull();
        expect(selection.ok, `${testCase.id}: ${testCase.source}`).toBe(true);
        expect(selection.rects.length, `${testCase.id}: ${testCase.source}`).toBeGreaterThan(0);
      }
    }
  });

  it("reports whole-node fallback for inline math without a math box provider", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha $x$`, {
      paragraphId: "tex:fallback",
      width: 100,
    });

    expect(result.supported).toBe(false);
    expect(result.report).toBeNull();
    expect(result.fallbackReason).toContain("inline math");
    expect(result.errors).toEqual([result.fallbackReason]);
  });

  it("contains formulas the math box provider cannot measure as literal runs", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha $x$`, {
      paragraphId: "tex:math-provider-fallback",
      width: 100,
      mathBoxProvider: { getInlineMathBox: () => null },
    });

    expect(result.supported).toBe(true);
    expect(result.fallbackReason).toBeNull();
    const segments = result.report?.lines.flatMap((line) => line.segments) ?? [];
    const literalSegments = segments.filter((segment) => segment.literal);
    expect(literalSegments.map((segment) => segment.text).join("")).toBe("$x$");
    expect(literalSegments.every((segment) => segment.literal?.reason === "math-error")).toBe(true);
  });

  it("keeps current editor hit testing usable for TeX paragraph reports", async () => {
    const sourceText = "office AV To";
    const font = computerModernTexMetricProvider.resolveFont();
    const officeWidth = computerModernTexMetricProvider.shapeText("office", font).width;
    const avWidth = computerModernTexMetricProvider.shapeText("AV", font).width;
    const spaceWidth = font.data.fontdimen.space * font.atPt;
    const result = layoutSimpleTexParagraph(sourceText, {
      paragraphId: "tex:hitmap",
      width: officeWidth + spaceWidth + avWidth + 0.01,
      font,
      textFontProfile: classicComputerModernTextFontProfile,
    });
    const report = result.report;
    expect(report).not.toBeNull();
    expect(report?.lines).toHaveLength(2);

    const outputJax = { linebreaks: { getReports: () => [report as ParagraphLayoutReport] } };
    const containerElement = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: report?.width ?? 0, bottom: 10 }, report?.width ?? 1),
        makeLineElement({ left: 0, top: 12, right: report?.width ?? 0, bottom: 22 }, report?.width ?? 1),
      ],
    };
    const point = await getKnuthPlassPointFromOffset(outputJax, {
      paragraphId: "tex:hitmap",
      sourceText,
      containerElement,
      offset: 3,
    });
    const secondLinePoint = await getKnuthPlassPointFromOffset(outputJax, {
      paragraphId: "tex:hitmap",
      sourceText,
      containerElement,
      offset: sourceText.length,
    });

    expect(point).toMatchObject({ ok: true, offset: 3, kind: "text", lineIndex: 0 });
    expect(point.lineLocalX).toBeCloseTo(
      computerModernTexMetricProvider.shapeText("office", font).caretStops[3],
      6
    );
    expect(secondLinePoint).toMatchObject({ ok: true, offset: sourceText.length, kind: "text", lineIndex: 1 });
  });

  it("uses registered vlist geometry for nested quote/list text editing", async () => {
    const sourceText = String.raw`\begin{quote}\begin{itemize}\item Alpha\end{itemize}\end{quote}`;
    const hitmapSourceText = "Alpha";
    const result = layoutSimpleTexParagraph(sourceText, {
      paragraphId: "tex:nested-vlist-hitmap",
      width: 160,
      alignment: "ragged-right",
      hyphenator: { hyphenate: () => [] },
    });
    const report = result.report;
    const vlistLayout = result.vlistLayout;
    expect(report).not.toBeNull();
    expect(vlistLayout).not.toBeNull();
    expect(vlistLayout?.paragraphPlacements[0]).toMatchObject({
      blockIndex: 0,
      x: 47,
      y: 13,
      vlistPath: [0, 0, 0, 2],
    });
    expect(vlistLayout?.linePlacements[0]).toMatchObject({
      lineIndex: 0,
      x: 47,
      y: 13,
    });
    expect(report?.lines[0]).toMatchObject({
      lineIndex: 0,
      xStart: 47,
    });

    const outputJax = { linebreaks: { getReports: () => [report as ParagraphLayoutReport] } };
    registerTexVListLayoutsOnOutputJax(outputJax, [{
      paragraphId: "tex:nested-vlist-hitmap",
      layout: vlistLayout!,
    }]);
    const containerElement = {
      getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      viewBox: { baseVal: { width: report?.width ?? 1 } },
      querySelectorAll: () => {
        throw new Error("registered nested vlist geometry should avoid rendered linebox queries");
      },
    };
    const alphaOffset = 2;
    const point = await getKnuthPlassPointFromOffset(outputJax, {
      paragraphId: "tex:nested-vlist-hitmap",
      sourceText: hitmapSourceText,
      containerElement,
      offset: alphaOffset,
    });
    expect(point).toMatchObject({
      ok: true,
      offset: alphaOffset,
      lineIndex: 0,
      kind: "text",
    });
    expect(point.lineLocalX).toBeGreaterThan(47);
    expect(point.clientPoint?.x).toBeCloseTo(point.lineLocalX ?? 0, 6);
    const linePlacement = vlistLayout?.linePlacements.find((placement) => placement.lineIndex === 0);
    expect(linePlacement).toBeDefined();
    expect(point.clientPoint?.y).toBeCloseTo(
      (linePlacement?.y ?? 0) + (linePlacement?.height ?? 0) / 2,
      6
    );

    const caret = await getKnuthPlassCaretFromPoint(outputJax, {
      paragraphId: "tex:nested-vlist-hitmap",
      sourceText: hitmapSourceText,
      containerElement,
      clientPoint: clientPoint(px(point.clientPoint?.x ?? 0), px(point.clientPoint?.y ?? 0)),
    });
    expect(caret).toMatchObject({
      ok: true,
      lineIndex: 0,
      offset: alphaOffset,
      kind: "text",
    });
  });

  it("exposes display alignment rows in registered vlist hit geometry", () => {
    const sourceText = String.raw`\begin{quote}Intro \begin{align*}x&=y\\a&=b\end{align*} Outro\end{quote}`;
    const result = layoutSimpleTexParagraph(sourceText, {
      paragraphId: "tex:display-align-row-hitmap",
      width: 180,
      alignment: "ragged-right",
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });
    const report = result.report;
    const vlistLayout = result.vlistLayout;
    expect(report).not.toBeNull();
    expect(vlistLayout).not.toBeNull();

    const outputJax = { linebreaks: { getReports: () => [report as ParagraphLayoutReport] } };
    registerTexVListLayoutsOnOutputJax(outputJax, [{
      paragraphId: "tex:display-align-row-hitmap",
      layout: vlistLayout!,
    }]);
    const containerElement = {
      getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      viewBox: { baseVal: { width: report?.width ?? 1 } },
      querySelectorAll: () => {
        throw new Error("registered display alignment row hit-testing should avoid rendered linebox queries");
      },
    };

    const alignRows = getKnuthPlassVListItemGeometry({
      outputJax,
      paragraphId: "tex:display-align-row-hitmap",
      containerElement: containerElement as any,
    }).filter((item) => item.hboxRole === "display-align-row");

    expect(alignRows.map((row) => ({
      role: row.hboxRole,
      delimiter: row.displayAlignDelimiter,
      rowIndex: row.displayAlignRowIndex,
      source: sourceText.slice(row.sourceStart ?? 0, row.sourceEnd ?? 0),
    }))).toEqual([
      {
        role: "display-align-row",
        delimiter: "align-star",
        rowIndex: 0,
        source: String.raw`x&=y\\`,
      },
      {
        role: "display-align-row",
        delimiter: "align-star",
        rowIndex: 1,
        source: "a&=b",
      },
    ]);

    const secondRow = alignRows[1];
    expect(secondRow).toBeDefined();
    const hit = getKnuthPlassVListItemFromPoint({
      outputJax,
      paragraphId: "tex:display-align-row-hitmap",
      containerElement: containerElement,
      clientPoint: clientPoint(
        px(((secondRow?.clientLeft ?? 0) + (secondRow?.clientRight ?? 0)) / 2),
        px(((secondRow?.clientTop ?? 0) + (secondRow?.clientBottom ?? 0)) / 2)
      ),
    });
    expect(hit).toMatchObject({
      kind: "hbox",
      hboxRole: "display-align-row",
      displayAlignDelimiter: "align-star",
      displayAlignRowIndex: 1,
      sourceStart: sourceText.indexOf("a&=b"),
      sourceEnd: sourceText.indexOf("a&=b") + "a&=b".length,
    });

    const snapshot = getKnuthPlassVListGeometrySnapshot({
      outputJax,
      paragraphId: "tex:display-align-row-hitmap",
      containerElement: containerElement,
    });
    const sourceHit = getKnuthPlassVListSourceHitFromSnapshot({
      snapshot,
      clientPoint: clientPoint(
        px(((secondRow?.clientLeft ?? 0) + (secondRow?.clientRight ?? 0)) / 2),
        px(((secondRow?.clientTop ?? 0) + (secondRow?.clientBottom ?? 0)) / 2)
      ),
    });
    expect(sourceHit).toEqual({
      offset: sourceText.indexOf("a&=b"),
      selectionRange: {
        start: sourceText.indexOf("a&=b"),
        end: sourceText.indexOf("a&=b") + "a&=b".length,
      },
    });
  });

  it("maps editor carets inside display math boxes from registered vlist geometry", async () => {
    const sourceText = String.raw`Intro \[x^2=y\] Outro`;
    const result = layoutSimpleTexParagraph(sourceText, {
      paragraphId: "tex:display-math-caret",
      width: 180,
      alignment: "ragged-right",
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });
    expect(result.supported, sourceText).toBe(true);
    expect(result.report, sourceText).not.toBeNull();
    expect(result.vlistLayout, sourceText).not.toBeNull();

    const outputJax = { linebreaks: { getReports: () => [result.report as ParagraphLayoutReport] } };
    registerTexVListLayoutsOnOutputJax(outputJax, [{
      paragraphId: "tex:display-math-caret",
      layout: result.vlistLayout!,
    }]);
    const containerElement = {
      getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      viewBox: { baseVal: { width: result.report?.width ?? 1 } },
      querySelectorAll: () => {
        throw new Error("display math caret mapping should use registered vlist geometry");
      },
    };
    const snapshot = getKnuthPlassVListGeometrySnapshot({
      outputJax,
      paragraphId: "tex:display-math-caret",
      containerElement: containerElement,
    });
    const displayItem = snapshot.items.find((item) => item.kind === "display-math");
    expect(displayItem).toBeTruthy();
    const displaySourceHit = getKnuthPlassVListSourceHitFromSnapshot({
      snapshot,
      clientPoint: clientPoint(
        px(((displayItem?.clientLeft ?? 0) + (displayItem?.clientRight ?? 0)) / 2),
        px(((displayItem?.clientTop ?? 0) + (displayItem?.clientBottom ?? 0)) / 2)
      ),
    });
    expect(displaySourceHit).toEqual({
      offset: sourceText.indexOf(String.raw`\[`),
      selectionRange: {
        start: sourceText.indexOf(String.raw`\[`),
        end: sourceText.indexOf(String.raw`\]`) + String.raw`\]`.length,
      },
    });

    const offset = sourceText.indexOf("^");
    const point = await getKnuthPlassPointFromOffset(outputJax, {
      paragraphId: "tex:display-math-caret",
      sourceText,
      containerElement,
      offset,
    });
    expect(point.error?.message ?? null).toBeNull();
    expect(point).toMatchObject({
      ok: true,
      offset,
      kind: "math",
      snappedToMathPrefix: false,
    });

    const caret = await getKnuthPlassCaretFromPoint(outputJax, {
      paragraphId: "tex:display-math-caret",
      sourceText,
      containerElement,
      clientPoint: clientPoint(px(point.clientPoint?.x ?? 0), px(point.clientPoint?.y ?? 0)),
    });
    expect(caret.error?.message ?? null).toBeNull();
    expect(caret).toMatchObject({
      ok: true,
      offset,
      kind: "math",
      snappedToMathPrefix: false,
    });

    const selection = await getKnuthPlassSelectionRects(outputJax, {
      paragraphId: "tex:display-math-caret",
      sourceText,
      containerElement,
      startOffset: sourceText.indexOf("x"),
      endOffset: sourceText.indexOf("y") + 1,
    });
    expect(selection.error?.message ?? null).toBeNull();
    expect(selection.ok).toBe(true);
    expect(selection.rects.some((rect) => rect.lineIndex === point.lineIndex)).toBe(true);
  });

  it("round-trips editor carets inside non-linear display math boxes", async () => {
    const formulas = texMathHitMapFuzzFormulas();
    for (const [formulaIndex, formula] of formulas.entries()) {
      const sourceText = String.raw`Intro \[` + formula.source + String.raw`\] Outro`;
      const result = layoutSimpleTexParagraph(sourceText, {
        paragraphId: `tex:display-math-construct-caret-${formulaIndex}`,
        width: 180,
        alignment: "ragged-right",
        hyphenator: { hyphenate: () => [] },
        mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
      });
      expect(result.supported, sourceText).toBe(true);
      expect(result.report, sourceText).not.toBeNull();
      expect(result.vlistLayout, sourceText).not.toBeNull();

      const outputJax = { linebreaks: { getReports: () => [result.report as ParagraphLayoutReport] } };
      registerTexVListLayoutsOnOutputJax(outputJax, [{
        paragraphId: `tex:display-math-construct-caret-${formulaIndex}`,
        layout: result.vlistLayout!,
      }]);
      const containerElement = {
        getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        viewBox: { baseVal: { width: result.report?.width ?? 1 } },
        querySelectorAll: () => {
          throw new Error("display math construct caret mapping should use registered vlist geometry");
        },
      };
      const contentStart = sourceText.indexOf(formula.source);

      for (const tracked of formula.trackedOffsets) {
        const offset = contentStart + tracked.offset;
        const point = await getKnuthPlassPointFromOffset(outputJax, {
          paragraphId: `tex:display-math-construct-caret-${formulaIndex}`,
          sourceText,
          containerElement,
          offset,
        });
        expect(point.error?.message ?? null, `${sourceText} @ ${offset} (${tracked.label})`).toBeNull();
        expect(point, `${sourceText} @ ${offset} (${tracked.label})`).toMatchObject({
          ok: true,
          offset,
          kind: "math",
          snappedToMathPrefix: false,
        });

        const caret = await getKnuthPlassCaretFromPoint(outputJax, {
          paragraphId: `tex:display-math-construct-caret-${formulaIndex}`,
          sourceText,
          containerElement,
          clientPoint: clientPoint(px(point.clientPoint?.x ?? 0), px(point.clientPoint?.y ?? 0)),
        });
        expect(caret.error?.message ?? null, `${sourceText} @ ${offset} (${tracked.label})`).toBeNull();
        expect(caret, `${sourceText} @ ${offset} (${tracked.label})`).toMatchObject({
          ok: true,
          kind: "math",
          snappedToMathPrefix: false,
        });
      }

      const selectionStart = contentStart + (formula.trackedOffsets[0]?.offset ?? 0);
      const selectionEnd = contentStart + (formula.trackedOffsets.at(-1)?.offset ?? 0) + 1;
      if (selectionEnd > selectionStart) {
        const selection = await getKnuthPlassSelectionRects(outputJax, {
          paragraphId: `tex:display-math-construct-caret-${formulaIndex}`,
          sourceText,
          containerElement,
          startOffset: selectionStart,
          endOffset: selectionEnd,
        });
        expect(selection.error?.message ?? null, sourceText).toBeNull();
        expect(selection.ok, sourceText).toBe(true);
        expect(selection.rects.length, sourceText).toBeGreaterThan(0);
      }
    }
  });

  it("maps editor carets inside numbered display alignment rows from registered vlist geometry", async () => {
    const sourceText = String.raw`Intro \begin{align}x&=y\\a&=b\notag\\c&=d\tag{A}\end{align} Outro`;
    const result = layoutSimpleTexParagraph(sourceText, {
      paragraphId: "tex:numbered-display-align-caret",
      width: 180,
      alignment: "ragged-right",
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });
    expect(result.supported, sourceText).toBe(true);
    expect(result.report, sourceText).not.toBeNull();
    expect(result.vlistLayout, sourceText).not.toBeNull();

    const outputJax = { linebreaks: { getReports: () => [result.report as ParagraphLayoutReport] } };
    registerTexVListLayoutsOnOutputJax(outputJax, [{
      paragraphId: "tex:numbered-display-align-caret",
      layout: result.vlistLayout!,
    }]);
    const containerElement = {
      getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      viewBox: { baseVal: { width: result.report?.width ?? 1 } },
      querySelectorAll: () => {
        throw new Error("display alignment caret mapping should use registered vlist geometry");
      },
    };

    const alignRows = getKnuthPlassVListItemGeometry({
      outputJax,
      paragraphId: "tex:numbered-display-align-caret",
      containerElement: containerElement as any,
    }).filter((item) => item.hboxRole === "display-align-row");
    expect(alignRows.map((row) => ({
      delimiter: row.displayAlignDelimiter,
      rowIndex: row.displayAlignRowIndex,
      source: sourceText.slice(row.sourceStart ?? 0, row.sourceEnd ?? 0),
    }))).toEqual([
      {
        delimiter: "align",
        rowIndex: 0,
        source: String.raw`x&=y\\`,
      },
      {
        delimiter: "align",
        rowIndex: 1,
        source: String.raw`a&=b\notag\\`,
      },
      {
        delimiter: "align",
        rowIndex: 2,
        source: String.raw`c&=d\tag{A}`,
      },
    ]);

    const offset = sourceText.indexOf("&=b");
    const point = await getKnuthPlassPointFromOffset(outputJax, {
      paragraphId: "tex:numbered-display-align-caret",
      sourceText,
      containerElement,
      offset,
    });
    expect(point.error?.message ?? null).toBeNull();
    expect(point).toMatchObject({
      ok: true,
      offset,
      kind: "math",
      snappedToMathPrefix: false,
    });

    const caret = await getKnuthPlassCaretFromPoint(outputJax, {
      paragraphId: "tex:numbered-display-align-caret",
      sourceText,
      containerElement,
      clientPoint: clientPoint(px(point.clientPoint?.x ?? 0), px(point.clientPoint?.y ?? 0)),
    });
    expect(caret.error?.message ?? null).toBeNull();
    expect(caret).toMatchObject({
      ok: true,
      offset,
      kind: "math",
      snappedToMathPrefix: false,
    });
  });

  it("maps editor carets inside shoved multline rows from registered vlist geometry", async () => {
    const sourceText = String.raw`Intro \begin{multline*}a+b\\\shoveleft c+d\\\shoveright e+f\end{multline*} Outro`;
    const result = layoutSimpleTexParagraph(sourceText, {
      paragraphId: "tex:display-multline-shove-caret",
      width: 180,
      alignment: "ragged-right",
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });
    expect(result.supported, sourceText).toBe(true);
    expect(result.report, sourceText).not.toBeNull();
    expect(result.vlistLayout, sourceText).not.toBeNull();

    const outputJax = { linebreaks: { getReports: () => [result.report as ParagraphLayoutReport] } };
    registerTexVListLayoutsOnOutputJax(outputJax, [{
      paragraphId: "tex:display-multline-shove-caret",
      layout: result.vlistLayout!,
    }]);
    const containerElement = {
      getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      viewBox: { baseVal: { width: result.report?.width ?? 1 } },
      querySelectorAll: () => {
        throw new Error("shoved multline caret mapping should use registered vlist geometry");
      },
    };

    const rows = getKnuthPlassVListItemGeometry({
      outputJax,
      paragraphId: "tex:display-multline-shove-caret",
      containerElement: containerElement as any,
    }).filter((item) => item.hboxRole === "display-align-row");
    expect(rows.map((row) => sourceText.slice(row.sourceStart ?? 0, row.sourceEnd ?? 0))).toEqual([
      String.raw`a+b\\`,
      String.raw`\shoveleft c+d\\`,
      String.raw`\shoveright e+f`,
    ]);

    const leftOffset = sourceText.indexOf("c+d");
    const rightOffset = sourceText.indexOf("e+f");
    const [leftPoint, rightPoint] = await Promise.all([leftOffset, rightOffset].map((offset) =>
      getKnuthPlassPointFromOffset(outputJax, {
        paragraphId: "tex:display-multline-shove-caret",
        sourceText,
        containerElement,
        offset,
      })
    ));
    expect(leftPoint.error?.message ?? null).toBeNull();
    expect(rightPoint.error?.message ?? null).toBeNull();
    expect(leftPoint).toMatchObject({
      ok: true,
      offset: leftOffset,
      kind: "math",
      snappedToMathPrefix: false,
    });
    expect(rightPoint).toMatchObject({
      ok: true,
      offset: rightOffset,
      kind: "math",
      snappedToMathPrefix: false,
    });
    expect(rightPoint.lineIndex).not.toBe(leftPoint.lineIndex);
    expect(rightPoint.lineLocalX ?? 0).toBeGreaterThan((leftPoint.lineLocalX ?? 0) + 80);

    const caret = await getKnuthPlassCaretFromPoint(outputJax, {
      paragraphId: "tex:display-multline-shove-caret",
      sourceText,
      containerElement,
      clientPoint: clientPoint(px(rightPoint.clientPoint?.x ?? 0), px(rightPoint.clientPoint?.y ?? 0)),
    });
    expect(caret.error?.message ?? null).toBeNull();
    expect(caret).toMatchObject({
      ok: true,
      offset: rightOffset,
      kind: "math",
      snappedToMathPrefix: false,
    });

    const selection = await getKnuthPlassSelectionRects(outputJax, {
      paragraphId: "tex:display-multline-shove-caret",
      sourceText,
      containerElement,
      startOffset: leftOffset,
      endOffset: rightOffset + 1,
    });
    expect(selection.error?.message ?? null).toBeNull();
    expect(selection.ok).toBe(true);
    expect(selection.rects.length).toBeGreaterThanOrEqual(2);
  });

  it("fuzzes registered hit geometry for display alignment rows in mixed vlists", async () => {
    const cases = Array.from({ length: 64 }, (_, index) => buildTexDisplayAlignHitMapFuzzCase(index));
    for (const testCase of cases) {
      const result = layoutSimpleTexParagraph(testCase.source, {
        paragraphId: testCase.id,
        width: testCase.width,
        alignment: "ragged-right",
        hyphenator: { hyphenate: () => [] },
        mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
      });
      expect(result.supported, testCase.source).toBe(true);
      expect(result.report, testCase.source).not.toBeNull();
      expect(result.vlistLayout, testCase.source).not.toBeNull();

      const outputJax = { linebreaks: { getReports: () => [result.report as ParagraphLayoutReport] } };
      registerTexVListLayoutsOnOutputJax(outputJax, [{
        paragraphId: testCase.id,
        layout: result.vlistLayout!,
      }]);
      const containerElement = {
        getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        viewBox: { baseVal: { width: result.report?.width ?? 1 } },
        querySelectorAll: () => {
          throw new Error("registered display alignment row fuzz should avoid rendered linebox queries");
        },
      };

      const snapshot = getKnuthPlassVListGeometrySnapshot({
        outputJax,
        paragraphId: testCase.id,
        containerElement: containerElement,
      });
      const alignRows = snapshot.items.filter((item) => item.hboxRole === "display-align-row");
      expect(alignRows.length, testCase.source).toBe(testCase.rows.length);

      for (const [rowIndex, row] of alignRows.entries()) {
        const expectedSource = testCase.rows[rowIndex] + (rowIndex === testCase.rows.length - 1 ? "" : String.raw`\\`);
        expect(row, testCase.source).toMatchObject({
          kind: "hbox",
          hboxRole: "display-align-row",
          displayAlignDelimiter: testCase.delimiter,
          displayAlignRowIndex: rowIndex,
        });
        expect(
          testCase.source.slice(row.sourceStart ?? 0, row.sourceEnd ?? 0),
          `${testCase.id} row ${rowIndex}: ${testCase.source}`
        ).toBe(expectedSource);

        const hit = getKnuthPlassVListItemFromPoint({
          outputJax,
          paragraphId: testCase.id,
          containerElement: containerElement,
          clientPoint: clientPoint(
            px((row.clientLeft + row.clientRight) / 2),
            px((row.clientTop + row.clientBottom) / 2)
          ),
        });
        expect(hit, `${testCase.id} row ${rowIndex}: ${testCase.source}`).toMatchObject({
          kind: "hbox",
          hboxRole: "display-align-row",
          displayAlignDelimiter: testCase.delimiter,
          displayAlignRowIndex: rowIndex,
          sourceStart: row.sourceStart,
          sourceEnd: row.sourceEnd,
        });
        const sourceHit = getKnuthPlassVListSourceHitFromSnapshot({
          snapshot,
          clientPoint: clientPoint(
            px((row.clientLeft + row.clientRight) / 2),
            px((row.clientTop + row.clientBottom) / 2)
          ),
        });
        expect(sourceHit, `${testCase.id} row ${rowIndex}: ${testCase.source}`).toEqual({
          offset: row.sourceStart,
          selectionRange: {
            start: row.sourceStart,
            end: row.sourceEnd,
          },
        });
      }

      expect(testCase.offsets.length, testCase.source).toBeGreaterThan(0);
      for (const { offset, label } of testCase.offsets.slice(0, 10)) {
        const point = await getKnuthPlassPointFromOffset(outputJax, {
          paragraphId: testCase.id,
          sourceText: testCase.source,
          containerElement,
          offset,
        });
        expect(point.error?.message ?? null, `${testCase.id}: ${testCase.source} @ ${offset} (${label ?? "offset"})`).toBeNull();
        expect(point, `${testCase.id}: ${testCase.source} @ ${offset} (${label ?? "offset"})`).toMatchObject({
          ok: true,
          offset,
          kind: "math",
          snappedToMathPrefix: false,
        });

        const caret = await getKnuthPlassCaretFromPoint(outputJax, {
          paragraphId: testCase.id,
          sourceText: testCase.source,
          containerElement,
          clientPoint: clientPoint(px(point.clientPoint?.x ?? 0), px(point.clientPoint?.y ?? 0)),
        });
        expect(caret.error?.message ?? null, `${testCase.id}: ${testCase.source} @ ${offset} (${label ?? "offset"})`).toBeNull();
        expect(caret, `${testCase.id}: ${testCase.source} @ ${offset} (${label ?? "offset"})`).toMatchObject({
          ok: true,
          kind: "math",
          snappedToMathPrefix: false,
        });
      }

      const selectionStart = testCase.offsets[0]?.offset ?? 0;
      const selectionEnd = (testCase.offsets.at(-1)?.offset ?? selectionStart) + 1;
      if (selectionEnd > selectionStart) {
        const selection = await getKnuthPlassSelectionRects(outputJax, {
          paragraphId: testCase.id,
          sourceText: testCase.source,
          containerElement,
          startOffset: selectionStart,
          endOffset: selectionEnd,
        });
        expect(selection.error?.message ?? null, `${testCase.id}: ${testCase.source}`).toBeNull();
        expect(selection.ok, `${testCase.id}: ${testCase.source}`).toBe(true);
        expect(selection.rects.length, `${testCase.id}: ${testCase.source}`).toBeGreaterThan(0);
      }
    }
  });

  it("fuzzes registered document-level hit geometry for mixed inline and display math", async () => {
    const cases = Array.from({ length: 64 }, (_, index) => buildTexDocumentMathHitMapFuzzCase(index));
    for (const testCase of cases) {
      const result = layoutSimpleTexParagraph(testCase.source, {
        paragraphId: testCase.id,
        width: testCase.width,
        alignment: "ragged-right",
        rightskipStretch: testCase.width,
        spaceGlueProfile: "font",
        tikzTextWidthNode: true,
        parindent: 0,
        hyphenator: { hyphenate: () => [] },
        mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
      });
      expect(result.supported, testCase.source).toBe(true);
      expect(result.report, testCase.source).not.toBeNull();
      expect(result.vlistLayout, testCase.source).not.toBeNull();
      expect(testCase.offsets.length, testCase.source).toBeGreaterThan(0);

      const outputJax = { linebreaks: { getReports: () => [result.report as ParagraphLayoutReport] } };
      registerTexVListLayoutsOnOutputJax(outputJax, [{
        paragraphId: testCase.id,
        layout: result.vlistLayout!,
      }]);
      const containerElement = {
        getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        viewBox: { baseVal: { width: result.report?.width ?? 1 } },
        querySelectorAll: () => {
          throw new Error("registered document-level math hit-map fuzz should avoid rendered linebox queries");
        },
      };

      const snapshot = getKnuthPlassVListGeometrySnapshot({
        outputJax,
        paragraphId: testCase.id,
        containerElement: containerElement,
      });
      expect(snapshot.source, testCase.source).toBe("registered");
      expect(snapshot.paragraphs.length, testCase.source).toBeGreaterThan(0);

      const displayItems = snapshot.items.filter((item) => item.kind === "display-math");
      expect(displayItems.length, testCase.source).toBeGreaterThan(0);
      for (const displayItem of displayItems) {
        const displayHit = getKnuthPlassVListSourceHitFromSnapshot({
          snapshot,
          clientPoint: clientPoint(
            px((displayItem.clientLeft + displayItem.clientRight) / 2),
            px((displayItem.clientTop + displayItem.clientBottom) / 2)
          ),
        });
        expect(displayHit, `${testCase.id}: ${testCase.source}`).toEqual({
          offset: displayItem.sourceStart,
          selectionRange: {
            start: displayItem.sourceStart,
            end: displayItem.sourceEnd,
          },
        });
      }

      for (const { offset, kind, label, exactRoundTrip } of testCase.offsets.slice(0, 18)) {
        const point = await getKnuthPlassPointFromOffset(outputJax, {
          paragraphId: testCase.id,
          sourceText: testCase.source,
          containerElement,
          offset,
        });
        expect(point.error?.message ?? null, `${testCase.id}: ${testCase.source} @ ${offset} (${label ?? "offset"})`).toBeNull();
        expect(point, `${testCase.id}: ${testCase.source} @ ${offset} (${label ?? "offset"})`).toMatchObject({
          ok: true,
          offset,
          kind: "math",
          snappedToMathPrefix: false,
        });

        const caret = await getKnuthPlassCaretFromPoint(outputJax, {
          paragraphId: testCase.id,
          sourceText: testCase.source,
          containerElement,
          clientPoint: clientPoint(px(point.clientPoint?.x ?? 0), px(point.clientPoint?.y ?? 0)),
        });
        expect(caret.error?.message ?? null, `${testCase.id}: ${testCase.source} @ ${offset} (${label ?? "offset"})`).toBeNull();
        expect(caret, `${testCase.id}: ${testCase.source} @ ${offset} (${label ?? "offset"})`).toMatchObject({
          ok: true,
        });
        if (exactRoundTrip) {
          expect(caret, `${testCase.id}: ${testCase.source} @ ${offset} (${label ?? "offset"})`).toMatchObject({
            offset,
            kind,
            snappedToMathPrefix: false,
          });
        }
      }

      const firstOffset = testCase.offsets[0]?.offset ?? 0;
      const lastOffset = testCase.offsets.at(-1)?.offset ?? firstOffset;
      if (lastOffset > firstOffset) {
        const selection = await getKnuthPlassSelectionRects(outputJax, {
          paragraphId: testCase.id,
          sourceText: testCase.source,
          containerElement,
          startOffset: firstOffset,
          endOffset: lastOffset,
        });
        expect(selection.error?.message ?? null, `${testCase.id}: ${testCase.source}`).toBeNull();
        expect(selection.ok, `${testCase.id}: ${testCase.source}`).toBe(true);
        expect(selection.rects.length, `${testCase.id}: ${testCase.source}`).toBeGreaterThan(1);
      }

      const alignRows = snapshot.items.filter((item) => item.hboxRole === "display-align-row");
      expect(alignRows.length, testCase.source).toBe(testCase.rows.length);
      for (const [rowIndex, row] of alignRows.entries()) {
        const expectedSource = testCase.rows[rowIndex] + (rowIndex === testCase.rows.length - 1 ? "" : String.raw`\\`);
        expect(
          testCase.source.slice(row.sourceStart ?? 0, row.sourceEnd ?? 0),
          `${testCase.id} row ${rowIndex}: ${testCase.source}`
        ).toBe(expectedSource);
        const hit = getKnuthPlassVListItemFromPoint({
          outputJax,
          paragraphId: testCase.id,
          containerElement: containerElement,
          clientPoint: clientPoint(
            px((row.clientLeft + row.clientRight) / 2),
            px((row.clientTop + row.clientBottom) / 2)
          ),
        });
        expect(hit, `${testCase.id} row ${rowIndex}: ${testCase.source}`).toMatchObject({
          kind: "hbox",
          hboxRole: "display-align-row",
          displayAlignDelimiter: testCase.delimiter,
          displayAlignRowIndex: rowIndex,
          sourceStart: row.sourceStart,
          sourceEnd: row.sourceEnd,
        });
        const sourceHit = getKnuthPlassVListSourceHitFromSnapshot({
          snapshot,
          clientPoint: clientPoint(
            px((row.clientLeft + row.clientRight) / 2),
            px((row.clientTop + row.clientBottom) / 2)
          ),
        });
        expect(sourceHit, `${testCase.id} row ${rowIndex}: ${testCase.source}`).toEqual({
          offset: row.sourceStart,
          selectionRange: {
            start: row.sourceStart,
            end: row.sourceEnd,
          },
        });
      }
    }
  });
});

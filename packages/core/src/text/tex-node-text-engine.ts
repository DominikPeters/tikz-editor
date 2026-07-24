import {
  registerParagraphLayoutReports,
  type ParagraphLayoutReport,
} from "./knuth-plass/index.js";
import { preloadEnglishHyphenator } from "./knuth-plass/paragraph/hyphenate.js";
import {
  computerModernTexMetricProvider,
  createTexDerivedInlineMathBoxProvider,
  getSimpleTexFallbackReason,
  layoutSimpleTexParagraph,
  luaLatexDefaultTextFontProfile,
  renderTexParagraphSvgBody,
  renderTexVListSvgMetadata,
} from "./tex/index.js";
import type {
  ResolvedTexFont,
  SimpleTexFontState,
  TexMathFontProfile,
  TexTextFontProfile,
} from "./tex/index.js";
import {
  texLength,
  texLineX,
  type TexLength,
  type TexVListY,
} from "./tex/coordinates.js";
import { registerTexVListLayouts } from "./tex/vlist/index.js";
import { collectTexGraphicsPlacements } from "./tex/vlist/graphics-placements.js";
import {
  remapParagraphLayoutReportSourceMap,
  remapTexVListLayoutSourceMap,
} from "./tex/source-map-report.js";
import type { TexVListLayout } from "./tex/vlist/index.js";
import type { DocumentGraphicsResolver } from "../graphics/types.js";
import type {
  NodeTextColorResolver,
  NodeTextEngine,
  NodeTextMeasureRequest,
  NodeTextParagraphAlignment,
  NodeTextRenderPayload,
  NodeTextValidationIssue,
} from "./types.js";
import {
  createIdentityMappedText,
  mapTransformedTextWithFallback,
  type TextSourceMap,
} from "./source-map.js";
import {
  createTextLayoutContext,
  type TextLayoutContext,
} from "./layout-context.js";

export { renderTexVListSvgMetadata };

type CachedRenderEntry = {
  readonly payload: NodeTextRenderPayload;
  readonly baseWidthPt: number;
  readonly baseHeightPt: number;
  readonly baseLineYPt: number;
  readonly midLineYPt: number;
  readonly paragraphId: string;
  readonly renderSourceText: string;
};

type TextFontOptions = {
  readonly fontStyle: "normal" | "italic";
  readonly fontWeight: "normal" | "bold";
  readonly fontFamily: "serif" | "sans" | "monospace";
};

type TexSharedLayout = {
  readonly report: ParagraphLayoutReport<"layout">;
  readonly vlistLayout: TexVListLayout<"layout">;
  readonly contentWidthPt: TexLength;
  readonly renderFont: ResolvedTexFont;
};

const TEX_TEXT_BASE_FONT_SIZE = 10;
const TEX_NATURAL_TEXT_LAYOUT_WIDTH_PT = 16384;
const SINGLE_LINE_WIDTH_EPSILON_PT = 1e-4;
const LATEX_NORMAL_BASELINESKIP_EM = 1.2;
const LATEX_NORMAL_STRUT_HEIGHT_EM = 0.85;
const RENDER_CACHE_LIMIT = 2048;
const TEX_LAYOUT_CACHE_LIMIT = 512;
const VALIDATION_CACHE_LIMIT = 512;
const EXPLICIT_LINE_BREAK_TOKEN_PATTERN = /\\\\(?:\[[^\]]*\])?/;
const EXPLICIT_LINE_BREAK_CANONICAL_PATTERN =
  /[ \t\r\n]*(\\\\(?:\[[^\]]*\])?)[ \t\r\n]*/g;

let sharedEnginePromise: Promise<NodeTextEngine> | null = null;
const profiledEnginePromises = new Map<string, Promise<NodeTextEngine>>();

export type TexNodeTextEngineOptions = {
  /**
   * Document-class math substitutions used inside node text. For example,
   * Beamer keeps Computer Modern symbols but maps literal Latin math letters
   * to the sans text family.
   */
  readonly mathFontProfile?: TexMathFontProfile;
};

export async function createTexNodeTextEngine(
  options: TexNodeTextEngineOptions = {}
): Promise<NodeTextEngine> {
  if (!options.mathFontProfile) {
    sharedEnginePromise ??= initializeEngine(options);
    return sharedEnginePromise;
  }
  const key = options.mathFontProfile.id;
  let promise = profiledEnginePromises.get(key);
  if (!promise) {
    promise = initializeEngine(options);
    profiledEnginePromises.set(key, promise);
  }
  return promise;
}

async function initializeEngine(
  options: TexNodeTextEngineOptions
): Promise<NodeTextEngine> {
  await preloadEnglishHyphenator();

  const layoutContext = createTextLayoutContext();
  const renderCache = new Map<string, CachedRenderEntry>();
  const layoutCache = new Map<string, TexSharedLayout>();
  const validationCache = new Map<string, NodeTextValidationIssue | null>();

  return {
    validate(text: string): NodeTextValidationIssue | null {
      const cached = validationCache.get(text);
      if (cached !== undefined || validationCache.has(text)) {
        return cached ?? null;
      }
      const prepared = normalizeTexTextInput(text);
      if (prepared.text.trim().length === 0) {
        setCappedMapValue(validationCache, text, null, VALIDATION_CACHE_LIMIT);
        return null;
      }
      const fallbackReason = getSimpleTexFallbackReason(
        prepared.text,
        TEX_NATURAL_TEXT_LAYOUT_WIDTH_PT
      );
      const issue = fallbackReason
        ? {
          code: "unsupported-node-tex",
          message: fallbackReason,
        }
        : null;
      setCappedMapValue(validationCache, text, issue, VALIDATION_CACHE_LIMIT);
      return issue;
    },

    measure(request: NodeTextMeasureRequest) {
      const prepared = normalizeTexTextInput(request.text, {
        fontStyle: request.fontStyle,
        fontWeight: request.fontWeight,
        fontFamily: request.fontFamily,
      }, request.sourceMap);
      if (prepared.text.trim().length === 0) {
        return null;
      }

      const fontSizePt =
        Number.isFinite(request.fontSizePt) && request.fontSizePt > 0
          ? request.fontSizePt
          : TEX_TEXT_BASE_FONT_SIZE;
      const layoutInput = request.textWidthPt == null
        ? normalizeRestrictedHorizontalModeInput(prepared)
        : prepared;
      const alignment = resolveParagraphAlignment(
        request.textWidthPt,
        request.alignment
      );
      const graphicsCacheKey = request.graphicsResolver?.cacheKey ?? null;
      const resolverCacheKey = [
        graphicsCacheKey,
        request.colorResolver?.cacheKey ?? null,
      ].filter((value): value is string => value !== null).join("|") || null;
      const layoutCacheKey = measurementKey(
        layoutInput.text,
        request.textWidthPt,
        layoutInput.font,
        fontSizePt,
        alignment,
        resolverCacheKey
      );
      const sourceMapAnchor = layoutInput.sourceMap
        ? texSourceMapAnchor(layoutInput.sourceMap)
        : null;
      const cacheKey = sourceMapAnchor == null
        ? layoutCacheKey
        : `${layoutCacheKey}|sm:${sourceMapAnchor}`;

      let entry = getCappedMapValue(renderCache, cacheKey) ?? null;
      if (!entry) {
        entry = buildTexTextCacheEntry({
          layoutContext,
          cacheKey,
          layoutCacheKey,
          layoutCache,
          sourceText: layoutInput.text,
          textWidthPt: request.textWidthPt,
          font: layoutInput.font,
          fontSizePt,
          alignment,
          requestedAlignment: request.alignment ?? null,
          sourceMap: layoutInput.sourceMap,
          graphicsResolver: request.graphicsResolver,
          colorResolver: request.colorResolver,
          mathFontProfile: options.mathFontProfile,
        });
        if (!entry) {
          return null;
        }
        setCappedMapValue(renderCache, cacheKey, entry, RENDER_CACHE_LIMIT);
      }

      return {
        cacheKey: entry.payload.cacheKey,
        width: entry.baseWidthPt,
        height: entry.baseHeightPt,
        baselineY: entry.baseLineYPt,
        midLineY: entry.midLineYPt,
        paragraphId: entry.paragraphId,
        renderSourceText: entry.renderSourceText,
        graphicsPlacements: entry.payload.graphicsPlacements,
      };
    },

    renderFromCache(cacheKey: string): NodeTextRenderPayload | null {
      return getCappedMapValue(renderCache, cacheKey)?.payload ?? null;
    },
  };
}

function buildTexSharedLayout(params: {
  readonly layoutCacheKey: string;
  readonly layoutCache: Map<string, TexSharedLayout>;
  readonly sourceText: string;
  readonly textWidthPt: number | null;
  readonly font: TextFontOptions;
  readonly fontSizePt: number;
  readonly alignment: NodeTextParagraphAlignment | null;
  readonly graphicsResolver?: DocumentGraphicsResolver;
  readonly colorResolver?: NodeTextColorResolver;
  readonly mathFontProfile?: TexMathFontProfile;
}): TexSharedLayout | null {
  const cached = getCappedMapValue(params.layoutCache, params.layoutCacheKey);
  if (cached) {
    return cached;
  }

  const isNaturalWidthLayout = params.textWidthPt == null;
  const layoutWidthPt = texLength(
    params.textWidthPt ?? TEX_NATURAL_TEXT_LAYOUT_WIDTH_PT
  );
  const metricProvider = computerModernTexMetricProvider;
  const textFontProfile = texTextFontProfileForNodeFont(params.font);
  const renderFont = textFontProfile.resolveTextFont(
    textFontProfile.defaultFontState,
    texLength(params.fontSizePt),
    metricProvider
  );
  const paragraphId = `tex:${stableHashString(params.layoutCacheKey)}`;

  const runLayout = (
    width: TexLength,
    alignment: NodeTextParagraphAlignment
  ) => layoutSimpleTexParagraph(params.sourceText, {
    paragraphId,
    width,
    alignment,
    font: renderFont,
    metricProvider,
    textFontProfile,
    tikzTextWidthNode: true,
    fallbackPolicy: "placeholder",
    mathBoxProvider: createTexDerivedInlineMathBoxProvider({
      baseAtPt: params.fontSizePt,
      ...(params.mathFontProfile
        ? { fontProfile: params.mathFontProfile }
        : {}),
    }),
    ...(params.graphicsResolver
      ? { graphicsResolver: params.graphicsResolver }
      : {}),
    ...(params.colorResolver ? { colorResolver: params.colorResolver } : {}),
  });

  let layout: ReturnType<typeof layoutSimpleTexParagraph>;
  try {
    layout = runLayout(
      layoutWidthPt,
      isNaturalWidthLayout ? "ragged-right" : params.alignment ?? "ragged-right"
    );
  } catch {
    return null;
  }
  if (
    !layout.supported &&
    params.alignment === "ragged-left" &&
    hasExplicitMultilineBreaks(params.sourceText)
  ) {
    // The breaker can reject very wide ragged-left forced-line paragraphs
    // because their left skip has effectively unbounded stretch. Centering
    // finds the identical breaks; move those fixed lines to the right edge.
    try {
      const centered = runLayout(layoutWidthPt, "center");
      if (centered.supported && centered.report && centered.vlistLayout) {
        layout = {
          ...centered,
          report: {
            ...centered.report,
            alignment: "ragged-left",
            lines: centered.report.lines.map((line) => {
              const xStart = texLineX(layoutWidthPt - line.width);
              return {
                ...line,
                xStart,
                xEnd: texLineX(xStart + line.width),
              };
            }),
          },
        };
      }
    } catch {
      return null;
    }
  }
  if (!layout.supported || !layout.report || !layout.vlistLayout) {
    return null;
  }
  let baseReport = layout.report;
  let baseVListLayout = layout.vlistLayout;

  let contentWidthPt = isNaturalWidthLayout
    ? texParagraphNaturalContentWidth(baseReport)
    : layoutWidthPt;
  if (
    isNaturalWidthLayout &&
    params.alignment &&
    hasExplicitMultilineBreaks(params.sourceText)
  ) {
    // A centered or right-aligned paragraph has no feasible solution at the
    // deliberately enormous discovery width. First discover the longest
    // forced line ragged-right, then lay out again at that natural width.
    contentWidthPt = texLength(contentWidthPt + SINGLE_LINE_WIDTH_EPSILON_PT);
    try {
      const alignedLayout = runLayout(contentWidthPt, params.alignment);
      if (
        alignedLayout.supported &&
        alignedLayout.report &&
        alignedLayout.vlistLayout
      ) {
        baseReport = alignedLayout.report;
        baseVListLayout = alignedLayout.vlistLayout;
      }
    } catch {
      return null;
    }
  }
  const report = isNaturalWidthLayout
    ? shrinkTexParagraphReportToWidth(
      baseReport,
      contentWidthPt,
      hasExplicitMultilineBreaks(params.sourceText)
        ? "fixed-lines"
        : undefined
    )
    : baseReport;
  const vlistLayout = isNaturalWidthLayout
    ? shrinkTexVListLayoutToWidth(baseVListLayout, contentWidthPt, report)
    : baseVListLayout;
  const shared = { report, vlistLayout, contentWidthPt, renderFont };
  setCappedMapValue(
    params.layoutCache,
    params.layoutCacheKey,
    shared,
    TEX_LAYOUT_CACHE_LIMIT
  );
  return shared;
}

function buildTexTextCacheEntry(params: {
  readonly layoutContext: TextLayoutContext;
  readonly cacheKey: string;
  readonly layoutCacheKey: string;
  readonly layoutCache: Map<string, TexSharedLayout>;
  readonly sourceText: string;
  readonly textWidthPt: number | null;
  readonly font: TextFontOptions;
  readonly fontSizePt: number;
  readonly alignment: NodeTextParagraphAlignment | null;
  readonly requestedAlignment: NodeTextParagraphAlignment | null;
  readonly sourceMap?: TextSourceMap;
  readonly graphicsResolver?: DocumentGraphicsResolver;
  readonly colorResolver?: NodeTextColorResolver;
  readonly mathFontProfile?: TexMathFontProfile;
}): CachedRenderEntry | null {
  const shared = buildTexSharedLayout(params);
  if (!shared) {
    return null;
  }

  const { contentWidthPt, renderFont } = shared;
  const paragraphId = `tex:${stableHashString(params.cacheKey)}`;
  const report = {
    ...remapParagraphLayoutReportSourceMap(shared.report, params.sourceMap),
    paragraphId,
  };
  const remappedVList = remapTexVListLayoutSourceMap(
    shared.vlistLayout,
    params.sourceMap
  );
  const vlistLayout = {
    ...remappedVList,
    reports: remappedVList.reports.map((candidate) =>
      "paragraphId" in candidate &&
      candidate.paragraphId === shared.report.paragraphId
        ? report
        : candidate
    ),
    graphicsPlacements: remappedVList.graphicsPlacements.map((placement) => ({
      ...placement,
      id: placement.id.replace(shared.report.paragraphId, paragraphId),
      paragraphId,
    })),
  };
  registerParagraphLayoutReports(params.layoutContext, [report]);
  registerTexVListLayouts(params.layoutContext, [{
    paragraphId,
    layout: vlistLayout,
  }]);

  const baselineMetrics = texNormalBaselineMetrics(renderFont);
  const lineHeightPt = baselineMetrics.baselineskip;
  const singleNaturalLine =
    params.textWidthPt == null &&
    !hasExplicitMultilineBreaks(params.sourceText) &&
    report.lines.length === 1
      ? report.lines[0]
      : undefined;
  const firstLineTop = texVListPlacedLineTop(
    vlistLayout,
    report.lines[0]?.lineIndex ?? 0
  );
  const firstLineAscent = texLength(
    vlistLayout.baseline.kind === "explicit"
      ? vlistLayout.baseline.y - firstLineTop
      : baselineMetrics.strutHeight
  );
  const measuredFirstLineAscent = texLength(
    singleNaturalLine?.ascent ?? firstLineAscent
  );
  const heightPt = texLength(
    singleNaturalLine
      ? Math.max(0, singleNaturalLine.ascent + singleNaturalLine.descent)
      : Math.max(
        lineHeightPt,
        vlistLayout.metrics.height + vlistLayout.metrics.depth
      )
  );
  const body = renderTexParagraphSvgBody(report, {
    lineHeightPt,
    vlistLayout,
    metricProvider: computerModernTexMetricProvider,
    alignment: params.requestedAlignment,
  });

  return {
    payload: {
      cacheKey: params.cacheKey,
      viewBox: {
        x: 0,
        y: 0,
        width: contentWidthPt,
        height: heightPt,
      },
      body,
      graphicsPlacements: vlistLayout.graphicsPlacements,
    },
    baseWidthPt: contentWidthPt,
    baseHeightPt: heightPt,
    baseLineYPt: heightPt / 2 - measuredFirstLineAscent,
    midLineYPt: 0,
    paragraphId,
    renderSourceText: params.sourceText,
  };
}

export function renderTexParagraphDebugSvgBody(params: {
  readonly text: string;
  readonly width: number;
  readonly alignment?: NodeTextParagraphAlignment | null;
}): string | null {
  const metricProvider = computerModernTexMetricProvider;
  const renderFont = luaLatexDefaultTextFontProfile.resolveTextFont(
    luaLatexDefaultTextFontProfile.defaultFontState,
    texLength(TEX_TEXT_BASE_FONT_SIZE),
    metricProvider
  );
  const layout = layoutSimpleTexParagraph(params.text, {
    paragraphId: "tex:debug-placeholder",
    width: texLength(params.width),
    alignment: params.alignment ?? "ragged-right",
    font: renderFont,
    metricProvider,
    textFontProfile: luaLatexDefaultTextFontProfile,
    tikzTextWidthNode: true,
    fallbackPolicy: "placeholder",
    mathBoxProvider: createTexDerivedInlineMathBoxProvider({
      baseAtPt: TEX_TEXT_BASE_FONT_SIZE,
    }),
  });
  if (!layout.supported || !layout.report || !layout.vlistLayout) {
    return null;
  }

  return renderTexParagraphSvgBody(layout.report, {
    lineHeightPt: texNormalBaselineMetrics(renderFont).baselineskip,
    vlistLayout: layout.vlistLayout,
    metricProvider,
    alignment: params.alignment ?? null,
  });
}

function texTextFontProfileForNodeFont(
  font: TextFontOptions
): TexTextFontProfile {
  const defaultFontState: SimpleTexFontState = {
    family: font.fontFamily === "sans" ? "sans" : "normal",
    series: font.fontWeight === "bold" ? "bold" : "medium",
    shape: font.fontStyle === "italic" ? "italic" : "upright",
  };
  return {
    ...luaLatexDefaultTextFontProfile,
    defaultFontState,
  };
}

function texParagraphNaturalContentWidth(
  report: ParagraphLayoutReport
): TexLength {
  let width = texLength(0);
  for (const line of report.lines) {
    const lineRight = Math.max(
      line.xEnd,
      ...line.segments.map((segment) => segment.x + segment.width)
    );
    width = texLength(
      Math.max(width, lineRight - Math.min(0, line.xStart))
    );
  }
  return texLength(Math.max(SINGLE_LINE_WIDTH_EPSILON_PT, width));
}

function shrinkTexParagraphReportToWidth(
  report: ParagraphLayoutReport<"layout">,
  width: TexLength,
  layoutMode?: ParagraphLayoutReport["layoutMode"]
): ParagraphLayoutReport<"layout"> {
  return {
    ...report,
    width,
    layoutMode: layoutMode ?? report.layoutMode,
    lines: report.lines.map((line) => ({
      ...line,
      targetWidth: texLength(Math.min(line.targetWidth, width)),
    })),
  };
}

function shrinkTexVListLayoutToWidth(
  layout: TexVListLayout<"layout">,
  width: TexLength,
  report: ParagraphLayoutReport<"layout">
): TexVListLayout<"layout"> {
  return {
    ...layout,
    metrics: { ...layout.metrics, width },
    graphicsPlacements: collectTexGraphicsPlacements(
      [report],
      layout.linePlacements
    ),
    reports: layout.reports.map((candidate) =>
      "paragraphId" in candidate &&
      candidate.paragraphId === report.paragraphId
        ? report
        : candidate
    ),
  };
}

function texVListPlacedLineTop(
  layout: TexVListLayout,
  lineIndex: number
): TexVListY {
  const placement = layout.linePlacements.find(
    (entry) => entry.lineIndex === lineIndex
  );
  if (!placement) {
    throw new Error(`TeX vlist layout is missing line placement ${lineIndex}.`);
  }
  return placement.y;
}

function texNormalBaselineMetrics(font: ResolvedTexFont): {
  readonly baselineskip: TexLength;
  readonly strutHeight: TexLength;
} {
  return {
    baselineskip: texLength(font.atPt * LATEX_NORMAL_BASELINESKIP_EM),
    strutHeight: texLength(font.atPt * LATEX_NORMAL_STRUT_HEIGHT_EM),
  };
}

function resolveParagraphAlignment(
  textWidthPt: number | null,
  alignment: NodeTextParagraphAlignment | undefined
): NodeTextParagraphAlignment | null {
  if (textWidthPt == null) {
    return alignment ?? null;
  }
  return alignment ?? "ragged-right";
}

function normalizeTexTextInput(
  text: string,
  font: TextFontOptions = {
    fontStyle: "normal",
    fontWeight: "normal",
    fontFamily: "serif",
  },
  sourceMap?: TextSourceMap
): {
  readonly text: string;
  readonly font: TextFontOptions;
  readonly sourceMap?: TextSourceMap;
} {
  const normalized = text
    .replace(EXPLICIT_LINE_BREAK_CANONICAL_PATTERN, "$1")
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, " ");
  const normalizedSourceMap = sourceMap && normalized !== text
    ? mapTransformedTextWithFallback(
      { text, sourceMap },
      normalized,
      "native TeX input normalization"
    ).sourceMap
    : sourceMap;
  return {
    text: normalized,
    font: { ...font },
    ...(normalizedSourceMap ? { sourceMap: normalizedSourceMap } : {}),
  };
}

/**
 * A TikZ node without `text width` is collected in the hbox opened by
 * `\tikz@do@fig` (tikz.code.tex). That is restricted horizontal mode:
 * `\par` has no vertical effect, and the whitespace following its control
 * word is already consumed by TeX's scanner.
 */
function normalizeRestrictedHorizontalModeInput(
  input: ReturnType<typeof normalizeTexTextInput>
): ReturnType<typeof normalizeTexTextInput> {
  const normalized = input.text.replace(
    /\\par(?![A-Za-z@])[ \t\r\n]*/g,
    ""
  );
  if (normalized === input.text) {
    return input;
  }
  const sourceMap = mapTransformedTextWithFallback(
    input.sourceMap
      ? { text: input.text, sourceMap: input.sourceMap }
      : createIdentityMappedText(input.text),
    normalized,
    "TikZ restricted horizontal mode"
  ).sourceMap;
  return {
    ...input,
    text: normalized,
    sourceMap,
  };
}

function hasExplicitMultilineBreaks(text: string): boolean {
  return EXPLICIT_LINE_BREAK_TOKEN_PATTERN.test(text);
}

function measurementKey(
  text: string,
  textWidthPt: number | null,
  font: TextFontOptions,
  fontSizePt: number,
  alignment: NodeTextParagraphAlignment | null,
  resolverCacheKey: string | null
): string {
  return JSON.stringify({
    text,
    textWidthPt:
      textWidthPt == null ? null : Number(textWidthPt.toFixed(6)),
    fontSizePt: Number(fontSizePt.toFixed(6)),
    alignment,
    resolverCacheKey,
    fontStyle: font.fontStyle,
    fontWeight: font.fontWeight,
    fontFamily: font.fontFamily,
  });
}

function texSourceMapAnchor(sourceMap: TextSourceMap): string {
  return stableHashString(
    JSON.stringify([sourceMap.charOrigins, sourceMap.boundaryOrigins])
  );
}

function stableHashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function setCappedMapValue<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
  limit: number
): void {
  if (map.has(key)) {
    map.delete(key);
  }
  map.set(key, value);
  while (map.size > limit) {
    const oldest = map.keys().next();
    if (oldest.done) {
      break;
    }
    map.delete(oldest.value);
  }
}

function getCappedMapValue<K, V>(map: Map<K, V>, key: K): V | undefined {
  const value = map.get(key);
  if (value !== undefined) {
    map.delete(key);
    map.set(key, value);
  }
  return value;
}

import type { ParagraphLayoutReport } from "./knuth-plass/index.js";
import { preloadEnglishHyphenator } from "./knuth-plass/paragraph/hyphenate.js";
import {
  computerModernTexMetricProvider,
  createTexDerivedInlineMathBoxProvider,
  getSimpleTexFallbackReason,
  layoutSimpleTexParagraph,
  luaLatexDefaultTextFontProfile,
  projectSimpleTexSourceByPolicy,
  renderTexParagraphSvgBody,
  renderTexVListSvgMetadata,
  simpleTexSourceHasLineBreak,
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
  NodeTextRenderScope,
  NodeTextValidationIssue,
} from "./types.js";
import {
  createIdentityMappedText,
  mapTransformedTextWithFallback,
  translateTextSourceMap,
  type TextSourceMap,
} from "./source-map.js";
import {
  createTextLayoutContext,
  setActiveTextLayoutContext,
  type TextLayoutContext,
} from "./layout-context.js";
import { TexWeightedLruCache } from "./tex/cache.js";
import { estimateVListLayoutBytes } from "./layout-cache-size.js";

export { renderTexVListSvgMetadata };

type CachedRenderEntry = {
  readonly payload: NodeTextRenderPayload;
  readonly baseWidthPt: number;
  readonly baseHeightPt: number;
  readonly baseLineYPt: number;
  readonly midLineYPt: number;
  readonly paragraphId: string;
  readonly renderSourceText: string;
  readonly report: ParagraphLayoutReport;
  readonly vlistLayout: TexVListLayout;
  readonly retainedBytes: number;
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
  readonly isSingleNaturalLine: boolean;
  readonly retainedBytes: number;
};

const TEX_TEXT_BASE_FONT_SIZE = 10;
const TEX_NATURAL_TEXT_LAYOUT_WIDTH_PT = 16384;
const SINGLE_LINE_WIDTH_EPSILON_PT = 1e-4;
const LATEX_NORMAL_BASELINESKIP_EM = 1.2;
const LATEX_NORMAL_STRUT_HEIGHT_EM = 0.85;
const RENDER_CACHE_LIMIT = 2048;
const TEX_LAYOUT_CACHE_LIMIT = 512;
const VALIDATION_CACHE_LIMIT = 512;
const SOURCE_MAP_KEY_CACHE_BYTES = 4 * 1024 * 1024;
const RENDER_CACHE_BYTES = 32 * 1024 * 1024;
const TEX_LAYOUT_CACHE_BYTES = 16 * 1024 * 1024;
const VALIDATION_CACHE_BYTES = 1024 * 1024;
let sharedEnginePromise: Promise<NodeTextEngine> | null = null;
const profiledEnginePromises = new WeakMap<TexMathFontProfile, Promise<NodeTextEngine>>();
const retainedEntriesByContext = new WeakMap<TextLayoutContext, {
  readonly owner: object;
  readonly entries: ReadonlyMap<string, CachedRenderEntry>;
}>();

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
  const key = options.mathFontProfile;
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

  const entriesByParagraph = new Map<string, CachedRenderEntry>();
  // Requests live exactly as long as their render entries, including scene-owned
  // entries outside the reusable cache. Resolvers keep their original revisions.
  const requestsByEntry = new WeakMap<CachedRenderEntry, NodeTextMeasureRequest>();
  const renderCache = new TexWeightedLruCache<string, CachedRenderEntry>(RENDER_CACHE_LIMIT, RENDER_CACHE_BYTES, {
    retainOversizedEntry: true,
    onEvict: (_key, entry) => entriesByParagraph.delete(entry.paragraphId),
  });
  const layoutCache = new TexWeightedLruCache<string, TexSharedLayout>(TEX_LAYOUT_CACHE_LIMIT, TEX_LAYOUT_CACHE_BYTES);
  const validationCache = new TexWeightedLruCache<string, NodeTextValidationIssue | null>(VALIDATION_CACHE_LIMIT, VALIDATION_CACHE_BYTES);
  // Reports are owned by live render entries rather than a separately evicted
  // registry. Dropping a render entry drops its metadata in the same operation.
  const layoutContext = createTextLayoutContext({
    getParagraphReports: () => [...entriesByParagraph.values()].map((entry) => entry.report),
    getVListLayouts: () => [...entriesByParagraph.values()].map((entry) => ({ paragraphId: entry.paragraphId, layout: entry.vlistLayout })),
    getVListLayout: (paragraphId) => entriesByParagraph.get(paragraphId)?.vlistLayout ?? null,
  });
  const owner = {};
  let activeScope: { readonly context: TextLayoutContext; readonly entries: Map<string, CachedRenderEntry>; readonly byParagraph: Map<string, CachedRenderEntry>; readonly previous: ReadonlyMap<string, CachedRenderEntry> | null } | null = null;
  const sourceMapKeys = new TexWeightedLruCache<string, string>(RENDER_CACHE_LIMIT, SOURCE_MAP_KEY_CACHE_BYTES);
  let sourceMapSequence = 0n;
  let paragraphSequence = 0n;
  // Reports share an engine-local registry. IDs must be collision-free there;
  // hashes of source maps or layout keys cannot provide that guarantee.
  const nextParagraphId = () => `tex:${++paragraphSequence}`;

  const engine: NodeTextEngine = {
    layoutContext,
    createRenderScope(previousContext): NodeTextRenderScope {
      const previous = previousContext ? retainedEntriesByContext.get(previousContext) : undefined;
      const scopeEntries = new Map<string, CachedRenderEntry>();
      const byParagraph = new Map<string, CachedRenderEntry>();
      const ownedEntries = () => {
        const merged = new Map(entriesByParagraph);
        for (const [id, entry] of byParagraph) merged.set(id, entry);
        return merged.values();
      };
      const context = createTextLayoutContext({
        getParagraphReports: () => [...ownedEntries()].map((entry) => entry.report),
        getVListLayouts: () => [...ownedEntries()].map((entry) => ({ paragraphId: entry.paragraphId, layout: entry.vlistLayout })),
        getVListLayout: (paragraphId) => (byParagraph.get(paragraphId) ?? entriesByParagraph.get(paragraphId))?.vlistLayout ?? null,
      });
      const scope = { context, entries: scopeEntries, byParagraph, previous: previous?.owner === owner ? previous.entries : null };
      retainedEntriesByContext.set(context, { owner, entries: scopeEntries });
      return {
        layoutContext: context,
        run(operation) {
          const parent = activeScope;
          activeScope = scope;
          try { return operation(); } finally { activeScope = parent; }
        },
        retain(cacheKeys) {
          const retained = new Map<string, CachedRenderEntry>();
          for (const key of cacheKeys) {
            const entry = scopeEntries.get(key) ?? scope.previous?.get(key) ?? renderCache.get(key);
            if (entry) retained.set(key, entry);
          }
          scopeEntries.clear();
          byParagraph.clear();
          for (const [key, entry] of retained) {
            scopeEntries.set(key, entry);
            byParagraph.set(entry.paragraphId, entry);
          }
          scope.previous = null;
        },
      };
    },
    validate(text: string): NodeTextValidationIssue | null {
      const cached = validationCache.get(text);
      if (cached !== undefined) return cached;
      const prepared = normalizeTexTextInput(text);
      if (prepared.text.trim().length === 0) {
        validationCache.set(text, null, text.length * 2 + 64);
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
      validationCache.set(text, issue, text.length * 2 + (issue?.message.length ?? 0) * 2 + 128);
      return issue;
    },

    measure(request: NodeTextMeasureRequest) {
      setActiveTextLayoutContext(activeScope?.context ?? layoutContext);
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
      const layoutCacheKey = measurementKey(
        layoutInput.text,
        request.textWidthPt,
        layoutInput.font,
        fontSizePt,
        alignment,
        request.graphicsResolver?.cacheKey ?? null,
        request.colorResolver?.cacheKey ?? null
      );
      let sourceMapKey: string | null = null;
      if (layoutInput.sourceMap) {
        const serialized = JSON.stringify([
          layoutInput.sourceMap.inputText.length,
          layoutInput.sourceMap.charOrigins,
          layoutInput.sourceMap.boundaryOrigins,
        ]);
        sourceMapKey = sourceMapKeys.get(serialized) ?? null;
        if (sourceMapKey === null) {
          if (serialized.length * 2 + 64 <= SOURCE_MAP_KEY_CACHE_BYTES) {
            // Exact string equality interns maps; tokens are never recycled.
            // Evicting an interned map can cause a miss, never a false hit.
            sourceMapKey = (++sourceMapSequence).toString(36);
            sourceMapKeys.set(serialized, sourceMapKey, serialized.length * 2 + 64);
          } else {
            // Very large maps retain exact lookup without another cache copy.
            sourceMapKey = serialized;
          }
        }
      }
      const cacheKey = sourceMapKey === null
        ? layoutCacheKey
        : `${layoutCacheKey}|sm:${sourceMapKey}`;

      let entry = activeScope?.entries.get(cacheKey) ?? activeScope?.previous?.get(cacheKey) ?? renderCache.get(cacheKey) ?? null;
      if (!entry) {
        entry = buildTexTextCacheEntry({
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
          nextParagraphId,
        });
        if (!entry) {
          return null;
        }
        entry = { ...entry, retainedBytes: entry.retainedBytes + request.text.length * 2 +
          (request.sourceMap ? request.sourceMap.charOrigins.length * 160 + request.sourceMap.boundaryOrigins.length * 96 : 0) + 128 };
        requestsByEntry.set(entry, {
          ...request,
          sourceMap: request.sourceMap ? structuredClone(request.sourceMap) : undefined
        });
        if (renderCache.set(cacheKey, entry, cacheKey.length * 2 + entry.retainedBytes)) {
          entriesByParagraph.set(entry.paragraphId, entry);
        }
      }
      activeScope?.entries.set(cacheKey, entry);
      activeScope?.byParagraph.set(entry.paragraphId, entry);

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

    rebaseSource(cacheKey, delta) {
      const entry = activeScope?.entries.get(cacheKey) ?? activeScope?.previous?.get(cacheKey) ?? renderCache.get(cacheKey);
      const request = entry && requestsByEntry.get(entry);
      if (!request?.sourceMap) return null;
      // Foreign macro definition spans do not necessarily move with the node.
      // Let semantic replay handle those projections conservatively.
      const isMacro = (origin: { kind: string }) => origin.kind === "macro-argument" || origin.kind === "macro-generated";
      if (request.sourceMap.charOrigins.some(isMacro) || request.sourceMap.boundaryOrigins.some((anchor) =>
        anchor.kind === "range" && (anchor.policy === "macro" || (anchor.projection && isMacro(anchor.projection))))) return null;
      return engine.measure({ ...request, sourceMap: translateTextSourceMap(request.sourceMap, delta) });
    },

    renderFromCache(cacheKey: string): NodeTextRenderPayload | null {
      setActiveTextLayoutContext(activeScope?.context ?? layoutContext);
      const entry = activeScope?.entries.get(cacheKey) ?? activeScope?.previous?.get(cacheKey) ?? renderCache.get(cacheKey);
      if (entry) {
        activeScope?.entries.set(cacheKey, entry);
        activeScope?.byParagraph.set(entry.paragraphId, entry);
      }
      return entry?.payload ?? null;
    },
  };
  return engine;
}

function buildTexSharedLayout(params: {
  readonly layoutCacheKey: string;
  readonly layoutCache: TexWeightedLruCache<string, TexSharedLayout>;
  readonly sourceText: string;
  readonly textWidthPt: number | null;
  readonly font: TextFontOptions;
  readonly fontSizePt: number;
  readonly alignment: NodeTextParagraphAlignment | null;
  readonly graphicsResolver?: DocumentGraphicsResolver;
  readonly colorResolver?: NodeTextColorResolver;
  readonly mathFontProfile?: TexMathFontProfile;
  readonly nextParagraphId: () => string;
}): TexSharedLayout | null {
  const cached = params.layoutCache.get(params.layoutCacheKey);
  if (cached) {
    return cached;
  }

  const isNaturalWidthLayout = params.textWidthPt == null;
  let explicitLineBreaks: boolean | undefined;
  const hasExplicitLineBreaks = () =>
    explicitLineBreaks ??= hasExplicitMultilineBreaks(params.sourceText);
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
  const paragraphId = params.nextParagraphId();

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
    // The natural-width sentinel is an implementation detail, not a TeX
    // document register. Keep named width registers unresolved in that mode.
    dimensionContext: isNaturalWidthLayout ? null : undefined,
    fallbackPolicy: "placeholder",
    mathBoxProvider: createTexDerivedInlineMathBoxProvider({
      baseAtPt: params.fontSizePt,
      deferInlineSvg: true,
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
    hasExplicitLineBreaks()
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
    hasExplicitLineBreaks()
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
      hasExplicitLineBreaks()
        ? "fixed-lines"
        : undefined
    )
    : baseReport;
  const vlistLayout = isNaturalWidthLayout
    ? shrinkTexVListLayoutToWidth(baseVListLayout, contentWidthPt, report)
    : baseVListLayout;
  const shared: TexSharedLayout = {
    report,
    vlistLayout,
    contentWidthPt,
    renderFont,
    isSingleNaturalLine:
      isNaturalWidthLayout && !hasExplicitLineBreaks() && report.lines.length === 1,
    // Conservative estimate of owned layout structures, excluding shared font
    // tables. Avoid a second traversal of every glyph/caret graph on cold paths.
    retainedBytes: params.sourceText.length * 256 + estimateVListLayoutBytes(vlistLayout),
  };
  params.layoutCache.set(params.layoutCacheKey, shared, params.layoutCacheKey.length * 2 + shared.retainedBytes);
  return shared;
}

function buildTexTextCacheEntry(params: {
  readonly cacheKey: string;
  readonly layoutCacheKey: string;
  readonly layoutCache: TexWeightedLruCache<string, TexSharedLayout>;
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
  readonly nextParagraphId: () => string;
}): CachedRenderEntry | null {
  const shared = buildTexSharedLayout(params);
  if (!shared) {
    return null;
  }

  const { contentWidthPt, renderFont } = shared;
  const paragraphId = params.nextParagraphId();
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

  const baselineMetrics = texNormalBaselineMetrics(renderFont);
  const lineHeightPt = baselineMetrics.baselineskip;
  const singleNaturalLine =
    shared.isSingleNaturalLine
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
    report,
    vlistLayout,
    retainedBytes: shared.retainedBytes * 2 + body.length * 2 + params.sourceText.length * 2 + 256,
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
  return {
    text,
    font: { ...font },
    ...(sourceMap ? { sourceMap } : {}),
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
  // Only a source-backed \\par node can be removed by this policy. Avoid
  // parsing every ordinary label, including render-cache hits, to prove absence.
  if (!input.text.includes("\\par")) {
    return input;
  }
  const normalized = projectSimpleTexSourceByPolicy(input.text, {
    removeControlParagraphBreaks: true,
  });
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
  return simpleTexSourceHasLineBreak(text);
}

function measurementKey(
  text: string,
  textWidthPt: number | null,
  font: TextFontOptions,
  fontSizePt: number,
  alignment: NodeTextParagraphAlignment | null,
  graphicsResolverCacheKey: string | null,
  colorResolverCacheKey: string | null
): string {
  return JSON.stringify({
    text,
    textWidthPt: textWidthPt == null ? null : String(textWidthPt),
    fontSizePt,
    alignment,
    graphicsResolverCacheKey,
    colorResolverCacheKey,
    fontStyle: font.fontStyle,
    fontWeight: font.fontWeight,
    fontFamily: font.fontFamily,
  });
}

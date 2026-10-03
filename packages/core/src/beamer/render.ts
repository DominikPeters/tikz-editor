import { beamerBibliographyStyle, beamerBibliographyGraphicsResolver } from "./bibliography.js";
import {
  buildBeamerReferenceIndex,
  projectBeamerReferences,
  layoutBeamerLinks,
  type BeamerReferenceContext,
  type BeamerReferenceIndex,
} from "./references.js";
import {
  remapParagraphLayoutReportSourceMap,
  remapTexVListLayoutSourceMap,
  remapSimpleTexListStructureSourceMap,
} from "../text/tex/source-map-report.js";
import type { Span } from "../ast/types.js";
import { pt, svgPoint, svgRect, type SvgPoint, type SvgRect } from "../coords/index.js";
import type { Diagnostic } from "../diagnostics/types.js";
import type { DocumentGraphicsResolver } from "../graphics/types.js";
import {
  collectMacroBindings,
  expandMacroBindingsMapped,
  type MacroBinding,
} from "../macros/index.js";
import { renderTikzToSvgAsync } from "../render/index.js";
import { BeamerRenderWork, runBeamerRenderOperation } from "./cooperative-render-work.js";
import { formatSvgNumber as fmt } from "../svg/format.js";
import {
  createSvgModelBuilder,
  serializeSvgModel,
} from "../svg/model.js";
import {
  createGeneratedMappedText,
  createIdentityMappedText,
  mapTransformedTextWithFallback,
  type MappedText,
} from "../text/source-map.js";
import { createTexNodeTextEngine } from "../text/tex-node-text-engine.js";
import {
  computerModernTexMetricProvider,
  collectTexGraphicsPlacements,
  createTexDerivedInlineMathBoxProvider,
  defaultTexMathFontProfile,
  layoutSimpleTexParagraph,
  renderTexParagraphSvgBody,
  TEX_ALERT_COLOR_ALIAS,
  texLength,
  texLineX,
  type TexDisplayMathLayoutProfile,
  type TexListLayoutProfile,
  type TexMetricProvider,
} from "../text/tex/index.js";
import { parseTexDimensionExpression } from "../text/tex/dimensions.js";
import { collectBeamerParagraphSpacing } from "./spacing.js";
import { resolveBeamerColumnWidth } from "./column-dimensions.js";
import { parseBeamerFrameBody } from "./content.js";
import { collectBeamerEditScopes } from "./edit-scopes.js";
import { emitEmbeddedTikz } from "./embedded-tikz.js";
import {
  leadingBeamerTrivlistAdjustment,
  paragraphEndingMaterialDepth,
  paragraphLastLineDepth,
  paragraphStartingMaterialHeight,
  positionPreparedFrameFlow,
  previousDepthBeforeTrailingVerticalSpace,
  trailingBeamerListSkip,
  trailingBeamerTrivlistSkip,
} from "./frame-flow.js";
import type {
  BeamerBlockBodyNode,
  BeamerColumnAlignment,
  BeamerColumnBodyNode,
  BeamerColumnFlowNode,
  BeamerFrameBodyIr,
  BeamerFrameBodyNode,
  BeamerParagraphBodyNode,
  BeamerTheoremBodyNode,
  BeamerTitlePageBodyNode,
} from "./content-types.js";
import { resolveBeamerPageGeometry } from "./geometry.js";
import {
  projectBeamerOverlayText,
  resolveBeamerOverlaySpanVisibility,
  scanBeamerFrameOverlays,
  type BeamerOverlayModel,
  type BeamerOverlayVisibility,
} from "./overlay.js";
import { scanBeamerDocumentWithSyntax } from "./scan.js";
import { createBeamerSyntaxContext } from "./syntax.js";
import type { TexSyntaxIndex } from "../text/tex/syntax-index.js";
import type { NodeTextColorResolver } from "../text/types.js";
import {
  resolveBeamerTheoremOccurrences,
  type BeamerTheoremOccurrence,
} from "./theorems.js";
import {
  createBeamerTexMathFontProfile,
  createBeamerTexTextFontProfile,
  createBeamerFrameNavigationSnapshot,
  createBeamerNavigationModel,
  planBeamerBlockTemplate,
  planBeamerFrameChrome,
  planBeamerTitlePageTemplate,
  resolveBeamerEnumerateMarker,
  resolveBeamerItemizeMarkers,
  resolveBeamerTheme,
  resolveBeamerThemeColor,
} from "./theme/index.js";
import type {
  BeamerFrameChromePlan,
  BeamerNavigationModel,
  BeamerTemplatePrimitive,
  BeamerThemeFont,
  BeamerThemeFontRole,
  ResolvedBeamerTheme,
} from "./theme/types.js";
import { beamerRoundedShadowMarkup } from "./theme/rounded-shadow.js";
import {
  escapeAttribute,
  paragraphMarkup,
  rectMarkup,
  textColor,
  vectorTemplateMarkup,
} from "./theme/svg-markup.js";
import type {
  ColumnVerticalBox,
  LaidParagraph,
  PreparedBlock,
  PreparedColumnContent,
  PreparedColumnFlowItem,
  PreparedFrameFlowItem,
  PreparedTitlePage,
  PreparedTitlePageMetadataBox,
} from "./render-model.js";
import {
  prepareUnsupportedPlaceholder,
  unsupportedPlaceholderMarkup,
  type BeamerUnsupportedPlaceholder,
} from "./unsupported-placeholder.js";
import type {
  BeamerDocumentModel,
  BeamerEmbeddedTikzLayout,
  BeamerFrameModel,
  BeamerFrameLayout,
  BeamerSpacingLayout,
  BeamerFrameLayoutItem,
  BeamerGraphicsLayout,
  BeamerMetadataFieldModel,
  BeamerMetadataFieldName,
  BeamerPageGeometry,
  BeamerListTopology,
  BeamerParagraphLayout,
  BeamerRect,
  RenderBeamerFrameOptions,
  RenderBeamerFramePagesOptions,
  RenderBeamerFramePagesResult,
  RenderBeamerFrameResult,
  PrepareBeamerDocumentOptions,
} from "./types.js";

const TEX_POINTS_PER_CM = 72.27 / 2.54;
const TOP_ALIGNED_FRAME_SKIP_PT = 0.2 * TEX_POINTS_PER_CM;
// A root-level `center` is LaTeX's trivlist-based center environment.
// size11.clo supplies \topsep 9pt plus 3pt minus 5pt. Beamer's frame vbox
// applies one ordinary-order shrink ratio to these two skips and to display
// skips in the surrounding body.
const BEAMER_CENTER_TOPSEP = {
  naturalPt: 9,
  shrinkPt: 5,
} as const;
// beamerinnerthemedefault.sty's title-page template under the 11pt class
// profile. The rounded inner theme wraps the title colorbox with the PGF
// rounded/shadow option but retains these TeX box dimensions.
const BEAMER_TITLE_TEMPLATE_AFTER_TITLE_PT = 10.95;
const BEAMER_EMPTY_METADATA_COLORBOX_PT = 16;
const BEAMER_TITLE_TEMPLATE_INTERBOX_PT = 1;
const BEAMER_TITLE_TEMPLATE_GRAPHIC_SKIP_PT = 5.475;
// beamerbaselocalstructure.sty: \leftmargini..iii=2em,
// \topsep=3pt/2pt/2pt, \partopsep=0pt, \parsep=0pt, and first-level
// \itemsep=3pt. The deeper itemsep values alias their zero parsep.
const BEAMER_LIST_LAYOUT_PROFILE: TexListLayoutProfile = {
  leftMarginEmByDepth: [2, 2, 2],
  topsepPtByDepth: [3, 2, 2],
  topsepStretchPtByDepth: [2, 1, 1],
  topsepShrinkPtByDepth: [2.5, 2, 2],
  partopsepPtByDepth: [0, 0, 0],
  itemsepPtByDepth: [3, 0, 0],
  itemsepStretchPtByDepth: [2, 1, 1],
  itemsepShrinkPtByDepth: [3, 0, 0],
  parsepPtByDepth: [0, 0, 0],
  parsepStretchPtByDepth: [0, 1, 1],
  parsepShrinkPtByDepth: [0, 0, 0],
  initialItemBaselineAdjustmentPt: 0,
};

// beamer.cls uses the 11pt LaTeX size profile by default. These are the
// \normalsize display registers installed by size11.clo.
const BEAMER_NORMAL_DISPLAY_MATH_PROFILE: TexDisplayMathLayoutProfile = {
  // beamerbaseframe.sty opens the frame body in horizontal mode. A leading
  // display therefore follows a shipped zero-sized line and selects the
  // short display skips; the 11pt profile's normal baseline is 13.6pt.
  leadingDisplay: {
    emptyLineBaselineSkipPt: 13.6,
  },
  above: {
    normal: { sizePt: 11, stretchPt: 3, shrinkPt: 6 },
    short: { sizePt: 0, stretchPt: 3, shrinkPt: 0 },
  },
  below: {
    normal: { sizePt: 11, stretchPt: 3, shrinkPt: 6 },
    short: { sizePt: 6.5, stretchPt: 3.5, shrinkPt: 3 },
  },
};

function beamerListLayoutProfile(
  theme: ResolvedBeamerTheme
): TexListLayoutProfile {
  return {
    ...BEAMER_LIST_LAYOUT_PROFILE,
    leftMarginEmByDepth: theme.dimensions.listLeftMarginEmByDepth,
    itemizeMarkersByDepth: resolveBeamerItemizeMarkers(theme),
    resolveEnumerateMarker: (itemIndex, labelDepth) =>
      resolveBeamerEnumerateMarker(theme, itemIndex, labelDepth),
  };
}

/**
 * The document-level state shared by every frame/step render of one source
 * revision: scan, resolved theme, page geometry, macro bindings, navigation
 * topology, and theorem counters.
 */
type BeamerRenderContext = {
  readonly source: string;
  readonly syntax: TexSyntaxIndex;
  readonly document: BeamerDocumentModel;
  readonly theme: ResolvedBeamerTheme;
  readonly macroBindings: ReadonlyMap<string, MacroBinding>;
  readonly references: BeamerReferenceIndex;
  readonly overlaysByFrameId: ReadonlyMap<string, BeamerOverlayModel>;
  readonly page: BeamerPageGeometry;
  readonly navigationModel: BeamerNavigationModel;
  readonly theoremOccurrences: ReadonlyMap<number, BeamerTheoremOccurrence>;
};

function createBeamerRenderContext(
  source: string,
  options: PrepareBeamerDocumentOptions = {}
): BeamerRenderContext {
  const syntaxContext = createBeamerSyntaxContext(
    source,
    options.structuralMasks,
    {
      previousTree: options.previousSyntaxTree,
      patches: options.syntaxPatches,
    }
  );
  const document = scanBeamerDocumentWithSyntax(syntaxContext);
  const theme = resolveBeamerTheme(document);
  const overlaysByFrameId = new Map(document.frames.map((frame) => [
    frame.id, scanBeamerFrameOverlays(source, frame, syntaxContext.syntax),
  ]));
  return {
    source,
    syntax: syntaxContext.syntax,
    document,
    theme,
    macroBindings: collectMacroBindings(document.preamble.macroDefinitions),
    references: buildBeamerReferenceIndex(document, syntaxContext.syntax, overlaysByFrameId),
    overlaysByFrameId,
    page: resolveBeamerPageGeometry(document, theme),
    navigationModel: createBeamerNavigationModel(document),
    theoremOccurrences: resolveBeamerTheoremOccurrences(
      document,
      syntaxContext.syntax
    ),
  };
}

/**
 * A prepared Beamer document: document-level passes run once, then any
 * frame/step renders against the shared model. Frame body IRs are parsed
 * lazily and cached per frame.
 */
export type PreparedBeamerDocument = {
  readonly document: BeamerDocumentModel;
  readonly theme: ResolvedBeamerTheme;
  /** Retained by the app compute session for incremental document parsing. */
  readonly syntaxTree: TexSyntaxIndex["tree"];
  /** Overlay step count for one frame, without rendering it. */
  frameStepCount(frameIndex: number): number;
  renderFrame(
    options?: RenderBeamerFrameOptions
  ): Promise<RenderBeamerFrameResult>;
  renderFramePages(
    options?: RenderBeamerFramePagesOptions
  ): Promise<RenderBeamerFramePagesResult>;
};

/**
 * Run the document-level Beamer passes (scan, theme resolution, page
 * geometry, macro collection, navigation topology, theorem counters) once
 * and return a handle that renders frames and steps against the prepared
 * model. `renderBeamerFrame`/`renderBeamerFramePages` are one-shot wrappers
 * over this entry point.
 */
export function prepareBeamerDocument(
  source: string,
  options: PrepareBeamerDocumentOptions = {}
): PreparedBeamerDocument {
  const context = createBeamerRenderContext(source, options);
  const bodyIrByFrameIndex = new Map<number, BeamerFrameBodyIr>();

  const requireFrame = (frameIndex: number): BeamerFrameModel => {
    const frame = context.document.frames[frameIndex];
    if (!frame) {
      throw new RangeError(
        `Beamer frame index ${frameIndex} is outside the document's ${context.document.frames.length} frames.`
      );
    }
    return frame;
  };

  const frameBodyIr = (frameIndex: number): BeamerFrameBodyIr => {
    const cached = bodyIrByFrameIndex.get(frameIndex);
    if (cached) {
      return cached;
    }
    const bodyIr = parseBeamerFrameBody({
      source: context.source,
      frame: requireFrame(frameIndex),
      document: context.document,
      syntax: context.syntax,
      theoremOccurrences: context.theoremOccurrences,
      overlays: context.overlaysByFrameId.get(requireFrame(frameIndex).id),
    });
    bodyIrByFrameIndex.set(frameIndex, bodyIr);
    return bodyIr;
  };

  const requireStep = (bodyIr: BeamerFrameBodyIr, step: number): void => {
    if (!Number.isInteger(step) || step < 1) {
      throw new RangeError(
        "A Beamer overlay step must be a positive integer."
      );
    }
    if (step > bodyIr.overlays.stepCount) {
      throw new RangeError(
        `Beamer overlay step ${step} is outside the frame's ${bodyIr.overlays.stepCount} steps.`
      );
    }
  };

  return {
    document: context.document,
    theme: context.theme,
    syntaxTree: context.syntax.tree,
    frameStepCount: (frameIndex) => {
      return context.overlaysByFrameId.get(requireFrame(frameIndex).id)!.stepCount;
    },
    async renderFrame(options = {}) {
      options.cooperative?.signal?.throwIfAborted();
      const frameIndex = options.frameIndex ?? 0;
      const frame = requireFrame(frameIndex);
      const bodyIr = frameBodyIr(frameIndex);
      const step = options.step ?? 1;
      requireStep(bodyIr, step);
      return renderBeamerFrameStep({
        context,
        frame,
        frameIndex,
        bodyIr,
        step,
        graphicsResolver: options.graphicsResolver,
        work: options.cooperative ? new BeamerRenderWork(options.cooperative) : undefined,
      });
    },
    async renderFramePages(options = {}) {
      options.cooperative?.signal?.throwIfAborted();
      const frameIndex = options.frameIndex ?? 0;
      const frame = requireFrame(frameIndex);
      const bodyIr = frameBodyIr(frameIndex);
      const stepCount = bodyIr.overlays.stepCount;
      const pages: RenderBeamerFrameResult[] = [];
      const work = options.cooperative ? new BeamerRenderWork(options.cooperative) : undefined;
      for (let step = 1; step <= stepCount; step += 1) {
        if (work) await work.checkpoint();
        pages.push(
          await renderBeamerFrameStep({
            context,
            frame,
            frameIndex,
            bodyIr,
            step,
            graphicsResolver: options.graphicsResolver,
            work,
          })
        );
      }
      return {
        document: context.document,
        frame,
        stepCount,
        pages,
        diagnostics: pages.flatMap((page) => page.diagnostics),
      };
    },
  };
}

/**
 * Render one Beamer frame into a fixed-page SVG and a source-addressable
 * layout contract.
 *
 * Theme names are resolved before composition. This function consumes only
 * semantic font/color roles and generic chrome primitives.
 */
export async function renderBeamerFrame(
  source: string,
  options: RenderBeamerFrameOptions = {}
): Promise<RenderBeamerFrameResult> {
  return prepareBeamerDocument(source).renderFrame(options);
}

async function renderBeamerFrameStep(params: {
  context: BeamerRenderContext;
  frame: BeamerFrameModel;
  frameIndex: number;
  bodyIr: BeamerFrameBodyIr;
  step: number;
  graphicsResolver?: DocumentGraphicsResolver;
  work?: BeamerRenderWork;
}): Promise<RenderBeamerFrameResult> {
  const { context, frame, frameIndex, bodyIr, step } = params;
  const { source, document, theme, macroBindings, page } = context;
  const stepCount = bodyIr.overlays.stepCount;
  const navigation = createBeamerFrameNavigationSnapshot(
    document,
    frameIndex,
    context.navigationModel
  );
  const chrome = planBeamerFrameChrome({
    document,
    frame,
    frameIndex,
    totalFrames: document.frames.length,
    navigation,
    step,
    page,
    theme,
  });
  const diagnostics: Diagnostic[] = [
    ...document.diagnostics,
    ...theme.diagnostics,
  ];
  diagnostics.push(...bodyIr.diagnostics, ...context.references.diagnostics);
  const references: BeamerReferenceContext = { ...context.references, step, theme, renderDiagnostics: diagnostics };
  const items: BeamerFrameLayoutItem[] = [];
  const spacing: BeamerSpacingLayout[] = [];
  const paragraphs: BeamerParagraphLayout[] = [];
  const embeddedTikz: BeamerEmbeddedTikzLayout[] = [];
  const modelBuilder = createSvgModelBuilder();
  const pageBackground =
    resolveBeamerThemeColor(theme, "normal text").bg ?? "#ffffff";

  items.push({
    id: `${frame.id}:background`,
    kind: "background",
    sourceSpan: frame.span,
    bounds: page.page,
    parentId: null,
  });
  modelBuilder.addPart({
    basePartId: `${frame.id}:background`,
    sourceId: frame.id,
    elementId: null,
    markup: rectMarkup(page.page, pageBackground),
  });
  renderChrome({
    chrome,
    theme,
    items,
    paragraphs,
    modelBuilder,
    macroBindings,
    references,
    graphicsResolver: params.graphicsResolver,
    paperWidth: page.page.width,
  });

  const availableContentBounds: BeamerRect = {
    x: page.textArea.x,
    y: chrome.topInset,
    width: page.textArea.width,
    height: Math.max(
      0,
      page.page.height - chrome.topInset - chrome.bottomInset
    ),
  };
  let contentBounds = availableContentBounds;
  const preparedFrameFlow = await prepareFrameFlow({
    source,
    children: bodyIr.children,
    textWidth: page.textArea.width,
    paperWidth: page.page.width,
    leftSidebarWidth: page.frameArea.x,
    availableHeight: availableContentBounds.height,
    diagnostics,
    theme,
    metadata: document.preamble.metadata,
    macroBindings,
    references,
    overlays: bodyIr.overlays,
    step,
    graphicsResolver: params.graphicsResolver,
    work: params.work,
  });
  if (preparedFrameFlow.length > 0) {
    const rigidPositioned = positionPreparedFrameFlow(
      preparedFrameFlow,
      theme.fonts["normal-text"].lineHeightPt
    );
    const verticalPacking = resolveFrameVerticalPacking(
      availableContentBounds,
      rigidPositioned.extent,
      preparedFrameFlow,
      frame.options?.alignment ?? "center"
    );
    const positioned = positionPreparedFrameFlow(
      preparedFrameFlow,
      theme.fonts["normal-text"].lineHeightPt,
      verticalPacking.fillUnit
    );
    const frameBlockTop =
      availableContentBounds.y + verticalPacking.topOffset;
    for (const placement of positioned.items) {
      if (params.work) await params.work.checkpoint();
      if (
        placement.item.visibility === "hidden" &&
        placement.item.kind !== "block"
      ) {
        continue;
      }
      if (placement.item.kind === "title-page") {
        emitPreparedTitlePage({
          prepared: placement.item.titlePage,
          x: availableContentBounds.x,
          y: frameBlockTop + placement.contentTop,
          items,
          paragraphs,
          modelBuilder,
          theme,
        });
      } else if (placement.item.kind === "paragraph") {
        emitFrameParagraph({
          prepared: placement.item,
          x: availableContentBounds.x,
          y: frameBlockTop + placement.contentTop,
          items,
          paragraphs,
          modelBuilder,
          theme,
        });
      } else if (placement.item.kind === "columns") {
        await emitPreparedColumns({
          prepared: placement.item,
          referenceY: frameBlockTop + placement.referenceY,
          spacing,
          bounds: availableContentBounds,
          items,
          paragraphs,
          embeddedTikz,
          modelBuilder,
          theme,
          work: params.work,
        });
      } else if (placement.item.kind === "tikzpicture") {
        const tikz = placement.item.tikz;
        const x = tikz.horizontalAlignment === "center"
          ? availableContentBounds.x +
            (availableContentBounds.width - tikz.width) / 2
          : availableContentBounds.x;
        emitEmbeddedTikz({
          tikz,
          x,
          y:
            frameBlockTop +
            placement.contentTop +
            placement.item.contentInsetTop,
          parentId: null,
          items,
          embeddedTikz,
          modelBuilder,
        });
      } else if (placement.item.kind === "unsupported") {
        emitUnsupportedPlaceholder({
          placeholder: placement.item.placeholder,
          x: availableContentBounds.x,
          y: frameBlockTop + placement.contentTop,
          parentId: null,
          items,
          modelBuilder,
        });
      } else if (placement.item.kind === "vertical-space") {
        const item = placement.item;
        spacing.push({ command: item.node.command, sourceSpan: item.node.span, sizePt: item.height,
          relativeUnitPt: item.relativeUnitPt,
          bounds: { x: availableContentBounds.x, y: frameBlockTop + placement.contentTop,
            width: availableContentBounds.width, height: item.height } });
      } else {
        emitPreparedBlock({
          prepared: placement.item.block,
          x: availableContentBounds.x,
          y: frameBlockTop + placement.contentTop,
          parentId: null,
          items,
          paragraphs,
          modelBuilder,
          theme,
          visibility:
            placement.item.visibility === "hidden" ? "hidden" : "visible",
        });
      }
    }
    const visualTop = Math.min(
      ...positioned.items.map((placement) => placement.visualTop)
    );
    const visualBottom = Math.max(
      ...positioned.items.map((placement) => placement.visualBottom)
    );
    contentBounds = {
      ...availableContentBounds,
      y: frameBlockTop + visualTop,
      height: Math.max(0, visualBottom - visualTop),
    };
  } else if (
    bodyIr.children.some((node) =>
      resolveBeamerOverlaySpanVisibility(bodyIr.overlays, node.span, step) === "visible" &&
      hasProjectedContent(source, node.span, bodyIr.overlays, step, references)
    )
  ) {
    const message = "This Beamer frame body could not be laid out.";
    const placeholder = prepareUnsupportedPlaceholder(
      source,
      { id: `${frame.id}:unsupported-body`, span: frame.bodySpan, message },
      availableContentBounds.width
    );
    emitUnsupportedPlaceholder({
      placeholder,
      x: availableContentBounds.x,
      y: availableContentBounds.y,
      parentId: null,
      items,
      modelBuilder,
    });
    diagnostics.push({
      severity: "warning",
      code: "beamer-render-unsupported-body",
      message,
      span: frame.bodySpan,
    });
  }

  spacing.push(...collectBeamerParagraphSpacing(paragraphs, items));
  const graphics = collectBeamerGraphicsLayout(paragraphs, items);
  const model = modelBuilder.build({
    viewBox: page.page,
    defs: [],
    diagnostics: diagnostics.map((diagnostic) => ({
      code: diagnostic.code ?? "beamer-render",
      message: diagnostic.message,
    })),
  });
  // The body parser labels picture roots with span-local ids; the document
  // root ids (`frame:i:tikzpicture:j`, nested figure addressing) come from
  // the scan model. Rebind each published picture item to the scan child
  // whose begin token it contains.
  for (const item of items) {
    if (item.kind !== "tikzpicture") {
      continue;
    }
    const child = frame.children.find(
      (candidate) =>
        item.sourceSpan.from <= candidate.beginSpan.from &&
        candidate.beginSpan.to <= item.sourceSpan.to
    );
    item.rootId = child?.id;
  }
  const layout: BeamerFrameLayout = {
    coordinateSystem: {
      unit: "tex-pt",
      origin: "top-left",
      yAxis: "down",
    },
    frameId: frame.id,
    frameIndex,
    step,
    stepCount,
    page,
    contentBounds,
    items,
    paragraphs,
    graphics,
    spacing,
    embeddedTikz,
    editScopes: collectBeamerEditScopes(
      frame,
      bodyIr,
      document.preamble.metadata
    ),
  };

  params.work?.options.signal?.throwIfAborted();
  return {
    document,
    frame,
    layout,
    svg: {
      svg: serializeSvgModel(model),
      viewBox: model.viewBox,
      model,
      diagnostics: model.diagnostics,
    },
    diagnostics,
  };
}

function collectBeamerGraphicsLayout(
  paragraphs: readonly BeamerParagraphLayout[],
  items: BeamerFrameLayoutItem[]
): BeamerGraphicsLayout[] {
  const paragraphItemById = new Map(
    items
      .filter((item) => item.paragraphId)
      .map((item) => [item.paragraphId!, item])
  );
  const graphics: BeamerGraphicsLayout[] = [];
  for (const paragraph of paragraphs) {
    const paragraphItem = paragraphItemById.get(paragraph.paragraphId);
    for (const placement of paragraph.vlistLayout.graphicsPlacements) {
      const sourceSpan = {
        from: Number(placement.sourceSpan.start),
        to: Number(placement.sourceSpan.end),
      };
      const hidden =
        paragraphItem?.visibility === "hidden" ||
        paragraph.hiddenSourceSpans?.some((span) =>
          span.from <= sourceSpan.from && span.to >= sourceSpan.to
        ) === true;
      const graphic: BeamerGraphicsLayout = {
        itemId: placement.id,
        paragraphId: paragraph.paragraphId,
        lineIndex: placement.lineIndex,
        sourceSpan,
        filenameSpan: {
          from: Number(placement.filenameSpan.start),
          to: Number(placement.filenameSpan.end),
        },
        bounds: {
          x: paragraph.bounds.x + Number(placement.bounds.x),
          y: paragraph.bounds.y + Number(placement.bounds.y),
          width: Number(placement.bounds.width),
          height: Number(placement.bounds.height),
        },
        baselineY: paragraph.bounds.y + Number(placement.baselineY),
        asset: placement.asset,
        options: placement.options,
        caretPolicy: placement.caretPolicy,
        visibility: hidden ? "hidden" : "visible",
        ...(placement.crop
          ? {
              crop: {
                x: Number(placement.crop.x),
                y: Number(placement.crop.y),
                width: Number(placement.crop.width),
                height: Number(placement.crop.height),
                clip: placement.crop.clip,
              },
            }
          : {}),
      };
      graphics.push(graphic);
      items.push({
        id: graphic.itemId,
        kind: "graphics",
        sourceSpan: graphic.sourceSpan,
        bounds: graphic.bounds,
        parentId: paragraph.paragraphId,
        visibility: graphic.visibility,
      });
      if (paragraphItem) {
        paragraphItem.childIds = [
          ...(paragraphItem.childIds ?? []),
          graphic.itemId,
        ];
      }
    }
  }
  return graphics;
}

/**
 * Render every overlay page emitted by one source frame, in Beamer page
 * order. A frame without overlay material yields exactly one page.
 */
export async function renderBeamerFramePages(
  source: string,
  options: RenderBeamerFramePagesOptions = {}
): Promise<RenderBeamerFramePagesResult> {
  return prepareBeamerDocument(source).renderFramePages(options);
}

function renderChrome(params: {
  chrome: BeamerFrameChromePlan;
  theme: ResolvedBeamerTheme;
  items: BeamerFrameLayoutItem[];
  paragraphs: BeamerParagraphLayout[];
  modelBuilder: ReturnType<typeof createSvgModelBuilder>;
  macroBindings: ReadonlyMap<string, MacroBinding>;
  references: BeamerReferenceContext;
  graphicsResolver?: DocumentGraphicsResolver;
  paperWidth: number;
}): void {
  const { chrome, theme, items, paragraphs, modelBuilder } = params;
  for (const primitive of chrome.primitives) {
    if (primitive.kind === "fill") {
      const color = resolveBeamerThemeColor(theme, primitive.colorRole);
      modelBuilder.addPart({
        basePartId: primitive.id,
        sourceId: primitive.id,
        elementId: null,
        markup: rectMarkup(
          primitive.bounds,
          primitive.paint === "foreground"
            ? color.fg ?? color.bg ?? "transparent"
            : color.bg ?? color.fg ?? "transparent",
          primitive.id
        ),
      });
      items.push({
        id: primitive.id,
        kind: primitive.id.includes(":frame-title:")
          ? "frame-title"
          : "background",
        sourceSpan: primitive.sourceSpan,
        bounds: primitive.bounds,
        parentId: null,
      });
      continue;
    }

    if (primitive.kind === "vector") {
      modelBuilder.addPart({
        basePartId: primitive.id,
        sourceId: primitive.id,
        elementId: null,
        markup: vectorTemplateMarkup(primitive, theme),
      });
      items.push({
        id: primitive.id,
        kind: primitive.layoutKind,
        sourceSpan: primitive.sourceSpan,
        bounds: primitive.bounds,
        parentId: null,
      });
      continue;
    }

    const mapped = mappedTemplateText(primitive);
    const font = theme.fonts[primitive.fontRole];
    const laid = layoutParagraph({
      mapped,
      sourceSpan: primitive.sourceSpan,
      paragraphId: primitive.id,
      role: paragraphRole(primitive.fontRole),
      bounds: primitive.bounds,
      font,
      colorResolver: beamerAlertColorResolver(theme),
      alignment: primitive.alignment,
      interwordSpacePt: primitive.interwordSpacePt,
      disableAutomaticHyphenation: primitive.disableAutomaticHyphenation,
      macroBindings: params.macroBindings,
      references: params.references,
      graphicsResolver: params.graphicsResolver,
      paperWidth: params.paperWidth,
    });
    if (!laid) {
      continue;
    }
    const y = primitive.baselineY == null
      ? verticallyAlignedParagraphY(primitive, laid.height)
      : primitive.baselineY - firstLineBaselineOffset(laid);
    positionParagraphLayout(
      laid.layout,
      svgPoint(pt(primitive.bounds.x), pt(y))
    );
    paragraphs.push(laid.layout);
    items.push({
      id: primitive.id,
      kind: primitive.id.includes(":frame-title:")
        ? "frame-title"
        : "text",
      sourceSpan: primitive.sourceSpan,
      bounds: laid.layout.bounds,
      parentId: null,
      paragraphId: primitive.id,
    });
    modelBuilder.addPart({
      basePartId: primitive.id,
      sourceId: primitive.id,
      elementId: null,
      markup: paragraphMarkup(
        laid.svgBody,
        primitive.bounds.x,
        y,
        textColor(theme, primitive.colorRole)
      ),
    });
  }
}

function verticallyAlignedParagraphY(
  primitive: Extract<BeamerTemplatePrimitive, { kind: "text" }>,
  paragraphHeight: number
): number {
  const freeHeight = Math.max(0, primitive.bounds.height - paragraphHeight);
  return primitive.bounds.y +
    (primitive.verticalAlignment === "bottom"
      ? freeHeight
      : primitive.verticalAlignment === "center"
        ? freeHeight / 2
        : 0);
}

function firstLineBaselineOffset(paragraph: LaidParagraph): number {
  const firstLine = paragraph.layout.report.lines[0];
  if (!firstLine) {
    return 0;
  }
  const placement = paragraph.layout.vlistLayout.linePlacements.find(
    (candidate) => candidate.lineIndex === firstLine.lineIndex
  );
  return Number(placement?.y ?? 0) + Number(firstLine.ascent);
}

async function prepareFrameFlow(params: {
  source: string;
  children: readonly BeamerFrameBodyNode[];
  textWidth: number;
  paperWidth: number;
  leftSidebarWidth: number;
  availableHeight: number;
  diagnostics: Diagnostic[];
  theme: ResolvedBeamerTheme;
  metadata: Partial<
    Record<BeamerMetadataFieldName, BeamerMetadataFieldModel>
  >;
  macroBindings: ReadonlyMap<string, MacroBinding>;
  references: BeamerReferenceContext;
  overlays: BeamerOverlayModel;
  step: number;
  graphicsResolver?: DocumentGraphicsResolver;
  work?: BeamerRenderWork;
}): Promise<PreparedFrameFlowItem[]> {
  const result: PreparedFrameFlowItem[] = [];
  const bodyFont = params.theme.fonts["normal-text"];
  const listProfile = beamerListLayoutProfile(params.theme);
  for (const node of params.children) {
    if (params.work) await params.work.checkpoint();
    const visibility = resolveBeamerOverlaySpanVisibility(
      params.overlays,
      node.span,
      params.step
    );
    if (visibility === "removed") {
      continue;
    }
    if (node.kind === "title-page") {
      result.push({
        kind: "title-page",
        visibility,
        titlePage: runBeamerRenderOperation(params.work, () => prepareTitlePage({
          node,
          width: params.textWidth,
          theme: params.theme,
          metadata: params.metadata,
          macroBindings: params.macroBindings,
          references: params.references,
          graphicsResolver: params.graphicsResolver,
          paperWidth: params.paperWidth,
        })),
      });
      continue;
    }
    if (node.kind === "paragraph") {
      const paragraph = runBeamerRenderOperation(params.work, () => prepareFrameParagraph({
        source: params.source,
        node,
        textWidth: params.textWidth,
        bodyFont,
        listProfile,
        macroBindings: params.macroBindings,
        references: params.references,
        overlays: params.overlays,
        step: params.step,
        graphicsResolver: params.graphicsResolver,
        colorResolver: beamerAlertColorResolver(params.theme),
        paperWidth: params.paperWidth,
      }));
      if (paragraph) {
        result.push(paragraph);
      } else if (hasProjectedContent(params.source, node.span, params.overlays, params.step, params.references)) {
        const placeholder = prepareUnsupportedPlaceholder(
          params.source,
          { ...node, message: "This content could not be laid out." },
          params.textWidth
        );
        result.push({
          kind: "unsupported",
          visibility,
          placeholder,
          height: placeholder.height,
        });
        params.diagnostics.push({
          severity: "warning",
          code: "beamer-render-unsupported-flow-node",
          message: placeholder.message,
          span: node.span,
        });
      }
      continue;
    }
    if (node.kind === "vertical-space") {
      result.push({
        kind: "vertical-space",
        visibility,
        node,
        ...measureVerticalSpace(node, bodyFont),
      });
      continue;
    }
    if (node.kind === "columns") {
      if (node.columns.length === 0) {
        params.diagnostics.push({
          severity: "warning",
          code: "beamer-render-empty-columns",
          message: "The columns environment has no renderable columns.",
          span: node.span,
        });
        continue;
      }
      // Retain the existing asynchronous column schedule, including warnings
      // produced before an earlier column's embedded picture completes. Each
      // column shares the frame budget and checks the same cancellation signal.
      const columns = await Promise.all(node.columns.map(column => prepareColumnContent({
        source: params.source,
        column,
        textWidth: params.textWidth,
        diagnostics: params.diagnostics,
        theme: params.theme,
        macroBindings: params.macroBindings,
        references: params.references,
        leftSidebarWidth: params.leftSidebarWidth,
        overlays: params.overlays,
        step: params.step,
        graphicsResolver: params.graphicsResolver,
        paperWidth: params.paperWidth,
        work: params.work,
      })));
      result.push({
        kind: "columns",
        visibility,
        node,
        columns,
        box: {
          height: Math.max(0, ...columns.map((column) => column.box.height)),
          depth: Math.max(0, ...columns.map((column) => column.box.depth)),
        },
      });
      continue;
    }
    if (node.kind === "tikzpicture") {
      const tikz = await prepareEmbeddedTikz({
        source: params.source,
        node,
        width: params.textWidth,
        bodyFont,
        diagnostics: params.diagnostics,
        visibility,
        graphicsResolver: params.graphicsResolver,
        work: params.work,
      });
      if (tikz) {
        const surroundingGlue = node.horizontalAlignment === "center"
          ? {
              top: BEAMER_CENTER_TOPSEP,
              bottom: BEAMER_CENTER_TOPSEP,
            }
          : {
              top: { naturalPt: 0, shrinkPt: 0 },
              bottom: { naturalPt: 0, shrinkPt: 0 },
            };
        const centerSkip = surroundingGlue.top.naturalPt;
        result.push({
          kind: "tikzpicture",
          visibility,
          node,
          tikz,
          naturalHeight:
            tikz.height +
            surroundingGlue.top.naturalPt +
            surroundingGlue.bottom.naturalPt,
          boxHeight: tikz.height + centerSkip,
          contentInsetTop: centerSkip,
          endingDepth: 0,
          surroundingGlue,
        });
      }
      continue;
    }
    if (node.kind === "block" || node.kind === "theorem") {
      const block = runBeamerRenderOperation(params.work, () => prepareBlock({
        source: params.source,
        node,
        width: params.textWidth,
        leftSidebarWidth: params.leftSidebarWidth,
        theme: params.theme,
        macroBindings: params.macroBindings,
        references: params.references,
        overlays: params.overlays,
        step: params.step,
        graphicsResolver: params.graphicsResolver,
        paperWidth: params.paperWidth,
      }));
      if (block) {
        result.push({
          kind: "block",
          visibility,
          node,
          block,
          naturalHeight: block.naturalHeight,
          boxHeight: block.flowBoxHeight,
          endingDepth: block.endingDepth,
        });
      }
      continue;
    }
    params.diagnostics.push({
      severity: "warning",
      code: "beamer-render-unsupported-flow-node",
      message: node.message,
      span: node.span,
    });
    const placeholder = prepareUnsupportedPlaceholder(params.source, node, params.textWidth);
    result.push({
      kind: "unsupported",
      visibility,
      placeholder,
      height: placeholder.height,
    });
  }
  return shrinkFrameParagraphGlueToAvailableHeight(result, {
    source: params.source,
    textWidth: params.textWidth,
    availableHeight: params.availableHeight,
    bodyFont,
    listProfile,
    macroBindings: params.macroBindings,
    references: params.references,
    overlays: params.overlays,
    step: params.step,
    graphicsResolver: params.graphicsResolver,
    colorResolver: beamerAlertColorResolver(params.theme),
    paperWidth: params.paperWidth,
    work: params.work,
  });
}

function prepareTitlePage(params: {
  node: BeamerTitlePageBodyNode;
  width: number;
  theme: ResolvedBeamerTheme;
  metadata: Partial<
    Record<BeamerMetadataFieldName, BeamerMetadataFieldModel>
  >;
  macroBindings: ReadonlyMap<string, MacroBinding>;
  references: BeamerReferenceContext;
  graphicsResolver?: DocumentGraphicsResolver;
  paperWidth: number;
}): PreparedTitlePage {
  const hasSubtitle = params.metadata.subtitle?.value != null;
  const plan = planBeamerTitlePageTemplate(params.theme, hasSubtitle);
  const alignment = plan.style === "inmargin" ? "left" : "center";
  const titleSource = params.metadata.title?.value;
  const subtitleSource = params.metadata.subtitle?.value;
  const title = titleSource
    ? layoutParagraph({
        mapped: createIdentityMappedText(
          titleSource.value,
          titleSource.contentSpan.from
        ),
        sourceSpan: titleSource.contentSpan,
        paragraphId: `${params.node.id}:title`,
        role: "title",
        bounds: { x: 0, y: 0, width: params.width, height: 0 },
        font: params.theme.fonts.title,
        colorResolver: beamerAlertColorResolver(params.theme),
        alignment,
        macroBindings: params.macroBindings,
        references: params.references,
        graphicsResolver: params.graphicsResolver,
        paperWidth: params.paperWidth,
      })
    : null;
  const subtitle = subtitleSource
    ? layoutParagraph({
        mapped: createIdentityMappedText(
          subtitleSource.value,
          subtitleSource.contentSpan.from
        ),
        sourceSpan: subtitleSource.contentSpan,
        paragraphId: `${params.node.id}:subtitle`,
        role: "subtitle",
        bounds: { x: 0, y: 0, width: params.width, height: 0 },
        font: params.theme.fonts.subtitle,
        colorResolver: beamerAlertColorResolver(params.theme),
        alignment,
        macroBindings: params.macroBindings,
        references: params.references,
        graphicsResolver: params.graphicsResolver,
        paperWidth: params.paperWidth,
      })
    : null;
  if (plan.style === "inmargin") {
    const finalParagraph = subtitle ?? title;
    const naturalHeight =
      plan.titleBoxTopPt +
      (subtitle
        ? plan.subtitleBaselineFromBoxTopPt
        : plan.titleBaselineFromBoxTopPt) +
      (finalParagraph ? paragraphLastLineDepth(finalParagraph) : 0) +
      3;
    return {
      node: params.node,
      plan,
      width: params.width,
      title,
      subtitle,
      metadataBoxes: [],
      naturalHeight,
      // Unlike the default title-page template, inmargin has no leading
      // \vfill and retains one fill after the title group.
      leadingFillWeight: 0,
      trailingFillWeight: 1,
    };
  }
  // The default template stacks author/institute/date colorboxes below the
  // title box. Each is a sep=8pt colorbox (16pt when empty), separated by
  // TeX \lineskip since the boxes exceed the baselineskip window.
  const metadataBoxes: PreparedTitlePageMetadataBox[] = [];
  let metadataTop =
    plan.titleBoxTopPt +
    plan.titleBoxHeightPt +
    BEAMER_TITLE_TEMPLATE_AFTER_TITLE_PT;
  for (const field of ["author", "institute", "date"] as const) {
    metadataTop += BEAMER_TITLE_TEMPLATE_INTERBOX_PT;
    const fieldSource = params.metadata[field]?.value;
    const paragraph = fieldSource
      ? layoutParagraph({
          mapped: createIdentityMappedText(
            fieldSource.value,
            fieldSource.contentSpan.from
          ),
          sourceSpan: fieldSource.contentSpan,
          paragraphId: `${params.node.id}:${field}`,
          role: field,
          bounds: { x: 0, y: 0, width: params.width, height: 0 },
          font: params.theme.fonts[field],
          colorResolver: beamerAlertColorResolver(params.theme),
          alignment,
          macroBindings: params.macroBindings,
          references: params.references,
          graphicsResolver: params.graphicsResolver,
          paperWidth: params.paperWidth,
        })
      : null;
    const heightPt =
      BEAMER_EMPTY_METADATA_COLORBOX_PT +
      (paragraph ? paragraphLineExtent(paragraph) : 0);
    metadataBoxes.push({ field, paragraph, topPt: metadataTop, heightPt });
    metadataTop += heightPt;
  }
  const naturalHeight =
    metadataTop + BEAMER_TITLE_TEMPLATE_GRAPHIC_SKIP_PT;
  return {
    node: params.node,
    plan,
    width: params.width,
    title,
    subtitle,
    metadataBoxes,
    naturalHeight,
    leadingFillWeight: 1,
    trailingFillWeight: 1,
  };
}

function prepareFrameParagraph(params: {
  source: string;
  node: BeamerParagraphBodyNode;
  textWidth: number;
  bodyFont: BeamerThemeFont;
  listProfile: TexListLayoutProfile;
  macroBindings: ReadonlyMap<string, MacroBinding>;
  references: BeamerReferenceContext;
  overlays: BeamerOverlayModel;
  step: number;
  targetHeight?: number;
  graphicsResolver?: DocumentGraphicsResolver;
  colorResolver?: NodeTextColorResolver;
  paperWidth: number;
}): Extract<PreparedFrameFlowItem, { kind: "paragraph" }> | null {
  const paragraphSource = params.source.slice(
    params.node.span.from,
    params.node.span.to
  );
  const projection = projectBeamerOverlayText(
    createIdentityMappedText(
      paragraphSource,
      params.node.span.from
    ),
    params.node.span,
    params.overlays,
    params.step
  );
  const paragraph = layoutParagraph({
    mapped: projection.mapped,
    sourceSpan: params.node.span,
    paragraphId: params.node.id,
    role: "body",
    bounds: { x: 0, y: 0, width: params.textWidth, height: 0 },
    font: params.bodyFont,
    colorResolver: params.colorResolver,
    alignment: "left",
    listProfile: params.listProfile,
    macroBindings: params.macroBindings,
    references: params.references,
    targetHeight: params.targetHeight,
    hiddenSourceSpans: projection.hiddenSourceSpans,
    hiddenListItemIndices: projection.hiddenListItemIndices,
    graphicsResolver: params.graphicsResolver,
    paperWidth: params.paperWidth,
  });
  if (!paragraph) {
    return null;
  }
  const projectedSource = projection.mapped.text;
  const trailingTrivlistSkip = trailingBeamerTrivlistSkip(projectedSource);
  const trailingListSkip = trailingBeamerListSkip(projectedSource);
  const trailingListShrink = trailingListSkip > 0
    ? BEAMER_LIST_LAYOUT_PROFILE.topsepShrinkPtByDepth?.[0] ?? 0
    : 0;
  const namedSize = activeBeamerNamedSize(projectedSource);
  return {
    kind: "paragraph",
    visibility: resolveBeamerOverlaySpanVisibility(
      params.overlays,
      params.node.span,
      params.step
    ),
    node: params.node,
    paragraph,
    naturalHeight:
      paragraph.height + trailingTrivlistSkip + trailingListSkip,
    boxHeight: paragraphStartingMaterialHeight(paragraph),
    startingBaselineSkip:
      namedSize?.lineHeightPt ?? params.bodyFont.lineHeightPt,
    leadingAdjustment: leadingBeamerTrivlistAdjustment(
      paragraphSource,
      paragraph
    ),
    endingDepth: paragraphEndingMaterialDepth(paragraph),
    trailingListGlue: {
      naturalPt: trailingListSkip,
      shrinkPt: trailingListShrink,
    },
    trailingVerticalSpacePreviousDepth:
      previousDepthBeforeTrailingVerticalSpace(paragraph),
  };
}

async function shrinkFrameParagraphGlueToAvailableHeight(
  flow: readonly PreparedFrameFlowItem[],
  params: {
    source: string;
    textWidth: number;
    availableHeight: number;
    bodyFont: BeamerThemeFont;
    listProfile: TexListLayoutProfile;
    macroBindings: ReadonlyMap<string, MacroBinding>;
    references: BeamerReferenceContext;
    overlays: BeamerOverlayModel;
    step: number;
    graphicsResolver?: DocumentGraphicsResolver;
    colorResolver?: NodeTextColorResolver;
    paperWidth: number;
    work?: BeamerRenderWork;
  }
): Promise<PreparedFrameFlowItem[]> {
  const fitted = [...flow];
  for (let index = 0; index < fitted.length; index += 1) {
    if (params.work) await params.work.checkpoint();
    const item = fitted[index];
    const next = fitted[index + 1];
    if (item?.kind !== "paragraph" || next?.kind !== "tikzpicture") {
      continue;
    }
    fitted[index] = cancelTrailingDisplayGlueBeforeCenteredTikz(
      item,
      next
    );
    fitted[index + 1] = suppressCenteredTikzTopGlueAfterNormalDisplay(
      item,
      next
    );
  }
  // beamerbaseframesize.sty packs the assembled frame into
  // `\vbox to\textheight`. If the material is overfull, ordinary-order glue
  // inside the frame body (notably display skips) receives the box's shrink
  // setting. Our frame flow keeps source-contiguous prose in a reusable VList,
  // so re-run those VLists against the remaining frame height.
  const overflow = Math.max(
    0,
    positionPreparedFrameFlow(
      fitted,
      params.bodyFont.lineHeightPt
    ).extent - params.availableHeight
  );
  if (overflow === 0) {
    return fitted;
  }
  const shrinkable: Array<{
    index: number;
    item: Extract<PreparedFrameFlowItem, { kind: "paragraph" }>;
    maximumShrink: number;
    paragraphMaximumShrink: number;
  }> = [];
  for (let index = 0; index < fitted.length; index += 1) {
    if (params.work) await params.work.checkpoint();
    const item = fitted[index];
    if (item?.kind !== "paragraph") {
      continue;
    }
    const rawFullyShrunk = runBeamerRenderOperation(params.work, () => prepareFrameParagraph({
      ...params,
      node: item.node,
      targetHeight: 0,
    }));
    if (!rawFullyShrunk) {
      continue;
    }
    const fullyShrunk = cancelTrailingDisplayGlueBeforeCenteredTikz(
      rawFullyShrunk,
      fitted[index + 1]
    );
    shrinkable.push({
      index,
      item,
      maximumShrink: Math.max(
        0,
        item.naturalHeight - fullyShrunk.naturalHeight
      ) + item.trailingListGlue.shrinkPt,
      paragraphMaximumShrink: Math.max(
        0,
        item.paragraph.height - rawFullyShrunk.paragraph.height
      ),
    });
  }
  const totalShrink = shrinkable.reduce(
    (sum, candidate) => sum + candidate.maximumShrink,
    0
  ) + fitted.reduce(
    (sum, item) =>
      sum +
      (item.kind === "tikzpicture"
        ? item.surroundingGlue.top.shrinkPt +
          item.surroundingGlue.bottom.shrinkPt
        : 0),
    0
  );
  const ratio = totalShrink > 0
    ? Math.min(overflow / totalShrink, 1)
    : 0;
  for (const candidate of shrinkable) {
    if (params.work) await params.work.checkpoint();
    const targetHeight =
      candidate.item.paragraph.height -
      candidate.paragraphMaximumShrink * ratio;
    const rawRelaid = runBeamerRenderOperation(params.work, () => prepareFrameParagraph({
      ...params,
      node: candidate.item.node,
      targetHeight,
    }));
    if (!rawRelaid) {
      continue;
    }
    const relaid = cancelTrailingDisplayGlueBeforeCenteredTikz(
      rawRelaid,
      fitted[candidate.index + 1]
    );
    const index = candidate.index;
    fitted[index] = {
      ...relaid,
      naturalHeight:
        relaid.naturalHeight -
        relaid.trailingListGlue.shrinkPt * ratio,
    };
  }
  for (let index = 0; index < fitted.length; index += 1) {
    const item = fitted[index];
    if (item?.kind !== "tikzpicture") {
      continue;
    }
    const topSkip = Math.max(
      0,
      item.surroundingGlue.top.naturalPt -
        item.surroundingGlue.top.shrinkPt * ratio
    );
    const bottomSkip = Math.max(
      0,
      item.surroundingGlue.bottom.naturalPt -
        item.surroundingGlue.bottom.shrinkPt * ratio
    );
    fitted[index] = {
      ...item,
      naturalHeight: item.tikz.height + topSkip + bottomSkip,
      boxHeight: item.tikz.height + topSkip,
      contentInsetTop: topSkip,
    };
  }
  return fitted;
}

function cancelTrailingDisplayGlueBeforeCenteredTikz(
  paragraph: Extract<PreparedFrameFlowItem, { kind: "paragraph" }>,
  next: PreparedFrameFlowItem | undefined
): Extract<PreparedFrameFlowItem, { kind: "paragraph" }> {
  if (
    next?.kind !== "tikzpicture" ||
    next.surroundingGlue.bottom.naturalPt === 0
  ) {
    return paragraph;
  }
  const trailing = paragraph.paragraph.layout.vlistLayout.boxReport.items.at(-1);
  if (
    trailing?.itemKind !== "glue" ||
    trailing.glue?.origin?.kind !== "display-math-boundary" ||
    trailing.glue.origin.side !== "below" ||
    trailing.glue.origin.variant !== "short"
  ) {
    return paragraph;
  }
  // LaTeX's center environment is a trivlist. Its opening \addvspace and
  // negative list glues cancel an immediately preceding \belowdisplayskip;
  // the center \topsep remains. Keep the display VList intact for source and
  // box reporting, but omit that canceled terminal glue from the assembled
  // frame extent. Applying this at every trial height also removes the
  // canceled glue's shrink capacity from the enclosing frame vbox.
  return {
    ...paragraph,
    naturalHeight: Math.max(0, paragraph.naturalHeight - trailing.height),
  };
}

function suppressCenteredTikzTopGlueAfterNormalDisplay(
  paragraph: Extract<PreparedFrameFlowItem, { kind: "paragraph" }>,
  tikz: Extract<PreparedFrameFlowItem, { kind: "tikzpicture" }>
): Extract<PreparedFrameFlowItem, { kind: "tikzpicture" }> {
  if (tikz.surroundingGlue.top.naturalPt === 0) {
    return tikz;
  }
  const trailing = paragraph.paragraph.layout.vlistLayout.boxReport.items.at(-1);
  if (
    trailing?.itemKind !== "glue" ||
    trailing.glue?.origin?.kind !== "display-math-boundary" ||
    trailing.glue.origin.side !== "below" ||
    trailing.glue.origin.variant === "short"
  ) {
    return tikz;
  }
  // When the normal \belowdisplayskip is larger than center's \topsep,
  // LaTeX's opening \addvspace keeps the display skip and contributes no
  // separate top glue. The closing topsep remains below the environment.
  return {
    ...tikz,
    naturalHeight:
      tikz.naturalHeight - tikz.surroundingGlue.top.naturalPt,
    boxHeight: tikz.boxHeight - tikz.surroundingGlue.top.naturalPt,
    contentInsetTop: 0,
    surroundingGlue: {
      ...tikz.surroundingGlue,
      top: { naturalPt: 0, shrinkPt: 0 },
    },
  };
}

function prepareBlock(params: {
  source: string;
  node: BeamerBlockBodyNode | BeamerTheoremBodyNode;
  width: number;
  leftSidebarWidth: number;
  theme: ResolvedBeamerTheme;
  macroBindings: ReadonlyMap<string, MacroBinding>;
  references: BeamerReferenceContext;
  overlays: BeamerOverlayModel;
  step: number;
  graphicsResolver?: DocumentGraphicsResolver;
  paperWidth: number;
}): PreparedBlock | null {
  const plan = planBeamerBlockTemplate({
    environment: params.node.kind === "theorem"
      ? params.node.blockEnvironment
      : params.node.environment,
    theme: params.theme,
  });
  const titleFont = params.theme.fonts[plan.titleFontRole];
  const theoremTitleFont =
    params.node.kind === "theorem" &&
    params.node.theoremTemplate === "ams-style"
      ? params.node.theoremStyle === "remark"
        ? { ...titleFont, shape: "italic" as const }
        : { ...titleFont, series: "bold" as const }
      : titleFont;
  const blockTitleLayoutFont = plan.style === "inmargin"
    ? {
        ...theoremTitleFont,
        // The title vtop is opened in \normalsize; the starred Beamer font
        // switch changes the glyph face/size without replacing that vtop's
        // normal-text baseline grid.
        lineHeightPt: params.theme.fonts["normal-text"].lineHeightPt,
      }
    : theoremTitleFont;
  const normalXHeight = fontXHeightPt(params.theme.fonts["normal-text"]);
  const inMarginTitleWidth = Math.max(
    0,
    params.leftSidebarWidth - 3 * normalXHeight
  );
  const titleProjection = params.node.kind === "theorem"
    ? {
        mapped: params.node.titleMapped,
        hiddenSourceSpans: [],
        hiddenListItemIndices: [],
      }
    : projectBeamerOverlayText(
        createIdentityMappedText(
          params.node.title.value,
          params.node.title.contentSpan.from
        ),
        params.node.title.contentSpan,
        params.overlays,
        params.step
      );
  const title = layoutParagraph({
    mapped: titleProjection.mapped,
    sourceSpan: params.node.title.contentSpan,
    paragraphId: `${params.node.id}:title`,
    role: "block-title",
    bounds: {
      x: 0,
      y: 0,
      width: plan.style === "inmargin"
        ? inMarginTitleWidth
        : params.width,
      height: 0,
    },
    font: blockTitleLayoutFont,
    colorResolver: beamerAlertColorResolver(params.theme),
    alignment: plan.style === "inmargin" ? "right" : "left",
    disableAutomaticHyphenation: plan.style === "inmargin",
    macroBindings: params.macroBindings,
    references: params.references,
    hiddenSourceSpans: titleProjection.hiddenSourceSpans,
    graphicsResolver: params.graphicsResolver,
    paperWidth: params.paperWidth,
    textWidth: params.width,
    columnWidth: params.width,
  });
  if (!title) {
    return null;
  }
  const bodyNode = params.node.children.find(
    (node): node is BeamerParagraphBodyNode => node.kind === "paragraph"
  );
  const bodyProjection = bodyNode
    ? projectBeamerOverlayText(
        createIdentityMappedText(
          params.source.slice(bodyNode.span.from, bodyNode.span.to),
          bodyNode.span.from
        ),
        bodyNode.span,
        params.overlays,
        params.step
      )
    : null;
  const theoremBodyFont =
    params.node.kind === "theorem" &&
    params.node.theoremStyle === "plain" &&
    params.node.theoremTemplate !== "normal-font"
      ? {
          ...params.theme.fonts[plan.bodyFontRole],
          shape: "italic" as const,
        }
      : params.theme.fonts[plan.bodyFontRole];
  const body = bodyNode && bodyProjection
    ? layoutParagraph({
        mapped: bodyProjection.mapped,
        sourceSpan: bodyNode.span,
        paragraphId: `${params.node.id}:body`,
        role: "block-body",
        bounds: { x: 0, y: 0, width: params.width, height: 0 },
        font: theoremBodyFont,
        mathFont: params.theme.fonts[plan.bodyFontRole],
        colorResolver: beamerAlertColorResolver(params.theme),
        alignment: "left",
        disableAutomaticHyphenation: true,
        // Lists inside blocks use the same theme templates (margins,
        // markers) as frame-level lists.
        listProfile: beamerListLayoutProfile(params.theme),
        macroBindings: params.macroBindings,
        references: params.references,
        hiddenSourceSpans: bodyProjection.hiddenSourceSpans,
        hiddenListItemIndices: bodyProjection.hiddenListItemIndices,
        graphicsResolver: params.graphicsResolver,
        paperWidth: params.paperWidth,
      })
    : null;
  const titleLine = title.layout.report.lines[0];
  const titleAscent = Number(titleLine?.ascent ?? firstLineBaselineOffset(title));
  const titleDepth = Number(titleLine?.descent ?? 0);
  const geometry = plan.geometry;
  if (plan.style === "inmargin") {
    const titleFirstBaseline = firstLineBaselineOffset(title);
    const bodyFirstBaseline = body ? firstLineBaselineOffset(body) : 0;
    const hboxHeight = Math.max(titleFirstBaseline, bodyFirstBaseline);
    const titleTop =
      geometry.beforeSkipPt + hboxHeight - titleFirstBaseline;
    const bodyParagraphTop =
      geometry.beforeSkipPt + hboxHeight - bodyFirstBaseline;
    const bodyExtent = body ? paragraphLineExtent(body) : 0;
    const contentBottom = Math.max(
      titleTop + paragraphLineExtent(title),
      bodyParagraphTop + bodyExtent
    );
    const naturalHeight =
      contentBottom +
      geometry.boxBottomSkipPt;
    const referenceY = geometry.beforeSkipPt + hboxHeight;
    return {
      node: params.node,
      plan,
      width: params.width,
      title,
      body,
      titleXOffset:
        -params.leftSidebarWidth + 0.5 * normalXHeight,
      titleTop,
      titleAscent,
      titleDepth,
      titleBackgroundHeight: 0,
      bodyBackgroundTop: bodyParagraphTop,
      bodyParagraphTop,
      bodyBackgroundHeight: 0,
      backgroundTop: bodyParagraphTop,
      backgroundBottom: naturalHeight,
      naturalHeight,
      flowBoxHeight: hboxHeight,
      // The closing \smallskip does not clear TeX's \prevdepth: it remains
      // the depth of the hbox containing the two vtops.
      endingDepth: Math.max(0, contentBottom - referenceY),
    };
  }
  const backgroundTop =
    geometry.beforeSkipPt +
    Math.max(0, geometry.outerBleedPt - geometry.roundedTopInsetPt);
  const titleBackgroundHeight =
    titleAscent +
    Math.max(titleDepth, geometry.titleDepthFloorPt) +
    geometry.titleExtraHeightPt;
  const bodyBackgroundTop =
    backgroundTop +
    titleBackgroundHeight +
    geometry.transitionHeightPt;
  const titleBoxExtent =
    titleAscent + Math.max(titleDepth, geometry.titleDepthFloorPt);
  const bodyBaselineInset =
    body && geometry.bodyFirstBaselineSkipPt != null
      ? geometry.bodyFirstBaselineSkipPt +
        geometry.bodyInitialVSkipEx *
          fontXHeightPt(params.theme.fonts[plan.bodyFontRole]) -
        firstLineBaselineOffset(body)
      : geometry.bodyTopPaddingPt;
  const bodyParagraphTop =
    geometry.beforeSkipPt +
    geometry.boxTopSkipPt +
    titleBoxExtent +
    geometry.titleBodyGapPt +
    bodyBaselineInset;
  const bodyExtent = body ? paragraphLineExtent(body) : 0;
  const bodyBackgroundHeight =
    bodyBaselineInset +
    bodyExtent +
    geometry.bodyExtraHeightPt;
  const backgroundBottom = bodyBackgroundTop + bodyBackgroundHeight;
  const naturalHeight =
    bodyParagraphTop +
    bodyExtent +
    geometry.bodyBottomRaisePt +
    geometry.boxBottomSkipPt;
  return {
    node: params.node,
    plan,
    width: params.width,
    title,
    body,
    titleXOffset: 0,
    titleTop: backgroundTop + geometry.roundedTopInsetPt,
    titleAscent,
    titleDepth,
    titleBackgroundHeight,
    bodyBackgroundTop,
    bodyParagraphTop,
    bodyBackgroundHeight,
    backgroundTop,
    backgroundBottom,
    naturalHeight,
    flowBoxHeight:
      geometry.flowBoxHeight === "title-ascent"
        ? titleAscent
        : naturalHeight,
    endingDepth:
      geometry.flowEndingDepth === "body-last-line" && body
        ? paragraphLastLineDepth(body)
        : 0,
  };
}

function emitPreparedBlock(params: {
  prepared: PreparedBlock;
  x: number;
  y: number;
  parentId: string | null;
  items: BeamerFrameLayoutItem[];
  paragraphs: BeamerParagraphLayout[];
  modelBuilder: ReturnType<typeof createSvgModelBuilder>;
  theme: ResolvedBeamerTheme;
  visibility?: "visible" | "hidden";
}): void {
  const block = params.prepared;
  const geometry = block.plan.geometry;
  const outerBounds = {
    x: params.x - geometry.outerBleedPt,
    y: params.y + block.backgroundTop,
    width: block.width + 2 * geometry.outerBleedPt,
    height:
      block.backgroundBottom -
      block.backgroundTop +
      geometry.shadowExtentPt,
  };
  const titleColor = resolveBeamerThemeColor(
    params.theme,
    block.plan.titleColorRole
  );
  const bodyColor = resolveBeamerThemeColor(
    params.theme,
    block.plan.bodyColorRole
  );
  if (block.plan.style === "default" && titleColor.bg) {
    params.items.push({
      id: `${block.node.id}:title:background`,
      kind: "background",
      sourceSpan: block.node.title.span,
      bounds: {
        x: outerBounds.x,
        y: params.y + block.backgroundTop,
        width: outerBounds.width,
        height: block.titleBackgroundHeight,
      },
      parentId: block.node.id,
      visibility: params.visibility,
    });
  }
  if (block.plan.style === "default" && bodyColor.bg) {
    params.items.push({
      id: `${block.node.id}:body:background`,
      kind: "background",
      sourceSpan: block.node.span,
      bounds: {
        x: outerBounds.x,
        y: params.y + block.bodyBackgroundTop,
        width: outerBounds.width,
        height: block.bodyBackgroundHeight,
      },
      parentId: block.node.id,
      visibility: params.visibility,
    });
  }
  params.modelBuilder.addPart({
    basePartId: `${block.node.id}:chrome`,
    sourceId: block.node.id,
    elementId: null,
    markup: overlayVisibilityMarkup(
      blockChromeMarkup({
        block,
        x: params.x,
        y: params.y,
        titleFill: titleColor.bg ?? "transparent",
        bodyFill: bodyColor.bg ?? "transparent",
      }),
      params.visibility
    ),
  });

  const titleX = params.x + block.titleXOffset;
  const titleY = params.y + block.titleTop;
  if (params.visibility === "hidden") {
    block.title.layout.hiddenSourceSpans = [block.node.span];
  }
  positionParagraphLayout(
    block.title.layout,
    svgPoint(pt(titleX), pt(titleY))
  );
  params.paragraphs.push(block.title.layout);
  params.items.push({
    id: block.title.layout.paragraphId,
    kind: "text",
    sourceSpan: block.title.layout.sourceSpan,
    bounds: block.title.layout.bounds,
    parentId: block.node.id,
    paragraphId: block.title.layout.paragraphId,
    visibility: params.visibility,
  });
  params.modelBuilder.addPart({
    basePartId: block.title.layout.paragraphId,
    sourceId: block.title.layout.paragraphId,
    elementId: null,
    markup: overlayVisibilityMarkup(
      paragraphMarkup(
        block.title.svgBody,
        titleX,
        titleY,
        titleColor.fg ?? textColor(params.theme, "normal text")
      ),
      params.visibility
    ),
  });

  const childIds = [block.title.layout.paragraphId];
  if (block.body) {
    const bodyY = params.y + block.bodyParagraphTop;
    if (params.visibility === "hidden") {
      block.body.layout.hiddenSourceSpans = [block.node.span];
    }
    positionParagraphLayout(
      block.body.layout,
      svgPoint(pt(params.x), pt(bodyY)),
      paragraphLineExtent(block.body)
    );
    params.paragraphs.push(block.body.layout);
    childIds.push(block.body.layout.paragraphId);
    params.items.push({
      id: block.body.layout.paragraphId,
      kind: "text",
      sourceSpan: block.body.layout.sourceSpan,
      bounds: block.body.layout.bounds,
      parentId: block.node.id,
      paragraphId: block.body.layout.paragraphId,
      visibility: params.visibility,
    });
    for (const marker of block.body.listMarkers) {
      params.items.push({
        id: marker.id,
        kind: "list-marker",
        sourceSpan: marker.sourceSpan ?? block.body.layout.sourceSpan,
        bounds: {
          x: params.x + marker.bounds.x,
          y: bodyY + marker.bounds.y,
          width: marker.bounds.width,
          height: marker.bounds.height,
        },
        parentId: block.body.layout.paragraphId,
        traceAsGlyph: marker.traceAsGlyph,
        visibility: params.visibility === "hidden" ? "hidden" : marker.visibility,
      });
    }
    params.modelBuilder.addPart({
      basePartId: block.body.layout.paragraphId,
      sourceId: block.body.layout.paragraphId,
      elementId: null,
      markup: overlayVisibilityMarkup(
        paragraphMarkup(
          block.body.svgBody,
          params.x,
          bodyY,
          bodyColor.fg ?? textColor(params.theme, "normal text")
        ),
        params.visibility
      ),
    });
    if (block.node.kind === "theorem" && block.node.qed) {
      const qedRects = proofQedRectangles({
        block,
        bodyY,
        x: params.x,
        fontSizePt: params.theme.fonts[block.plan.bodyFontRole].sizePt,
      });
      const qedColor =
        resolveBeamerThemeColor(params.theme, "qed symbol").fg ??
        textColor(params.theme, "normal text");
      for (const [index, bounds] of qedRects.entries()) {
        const id = `${block.node.id}:qed:${index}:background`;
        childIds.push(id);
        params.items.push({
          id,
          kind: "background",
          sourceSpan: block.node.endSpan,
          bounds,
          parentId: block.node.id,
          visibility: params.visibility,
        });
      }
      params.modelBuilder.addPart({
        basePartId: `${block.node.id}:qed`,
        sourceId: block.node.id,
        elementId: null,
        markup: overlayVisibilityMarkup(
          qedRects.map((bounds) => rectMarkup(bounds, qedColor)).join(""),
          params.visibility
        ),
      });
    }
  }

  params.items.push({
    id: block.node.id,
    kind: "block",
    sourceSpan: block.node.span,
    bounds: outerBounds,
    parentId: params.parentId,
    childIds,
    visibility: params.visibility,
  });
}

function overlayVisibilityMarkup(
  markup: string,
  visibility: "visible" | "hidden" | undefined
): string {
  return visibility === "hidden"
    ? `<g visibility="hidden">${markup}</g>`
    : markup;
}

function proofQedRectangles(params: {
  block: PreparedBlock;
  bodyY: number;
  x: number;
  fontSizePt: number;
}): BeamerRect[] {
  const body = params.block.body;
  if (!body) {
    return [];
  }
  const lastLine = body?.layout.report.lines.at(-1);
  const placement = lastLine
    ? body.layout.vlistLayout.linePlacements.find(
        (candidate) => candidate.lineIndex === lastLine.lineIndex
      )
    : null;
  const baselineY =
    params.bodyY +
    Number(placement?.y ?? 0) +
    Number(lastLine?.ascent ?? 0);
  const rulePt = 0.4;
  const symbolHeight = 0.675 * params.fontSizePt;
  const innerWidth = 0.6 * params.fontSizePt;
  const symbolBoxWidth = 0.77778 * params.fontSizePt;
  const left = params.x + params.block.width - symbolBoxWidth +
    (symbolBoxWidth - innerWidth - 2 * rulePt) / 2;
  const innerLeft = left + rulePt;
  const right = innerLeft + innerWidth;
  const top = baselineY - symbolHeight;
  return [
    { x: left, y: top, width: rulePt, height: symbolHeight },
    { x: innerLeft, y: top, width: innerWidth, height: rulePt },
    {
      x: innerLeft,
      y: baselineY - rulePt,
      width: innerWidth,
      height: rulePt,
    },
    { x: right, y: top, width: rulePt, height: symbolHeight },
  ];
}

function blockChromeMarkup(params: {
  block: PreparedBlock;
  x: number;
  y: number;
  titleFill: string;
  bodyFill: string;
}): string {
  const { block } = params;
  if (block.plan.style === "inmargin") {
    return (
      `<g data-beamer-block-template="${escapeAttribute(block.plan.templateId)}" />`
    );
  }
  const geometry = block.plan.geometry;
  const left = params.x - geometry.outerBleedPt;
  const right = params.x + block.width + geometry.outerBleedPt;
  const top = params.y + block.backgroundTop;
  const titleBottom = top + block.titleBackgroundHeight;
  const bodyTop = params.y + block.bodyBackgroundTop;
  const bottom = params.y + block.backgroundBottom;
  const radius = geometry.cornerRadiusPt;
  const gradientId = `${block.node.id}:transition`.replace(
    /[^A-Za-z0-9_-]/gu,
    "-"
  );
  const filterId = `${block.node.id}:shadow`.replace(
    /[^A-Za-z0-9_-]/gu,
    "-"
  );
  const titlePath =
    `M${fmt(left)} ${fmt(titleBottom)}V${fmt(top + radius)}` +
    `Q${fmt(left)} ${fmt(top)} ${fmt(left + radius)} ${fmt(top)}` +
    `H${fmt(right - radius)}` +
    `Q${fmt(right)} ${fmt(top)} ${fmt(right)} ${fmt(top + radius)}` +
    `V${fmt(titleBottom)}Z`;
  const bodyPath =
    `M${fmt(left)} ${fmt(bodyTop)}V${fmt(bottom - radius)}` +
    `Q${fmt(left)} ${fmt(bottom)} ${fmt(left + radius)} ${fmt(bottom)}` +
    `H${fmt(right - radius)}` +
    `Q${fmt(right)} ${fmt(bottom)} ${fmt(right)} ${fmt(bottom - radius)}` +
    `V${fmt(bodyTop)}Z`;
  const shadow = block.plan.shadow
    ? beamerRoundedShadowMarkup({
        id: filterId,
        left,
        top,
        right,
        bottom,
      })
    : "";
  return (
    `<g data-beamer-block-template="${block.plan.templateId}">` +
    `<defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${params.titleFill}" />` +
    `<stop offset="1" stop-color="${params.bodyFill}" />` +
    `</linearGradient></defs>` +
    shadow +
    `<path d="${titlePath}" fill="${params.titleFill}" />` +
    `<path d="M${fmt(left)} ${fmt(titleBottom)}H${fmt(right)}V${fmt(bodyTop)}H${fmt(left)}Z" fill="url(#${gradientId})" />` +
    `<path d="${bodyPath}" fill="${params.bodyFill}" />` +
    `</g>`
  );
}

function emitPreparedTitlePage(params: {
  prepared: PreparedTitlePage;
  x: number;
  y: number;
  items: BeamerFrameLayoutItem[];
  paragraphs: BeamerParagraphLayout[];
  modelBuilder: ReturnType<typeof createSvgModelBuilder>;
  theme: ResolvedBeamerTheme;
}): void {
  const titlePage = params.prepared;
  const boxBounds: BeamerRect = {
    x: params.x - titlePage.plan.outerBleedPt,
    y: params.y + titlePage.plan.titleBoxTopPt,
    width: titlePage.width + 2 * titlePage.plan.outerBleedPt,
    height: titlePage.plan.titleBoxHeightPt,
  };
  const titleColor = resolveBeamerThemeColor(params.theme, "title");
  const titleFill =
    titleColor.bg ??
    resolveBeamerThemeColor(params.theme, "titlelike").bg;
  if (titlePage.plan.style === "colorbox" && titleFill) {
    params.items.push({
      id: `${titlePage.node.id}:title:background`,
      kind: "background",
      sourceSpan: titlePage.node.span,
      bounds: boxBounds,
      parentId: titlePage.node.id,
    });
  }
  params.modelBuilder.addPart({
    basePartId: `${titlePage.node.id}:chrome`,
    sourceId: titlePage.node.id,
    elementId: null,
    markup: titlePageChromeMarkup({
      id: titlePage.node.id,
      bounds: boxBounds,
      templateId: titlePage.plan.templateId,
      style: titlePage.plan.style,
      fill: titleFill ?? "transparent",
      shadow: titlePage.plan.shadow,
    }),
  });

  const childIds: string[] = [];
  const emitText = (
    paragraph: LaidParagraph | null,
    baselineFromBoxTop: number,
    colorRole: "title" | "subtitle" | "author" | "institute" | "date"
  ) => {
    if (!paragraph) {
      return;
    }
    const y =
      boxBounds.y +
      baselineFromBoxTop -
      firstLineBaselineOffset(paragraph);
    positionParagraphLayout(
      paragraph.layout,
      svgPoint(pt(params.x), pt(y)),
      paragraphLineExtent(paragraph)
    );
    params.paragraphs.push(paragraph.layout);
    childIds.push(paragraph.layout.paragraphId);
    params.items.push({
      id: paragraph.layout.paragraphId,
      kind: "text",
      sourceSpan: paragraph.layout.sourceSpan,
      bounds: paragraph.layout.bounds,
      parentId: titlePage.node.id,
      paragraphId: paragraph.layout.paragraphId,
    });
    params.modelBuilder.addPart({
      basePartId: paragraph.layout.paragraphId,
      sourceId: paragraph.layout.paragraphId,
      elementId: null,
      markup: paragraphMarkup(
        paragraph.svgBody,
        params.x,
        y,
        textColor(params.theme, colorRole)
      ),
    });
  };
  emitText(
    titlePage.title,
    titlePage.plan.titleBaselineFromBoxTopPt,
    "title"
  );
  emitText(
    titlePage.subtitle,
    titlePage.plan.subtitleBaselineFromBoxTopPt,
    "subtitle"
  );
  for (const box of titlePage.metadataBoxes) {
    if (!box.paragraph) {
      continue;
    }
    // Content sits sep-inset below the colorbox top; emitText measures
    // baselines from the title box top.
    emitText(
      box.paragraph,
      box.topPt -
        titlePage.plan.titleBoxTopPt +
        BEAMER_EMPTY_METADATA_COLORBOX_PT / 2 +
        firstLineBaselineOffset(box.paragraph),
      box.field
    );
  }

  params.items.push({
    id: titlePage.node.id,
    kind: "title-page",
    sourceSpan: titlePage.node.span,
    bounds: {
      x: boxBounds.x,
      y: boxBounds.y,
      width: boxBounds.width,
      height: boxBounds.height + (childIds.length > 0 ? 4 : 0),
    },
    parentId: null,
    childIds,
  });
}

function titlePageChromeMarkup(params: {
  id: string;
  bounds: BeamerRect;
  templateId: string;
  style: "colorbox" | "rounded" | "inmargin";
  fill: string;
  shadow: boolean;
}): string {
  const { bounds } = params;
  if (params.style === "inmargin") {
    return (
      `<g data-beamer-title-page-template="${escapeAttribute(params.templateId)}" />`
    );
  }
  if (params.style === "colorbox") {
    return (
      `<g data-beamer-title-page-template="${escapeAttribute(params.templateId)}">` +
      rectMarkup(bounds, params.fill) +
      `</g>`
    );
  }
  const radius = 4;
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const outline =
    `M${fmt(bounds.x + radius)} ${fmt(bounds.y)}` +
    `H${fmt(right - radius)}` +
    `Q${fmt(right)} ${fmt(bounds.y)} ${fmt(right)} ${fmt(bounds.y + radius)}` +
    `V${fmt(bottom - radius)}` +
    `Q${fmt(right)} ${fmt(bottom)} ${fmt(right - radius)} ${fmt(bottom)}` +
    `H${fmt(bounds.x + radius)}` +
    `Q${fmt(bounds.x)} ${fmt(bottom)} ${fmt(bounds.x)} ${fmt(bottom - radius)}` +
    `V${fmt(bounds.y + radius)}` +
    `Q${fmt(bounds.x)} ${fmt(bounds.y)} ${fmt(bounds.x + radius)} ${fmt(bounds.y)}Z`;
  const shadowId = `${params.id}:shadow`.replace(
    /[^A-Za-z0-9_-]/gu,
    "-"
  );
  const shadow = params.shadow
    ? beamerRoundedShadowMarkup({
        id: shadowId,
        left: bounds.x,
        top: bounds.y,
        right,
        bottom,
      })
    : "";
  return (
    `<g data-beamer-title-page-template="${escapeAttribute(params.templateId)}">` +
    shadow +
    `<path d="${outline}" fill="${params.fill}" />` +
    `</g>`
  );
}

function emitFrameParagraph(params: {
  prepared: Extract<PreparedFrameFlowItem, { kind: "paragraph" }>;
  x: number;
  y: number;
  items: BeamerFrameLayoutItem[];
  paragraphs: BeamerParagraphLayout[];
  modelBuilder: ReturnType<typeof createSvgModelBuilder>;
  theme: ResolvedBeamerTheme;
}): void {
  const laid = params.prepared.paragraph;
  positionParagraphLayout(
    laid.layout,
    svgPoint(pt(params.x), pt(params.y)),
    params.prepared.naturalHeight
  );
  params.paragraphs.push(laid.layout);
  params.items.push({
    id: laid.layout.paragraphId,
    kind: "text",
    sourceSpan: laid.layout.sourceSpan,
    bounds: laid.layout.bounds,
    parentId: null,
    paragraphId: laid.layout.paragraphId,
  });
  for (const marker of laid.listMarkers) {
    params.items.push({
      id: marker.id,
      kind: "list-marker",
      sourceSpan: marker.sourceSpan ?? laid.layout.sourceSpan,
      bounds: {
        x: params.x + marker.bounds.x,
        y: params.y + marker.bounds.y,
        width: marker.bounds.width,
        height: marker.bounds.height,
      },
      parentId: laid.layout.paragraphId,
      traceAsGlyph: marker.traceAsGlyph,
      visibility: marker.visibility,
    });
  }
  params.modelBuilder.addPart({
    basePartId: laid.layout.paragraphId,
    sourceId: laid.layout.paragraphId,
    elementId: null,
    markup: paragraphMarkup(
      laid.svgBody,
      params.x,
      params.y,
      textColor(params.theme, "normal text")
    ),
  });
}

async function emitPreparedColumns(params: {
  prepared: Extract<PreparedFrameFlowItem, { kind: "columns" }>;
  referenceY: number;
  spacing: BeamerSpacingLayout[];
  bounds: BeamerRect;
  items: BeamerFrameLayoutItem[];
  paragraphs: BeamerParagraphLayout[];
  embeddedTikz: BeamerEmbeddedTikzLayout[];
  modelBuilder: ReturnType<typeof createSvgModelBuilder>;
  theme: ResolvedBeamerTheme;
  work?: BeamerRenderWork;
}): Promise<void> {
  const prepared = params.prepared.columns;
  const columnTops = prepared.map(
    (column) => params.referenceY - column.box.referenceFromContentTop
  );
  const visualTop = Math.min(...columnTops);
  const visualBottom = Math.max(
    ...prepared.map(
      (column, index) => columnTops[index] + column.naturalHeight
    )
  );
  const columnGap = prepared.length > 1
    ? Math.max(
      0,
      (params.bounds.width -
        prepared.reduce((sum, column) => sum + column.width, 0)) /
        (prepared.length - 1)
    )
    : 0;
  const columnsId = params.prepared.node.id;
  const columnChildIds: string[] = [];
  let x = params.bounds.x;
  for (let index = 0; index < prepared.length; index += 1) {
    const preparedColumn = prepared[index];
    const columnId = preparedColumn.column.id;
    const childIds: string[] = [];
    const columnTop = columnTops[index];
    let flowY = columnTop;
    columnChildIds.push(columnId);
    for (
      let flowIndex = 0;
      flowIndex < preparedColumn.flow.length;
      flowIndex += 1
    ) {
      const flowItem = preparedColumn.flow[flowIndex];
      if (params.work) await params.work.checkpoint();
      if (
        flowItem.visibility === "hidden" &&
        flowItem.kind !== "block"
      ) {
        flowY += columnFlowAdvance(
          flowItem,
          preparedColumn.flow[flowIndex + 1] != null
        );
        continue;
      }
      if (flowItem.kind === "vertical-space") {
        params.spacing.push({ command: flowItem.node.command, sourceSpan: flowItem.node.span,
          sizePt: flowItem.height, relativeUnitPt: flowItem.relativeUnitPt,
          bounds: { x, y: flowY, width: preparedColumn.width, height: flowItem.height } });
        flowY += flowItem.height;
      } else if (flowItem.kind === "paragraph") {
        const laid = flowItem.paragraph;
        positionParagraphLayout(
          laid.layout,
          svgPoint(pt(x), pt(flowY)),
          flowItem.advanceHeight
        );
        params.paragraphs.push(laid.layout);
        childIds.push(laid.layout.paragraphId);
        params.items.push({
          id: laid.layout.paragraphId,
          kind: "text",
          sourceSpan: laid.layout.sourceSpan,
          bounds: laid.layout.bounds,
          parentId: columnId,
          paragraphId: laid.layout.paragraphId,
        });
        for (const marker of laid.listMarkers) {
          params.items.push({
            id: marker.id,
            kind: "list-marker",
            sourceSpan: marker.sourceSpan ?? laid.layout.sourceSpan,
            bounds: {
              x: x + marker.bounds.x,
              y: flowY + marker.bounds.y,
              width: marker.bounds.width,
              height: marker.bounds.height,
            },
            parentId: laid.layout.paragraphId,
            traceAsGlyph: marker.traceAsGlyph,
            visibility: marker.visibility,
          });
        }
        params.modelBuilder.addPart({
          basePartId: laid.layout.paragraphId,
          sourceId: laid.layout.paragraphId,
          elementId: null,
          markup: paragraphMarkup(
            laid.svgBody,
            x,
            flowY,
            textColor(params.theme, "normal text")
          ),
        });
        flowY +=
          flowItem.advanceHeight +
          (preparedColumn.flow[flowIndex + 1]
            ? flowItem.trailingSkipPt
            : 0);
      } else if (flowItem.kind === "block") {
        emitPreparedBlock({
          prepared: flowItem.block,
          x,
          y: flowY,
          parentId: columnId,
          items: params.items,
          paragraphs: params.paragraphs,
          modelBuilder: params.modelBuilder,
          theme: params.theme,
          visibility:
            flowItem.visibility === "hidden" ? "hidden" : "visible",
        });
        childIds.push(flowItem.block.node.id);
        flowY +=
          flowItem.height +
          (preparedColumn.flow[flowIndex + 1]
            ? flowItem.block.plan.geometry.afterSkipPt
            : 0);
      } else if (flowItem.kind === "unsupported") {
        emitUnsupportedPlaceholder({
          placeholder: flowItem.placeholder,
          x,
          y: flowY,
          parentId: columnId,
          items: params.items,
          modelBuilder: params.modelBuilder,
        });
        childIds.push(flowItem.placeholder.id);
        flowY += flowItem.height;
      } else {
        emitEmbeddedTikz({
          tikz: flowItem,
          x,
          y: flowY,
          parentId: columnId,
          items: params.items,
          embeddedTikz: params.embeddedTikz,
          modelBuilder: params.modelBuilder,
        });
        childIds.push(flowItem.id);
        flowY += flowItem.height;
      }
    }
    params.items.push({
      id: columnId,
      kind: "column",
      sourceSpan: preparedColumn.column.span,
      bounds: {
        x,
        y: columnTop,
        width: preparedColumn.width,
        height: preparedColumn.naturalHeight,
      },
      parentId: columnsId,
      childIds,
    });
    x += preparedColumn.width + columnGap;
  }
  params.items.push({
    id: columnsId,
    kind: "columns",
    sourceSpan: params.prepared.node.span,
    bounds: {
      x: params.bounds.x,
      y: visualTop,
      width: params.bounds.width,
      height: Math.max(0, visualBottom - visualTop),
    },
    parentId: null,
    childIds: columnChildIds,
  });
}

function columnFlowAdvance(
  item: PreparedColumnFlowItem,
  hasNext: boolean
): number {
  if (item.kind === "paragraph") {
    return item.advanceHeight + (hasNext ? item.trailingSkipPt : 0);
  }
  if (item.kind === "block") {
    return item.height + (hasNext ? item.block.plan.geometry.afterSkipPt : 0);
  }
  return item.height;
}

async function prepareColumnContent(params: {
  source: string;
  column: BeamerColumnBodyNode;
  textWidth: number;
  diagnostics: Diagnostic[];
  theme: ResolvedBeamerTheme;
  macroBindings: ReadonlyMap<string, MacroBinding>;
  references: BeamerReferenceContext;
  leftSidebarWidth: number;
  overlays: BeamerOverlayModel;
  step: number;
  graphicsResolver?: DocumentGraphicsResolver;
  paperWidth: number;
  work?: BeamerRenderWork;
}): Promise<PreparedColumnContent> {
  const {
    source,
    column,
    textWidth,
    diagnostics,
    theme,
    macroBindings,
    references,
  } = params;
  const width = resolveBeamerColumnWidth(column.width.value, textWidth, params.paperWidth) ?? textWidth;
  const flow: PreparedColumnFlowItem[] = [];
  const bodyFont = theme.fonts["normal-text"];
  const listProfile = beamerListLayoutProfile(theme);
  let previousDepth: number | undefined;

  for (const node of column.children) {
    if (params.work) await params.work.checkpoint();
    const prepared = await prepareColumnFlowNode({
      source,
      node,
      width,
      bodyFont,
      theme,
      diagnostics,
      listProfile,
      initialPreviousDepth:
        node.kind === "list" ? previousDepth : undefined,
      macroBindings,
      references,
      leftSidebarWidth: params.leftSidebarWidth,
      overlays: params.overlays,
      step: params.step,
      graphicsResolver: params.graphicsResolver,
      paperWidth: params.paperWidth,
      work: params.work,
    });
    if (prepared) {
      flow.push(prepared);
      if (prepared.kind === "paragraph") {
        previousDepth = paragraphLastLineDepth(prepared.paragraph);
      } else if (prepared.kind === "tikzpicture" || prepared.kind === "unsupported") {
        previousDepth = 0;
      }
    }
  }

  const naturalHeight = flow.reduce(
    (height, item, index) =>
      height +
      (item.kind === "paragraph"
        ? item.advanceHeight +
          (flow[index + 1] ? item.trailingSkipPt : 0)
        : item.kind === "block" &&
            item.block.plan.style === "inmargin" &&
            !flow[index + 1]
          // TeX drops the terminal \smallskip glue when the in-margin block's
          // vtop becomes the final material in a column minipage.
          ? item.height - item.block.plan.geometry.boxBottomSkipPt
          : item.height) +
      (item.kind === "block" && flow[index + 1]
        ? item.block.plan.geometry.afterSkipPt
        : 0),
    0
  );
  return {
    column,
    width,
    flow,
    naturalHeight,
    box: measureColumnVerticalBox(
      column.alignment,
      flow,
      naturalHeight,
      bodyFont
    ),
  };
}

async function prepareColumnFlowNode(params: {
  source: string;
  node: BeamerColumnFlowNode;
  width: number;
  bodyFont: BeamerThemeFont;
  theme: ResolvedBeamerTheme;
  diagnostics: Diagnostic[];
  listProfile: TexListLayoutProfile;
  initialPreviousDepth?: number;
  macroBindings: ReadonlyMap<string, MacroBinding>;
  references: BeamerReferenceContext;
  leftSidebarWidth: number;
  overlays: BeamerOverlayModel;
  step: number;
  graphicsResolver?: DocumentGraphicsResolver;
  paperWidth: number;
  work?: BeamerRenderWork;
}): Promise<PreparedColumnFlowItem | null> {
  const {
    source,
    node,
    width,
    bodyFont,
    theme,
    diagnostics,
    listProfile,
    initialPreviousDepth,
    macroBindings,
    references,
    leftSidebarWidth,
    overlays,
    step,
    graphicsResolver,
    paperWidth,
  } = params;
  const visibility = resolveBeamerOverlaySpanVisibility(
    overlays,
    node.span,
    step
  );
  if (visibility === "removed") {
    return null;
  }
  if (node.kind === "vertical-space") {
    return {
      kind: "vertical-space",
      visibility,
      node,
      ...measureVerticalSpace(node, bodyFont),
    };
  }
  if (node.kind === "block" || node.kind === "theorem") {
    const block = runBeamerRenderOperation(params.work, () => prepareBlock({
      source,
      node,
      width,
      leftSidebarWidth,
      theme,
      macroBindings,
      references,
      overlays,
      step,
      graphicsResolver,
      paperWidth,
    }));
    return block
      ? { kind: "block", visibility, block, height: block.naturalHeight }
      : null;
  }
  if (node.kind === "paragraph" || node.kind === "list") {
    const text = source.slice(node.span.from, node.span.to);
    const projection = projectBeamerOverlayText(
      createIdentityMappedText(text, node.span.from),
      node.span,
      overlays,
      step
    );
    const paragraph = runBeamerRenderOperation(params.work, () => layoutParagraph({
      mapped: projection.mapped,
      sourceSpan: node.span,
      paragraphId: node.id,
      role: "body",
      bounds: { x: 0, y: 0, width, height: 0 },
      font: bodyFont,
      colorResolver: beamerAlertColorResolver(theme),
      alignment: "left",
      initialPreviousDepth,
      listProfile,
      macroBindings,
      references,
      hiddenSourceSpans: projection.hiddenSourceSpans,
      hiddenListItemIndices: projection.hiddenListItemIndices,
      graphicsResolver,
      paperWidth,
    }));
    if (!paragraph) {
      if (!hasProjectedContent(source, node.span, overlays, step, references)) {
        return null;
      }
      const placeholder = prepareUnsupportedPlaceholder(
        source,
        { ...node, message: "This content could not be laid out." },
        width
      );
      diagnostics.push({
        severity: "warning",
        code: "beamer-render-unsupported-flow-node",
        message: placeholder.message,
        span: node.span,
      });
      return {
        kind: "unsupported",
        visibility,
        placeholder,
        height: placeholder.height,
      };
    }
    return {
      kind: "paragraph",
      visibility,
      paragraph,
      // A plain TeX paragraph contributes its line hboxes, not the TikZ-node
      // strut carried by the shared text frontend's enclosing vlist. Lists,
      // on the other hand, intentionally carry their vertical list glue.
      advanceHeight: node.kind === "paragraph"
        ? paragraphLineExtent(paragraph)
        : paragraph.height,
      trailingSkipPt:
        node.kind === "list"
          ? trailingBeamerListSkip(projection.mapped.text)
          : 0,
    };
  }
  if (node.kind === "unsupported") {
    diagnostics.push({
      severity: "warning",
      code: "beamer-render-unsupported-flow-node",
      message: node.message,
      span: node.span,
    });
    const placeholder = prepareUnsupportedPlaceholder(source, node, width);
    return {
      kind: "unsupported",
      visibility,
      placeholder,
      height: placeholder.height,
    };
  }
  return prepareEmbeddedTikz({
    source,
    node,
    width,
    bodyFont,
    diagnostics,
    visibility,
    graphicsResolver,
    work: params.work,
  });
}

async function prepareEmbeddedTikz(params: {
  source: string;
  node: Extract<BeamerColumnFlowNode | BeamerFrameBodyNode, {
    kind: "tikzpicture";
  }>;
  width: number;
  bodyFont: BeamerThemeFont;
  diagnostics: Diagnostic[];
  visibility: BeamerOverlayVisibility;
  graphicsResolver?: DocumentGraphicsResolver;
  work?: BeamerRenderWork;
}): Promise<Extract<PreparedColumnFlowItem, {
  kind: "tikzpicture";
}> | null> {
  const snippet = params.source.slice(
    params.node.root.span.from,
    params.node.root.span.to
  );
  const textEngine = await createTexNodeTextEngine({
    mathFontProfile: createBeamerTexMathFontProfile(params.bodyFont),
  });
  const rendered = await renderTikzToSvgAsync(
    applyThemeFamilyToTikz(snippet, params.bodyFont),
    {
      textEngine,
      graphicsResolver: params.graphicsResolver,
      cooperative: params.work?.options,
      // A TikZ picture contributes its natural PGF bounding box to the
      // surrounding TeX hbox. The standalone renderer's presentation padding
      // is useful for an isolated SVG, but it is not part of that box.
      svg: { padding: 0 },
    }
  );
  const viewBox = rendered.svg.viewBox;
  const scale = Math.min(1, params.width / Math.max(viewBox.width, 1));
  for (const diagnostic of [
    ...rendered.parse.diagnostics,
    ...rendered.semantic.diagnostics,
  ]) {
    params.diagnostics.push({
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      span: params.node.root.span,
    });
  }
  return {
    kind: "tikzpicture",
    visibility: params.visibility,
    id: params.node.id,
    sourceSpan: params.node.span,
    horizontalAlignment: params.node.horizontalAlignment,
    width: viewBox.width * scale,
    height: viewBox.height * scale,
    model: rendered.svg.model,
    viewBox,
  };
}

function measureColumnVerticalBox(
  alignment: BeamerColumnAlignment,
  flow: readonly PreparedColumnFlowItem[],
  naturalHeight: number,
  font: BeamerThemeFont
): ColumnVerticalBox {
  if (alignment === "T") {
    const xHeight = fontXHeightPt(font);
    // beamerbaseframecomponents.sty selects a top-aligned minipage and emits
    // `\vskip-1ex\nointerlineskip`. The artificial leading empty line gives
    // the vtop zero height; the content can therefore protrude above its
    // reference line while only the remainder contributes to its depth.
    return {
      height: 0,
      depth: Math.max(0, naturalHeight - xHeight),
      referenceFromContentTop: xHeight,
    };
  }

  if (alignment === "bottom") {
    return {
      height: naturalHeight,
      depth: 0,
      referenceFromContentTop: naturalHeight,
    };
  }

  if (alignment === "center") {
    // LaTeX's `minipage[c]` lowers through `\@iiiparbox` to `\vcenter`.
    // TeX centers the total box extent on the active math axis rather than
    // splitting height/depth geometrically around the reference line.
    const mathAxis =
      Number(defaultTexMathFontProfile.parameters.axisHeight) * font.sizePt;
    const height = naturalHeight / 2 + mathAxis;
    return {
      height,
      depth: naturalHeight - height,
      referenceFromContentTop: height,
    };
  }

  const firstReference = firstFlowReferenceFromTop(flow);
  return {
    height: firstReference,
    depth: Math.max(0, naturalHeight - firstReference),
    referenceFromContentTop: firstReference,
  };
}

function firstFlowReferenceFromTop(
  flow: readonly PreparedColumnFlowItem[]
): number {
  let offset = 0;
  for (const item of flow) {
    if (item.kind === "vertical-space") {
      offset += item.height;
      continue;
    }
    if (item.kind === "tikzpicture" || item.kind === "unsupported") {
      return offset + item.height;
    }
    if (item.kind === "block") {
      return offset + item.height;
    }
    const firstLine = item.paragraph.layout.report.lines[0];
    if (!firstLine) {
      offset += item.advanceHeight;
      continue;
    }
    const placement = item.paragraph.layout.vlistLayout.linePlacements.find(
      (candidate) => candidate.lineIndex === firstLine.lineIndex
    );
    return offset + Number(placement?.y ?? 0) + Number(firstLine.ascent);
  }
  return offset;
}

function paragraphLineExtent(paragraph: LaidParagraph): number {
  let bottom = 0;
  for (const line of paragraph.layout.report.lines) {
    const placement = paragraph.layout.vlistLayout.linePlacements.find(
      (candidate) => candidate.lineIndex === line.lineIndex
    );
    bottom = Math.max(
      bottom,
      Number(placement?.y ?? 0) +
        Number(line.ascent) +
        Number(line.descent)
    );
  }
  return bottom || paragraph.height;
}

function fontXHeightPt(font: BeamerThemeFont): number {
  const fontSize = texLength(font.sizePt);
  const profile = createBeamerTexTextFontProfile(font);
  const resolved = profile.resolveTextFont(
    profile.defaultFontState,
    fontSize,
    profile.metricProvider
  );
  return Number(resolved.atPt) * resolved.data.fontdimen.xheight;
}

function positionParagraphLayout(
  layout: BeamerParagraphLayout,
  origin: SvgPoint,
  height = layout.bounds.height
): void {
  layout.bounds = {
    ...layout.bounds,
    x: Number(origin.x),
    y: Number(origin.y),
    height,
  };
  layout.editableTextSpans = collectBeamerEditableTextSpans(
    layout.paragraphId,
    layout.role,
    layout.report,
    layout.vlistLayout,
    layout.sourceSpan,
    layout.bounds,
    (layout.hiddenSourceSpans ?? []).concat(layout.readOnlySourceSpans ?? [])
  );
  layout.atomicRenderSpans = collectBeamerAtomicRenderSpans(
    layout.paragraphId,
    layout.role,
    layout.report,
    layout.vlistLayout,
    layout.sourceSpan,
    layout.bounds,
    layout.hiddenSourceSpans ?? [],
    layout.macroArgumentRuns ?? []
  );
}

/**
 * Layout color resolvers keyed by alerted-text color: `\alert{...}` in any
 * frame text resolves through this alias to the theme's "alerted text"
 * foreground. Memoized so resolver identity is stable across paragraphs
 * of one render (and across renders of an unchanged theme).
 */
const beamerAlertColorResolvers = new Map<string, NodeTextColorResolver>();

function beamerAlertColorResolver(theme: ResolvedBeamerTheme): NodeTextColorResolver {
  const color = resolveBeamerThemeColor(theme, "alerted text").fg ?? "#ff0000";
  let resolver = beamerAlertColorResolvers.get(color);
  if (!resolver) {
    resolver = {
      cacheKey: `beamer-alert:${color}`,
      resolve: (name) => (name === TEX_ALERT_COLOR_ALIAS ? color : null),
    };
    beamerAlertColorResolvers.set(color, resolver);
  }
  return resolver;
}

function layoutParagraph(params: {
  mapped: MappedText;
  sourceSpan: Span;
  paragraphId: string;
  role: BeamerParagraphLayout["role"];
  bounds: BeamerRect;
  font: BeamerThemeFont;
  mathFont?: BeamerThemeFont;
  alignment: "left" | "center" | "right";
  interwordSpacePt?: number;
  initialPreviousDepth?: number;
  listProfile?: TexListLayoutProfile;
  disableAutomaticHyphenation?: boolean;
  macroBindings?: ReadonlyMap<string, MacroBinding>;
  references: BeamerReferenceContext;
  targetHeight?: number;
  hiddenSourceSpans?: readonly Span[];
  hiddenListItemIndices?: readonly number[];
  graphicsResolver?: DocumentGraphicsResolver;
  colorResolver?: NodeTextColorResolver;
  paperWidth?: number;
  textWidth?: number;
  columnWidth?: number;
}): LaidParagraph | null {
  // A size declaration preceding the list is an ambient font selection,
  // not an empty paragraph (and must apply to its generated labels too).
  const leadingSize = activeBeamerNamedSize(params.mapped.text);
  if (leadingSize && new RegExp(`^\\s*\\\\${leadingSize.command}\\s*\\\\begin\\s*\\{thebibliography\\}`, "u").test(params.mapped.text)) {
    params = {
      ...params,
      font: { ...params.font, sizePt: leadingSize.sizePt, lineHeightPt: leadingSize.lineHeightPt },
      mapped: mapTransformedTextWithFallback(params.mapped, params.mapped.text.replace(leadingSize.pattern, ""), "Beamer ambient bibliography size"),
    };
  }
  const fontSize = texLength(params.font.sizePt);
  const profile = createBeamerTexTextFontProfile(params.font);
  const metricProvider = params.interwordSpacePt == null
    ? computerModernTexMetricProvider
    : fixedInterwordMetricProvider(
      computerModernTexMetricProvider,
      params.interwordSpacePt
    );
  const textFontProfile = metricProvider === profile.metricProvider
    ? profile
    : { ...profile, metricProvider };
  const resolvedFont = textFontProfile.resolveTextFont(
    textFontProfile.defaultFontState,
    fontSize,
    metricProvider
  );
  const alignment =
    params.alignment === "center"
      ? "center"
      : params.alignment === "right"
        ? "ragged-left"
        : "ragged-right";
  let mapped = params.macroBindings
    ? expandMacroBindingsMapped(params.mapped, params.macroBindings)
    : params.mapped;
  const namedSize = activeBeamerNamedSize(mapped.text);
  if (namedSize) {
    mapped = mapTransformedTextWithFallback(
      mapped,
      mapped.text.replace(
        namedSize.pattern,
        `\\fontsize{${namedSize.sizePt}pt}{${namedSize.lineHeightPt}pt}\\selectfont`
      ),
      `Beamer 11pt class ${namedSize.command} size`
    );
  }
  const graphicsResolver = beamerBibliographyGraphicsResolver(params.graphicsResolver);
  const referenceProjection = projectBeamerReferences(mapped, params.references, (widestLabel, sourceStart) =>
    beamerBibliographyStyle({
      source: params.references.source, sourceStart, theme: params.references.theme,
      widestLabel, fontSizePt: namedSize?.sizePt ?? params.font.sizePt,
      layoutFontSizePt: params.font.sizePt,
      measure: (tex) => {
        const prefix = namedSize ? `\\fontsize{${namedSize.sizePt}pt}{${namedSize.lineHeightPt}pt}\\selectfont ` : "";
        const measured = layoutSimpleTexParagraph(prefix + tex, {
          width: texLength(10000), font: resolvedFont, metricProvider, textFontProfile,
          alignment: "ragged-right", graphicsResolver,
          mathBoxProvider: createTexDerivedInlineMathBoxProvider({ baseAtPt: fontSize, fontProfile: createBeamerTexMathFontProfile(params.mathFont ?? params.font) }),
        });
        return measured.report?.lines[0]?.naturalWidth ?? 0;
      },
    })
  );
  mapped = referenceProjection.mapped;
  const layoutOptions = {
    paragraphId: params.paragraphId,
    width: texLength(params.bounds.width),
    height: params.targetHeight,
    alignment,
    font: resolvedFont,
    metricProvider,
    textFontProfile,
    tikzTextWidthNode: true,
    // beamer.cls installs `\raggedright`, and the rounded block templates issue
    // it again. LaTeX implements that as `\rightskip 0pt plus 1fil`, so loose
    // lines consume margin glue while near-full lines retain the font's finite
    // interword stretch and shrink for line-breaking.
    ...(params.alignment === "left"
      ? { rightskipStretch: Number.POSITIVE_INFINITY }
      : {}),
    spaceGlueProfile:
      params.alignment === "left" ||
        /\\(?:begin\s*\{\s*center\s*\}|centering)(?![A-Za-z@])/u.test(
          mapped.text
        )
        ? "font"
        : params.role === "block-body"
          ? "font"
          : "font-fixed",
    fallbackPolicy: "placeholder",
    mathBoxProvider: createTexDerivedInlineMathBoxProvider({
      baseAtPt: fontSize,
      fontProfile: createBeamerTexMathFontProfile(
        params.mathFont ?? params.font
      ),
    }),
    baselineSkip: namedSize?.lineHeightPt ?? params.font.lineHeightPt,
    initialPreviousDepth: params.initialPreviousDepth,
    listProfile: {
      ...(params.listProfile ?? BEAMER_LIST_LAYOUT_PROFILE),
      bibliographyMargins: referenceProjection.bibliographyMargins,
      bibliographyParsepPt: (leadingSize?.command ?? namedSize?.command) === "small"
        ? 3
        : (leadingSize?.command ?? namedSize?.command) === "footnotesize" ? 2 : 0,
    },
    displayMathProfile: BEAMER_NORMAL_DISPLAY_MATH_PROFILE,
    hyphenator: params.disableAutomaticHyphenation
      ? { hyphenate: () => [] }
      : undefined,
    graphicsResolver,
    colorResolver: params.colorResolver,
    dimensionContext: {
      linewidth: texLength(params.bounds.width),
      textwidth: texLength(params.textWidth ?? params.bounds.width),
      columnwidth: texLength(params.columnWidth ?? params.bounds.width),
      paperwidth: texLength(params.paperWidth ?? params.bounds.width),
    },
  } as const;
  let result = layoutSimpleTexParagraph(mapped.text, layoutOptions);
  if (
    !result.supported &&
    (alignment === "ragged-left" || alignment === "center")
  ) {
    // A short right-aligned or centered template line in a wide Beamer color
    // box can exhaust the finite alignment skips used by the generic
    // breaker. A ragged-right retry finds the symmetric feasible line
    // breaks; place those lines against the right edge or center, matching
    // TeX's template-level \hfill and \centering fil skips.
    const leftAligned = layoutSimpleTexParagraph(mapped.text, {
      ...layoutOptions,
      alignment: "ragged-right",
    });
    if (
      leftAligned.supported &&
      leftAligned.report &&
      leftAligned.vlistLayout
    ) {
      const width = texLength(params.bounds.width);
      const report = {
        ...leftAligned.report,
        alignment:
          alignment === "center"
            ? ("center" as const)
            : ("ragged-left" as const),
        lines: leftAligned.report.lines.map((line) => {
          const xStart = texLineX(
            alignment === "center"
              ? (width - line.width) / 2
              : width - line.width
          );
          const delta = xStart - line.xStart;
          return {
            ...line,
            xStart,
            xEnd: texLineX(xStart + line.width),
            segments: line.segments.map((segment) => ({
              ...segment,
              x: texLineX(segment.x + delta),
              caretStops: segment.caretStops?.map((stop) =>
                texLineX(stop + delta)
              ),
              mathConstructRanges: segment.mathConstructRanges?.map(
                (range) => ({
                  ...range,
                  xStart: texLineX(range.xStart + delta),
                  xEnd: texLineX(range.xEnd + delta),
                })
              ),
              mathCaretEntries: segment.mathCaretEntries?.map((entry) => ({
                ...entry,
                x: texLineX(entry.x + delta),
                hitBounds: {
                  ...entry.hitBounds,
                  xStart: texLineX(entry.hitBounds.xStart + delta),
                  xEnd: texLineX(entry.hitBounds.xEnd + delta),
                },
              })),
              mathBreakpoints: segment.mathBreakpoints?.map(
                (breakpoint) => ({
                  ...breakpoint,
                  x: texLineX(breakpoint.x + delta),
                })
              ),
            })),
          };
        }),
      };
      result = {
        ...leftAligned,
        report,
        vlistLayout: {
          ...leftAligned.vlistLayout,
          graphicsPlacements: collectTexGraphicsPlacements(
            [report],
            leftAligned.vlistLayout.linePlacements
          ),
          reports: leftAligned.vlistLayout.reports.map((candidate) =>
            "paragraphId" in candidate &&
            candidate.paragraphId === report.paragraphId
              ? report
              : candidate
          ),
        },
      };
    }
  }
  if (!result.supported || !result.report || !result.vlistLayout) {
    return null;
  }
  const links = layoutBeamerLinks(referenceProjection, result.report, result.vlistLayout, params.hiddenSourceSpans ?? []);
  const documentResult = {
    ...result,
    report: remapParagraphLayoutReportSourceMap(result.report, mapped.sourceMap),
    vlistLayout: remapTexVListLayoutSourceMap(result.vlistLayout, mapped.sourceMap),
    listStructure: remapSimpleTexListStructureSourceMap(result.listStructure, mapped.sourceMap),
  };
  const height =
    documentResult.vlistLayout.metrics.height + documentResult.vlistLayout.metrics.depth;
  const macroArgumentRuns = collectMappedMacroArgumentRuns(mapped);
  const readOnlySourceSpans = macroArgumentRuns.map((run) => run.span);
  const listStructure: BeamerListTopology[] = (documentResult.listStructure ?? []).flatMap((list) => list.name === "bibliography" ? [] : [{
    environment: list.name,
    beginSpan: { from: list.beginSpan.from, to: list.beginSpan.to },
    endSpan: { from: list.endSpan.from, to: list.endSpan.to },
    depth: list.depth,
    items: list.items.map((item) => ({
      commandSpan: { from: item.commandSpan.from, to: item.commandSpan.to },
      ...(item.labelSpan
        ? { labelSpan: { from: item.labelSpan.from, to: item.labelSpan.to } }
        : {}),
      contentSpan: { from: item.contentSpan.from, to: item.contentSpan.to },
      itemIndex: item.itemIndex,
    })),
  }]);
  return {
    height,
    layout: {
      links,
      paragraphId: params.paragraphId,
      role: params.role,
      sourceSpan: params.sourceSpan,
      bounds: {
        ...params.bounds,
        height,
      },
      report: documentResult.report,
      vlistLayout: documentResult.vlistLayout,
      editableTextSpans: collectBeamerEditableTextSpans(
        params.paragraphId,
        params.role,
        documentResult.report,
        documentResult.vlistLayout,
        params.sourceSpan,
        null,
        (params.hiddenSourceSpans ?? []).concat(readOnlySourceSpans)
      ),
      atomicRenderSpans: collectBeamerAtomicRenderSpans(
        params.paragraphId,
        params.role,
        documentResult.report,
        documentResult.vlistLayout,
        params.sourceSpan,
        null,
        params.hiddenSourceSpans ?? [],
        macroArgumentRuns
      ),
      ...(params.hiddenSourceSpans?.length
        ? { hiddenSourceSpans: params.hiddenSourceSpans }
        : {}),
      ...(readOnlySourceSpans.length
        ? { readOnlySourceSpans }
        : {}),
      ...(macroArgumentRuns.length
        ? { macroArgumentRuns }
        : {}),
      ...(params.hiddenListItemIndices?.length
        ? { hiddenListItemIndices: params.hiddenListItemIndices }
        : {}),
      ...(listStructure.length ? { listStructure } : {}),
    },
    svgBody: hideOverlayPaintInSvg(
      renderTexParagraphSvgBody(documentResult.report, {
        lineHeightPt: texLength(params.font.lineHeightPt),
        vlistLayout: documentResult.vlistLayout,
        metricProvider,
        textFontProfile,
        baseFontSizePt: fontSize,
        alignment,
      }),
      params.hiddenSourceSpans ?? [],
      params.hiddenListItemIndices ?? []
    ),
    listMarkers: documentResult.vlistLayout.boxReport.items
      .filter((item) =>
        item.hboxRole?.kind === "list-label" &&
        item.hboxRole.labelKind === "default"
      )
      .flatMap((item) => {
        const role = item.hboxRole;
        if (role?.kind !== "list-label") {
          return [];
        }
        // Same fallback the layout itself uses: block bodies omit an
        // explicit profile but still lay out (and paint) default markers.
        const listProfile = params.listProfile ?? BEAMER_LIST_LAYOUT_PROFILE;
        const marker =
          role.listKind === "itemize"
            ? listProfile.itemizeMarkersByDepth?.[
                Math.max(
                  0,
                  Math.min(
                    role.labelDepth - 1,
                    (listProfile.itemizeMarkersByDepth?.length ?? 1) - 1
                  )
                )
              ]
            : role.listKind === "enumerate"
              ? listProfile.resolveEnumerateMarker?.(
                  role.itemIndex,
                  role.labelDepth
                )
              : undefined;
        if (!marker) {
          return [];
        }
        const paint = marker.paintBoundsEm;
        const atPt = Number(resolvedFont.atPt);
        return [{
          id: `${params.paragraphId}:marker:${item.path.join("-")}`,
          ...(item.sourceSpan
            ? {
                sourceSpan: {
                  from: item.sourceSpan.start,
                  to: item.sourceSpan.end,
                },
              }
            : {}),
          traceAsGlyph: marker.traceAsGlyph ?? marker.glyph != null,
          visibility: params.hiddenListItemIndices?.includes(role.itemIndex)
            ? "hidden"
            : "visible",
          bounds: {
            x: Number(item.x) + (paint?.x ?? 0) * atPt,
            y: Number(item.y) + (paint?.y ?? 0) * atPt,
            width: (paint?.width ?? marker.widthEm) * atPt,
            height:
              (paint?.height ??
                marker.heightEm + marker.depthEm) * atPt,
          },
        }];
      }),
  };
}

const EDITABLE_BEAMER_PARAGRAPH_ROLES =
  new Set<BeamerParagraphLayout["role"]>([
    "frame-title",
    "body",
    "block-title",
    "block-body",
    "title",
    "subtitle",
    "author",
    "institute",
    "date",
  ]);

function collectBeamerEditableTextSpans(
  paragraphId: string,
  role: BeamerParagraphLayout["role"],
  report: BeamerParagraphLayout["report"],
  vlistLayout: BeamerParagraphLayout["vlistLayout"],
  paragraphSpan: Span,
  paragraphBounds: BeamerRect | null,
  hiddenSourceSpans: readonly Span[]
): BeamerParagraphLayout["editableTextSpans"] {
  if (!EDITABLE_BEAMER_PARAGRAPH_ROLES.has(role)) {
    return [];
  }
  const candidates = report.lines.flatMap((line) => {
    const placement = vlistLayout.linePlacements.find(
      (candidate) => candidate.lineIndex === line.lineIndex
    );
    const y = (paragraphBounds?.y ?? 0) + Number(placement?.y ?? 0);
    return line.segments.flatMap((segment) => {
      const isDirectText = segment.kind === "text" || segment.kind === "space";
      const isMathIsland = segment.kind === "math";
      if (
        (!isDirectText && !isMathIsland) ||
        segment.role === "list-label" ||
        segment.sourceRangePolicy !== "caret" ||
        segment.sourceStartRaw == null ||
        segment.sourceEndRaw == null
      ) {
        return [];
      }
      const from = Math.max(paragraphSpan.from, Number(segment.sourceStartRaw));
      const to = Math.min(paragraphSpan.to, Number(segment.sourceEndRaw));
      if (
        to <= from ||
        hiddenSourceSpans.some((hidden) => from < hidden.to && hidden.from < to)
      ) {
        return [];
      }
      return [{
        from,
        to,
        kind: isMathIsland ? ("math" as const) : ("text" as const),
        hitBounds: paragraphBounds
          ? [svgRect(
              paragraphBounds.x + Number(segment.x),
              y,
              Math.max(0.5, Number(segment.width)),
              Math.max(1, Number(line.ascent) + Number(line.descent))
            )]
          : [],
      }];
    });
  });

  // Display math lives in vlist boxes, not paragraph report segments: each
  // display block publishes a math hit span over its content range.
  const displayMathCandidates = vlistLayout.boxReport.items.flatMap((item) => {
    if (!item.displayMath) {
      return [];
    }
    const from = Math.max(paragraphSpan.from, item.displayMath.contentStart);
    const to = Math.min(paragraphSpan.to, item.displayMath.contentEnd);
    if (
      to <= from ||
      hiddenSourceSpans.some((hidden) => from < hidden.to && hidden.from < to)
    ) {
      return [];
    }
    return [{
      from,
      to,
      kind: "math" as const,
      hitBounds: paragraphBounds
        ? [svgRect(
            paragraphBounds.x + Number(item.x),
            paragraphBounds.y + Number(item.y),
            Math.max(0.5, Number(item.width)),
            Math.max(1, Number(item.totalHeight))
          )]
        : [],
    }];
  });

  const allCandidates = [...candidates, ...displayMathCandidates]
    .sort((left, right) => left.from - right.from || left.to - right.to);

  const merged: Array<Span & { kind: "text" | "math"; hitBounds: SvgRect[] }> = [];
  for (const candidate of allCandidates) {
    const previous = merged.at(-1);
    if (candidate.kind === previous?.kind && candidate.from <= previous.to) {
      previous.to = Math.max(previous.to, candidate.to);
      previous.hitBounds.push(...candidate.hitBounds);
    } else {
      merged.push({
        from: candidate.from,
        to: candidate.to,
        kind: candidate.kind,
        hitBounds: [...candidate.hitBounds],
      });
    }
  }
  return merged.map(({ hitBounds, kind, ...span }, index) => ({
    id: `${paragraphId}:editable:${index}`,
    span,
    kind,
    hitBounds,
  }));
}

/**
 * Rendered output whose source is not directly editable: segments with a
 * macro or select source-range policy (each output glyph reports the full
 * invocation span, so same-span candidates merge into one atom), plus
 * rendered macro-argument output, which selects its invocation's span.
 * Hidden overlay material ("generated" policy) publishes nothing.
 */
function collectBeamerAtomicRenderSpans(
  paragraphId: string,
  role: BeamerParagraphLayout["role"],
  report: BeamerParagraphLayout["report"],
  vlistLayout: BeamerParagraphLayout["vlistLayout"],
  paragraphSpan: Span,
  paragraphBounds: BeamerRect | null,
  hiddenSourceSpans: readonly Span[],
  macroArgumentRuns: NonNullable<BeamerParagraphLayout["macroArgumentRuns"]> = []
): BeamerParagraphLayout["atomicRenderSpans"] {
  if (!EDITABLE_BEAMER_PARAGRAPH_ROLES.has(role)) {
    return [];
  }
  const candidates = report.lines.flatMap((line) => {
    const placement = vlistLayout.linePlacements.find(
      (candidate) => candidate.lineIndex === line.lineIndex
    );
    const y = (paragraphBounds?.y ?? 0) + Number(placement?.y ?? 0);
    return line.segments.flatMap((segment) => {
      const isAtomicPolicy =
        segment.sourceRangePolicy === "macro" ||
        segment.sourceRangePolicy === "select";
      const isArgumentCandidate =
        !isAtomicPolicy &&
        segment.sourceRangePolicy === "caret" &&
        (segment.kind === "text" || segment.kind === "space");
      if (
        (!isAtomicPolicy && !isArgumentCandidate) ||
        segment.role === "list-label" ||
        segment.sourceStartRaw == null ||
        segment.sourceEndRaw == null
      ) {
        return [];
      }
      const from = Math.max(paragraphSpan.from, Number(segment.sourceStartRaw));
      const to = Math.min(paragraphSpan.to, Number(segment.sourceEndRaw));
      if (
        to <= from ||
        hiddenSourceSpans.some((hidden) => from < hidden.to && hidden.from < to)
      ) {
        return [];
      }
      // Argument output maps caret-precisely into the argument source, but
      // an argument can render any number of times, so direct editing stays
      // off; clicking it selects the whole invocation instead.
      let atomFrom = from;
      let atomTo = to;
      if (isArgumentCandidate) {
        const run = macroArgumentRuns.find(
          (candidate) => from < candidate.span.to && candidate.span.from < to
        );
        if (!run) {
          return [];
        }
        atomFrom = Math.max(paragraphSpan.from, run.invocationSpan.from);
        atomTo = Math.min(paragraphSpan.to, run.invocationSpan.to);
        if (atomTo <= atomFrom) {
          return [];
        }
      }
      return [{
        from: atomFrom,
        to: atomTo,
        hitBounds: paragraphBounds
          ? [svgRect(
              paragraphBounds.x + Number(segment.x),
              y,
              Math.max(0.5, Number(segment.width)),
              Math.max(1, Number(line.ascent) + Number(line.descent))
            )]
          : [],
      }];
    });
  }).sort((left, right) => left.from - right.from || left.to - right.to);

  const merged: Array<Span & { hitBounds: SvgRect[] }> = [];
  for (const candidate of candidates) {
    const previous = merged.at(-1);
    if (previous && candidate.from <= previous.to) {
      previous.to = Math.max(previous.to, candidate.to);
      previous.hitBounds.push(...candidate.hitBounds);
    } else {
      merged.push({
        from: candidate.from,
        to: candidate.to,
        hitBounds: [...candidate.hitBounds],
      });
    }
  }
  return merged.map(({ hitBounds, ...span }, index) => ({
    id: `${paragraphId}:atom:${index}`,
    span,
    hitBounds,
  }));
}

function collectMappedMacroArgumentRuns(
  mapped: MappedText
): NonNullable<BeamerParagraphLayout["macroArgumentRuns"]>[number][] {
  const runs: NonNullable<BeamerParagraphLayout["macroArgumentRuns"]>[number][] = [];
  for (const origin of mapped.sourceMap.charOrigins) {
    if (origin.kind !== "macro-argument" || origin.to <= origin.from) {
      continue;
    }
    const previous = runs.at(-1);
    if (
      previous &&
      origin.from <= previous.span.to &&
      previous.invocationSpan.from === origin.invocation.from &&
      previous.invocationSpan.to === origin.invocation.to
    ) {
      previous.span = {
        from: previous.span.from,
        to: Math.max(previous.span.to, origin.to),
      };
    } else {
      runs.push({
        span: { from: origin.from, to: origin.to },
        invocationSpan: {
          from: origin.invocation.from,
          to: origin.invocation.to,
        },
      });
    }
  }
  return runs;
}

function activeBeamerNamedSize(source: string): {
  command: string;
  pattern: RegExp;
  sizePt: number;
  lineHeightPt: number;
} | null {
  const sizes = [
    ["tiny", 6, 7],
    ["scriptsize", 8, 9.5],
    ["footnotesize", 9, 11],
    ["small", 10, 12],
    ["normalsize", 10.95, 13.6],
    ["large", 12, 14],
    ["Large", 14.4, 18],
    ["LARGE", 17.28, 22],
    ["huge", 20.74, 25],
    ["Huge", 24.88, 30],
  ] as const;
  let selected:
    | {
        command: string;
        pattern: RegExp;
        sizePt: number;
        lineHeightPt: number;
        index: number;
      }
    | null = null;
  for (const [command, sizePt, lineHeightPt] of sizes) {
    const pattern = new RegExp(String.raw`\\${command}(?![A-Za-z@])`, "gu");
    const match = pattern.exec(source);
    if (match && (selected == null || match.index > selected.index)) {
      selected = { command, pattern, sizePt, lineHeightPt, index: match.index };
    }
  }
  return selected && {
    command: selected.command,
    pattern: selected.pattern,
    sizePt: selected.sizePt,
    lineHeightPt: selected.lineHeightPt,
  };
}

function fixedInterwordMetricProvider(
  base: TexMetricProvider,
  spacePt: number
): TexMetricProvider {
  return {
    resolveFont(options) {
      const font = base.resolveFont(options);
      return {
        ...font,
        data: {
          ...font.data,
          fontdimen: {
            ...font.data.fontdimen,
            space: spacePt / Number(font.atPt),
            stretch: 0,
            shrink: 0,
            extraspace: 0,
          },
        },
      };
    },
    shapeText(text, font, options) {
      return base.shapeText(text, font, options);
    },
  };
}

function mappedTemplateText(primitive: Extract<
  BeamerTemplatePrimitive,
  { kind: "text" }
>): MappedText {
  if (primitive.source.kind === "mapped") {
    return createIdentityMappedText(
      primitive.source.value.value,
      primitive.source.value.contentSpan.from
    );
  }
  return createGeneratedMappedText(
    primitive.source.text,
    "Beamer template-generated text",
    primitive.source.sourceSpan
  );
}

function measureVerticalSpace(
  node: Extract<BeamerFrameBodyNode, { kind: "vertical-space" }>, font: BeamerThemeFont
): { height: number; relativeUnitPt?: number } {
  if (node.command !== "vspace") {
    return { height: { smallskip: 3, medskip: 6, bigskip: 12 }[node.command] };
  }
  const dimension = parseTexDimensionExpression(node.value.value);
  if (dimension?.kind === "absolute") return { height: dimension.value };
  if (dimension?.kind === "contextual" && (dimension.reference === "em" || dimension.reference === "ex")) {
    const relativeUnitPt = dimension.reference === "em" ? font.sizePt : fontXHeightPt(font);
    return { height: dimension.factor * relativeUnitPt, relativeUnitPt };
  }
  return { height: 0 };
}

function resolveFrameVerticalPacking(
  available: BeamerRect,
  rigidContentHeight: number,
  flow: readonly PreparedFrameFlowItem[],
  alignment: "top" | "center" | "bottom"
): { topOffset: number; fillUnit: number } {
  const freeHeight = Math.max(
    0,
    available.height - rigidContentHeight
  );
  const internalFillWeight = flow.reduce(
    (sum, item) =>
      sum +
      (item.kind === "title-page"
        ? item.titlePage.leadingFillWeight +
          item.titlePage.trailingFillWeight
        : 0),
    0
  );
  if (alignment === "top") {
    // beamerbaseframe.sty gives top-aligned frames a natural .2cm top skip;
    // their finite stretch is dominated by the bottom `1fill`.
    const topOffset = Math.min(TOP_ALIGNED_FRAME_SKIP_PT, freeHeight);
    return {
      topOffset,
      fillUnit:
        internalFillWeight > 0
          ? Math.max(0, freeHeight - topOffset) /
            (1 + internalFillWeight)
          : 0,
    };
  }
  if (alignment === "bottom") {
    const totalWeight = 1 + internalFillWeight;
    const fillUnit = totalWeight > 0 ? freeHeight / totalWeight : 0;
    return { topOffset: fillUnit, fillUnit };
  }
  // Beamer's default `c` frame uses 1fill above and 1.5fill below, so the
  // title page's own leading/trailing `\vfill` glues compete at the same
  // infinite order with the frame glues.
  const totalWeight = 2.5 + internalFillWeight;
  const fillUnit = totalWeight > 0 ? freeHeight / totalWeight : 0;
  return { topOffset: fillUnit, fillUnit };
}

function applyThemeFamilyToTikz(
  source: string,
  font: BeamerThemeFont
): string {
  const family =
    font.family === "sans"
      ? String.raw`\sffamily`
      : font.family === "monospace"
        ? String.raw`\ttfamily`
        : String.raw`\rmfamily`;
  const series =
    font.series === "bold" ? String.raw`\bfseries` : String.raw`\mdseries`;
  const shape =
    font.shape === "italic"
      ? String.raw`\itshape`
      : font.shape === "slanted"
        ? String.raw`\slshape`
        : String.raw`\upshape`;
  // A TikZ picture inherits the surrounding frame font before its root
  // options execute. The embedded renderer starts from a standalone 10pt
  // context, so project the complete resolved Beamer role—not just its
  // family—onto the picture's root font option.
  const command =
    `\\fontsize{${fmt(font.sizePt)}pt}{${fmt(font.lineHeightPt)}pt}` +
    String.raw`\selectfont` +
    family +
    series +
    shape;
  return source.replace(
    /\\begin\s*\{tikzpicture\}(?:\s*\[([^\]]*)\])?/,
    (_whole, options: string | undefined) =>
      `\\begin{tikzpicture}[${options ? `${options},` : ""}font=${command}]`
  );
}

function hideOverlayPaintInSvg(
  markup: string,
  hiddenSpans: readonly Span[],
  hiddenListItemIndices: readonly number[]
): string {
  if (hiddenSpans.length === 0 && hiddenListItemIndices.length === 0) {
    return markup;
  }
  const hiddenSources = markup.replace(
    /<(path|g)\b([^>]*\bdata-source-start="(\d+)"[^>]*\bdata-source-end="(\d+)"[^>]*)>/gu,
    (whole, tag: string, attributes: string, fromRaw: string, toRaw: string) => {
      if (!sourceSpanIsHidden(
        { from: Number(fromRaw), to: Number(toRaw) },
        hiddenSpans
      )) {
        return whole;
      }
      const selfClosing = attributes.trimEnd().endsWith("/");
      const visibleAttributes = selfClosing
        ? attributes.replace(/\/\s*$/u, "")
        : attributes;
      return `<${tag}${visibleAttributes} visibility="hidden"${selfClosing ? " /" : ""}>`;
    }
  );
  return hiddenSources.replace(
    /<g\b([^>]*\bdata-tex-list-item-index="(\d+)"[^>]*)>/gu,
    (whole, attributes: string, indexRaw: string) =>
      hiddenListItemIndices.includes(Number(indexRaw))
        ? `<g${attributes} visibility="hidden">`
        : whole
  );
}

function sourceSpanIsHidden(
  span: Span,
  hiddenSpans: readonly Span[]
): boolean {
  return hiddenSpans.some((hidden) =>
    span.from < hidden.to && span.to > hidden.from
  );
}

function paragraphRole(
  fontRole: BeamerThemeFontRole
): BeamerParagraphLayout["role"] {
  if (fontRole === "frame-title") {
    return "frame-title";
  }
  if (fontRole === "frame-subtitle") {
    return "frame-subtitle";
  }
  if (
    fontRole === "headline" ||
    fontRole === "section-in-head-foot" ||
    fontRole === "subsection-in-head-foot" ||
    fontRole === "title-in-sidebar" ||
    fontRole === "author-in-sidebar" ||
    fontRole === "section-in-sidebar" ||
    fontRole === "subsection-in-sidebar"
  ) {
    return "headline";
  }
  return fontRole === "footline" ? "footline" : "body";
}

function hasProjectedContent(
  source: string,
  span: Span,
  overlays: BeamerOverlayModel,
  step: number,
  references: BeamerReferenceContext
): boolean {
  const projected = projectBeamerOverlayText(
    createIdentityMappedText(source.slice(span.from, span.to), span.from),
    span,
    overlays,
    step
  );
  return projectBeamerReferences(projected.mapped, references).mapped.text
    .replace(/%[^\n]*/gu, "").replace(/[{}\s]/gu, "").length > 0;
}

function emitUnsupportedPlaceholder(params: {
  placeholder: BeamerUnsupportedPlaceholder;
  x: number;
  y: number;
  parentId: string | null;
  items: BeamerFrameLayoutItem[];
  modelBuilder: ReturnType<typeof createSvgModelBuilder>;
}): void {
  const { placeholder } = params;
  const bounds = {
    x: params.x,
    y: params.y,
    width: placeholder.width,
    height: placeholder.height,
  };
  params.items.push({
    id: placeholder.id,
    kind: "unsupported",
    sourceSpan: placeholder.sourceSpan,
    bounds,
    parentId: params.parentId,
    message: placeholder.message,
  });
  params.modelBuilder.addPart({
    basePartId: placeholder.id,
    sourceId: placeholder.id,
    elementId: null,
    markup: unsupportedPlaceholderMarkup(placeholder, bounds),
  });
}

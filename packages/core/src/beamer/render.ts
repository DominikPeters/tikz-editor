import type { Span } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import {
  collectMacroBindings,
  expandMacroBindingsMapped,
  type MacroBinding,
} from "../macros/index.js";
import { renderTikzToSvgAsync } from "../render/index.js";
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
import {
  computerModernTexMetricProvider,
  createTexDerivedInlineMathBoxProvider,
  defaultTexMathFontProfile,
  layoutSimpleTexParagraph,
  renderTexParagraphSvgBody,
  texLength,
  type TexDisplayMathLayoutProfile,
  type TexListLayoutProfile,
  type TexMetricProvider,
} from "../text/tex/index.js";
import { parseBeamerFrameBody } from "./content.js";
import type {
  BeamerBlockBodyNode,
  BeamerColumnAlignment,
  BeamerColumnBodyNode,
  BeamerColumnFlowNode,
  BeamerColumnsBodyNode,
  BeamerFrameBodyNode,
  BeamerParagraphBodyNode,
} from "./content-types.js";
import { resolveBeamerPageGeometry } from "./geometry.js";
import { scanBeamerDocument } from "./scan.js";
import {
  createBeamerTexMathFontProfile,
  createBeamerTexTextFontProfile,
  planBeamerBlockTemplate,
  planBeamerFrameChrome,
  resolveBeamerEnumerateMarker,
  resolveBeamerItemizeMarkers,
  resolveBeamerTheme,
  resolveBeamerThemeColor,
} from "./theme/index.js";
import type {
  BeamerBlockTemplatePlan,
  BeamerFrameChromePlan,
  BeamerTemplatePrimitive,
  BeamerThemeFont,
  BeamerThemeFontRole,
  ResolvedBeamerTheme,
} from "./theme/types.js";
import type {
  BeamerEmbeddedTikzLayout,
  BeamerFrameLayout,
  BeamerFrameLayoutItem,
  BeamerParagraphLayout,
  BeamerRect,
  RenderBeamerFrameOptions,
  RenderBeamerFrameResult,
} from "./types.js";

type LaidParagraph = {
  layout: BeamerParagraphLayout;
  svgBody: string;
  height: number;
  listMarkers: readonly {
    id: string;
    bounds: BeamerRect;
  }[];
};

type PreparedBlock = {
  node: BeamerBlockBodyNode;
  plan: BeamerBlockTemplatePlan;
  width: number;
  title: LaidParagraph;
  body: LaidParagraph | null;
  titleAscent: number;
  titleDepth: number;
  titleBackgroundHeight: number;
  bodyBackgroundTop: number;
  bodyParagraphTop: number;
  bodyBackgroundHeight: number;
  backgroundTop: number;
  backgroundBottom: number;
  naturalHeight: number;
};

type PreparedColumnFlowItem =
  | {
      kind: "paragraph";
      paragraph: LaidParagraph;
      advanceHeight: number;
      trailingSkipPt: number;
    }
  | {
      kind: "vertical-space";
      height: number;
    }
  | {
      kind: "tikzpicture";
      id: string;
      sourceSpan: Span;
      width: number;
      height: number;
      model: BeamerEmbeddedTikzLayout["model"];
      viewBox: BeamerEmbeddedTikzLayout["viewBox"];
    }
  | {
      kind: "block";
      block: PreparedBlock;
      height: number;
    };

type PreparedColumnContent = {
  column: BeamerColumnBodyNode;
  width: number;
  flow: PreparedColumnFlowItem[];
  naturalHeight: number;
  box: ColumnVerticalBox;
};

type PreparedFrameFlowItem =
  | {
      kind: "paragraph";
      node: BeamerParagraphBodyNode;
      paragraph: LaidParagraph;
      naturalHeight: number;
      boxHeight: number;
      startingBaselineSkip: number;
      leadingAdjustment: number;
      endingDepth: number;
      endsWithVerticalSpace: boolean;
      trailingParagraphPreviousDepth: number;
    }
  | {
      kind: "columns";
      node: BeamerColumnsBodyNode;
      columns: PreparedColumnContent[];
      box: Pick<ColumnVerticalBox, "height" | "depth">;
    }
  | {
      kind: "block";
      node: BeamerBlockBodyNode;
      block: PreparedBlock;
      naturalHeight: number;
      boxHeight: number;
      endingDepth: number;
    };

type PositionedFrameFlowItem = {
  item: PreparedFrameFlowItem;
  contentTop: number;
  referenceY: number;
  visualTop: number;
  visualBottom: number;
};

/**
 * TeX vertical boxes are positioned by a reference line, not their visual
 * top. Content may protrude above that line (notably Beamer's `[T]` columns),
 * so keep the box dimensions and the content/reference relationship separate.
 */
type ColumnVerticalBox = {
  height: number;
  depth: number;
  referenceFromContentTop: number;
};

const TEX_POINTS_PER_CM = 72.27 / 2.54;
const TOP_ALIGNED_FRAME_SKIP_PT = 0.2 * TEX_POINTS_PER_CM;
const TEX_LINE_SKIP_PT = 1;
// beamerbaselocalstructure.sty: \leftmargini..iii=2em,
// \topsep=3pt/2pt/2pt, \partopsep=0pt, \parsep=0pt, and first-level
// \itemsep=3pt. The deeper itemsep values alias their zero parsep.
const BEAMER_LIST_LAYOUT_PROFILE: TexListLayoutProfile = {
  leftMarginEmByDepth: [2, 2, 2],
  topsepPtByDepth: [3, 2, 2],
  partopsepPtByDepth: [0, 0, 0],
  itemsepPtByDepth: [3, 0, 0],
  parsepPtByDepth: [0, 0, 0],
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
    itemizeMarkersByDepth: resolveBeamerItemizeMarkers(theme),
    resolveEnumerateMarker: (itemIndex, labelDepth) =>
      resolveBeamerEnumerateMarker(theme, itemIndex, labelDepth),
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
  const document = scanBeamerDocument(source);
  const frameIndex = options.frameIndex ?? 0;
  const frame = document.frames[frameIndex];
  if (!frame) {
    throw new RangeError(
      `Beamer frame index ${frameIndex} is outside the document's ${document.frames.length} frames.`
    );
  }
  const step = options.step ?? 1;
  if (!Number.isInteger(step) || step < 1) {
    throw new RangeError("A Beamer overlay step must be a positive integer.");
  }

  const theme = resolveBeamerTheme(document);
  const macroBindings = collectMacroBindings(
    document.preamble.macroDefinitions
  );
  const page = resolveBeamerPageGeometry(document, theme);
  const chrome = planBeamerFrameChrome({
    document,
    frame,
    frameIndex,
    totalFrames: document.frames.length,
    step,
    page,
    theme,
  });
  const diagnostics: Diagnostic[] = [
    ...document.diagnostics,
    ...theme.diagnostics,
  ];
  const bodyIr = parseBeamerFrameBody({ source, frame });
  diagnostics.push(...bodyIr.diagnostics);
  const items: BeamerFrameLayoutItem[] = [];
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
    diagnostics,
    theme,
    macroBindings,
  });
  if (preparedFrameFlow.length > 0) {
    const positioned = positionPreparedFrameFlow(
      preparedFrameFlow,
      theme.fonts["normal-text"].lineHeightPt
    );
    const frameBlockTop = positionFrameContentTop(
      availableContentBounds,
      positioned.extent,
      frame.options?.alignment ?? "center"
    );
    for (const placement of positioned.items) {
      if (placement.item.kind === "paragraph") {
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
        emitPreparedColumns({
          prepared: placement.item,
          referenceY: frameBlockTop + placement.referenceY,
          bounds: availableContentBounds,
          items,
          paragraphs,
          embeddedTikz,
          modelBuilder,
          theme,
        });
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
  } else {
    items.push({
      id: `${frame.id}:unsupported-body`,
      kind: "unsupported",
      sourceSpan: frame.bodySpan,
      bounds: contentBounds,
      parentId: null,
      message: "This Beamer frame body has no supported flow content.",
    });
    diagnostics.push({
      severity: "warning",
      code: "beamer-render-unsupported-body",
      message: "This Beamer frame body has no supported flow content.",
      span: frame.bodySpan,
    });
  }

  const model = modelBuilder.build({
    viewBox: page.page,
    defs: [],
    diagnostics: diagnostics.map((diagnostic) => ({
      code: diagnostic.code ?? "beamer-render",
      message: diagnostic.message,
    })),
  });
  const layout: BeamerFrameLayout = {
    coordinateSystem: {
      unit: "tex-pt",
      origin: "top-left",
      yAxis: "down",
    },
    frameId: frame.id,
    frameIndex,
    step,
    page,
    contentBounds,
    items,
    paragraphs,
    embeddedTikz,
  };

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

function renderChrome(params: {
  chrome: BeamerFrameChromePlan;
  theme: ResolvedBeamerTheme;
  items: BeamerFrameLayoutItem[];
  paragraphs: BeamerParagraphLayout[];
  modelBuilder: ReturnType<typeof createSvgModelBuilder>;
  macroBindings: ReadonlyMap<string, MacroBinding>;
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
          color.bg ?? color.fg ?? "transparent",
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

    const mapped = mappedTemplateText(primitive);
    const font = theme.fonts[primitive.fontRole];
    const laid = layoutParagraph({
      mapped,
      sourceSpan: primitive.sourceSpan,
      paragraphId: primitive.id,
      role: paragraphRole(primitive.fontRole),
      bounds: primitive.bounds,
      font,
      alignment: primitive.alignment,
      interwordSpacePt: primitive.interwordSpacePt,
      macroBindings: params.macroBindings,
    });
    if (!laid) {
      continue;
    }
    const y = primitive.baselineY == null
      ? verticallyAlignedParagraphY(primitive, laid.height)
      : primitive.baselineY - firstLineBaselineOffset(laid);
    laid.layout.bounds = {
      ...laid.layout.bounds,
      x: primitive.bounds.x,
      y,
    };
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
  diagnostics: Diagnostic[];
  theme: ResolvedBeamerTheme;
  macroBindings: ReadonlyMap<string, MacroBinding>;
}): Promise<PreparedFrameFlowItem[]> {
  const result: PreparedFrameFlowItem[] = [];
  const bodyFont = params.theme.fonts["normal-text"];
  const listProfile = beamerListLayoutProfile(params.theme);
  for (const node of params.children) {
    if (node.kind === "paragraph") {
      const paragraphSource = params.source.slice(node.span.from, node.span.to);
      const paragraph = layoutParagraph({
        mapped: createIdentityMappedText(
          paragraphSource,
          node.span.from
        ),
        sourceSpan: node.span,
        paragraphId: node.id,
        role: "body",
        bounds: { x: 0, y: 0, width: params.textWidth, height: 0 },
        font: bodyFont,
        alignment: "left",
        listProfile,
        macroBindings: params.macroBindings,
      });
      if (paragraph) {
        const trailingTrivlistSkip = trailingBeamerTrivlistSkip(
          paragraphSource
        );
        const trailingListSkip = trailingBeamerListSkip(paragraphSource);
        const namedSize = activeBeamerNamedSize(paragraphSource);
        result.push({
          kind: "paragraph",
          node,
          paragraph,
          naturalHeight:
            paragraph.height + trailingTrivlistSkip + trailingListSkip,
          boxHeight: paragraphStartingMaterialHeight(paragraph),
          startingBaselineSkip:
            namedSize?.lineHeightPt ?? bodyFont.lineHeightPt,
          leadingAdjustment: leadingBeamerTrivlistAdjustment(
            paragraphSource,
            paragraph
          ),
          endingDepth: paragraphEndingMaterialDepth(paragraph),
          endsWithVerticalSpace: paragraphEndsWithVerticalSpace(paragraph),
          trailingParagraphPreviousDepth: paragraphLastLineDepth(paragraph),
        });
      }
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
      const columns = await Promise.all(
        node.columns.map((column) =>
          prepareColumnContent({
            source: params.source,
            column,
            textWidth: params.textWidth,
            diagnostics: params.diagnostics,
            theme: params.theme,
            macroBindings: params.macroBindings,
          })
        )
      );
      result.push({
        kind: "columns",
        node,
        columns,
        box: {
          height: Math.max(0, ...columns.map((column) => column.box.height)),
          depth: Math.max(0, ...columns.map((column) => column.box.depth)),
        },
      });
      continue;
    }
    if (node.kind === "block") {
      const block = prepareBlock({
        source: params.source,
        node,
        width: params.textWidth,
        theme: params.theme,
        macroBindings: params.macroBindings,
      });
      if (block) {
        result.push({
          kind: "block",
          node,
          block,
          naturalHeight: block.naturalHeight,
          boxHeight: block.naturalHeight,
          endingDepth: 0,
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
  }
  return result;
}

function positionPreparedFrameFlow(
  flow: readonly PreparedFrameFlowItem[],
  baselineSkip: number
): { items: PositionedFrameFlowItem[]; extent: number } {
  const items: PositionedFrameFlowItem[] = [];
  let cursor = 0;
  let previousDepth = 0;
  for (let index = 0; index < flow.length; index += 1) {
    const item = flow[index];
    if (item.kind === "paragraph") {
      const glue = verticalInterlineGlue(
        previousDepth,
        item.boxHeight,
        item.startingBaselineSkip
      ) + item.leadingAdjustment;
      const referenceY = cursor + glue + item.boxHeight;
      const contentTop = referenceY - item.boxHeight;
      const visualBottom = contentTop + item.naturalHeight;
      items.push({
        item,
        contentTop,
        referenceY,
        visualTop: contentTop,
        visualBottom,
      });
      cursor = visualBottom;
      previousDepth = item.endingDepth;
      if (
        item.endsWithVerticalSpace &&
        flow[index + 1]?.kind === "columns"
      ) {
        // The explicit `\vspace` ends the shared text vlist in glue, but TeX's
        // following columns hbox still computes `\baselineskip` from the
        // preceding line's real depth. Do not carry the enclosing vbox depth.
        previousDepth = item.trailingParagraphPreviousDepth;
      }
      continue;
    }
    if (item.kind === "block") {
      const glue = verticalInterlineGlue(
        previousDepth,
        item.boxHeight,
        baselineSkip
      );
      const referenceY = cursor + glue + item.boxHeight;
      const contentTop = referenceY - item.boxHeight;
      const visualBottom = contentTop + item.naturalHeight;
      items.push({
        item,
        contentTop,
        referenceY,
        visualTop: contentTop,
        visualBottom,
      });
      cursor = visualBottom + item.block.plan.geometry.afterSkipPt;
      previousDepth = item.endingDepth;
      continue;
    }
    const glue = verticalInterlineGlue(
      previousDepth,
      item.box.height,
      baselineSkip
    );
    const referenceY = cursor + glue + item.box.height;
    const columnTops = item.columns.map(
      (column) => referenceY - column.box.referenceFromContentTop
    );
    const visualTop = Math.min(...columnTops);
    const visualBottom = Math.max(
      ...item.columns.map(
        (column, index) => columnTops[index] + column.naturalHeight
      )
    );
    items.push({
      item,
      contentTop: visualTop,
      referenceY,
      visualTop,
      visualBottom,
    });
    cursor = referenceY + item.box.depth;
    previousDepth = item.box.depth;
  }
  return { items, extent: cursor };
}

function verticalInterlineGlue(
  previousDepth: number,
  height: number,
  baselineSkip: number
): number {
  const candidate = baselineSkip - previousDepth - height;
  return candidate >= 0 ? candidate : TEX_LINE_SKIP_PT;
}

function paragraphEndingMaterialDepth(paragraph: LaidParagraph): number {
  const last = paragraph.layout.vlistLayout.boxReport.items.at(-1);
  return Number(last?.depth ?? 0);
}

function paragraphStartingMaterialHeight(paragraph: LaidParagraph): number {
  const first = paragraph.layout.vlistLayout.boxReport.items.find(
    (item) => item.itemKind !== "glue" && item.itemKind !== "penalty"
  );
  if (first?.itemKind === "hbox") {
    // A frame-leading display is preceded by Beamer's shipped empty line.
    // Its zero-sized hbox sits after one baseline of explicit vertical
    // material, so the outer frame vbox references the bottom of that prefix
    // rather than the ascent of the later first prose line.
    return Number(first.y + first.height);
  }
  const firstLine = paragraph.layout.report.lines[0];
  if (firstLine) {
    return Number(firstLine.ascent);
  }
  return Number(first?.height ?? paragraph.layout.vlistLayout.metrics.height);
}

function paragraphEndsWithVerticalSpace(paragraph: LaidParagraph): boolean {
  const last = paragraph.layout.vlistLayout.boxReport.items.at(-1);
  return (
    last?.itemKind === "glue" &&
    last.glue?.origin?.kind === "explicit-command" &&
    last.glue.origin.command === "vspace"
  );
}

function trailingBeamerTrivlistSkip(source: string): number {
  const endPattern = /\\end\s*\{\s*(?:center|flushleft|flushright)\s*\}/gu;
  let lastEnd = -1;
  for (const match of source.matchAll(endPattern)) {
    lastEnd = (match.index ?? 0) + match[0].length;
  }
  if (lastEnd < 0) {
    return 0;
  }
  const suffix = source.slice(lastEnd);
  return /^(?:\s|\\vspace\*?\s*\{[^{}]*\})*$/u.test(suffix) ? 9 : 0;
}

function trailingBeamerListSkip(source: string): number {
  const endPattern =
    /\\end\s*\{\s*(?:itemize|enumerate|description)\s*\}/gu;
  let lastEnd = -1;
  for (const match of source.matchAll(endPattern)) {
    lastEnd = (match.index ?? 0) + match[0].length;
  }
  if (lastEnd < 0) {
    return 0;
  }
  const suffix = source.slice(lastEnd);
  // The shared VList materializes list-exit topsep when another paragraph
  // follows. A Beamer leaf can end at the environment (or in explicit
  // vertical glue), so its class adapter must retain the same outer topsep.
  return /^(?:\s|\\vspace\*?\s*\{[^{}]*\})*$/u.test(suffix) ? 3 : 0;
}

function leadingBeamerTrivlistAdjustment(
  source: string,
  paragraph: LaidParagraph
): number {
  if (
    !/\\begin\s*\{\s*(?:center|flushleft|flushright)\s*\}/u.test(source)
  ) {
    return 0;
  }
  const boundary = paragraph.layout.vlistLayout.boxReport.items.find(
    (item) =>
      item.itemKind === "glue" &&
      item.glue?.origin?.kind === "trivlist-boundary"
  );
  // size11.clo gives these trivlists a natural 9pt topsep. The generic text
  // engine expresses the same default as .8em (8.76pt at Beamer's 10.95pt
  // normalsize), so the Beamer adapter owns the small class-profile delta.
  return Math.max(0, 9 - Number(boundary?.height ?? 9));
}

function prepareBlock(params: {
  source: string;
  node: BeamerBlockBodyNode;
  width: number;
  theme: ResolvedBeamerTheme;
  macroBindings: ReadonlyMap<string, MacroBinding>;
}): PreparedBlock | null {
  const plan = planBeamerBlockTemplate({
    environment: params.node.environment,
    theme: params.theme,
  });
  const title = layoutParagraph({
    mapped: createIdentityMappedText(
      params.node.title.value,
      params.node.title.contentSpan.from
    ),
    sourceSpan: params.node.title.contentSpan,
    paragraphId: `${params.node.id}:title`,
    role: "block-title",
    bounds: { x: 0, y: 0, width: params.width, height: 0 },
    font: params.theme.fonts[plan.titleFontRole],
    alignment: "left",
    macroBindings: params.macroBindings,
  });
  if (!title) {
    return null;
  }
  const bodyNode = params.node.children.find(
    (node): node is BeamerParagraphBodyNode => node.kind === "paragraph"
  );
  const body = bodyNode
    ? layoutParagraph({
        mapped: createIdentityMappedText(
          params.source.slice(bodyNode.span.from, bodyNode.span.to),
          bodyNode.span.from
        ),
        sourceSpan: bodyNode.span,
        paragraphId: `${params.node.id}:body`,
        role: "block-body",
        bounds: { x: 0, y: 0, width: params.width, height: 0 },
        font: params.theme.fonts[plan.bodyFontRole],
        alignment: "left",
        disableAutomaticHyphenation: true,
        macroBindings: params.macroBindings,
      })
    : null;
  const titleLine = title.layout.report.lines[0];
  const titleAscent = Number(titleLine?.ascent ?? firstLineBaselineOffset(title));
  const titleDepth = Number(titleLine?.descent ?? 0);
  const geometry = plan.geometry;
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
  const bodyParagraphTop =
    bodyBackgroundTop + geometry.bodyTopPaddingPt;
  const bodyExtent = body ? paragraphLineExtent(body) : 0;
  const bodyBackgroundHeight =
    geometry.bodyTopPaddingPt +
    bodyExtent +
    geometry.bodyExtraHeightPt;
  const backgroundBottom = bodyBackgroundTop + bodyBackgroundHeight;
  return {
    node: params.node,
    plan,
    width: params.width,
    title,
    body,
    titleAscent,
    titleDepth,
    titleBackgroundHeight,
    bodyBackgroundTop,
    bodyParagraphTop,
    bodyBackgroundHeight,
    backgroundTop,
    backgroundBottom,
    naturalHeight: backgroundBottom + geometry.boxBottomAdvancePt,
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
  params.modelBuilder.addPart({
    basePartId: `${block.node.id}:chrome`,
    sourceId: block.node.id,
    elementId: null,
    markup: blockChromeMarkup({
      block,
      x: params.x,
      y: params.y,
      titleFill: titleColor.bg ?? "transparent",
      bodyFill: bodyColor.bg ?? "transparent",
    }),
  });

  const titleY =
    params.y +
    block.backgroundTop +
    geometry.roundedTopInsetPt;
  block.title.layout.bounds = {
    ...block.title.layout.bounds,
    x: params.x,
    y: titleY,
  };
  params.paragraphs.push(block.title.layout);
  params.items.push({
    id: block.title.layout.paragraphId,
    kind: "text",
    sourceSpan: block.title.layout.sourceSpan,
    bounds: block.title.layout.bounds,
    parentId: block.node.id,
    paragraphId: block.title.layout.paragraphId,
  });
  params.modelBuilder.addPart({
    basePartId: block.title.layout.paragraphId,
    sourceId: block.title.layout.paragraphId,
    elementId: null,
    markup: paragraphMarkup(
      block.title.svgBody,
      params.x,
      titleY,
      titleColor.fg ?? textColor(params.theme, "normal text")
    ),
  });

  const childIds = [block.title.layout.paragraphId];
  if (block.body) {
    const bodyY = params.y + block.bodyParagraphTop;
    block.body.layout.bounds = {
      ...block.body.layout.bounds,
      x: params.x,
      y: bodyY,
      height: paragraphLineExtent(block.body),
    };
    params.paragraphs.push(block.body.layout);
    childIds.push(block.body.layout.paragraphId);
    params.items.push({
      id: block.body.layout.paragraphId,
      kind: "text",
      sourceSpan: block.body.layout.sourceSpan,
      bounds: block.body.layout.bounds,
      parentId: block.node.id,
      paragraphId: block.body.layout.paragraphId,
    });
    params.modelBuilder.addPart({
      basePartId: block.body.layout.paragraphId,
      sourceId: block.body.layout.paragraphId,
      elementId: null,
      markup: paragraphMarkup(
        block.body.svgBody,
        params.x,
        bodyY,
        bodyColor.fg ?? textColor(params.theme, "normal text")
      ),
    });
  }

  params.items.push({
    id: block.node.id,
    kind: "block",
    sourceSpan: block.node.span,
    bounds: outerBounds,
    parentId: params.parentId,
    childIds,
  });
}

function blockChromeMarkup(params: {
  block: PreparedBlock;
  x: number;
  y: number;
  titleFill: string;
  bodyFill: string;
}): string {
  const { block } = params;
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
  const roundedOutline =
    `M${fmt(left + radius)} ${fmt(top)}` +
    `H${fmt(right - radius)}` +
    `Q${fmt(right)} ${fmt(top)} ${fmt(right)} ${fmt(top + radius)}` +
    `V${fmt(bottom - radius)}` +
    `Q${fmt(right)} ${fmt(bottom)} ${fmt(right - radius)} ${fmt(bottom)}` +
    `H${fmt(left + radius)}` +
    `Q${fmt(left)} ${fmt(bottom)} ${fmt(left)} ${fmt(bottom - radius)}` +
    `V${fmt(top + radius)}` +
    `Q${fmt(left)} ${fmt(top)} ${fmt(left + radius)} ${fmt(top)}Z`;
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
  const shadowFilter = block.plan.shadow
    ? `<filter id="${filterId}" x="-10%" y="-10%" width="130%" height="140%"><feGaussianBlur stdDeviation="${fmt(1.25)}" /></filter>`
    : "";
  const shadowPath = block.plan.shadow
    ? `<path d="${roundedOutline}" transform="translate(${fmt(2)} ${fmt(2)})" fill="#000000" opacity="0.22" filter="url(#${filterId})" />`
    : "";
  return (
    `<g data-beamer-block-template="${block.plan.templateId}">` +
    `<defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${params.titleFill}" />` +
    `<stop offset="1" stop-color="${params.bodyFill}" />` +
    `</linearGradient>${shadowFilter}</defs>` +
    shadowPath +
    `<path d="${titlePath}" fill="${params.titleFill}" />` +
    `<path d="M${fmt(left)} ${fmt(titleBottom)}H${fmt(right)}V${fmt(bodyTop)}H${fmt(left)}Z" fill="url(#${gradientId})" />` +
    `<path d="${bodyPath}" fill="${params.bodyFill}" />` +
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
  laid.layout.bounds = {
    ...laid.layout.bounds,
    x: params.x,
    y: params.y,
    height: params.prepared.naturalHeight,
  };
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
      sourceSpan: laid.layout.sourceSpan,
      bounds: {
        x: params.x + marker.bounds.x,
        y: params.y + marker.bounds.y,
        width: marker.bounds.width,
        height: marker.bounds.height,
      },
      parentId: laid.layout.paragraphId,
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

function emitPreparedColumns(params: {
  prepared: Extract<PreparedFrameFlowItem, { kind: "columns" }>;
  referenceY: number;
  bounds: BeamerRect;
  items: BeamerFrameLayoutItem[];
  paragraphs: BeamerParagraphLayout[];
  embeddedTikz: BeamerEmbeddedTikzLayout[];
  modelBuilder: ReturnType<typeof createSvgModelBuilder>;
  theme: ResolvedBeamerTheme;
}): void {
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
      if (flowItem.kind === "vertical-space") {
        flowY += flowItem.height;
      } else if (flowItem.kind === "paragraph") {
        const laid = flowItem.paragraph;
        laid.layout.bounds = {
          ...laid.layout.bounds,
          x,
          y: flowY,
          height: flowItem.advanceHeight,
        };
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
            sourceSpan: laid.layout.sourceSpan,
            bounds: {
              x: x + marker.bounds.x,
              y: flowY + marker.bounds.y,
              width: marker.bounds.width,
              height: marker.bounds.height,
            },
            parentId: laid.layout.paragraphId,
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
        });
        childIds.push(flowItem.block.node.id);
        flowY +=
          flowItem.height +
          (preparedColumn.flow[flowIndex + 1]
            ? flowItem.block.plan.geometry.afterSkipPt
            : 0);
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

function emitEmbeddedTikz(params: {
  tikz: Extract<PreparedColumnFlowItem, { kind: "tikzpicture" }>;
  x: number;
  y: number;
  parentId: string;
  items: BeamerFrameLayoutItem[];
  embeddedTikz: BeamerEmbeddedTikzLayout[];
  modelBuilder: ReturnType<typeof createSvgModelBuilder>;
}): void {
  const { tikz } = params;
  const bounds = {
    x: params.x,
    y: params.y,
    width: tikz.width,
    height: tikz.height,
  };
  const scale = tikz.width / tikz.viewBox.width;
  const translateX = params.x - tikz.viewBox.x * scale;
  const translateY = params.y - tikz.viewBox.y * scale;
  const innerDefs = tikz.model.defs.length > 0
    ? `<defs>${tikz.model.defs.join("")}</defs>`
    : "";
  const innerBody = tikz.model.parts.map((part) => part.markup).join("");
  params.embeddedTikz.push({
    itemId: tikz.id,
    sourceSpan: tikz.sourceSpan,
    bounds,
    viewBox: tikz.viewBox,
    model: tikz.model,
  });
  params.items.push({
    id: tikz.id,
    kind: "tikzpicture",
    sourceSpan: tikz.sourceSpan,
    bounds,
    parentId: params.parentId,
  });
  params.modelBuilder.addPart({
    basePartId: tikz.id,
    sourceId: tikz.id,
    elementId: null,
    markup:
      `<g transform="translate(${fmt(translateX)} ${fmt(translateY)}) scale(${fmt(scale)})">` +
      innerDefs +
      innerBody +
      `</g>`,
  });
}

async function prepareColumnContent(params: {
  source: string;
  column: BeamerColumnBodyNode;
  textWidth: number;
  diagnostics: Diagnostic[];
  theme: ResolvedBeamerTheme;
  macroBindings: ReadonlyMap<string, MacroBinding>;
}): Promise<PreparedColumnContent> {
  const {
    source,
    column,
    textWidth,
    diagnostics,
    theme,
    macroBindings,
  } = params;
  const width = resolveColumnWidth(column.width.value, textWidth);
  const flow: PreparedColumnFlowItem[] = [];
  const bodyFont = theme.fonts["normal-text"];
  const listProfile = beamerListLayoutProfile(theme);
  let previousDepth: number | undefined;

  for (const node of column.children) {
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
    });
    if (prepared) {
      flow.push(prepared);
      if (prepared.kind === "paragraph") {
        previousDepth = paragraphLastLineDepth(prepared.paragraph);
      } else if (prepared.kind === "tikzpicture") {
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
  } = params;
  if (node.kind === "vertical-space") {
    return {
      kind: "vertical-space",
      height: resolveEmDimension(node.value.value) * bodyFont.sizePt,
    };
  }
  if (node.kind === "block") {
    const block = prepareBlock({
      source,
      node,
      width,
      theme,
      macroBindings,
    });
    return block
      ? { kind: "block", block, height: block.naturalHeight }
      : null;
  }
  if (node.kind === "paragraph" || node.kind === "list") {
    const text = source.slice(node.span.from, node.span.to);
    const paragraph = layoutParagraph({
      mapped: createIdentityMappedText(text, node.span.from),
      sourceSpan: node.span,
      paragraphId: node.id,
      role: "body",
      bounds: { x: 0, y: 0, width, height: 0 },
      font: bodyFont,
      alignment: "left",
      initialPreviousDepth,
      listProfile,
      macroBindings,
    });
    if (!paragraph) {
      return null;
    }
    return {
      kind: "paragraph",
      paragraph,
      // A plain TeX paragraph contributes its line hboxes, not the TikZ-node
      // strut carried by the shared text frontend's enclosing vlist. Lists,
      // on the other hand, intentionally carry their vertical list glue.
      advanceHeight: node.kind === "paragraph"
        ? paragraphLineExtent(paragraph)
        : paragraph.height,
      trailingSkipPt:
        node.kind === "list" ? trailingBeamerListSkip(text) : 0,
    };
  }
  if (node.kind === "unsupported") {
    diagnostics.push({
      severity: "warning",
      code: "beamer-render-unsupported-flow-node",
      message: node.message,
      span: node.span,
    });
    return null;
  }

  const snippet = source.slice(node.span.from, node.span.to);
  const rendered = await renderTikzToSvgAsync(
    applyThemeFamilyToTikz(snippet, bodyFont),
    {
      // A TikZ picture contributes its natural PGF bounding box to the
      // surrounding TeX hbox. The standalone renderer's presentation padding
      // is useful for an isolated SVG, but it is not part of that box.
      svg: { padding: 0 },
    }
  );
  const viewBox = rendered.svg.viewBox;
  const scale = Math.min(1, width / Math.max(viewBox.width, 1));
  for (const diagnostic of [
    ...rendered.parse.diagnostics,
    ...rendered.semantic.diagnostics,
  ]) {
    diagnostics.push({
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      span: node.span,
    });
  }
  return {
    kind: "tikzpicture",
    id: node.id,
    sourceSpan: node.span,
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
    if (item.kind === "tikzpicture") {
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

function paragraphLastLineDepth(paragraph: LaidParagraph): number {
  return Number(paragraph.layout.report.lines.at(-1)?.descent ?? 0);
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

function layoutParagraph(params: {
  mapped: MappedText;
  sourceSpan: Span;
  paragraphId: string;
  role: BeamerParagraphLayout["role"];
  bounds: BeamerRect;
  font: BeamerThemeFont;
  alignment: "left" | "center" | "right";
  interwordSpacePt?: number;
  initialPreviousDepth?: number;
  listProfile?: TexListLayoutProfile;
  disableAutomaticHyphenation?: boolean;
  macroBindings?: ReadonlyMap<string, MacroBinding>;
}): LaidParagraph | null {
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
  const result = layoutSimpleTexParagraph(mapped.text, {
    paragraphId: params.paragraphId,
    width: texLength(params.bounds.width),
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
      fontProfile: createBeamerTexMathFontProfile(params.font),
    }),
    baselineSkip: namedSize?.lineHeightPt ?? params.font.lineHeightPt,
    initialPreviousDepth: params.initialPreviousDepth,
    listProfile: params.listProfile ?? BEAMER_LIST_LAYOUT_PROFILE,
    displayMathProfile: BEAMER_NORMAL_DISPLAY_MATH_PROFILE,
    hyphenator: params.disableAutomaticHyphenation
      ? { hyphenate: () => [] }
      : undefined,
    sourceMap: mapped.sourceMap,
  });
  if (!result.supported || !result.report || !result.vlistLayout) {
    return null;
  }
  const height =
    result.vlistLayout.metrics.height + result.vlistLayout.metrics.depth;
  return {
    height,
    layout: {
      paragraphId: params.paragraphId,
      role: params.role,
      sourceSpan: params.sourceSpan,
      bounds: {
        ...params.bounds,
        height,
      },
      report: result.report,
      vlistLayout: result.vlistLayout,
    },
    svgBody: renderTexParagraphSvgBody(result.report, {
      lineHeightPt: texLength(params.font.lineHeightPt),
      vlistLayout: result.vlistLayout,
      metricProvider,
      textFontProfile,
      baseFontSizePt: fontSize,
      alignment,
    }),
    listMarkers: result.vlistLayout.boxReport.items
      .filter((item) =>
        item.hboxRole?.kind === "list-label" &&
        item.hboxRole.labelKind === "default"
      )
      .flatMap((item) => {
        const role = item.hboxRole;
        if (role?.kind !== "list-label") {
          return [];
        }
        const marker =
          role.listKind === "itemize"
            ? params.listProfile?.itemizeMarkersByDepth?.[
                Math.max(
                  0,
                  Math.min(
                    role.labelDepth - 1,
                    (params.listProfile.itemizeMarkersByDepth?.length ?? 1) - 1
                  )
                )
              ]
            : role.listKind === "enumerate"
              ? params.listProfile?.resolveEnumerateMarker?.(
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

function resolveColumnWidth(expression: string, textWidth: number): number {
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*\\textwidth$/.exec(
    expression
  );
  return match
    ? Math.max(0, Number(match[1]) * textWidth)
    : textWidth;
}

function resolveEmDimension(value: string): number {
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))em$/.exec(value);
  return match ? Number(match[1]) : 0;
}

function positionFrameContentTop(
  available: BeamerRect,
  contentHeight: number,
  alignment: "top" | "center" | "bottom"
): number {
  const freeHeight = Math.max(0, available.height - contentHeight);
  if (alignment === "top") {
    // beamerbaseframe.sty gives top-aligned frames a natural .2cm top skip;
    // their stretch is dominated by the bottom `1fill`.
    return available.y + Math.min(TOP_ALIGNED_FRAME_SKIP_PT, freeHeight);
  }
  if (alignment === "bottom") {
    return available.y + freeHeight;
  }
  // Beamer's default `c` frame uses 1fill above and 1.5fill below, so the
  // remaining vertical space is divided 2:3 rather than geometrically halved.
  return available.y + freeHeight * (1 / 2.5);
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
  return source.replace(
    /\\begin\s*\{tikzpicture\}(?:\s*\[([^\]]*)\])?/,
    (_whole, options: string | undefined) =>
      `\\begin{tikzpicture}[${options ? `${options},` : ""}font=${family}]`
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
  return fontRole === "footline" ? "footline" : "body";
}

function textColor(theme: ResolvedBeamerTheme, role: string): string {
  return resolveBeamerThemeColor(theme, role).fg ??
    resolveBeamerThemeColor(theme, "normal text").fg ??
    "#000000";
}

function paragraphMarkup(
  svgBody: string,
  x: number,
  y: number,
  color: string
): string {
  return `<g color="${color}" transform="translate(${fmt(x)} ${fmt(y)})">${svgBody}</g>`;
}

function rectMarkup(
  bounds: BeamerRect,
  fill: string,
  templatePart?: string
): string {
  const data = templatePart
    ? ` data-beamer-template-part="${templatePart}"`
    : "";
  return `<rect${data} x="${fmt(bounds.x)}" y="${fmt(bounds.y)}" width="${fmt(bounds.width)}" height="${fmt(bounds.height)}" fill="${fill}" />`;
}

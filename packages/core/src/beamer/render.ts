import type { Span } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import { renderTikzToSvgAsync } from "../render/index.js";
import { formatSvgNumber as fmt } from "../svg/format.js";
import {
  createSvgModelBuilder,
  serializeSvgModel,
} from "../svg/model.js";
import {
  createGeneratedMappedText,
  createIdentityMappedText,
  type MappedText,
} from "../text/source-map.js";
import {
  computerModernTexMetricProvider,
  createTexDerivedInlineMathBoxProvider,
  layoutSimpleTexParagraph,
  renderTexParagraphSvgBody,
  texLength,
} from "../text/tex/index.js";
import { parseBeamerFrameBody } from "./content.js";
import type {
  BeamerColumnBodyNode,
  BeamerColumnFlowNode,
  BeamerColumnsBodyNode,
} from "./content-types.js";
import { resolveBeamerPageGeometry } from "./geometry.js";
import { scanBeamerDocument } from "./scan.js";
import {
  createBeamerTexTextFontProfile,
  planBeamerFrameChrome,
  resolveBeamerTheme,
  resolveBeamerThemeColor,
} from "./theme/index.js";
import type {
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
};

type PreparedColumnFlowItem =
  | {
      kind: "paragraph";
      paragraph: LaidParagraph;
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
    };

type PreparedColumnContent = {
  column: BeamerColumnBodyNode;
  width: number;
  flow: PreparedColumnFlowItem[];
  naturalHeight: number;
};

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
  const columnsNode = bodyIr.children.find(
    (node): node is BeamerColumnsBodyNode => node.kind === "columns"
  );
  const columns = columnsNode?.columns ?? [];

  if (columns.length > 0) {
    const prepared = await Promise.all(
      columns.map((column) =>
        prepareColumnContent({
          source,
          column,
          textWidth: page.textArea.width,
          diagnostics,
          theme,
        })
      )
    );
    const totalHeight = Math.max(
      0,
      ...prepared.map((column) => column.naturalHeight)
    );
    const top = availableContentBounds.y +
      Math.max(0, (availableContentBounds.height - totalHeight) / 2);
    const columnGap = prepared.length > 1
      ? Math.max(
        0,
        (availableContentBounds.width -
          prepared.reduce((sum, column) => sum + column.width, 0)) /
          (prepared.length - 1)
      )
      : 0;
    const columnsId = columnsNode?.id ?? `${frame.id}:columns`;
    const columnChildIds: string[] = [];
    let x = availableContentBounds.x;

    for (let index = 0; index < prepared.length; index += 1) {
      const preparedColumn = prepared[index];
      const columnId = preparedColumn.column.id;
      columnChildIds.push(columnId);
      const childIds: string[] = [];
      let flowY = top;

      for (const flowItem of preparedColumn.flow) {
        if (flowItem.kind === "vertical-space") {
          flowY += flowItem.height;
          continue;
        }
        if (flowItem.kind === "paragraph") {
          const laid = flowItem.paragraph;
          laid.layout.bounds = {
            ...laid.layout.bounds,
            x,
            y: flowY,
          };
          paragraphs.push(laid.layout);
          childIds.push(laid.layout.paragraphId);
          items.push({
            id: laid.layout.paragraphId,
            kind: "text",
            sourceSpan: laid.layout.sourceSpan,
            bounds: laid.layout.bounds,
            parentId: columnId,
            paragraphId: laid.layout.paragraphId,
          });
          modelBuilder.addPart({
            basePartId: laid.layout.paragraphId,
            sourceId: laid.layout.paragraphId,
            elementId: null,
            markup: paragraphMarkup(
              laid.svgBody,
              x,
              flowY,
              textColor(theme, "normal text")
            ),
          });
          flowY += laid.height;
          continue;
        }

        const tikz = flowItem;
        const tikzId = tikz.id;
        const tikzX = x + (preparedColumn.width - tikz.width) / 2;
        const tikzY = flowY;
        const bounds = {
          x: tikzX,
          y: tikzY,
          width: tikz.width,
          height: tikz.height,
        };
        const scale = tikz.width / tikz.viewBox.width;
        const translateX = tikzX - tikz.viewBox.x * scale;
        const translateY = tikzY - tikz.viewBox.y * scale;
        const innerDefs = tikz.model.defs.length > 0
          ? `<defs>${tikz.model.defs.join("")}</defs>`
          : "";
        const innerBody = tikz.model.parts.map((part) => part.markup).join("");

        childIds.push(tikzId);
        embeddedTikz.push({
          itemId: tikzId,
          sourceSpan: tikz.sourceSpan,
          bounds,
          viewBox: tikz.viewBox,
          model: tikz.model,
        });
        items.push({
          id: tikzId,
          kind: "tikzpicture",
          sourceSpan: tikz.sourceSpan,
          bounds,
          parentId: columnId,
        });
        modelBuilder.addPart({
          basePartId: tikzId,
          sourceId: tikzId,
          elementId: null,
          markup:
            `<g transform="translate(${fmt(translateX)} ${fmt(translateY)}) scale(${fmt(scale)})">` +
            innerDefs +
            innerBody +
            `</g>`,
        });
        flowY += tikz.height;
      }

      items.push({
        id: columnId,
        kind: "column",
        sourceSpan: preparedColumn.column.span,
        bounds: {
          x,
          y: top,
          width: preparedColumn.width,
          height: preparedColumn.naturalHeight,
        },
        parentId: columnsId,
        childIds,
      });
      x += preparedColumn.width + columnGap;
    }

    items.push({
      id: columnsId,
      kind: "columns",
      sourceSpan: columnsNode?.span ?? frame.bodySpan,
      bounds: {
        x: availableContentBounds.x,
        y: top,
        width: availableContentBounds.width,
        height: totalHeight,
      },
      parentId: null,
      childIds: columnChildIds,
    });
    contentBounds = {
      ...availableContentBounds,
      y: top,
      height: totalHeight,
    };
  } else {
    items.push({
      id: `${frame.id}:unsupported-body`,
      kind: "unsupported",
      sourceSpan: frame.bodySpan,
      bounds: contentBounds,
      parentId: null,
      message:
        "Initial Beamer rendering currently supports column-based frame bodies.",
    });
    diagnostics.push({
      severity: "warning",
      code: "beamer-render-unsupported-body",
      message:
        "Initial Beamer rendering currently supports column-based frame bodies.",
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
    });
    if (!laid) {
      continue;
    }
    const freeHeight = Math.max(0, primitive.bounds.height - laid.height);
    const y = primitive.bounds.y +
      (primitive.verticalAlignment === "bottom"
        ? freeHeight
        : primitive.verticalAlignment === "center"
          ? freeHeight / 2
          : 0);
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

async function prepareColumnContent(params: {
  source: string;
  column: BeamerColumnBodyNode;
  textWidth: number;
  diagnostics: Diagnostic[];
  theme: ResolvedBeamerTheme;
}): Promise<PreparedColumnContent> {
  const {
    source,
    column,
    textWidth,
    diagnostics,
    theme,
  } = params;
  const width = resolveColumnWidth(column.width.value, textWidth);
  const flow: PreparedColumnFlowItem[] = [];
  const bodyFont = theme.fonts["normal-text"];

  for (const node of column.children) {
    const prepared = await prepareColumnFlowNode({
      source,
      node,
      width,
      bodyFont,
      diagnostics,
    });
    if (prepared) {
      flow.push(prepared);
    }
  }

  return {
    column,
    width,
    flow,
    naturalHeight: flow.reduce(
      (height, item) =>
        height +
        (item.kind === "paragraph"
          ? item.paragraph.height
          : item.height),
      0
    ),
  };
}

async function prepareColumnFlowNode(params: {
  source: string;
  node: BeamerColumnFlowNode;
  width: number;
  bodyFont: BeamerThemeFont;
  diagnostics: Diagnostic[];
}): Promise<PreparedColumnFlowItem | null> {
  const {
    source,
    node,
    width,
    bodyFont,
    diagnostics,
  } = params;
  if (node.kind === "vertical-space") {
    return {
      kind: "vertical-space",
      height: resolveEmDimension(node.value.value) * bodyFont.sizePt,
    };
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
    });
    return paragraph
      ? { kind: "paragraph", paragraph }
      : null;
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
    applyThemeFamilyToTikz(snippet, bodyFont)
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

function layoutParagraph(params: {
  mapped: MappedText;
  sourceSpan: Span;
  paragraphId: string;
  role: BeamerParagraphLayout["role"];
  bounds: BeamerRect;
  font: BeamerThemeFont;
  alignment: "left" | "center" | "right";
}): LaidParagraph | null {
  const fontSize = texLength(params.font.sizePt);
  const profile = createBeamerTexTextFontProfile(params.font);
  const resolvedFont = profile.resolveTextFont(
    profile.defaultFontState,
    fontSize,
    computerModernTexMetricProvider
  );
  const alignment =
    params.alignment === "center"
      ? "center"
      : params.alignment === "right"
        ? "ragged-left"
        : "ragged-right";
  const result = layoutSimpleTexParagraph(params.mapped.text, {
    paragraphId: params.paragraphId,
    width: texLength(params.bounds.width),
    alignment,
    font: resolvedFont,
    metricProvider: computerModernTexMetricProvider,
    textFontProfile: profile,
    tikzTextWidthNode: true,
    fallbackPolicy: "placeholder",
    mathBoxProvider: createTexDerivedInlineMathBoxProvider({
      baseAtPt: fontSize,
    }),
    sourceMap: params.mapped.sourceMap,
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
      metricProvider: computerModernTexMetricProvider,
      textFontProfile: profile,
      baseFontSizePt: fontSize,
      alignment,
    }),
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

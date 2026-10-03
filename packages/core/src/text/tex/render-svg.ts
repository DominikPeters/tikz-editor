import type { ParagraphLayoutReport } from "../knuth-plass/paragraph/report.js";
import type { SourceCoordinateSpace } from "../source-coordinates.js";
import {
  projectTexLineXToHBox,
  projectTexLineXToVList,
  texHBoxX,
  texHBoxY,
  texLength,
  texLineX,
  texVListLocalX,
  texVListLocalXFromOrigin,
  texVListLocalYFromOrigin,
  texVListX,
  texVListY,
  translateTexVListX,
  type TexHBoxX,
  type TexHBoxY,
  type TexLength,
  type TexLineX,
  type TexVListLocalX,
  type TexVListLocalY,
  type TexVListX,
  type TexVListY,
} from "./coordinates.js";
import { luaLatexDefaultTextFontProfile } from "./fonts/text-profile.js";
import { texGlyphSvgPath } from "./fonts/glyph-svg.js";
import type {
  ResolvedTexFont,
  TexMetricProvider,
  TexShapedItem,
} from "./fonts/types.js";
import type { TexParagraphAlignment } from "./ir.js";
import type { TexTextFontProfile } from "./fonts/text-profile.js";
import type {
  PositionedTexVListItem,
  TexRenderItem,
  TexVListLayout,
} from "./vlist/types.js";
import { TEX_MATH_SVG_UNITS_PER_PT } from "./math/render-svg.js";

const DEFAULT_TEX_SVG_BASE_FONT_SIZE_PT = texLength(10);

export interface RenderTexParagraphSvgBodyOptions<
  Space extends SourceCoordinateSpace = SourceCoordinateSpace,
> {
  readonly lineHeightPt: TexLength;
  readonly vlistLayout?: TexVListLayout<Space>;
  readonly metricProvider: TexMetricProvider;
  readonly alignment?: TexParagraphAlignment | null;
  readonly baseFontSizePt?: TexLength;
  readonly textFontProfile?: TexTextFontProfile;
}

type ResolvedTexSvgRenderContext = {
  readonly metricProvider: TexMetricProvider;
  readonly baseFontSizePt: TexLength;
  readonly textFontProfile: TexTextFontProfile;
};

/**
 * Render a source-backed TeX paragraph report, optionally with its positioned
 * vertical-list layout, into an SVG body fragment.
 *
 * The returned fragment retains paragraph, line, glyph, and source-range
 * metadata used by the editor hit-testing layer. It is position-independent:
 * callers place the returned root group in their own SVG composition.
 */
export function renderTexParagraphSvgBody<
  Space extends SourceCoordinateSpace,
>(
  report: ParagraphLayoutReport<Space>,
  options: RenderTexParagraphSvgBodyOptions<Space>
): string {
  const context = resolveTexSvgRenderContext(options);
  const alignAttr = options.alignment == null
    ? ""
    : ` data-align="${escapeXmlAttribute(texAlignAttributeValue(options.alignment))}"`;
  const pieces: string[] = [
    `<g data-paragraph-id="${escapeXmlAttribute(report.paragraphId)}"${alignAttr} fill="currentColor">`,
  ];
  if (options.vlistLayout) {
    pieces.push(renderTexVListSvgContent(report, {
      lineHeightPt: options.lineHeightPt,
      vlistLayout: options.vlistLayout,
      context,
    }));
    pieces.push("</g>");
    return pieces.join("");
  }
  const renderedLines = new Set<number>();
  for (const line of report.lines) {
    pieces.push(renderTexReportLineSvg(
      report,
      line,
      {
        lineHeightPt: options.lineHeightPt,
        context,
      },
      renderedLines
    ));
  }
  pieces.push("</g>");
  return pieces.join("");
}

function resolveTexSvgRenderContext(
  options: Pick<
    RenderTexParagraphSvgBodyOptions,
    "metricProvider" | "baseFontSizePt" | "textFontProfile"
  >
): ResolvedTexSvgRenderContext {
  return {
    metricProvider: options.metricProvider,
    baseFontSizePt: options.baseFontSizePt ?? DEFAULT_TEX_SVG_BASE_FONT_SIZE_PT,
    textFontProfile: options.textFontProfile ?? luaLatexDefaultTextFontProfile,
  };
}

function renderTexVListSvgContent<Space extends SourceCoordinateSpace>(
  report: ParagraphLayoutReport<Space>,
  options: {
    readonly lineHeightPt: TexLength;
    readonly vlistLayout: TexVListLayout<Space>;
    readonly context: ResolvedTexSvgRenderContext;
  }
): string {
  const renderedLines = new Set<number>();
  const lineByIndex = new Map(report.lines.map((line) => [line.lineIndex, line]));
  const linePlacementByIndex = new Map(
    options.vlistLayout.linePlacements.map((placement) => [placement.lineIndex, placement])
  );
  const paragraphLineIndicesByPath = new Map(
    options.vlistLayout.paragraphPlacements.map((placement) => [
      texVListPathKey(placement.vlistPath),
      placement.lineIndices,
    ])
  );
  const renderOptions: TexVListRenderOptions<Space> = {
    lineHeightPt: options.lineHeightPt,
    context: options.context,
    lineByIndex,
    linePlacementByIndex,
    paragraphLineIndicesByPath,
    originX: texVListX(0),
    originY: texVListY(0),
  };
  const pieces = renderTexVListItemsSvgContent(
    options.vlistLayout.items,
    report,
    renderOptions,
    renderedLines
  );
  for (const line of report.lines) {
    if (!renderedLines.has(line.lineIndex)) {
      throw new Error(
        `TeX vlist layout for paragraph '${report.paragraphId}' did not place line ${line.lineIndex}.`
      );
    }
  }
  return pieces.join("");
}

type TexVListRenderOptions<Space extends SourceCoordinateSpace> = {
  readonly lineHeightPt: TexLength;
  readonly context: ResolvedTexSvgRenderContext;
  readonly linePlacementByIndex: ReadonlyMap<
    number,
    TexVListLayout<Space>["linePlacements"][number]
  >;
  readonly lineByIndex: ReadonlyMap<
    number,
    ParagraphLayoutReport<Space>["lines"][number]
  >;
  readonly paragraphLineIndicesByPath: ReadonlyMap<string, readonly number[]>;
  readonly originX: TexVListX;
  readonly originY: TexVListY;
};

function renderTexVListItemsSvgContent<Space extends SourceCoordinateSpace>(
  items: readonly PositionedTexVListItem[],
  report: ParagraphLayoutReport<Space>,
  options: TexVListRenderOptions<Space>,
  renderedLines: Set<number>
): string[] {
  const pieces: string[] = [];
  for (const item of items) {
    if (item.item.kind === "paragraph") {
      const pathKey = texVListPathKey(item.path);
      const assignedLineIndices = options.paragraphLineIndicesByPath.get(pathKey);
      if (!assignedLineIndices) {
        throw new Error(
          `TeX vlist layout for paragraph '${report.paragraphId}' is missing placement for path ${pathKey}.`
        );
      }
      for (const lineIndex of assignedLineIndices) {
        const line = options.lineByIndex.get(lineIndex);
        if (!line) {
          throw new Error(
            `TeX vlist layout for paragraph '${report.paragraphId}' references missing line ${lineIndex}.`
          );
        }
        if (!renderedLines.has(line.lineIndex)) {
          pieces.push(renderTexReportLineSvg(
            report,
            line,
            {
              ...options,
              skipListLabelSegments: item.item.paragraph.listContext?.kind !== "description" && item.item.paragraph.listContext?.kind !== "bibliography",
            },
            renderedLines
          ));
        }
      }
      continue;
    }
    if (item.item.kind === "placeholder") {
      pieces.push(renderTexPlaceholderSvgMetadata(
        item,
        texLength(report.width),
        options,
        options.context
      ));
      continue;
    }
    if (item.item.kind === "rule") {
      pieces.push(renderTexRuleSvgContent(item, options));
      continue;
    }
    if (item.item.kind === "display-math") {
      pieces.push(renderTexDisplayMathSvgContent(
        item,
        options
      ));
      continue;
    }
    if (item.item.kind === "hbox" || item.item.kind === "penalty") {
      pieces.push(renderTexVListLeafBoxSvgMetadata(
        item,
        options.context,
        options
      ));
      continue;
    }
    if (item.item.kind === "vbox") {
      pieces.push(renderTexVBoxSvgMetadata(item, texLength(report.width), {
        ...options,
        close: false,
      }));
      if (item.children?.length) {
        pieces.push(...renderTexVListItemsSvgContent(
          item.children,
          report,
          {
            ...options,
            originX: item.x,
            originY: item.y,
          },
          renderedLines
        ));
      }
      pieces.push("</g>");
    }
  }
  return pieces;
}

function texVListPathKey(path: readonly number[]): string {
  return path.join(".");
}

function renderTexReportLineSvg<Space extends SourceCoordinateSpace>(
  report: ParagraphLayoutReport<Space>,
  line: ParagraphLayoutReport<Space>["lines"][number],
  options: {
    readonly lineHeightPt: TexLength;
    readonly linePlacementByIndex?: ReadonlyMap<
      number,
      TexVListLayout<Space>["linePlacements"][number]
    >;
    readonly context: ResolvedTexSvgRenderContext;
    readonly skipListLabelSegments?: boolean;
    readonly originX?: TexVListX;
    readonly originY?: TexVListY;
  },
  renderedLines: Set<number>
): string {
  renderedLines.add(line.lineIndex);
  const font = options.context.metricProvider.resolveFont({
    atPt: options.context.baseFontSizePt,
  });
  const lineTop = texReportLineTop(report.paragraphId, line.lineIndex, options);
  const lineLeft = texLineX(Number.isFinite(line.xStart) ? line.xStart : 0);
  const lineXOffset = texReportLineXOffset(line, lineLeft, options);
  const baseline = texHBoxY(line.ascent);
  const lineBoxHeight = texLength(
    options.linePlacementByIndex?.get(line.lineIndex)?.height ?? options.lineHeightPt
  );
  const lineRootX = translateTexVListX(
    projectTexLineXToVList(lineLeft, texLineX(0), texVListX(0)),
    lineXOffset
  );
  const lineBoxLeft = texVListLocalXFromOrigin(texVListX(0), lineRootX);
  const lineLeadingAttr = line.break?.lineLeading
    ? ` data-lineleading="${escapeXmlAttribute(line.break.lineLeading)}"`
    : "";
  const pieces = [
    `<g data-tex-linebox="true" data-line-index="${line.lineIndex}"${lineLeadingAttr} transform="translate(${formatPt(texVListSvgTranslateX(lineRootX, options.originX))} ${formatPt(texVListSvgTranslateY(lineTop, options.originY))})">`,
    `<rect x="${formatPt(lineBoxLeft)}" y="0" width="${formatPt(texLength(report.width))}" height="${formatPt(lineBoxHeight)}" fill="transparent" />`,
  ];
  for (const segment of line.segments) {
    if (options.skipListLabelSegments && segment.role === "list-label") {
      continue;
    }
    if (segment.kind === "math") {
      if (segment.mathSvgBody) {
        pieces.push(renderTexInlineMathSvg(
          segment.mathSvgBody,
          projectTexLineXToHBox(segment.x, lineLeft, texHBoxX(0)),
          baseline
        ));
      }
      continue;
    }
    if (segment.kind !== "text" && segment.kind !== "space") {
      continue;
    }
    const text = segment.text ?? "";
    if (!text) {
      continue;
    }
    const segmentFont = segment.fontId
      ? options.context.metricProvider.resolveFont({
        fontId: segment.fontId,
        atPt: texLength(segment.fontAtPt ?? options.context.baseFontSizePt),
      })
      : font;
    let segmentMarkup: string;
    if (typeof segment.glyphCode === "number") {
      segmentMarkup = renderTexGlyphCode(
        segment.glyphCode,
        segmentFont,
        projectTexLineXToHBox(segment.x, lineLeft, texHBoxX(0)),
        baseline,
        typeof segment.sourceStartRaw === "number" && typeof segment.sourceEndRaw === "number"
          ? { start: segment.sourceStartRaw, end: segment.sourceEndRaw }
          : undefined
      );
    } else {
      segmentMarkup = renderTexGlyphRun(
        text,
        segmentFont,
        projectTexLineXToHBox(segment.x, lineLeft, texHBoxX(0)),
        baseline,
        options.context.metricProvider,
        typeof segment.sourceStartRaw === "number" && typeof segment.sourceEndRaw === "number"
          ? { start: segment.sourceStartRaw, end: segment.sourceEndRaw }
          : undefined
      );
    }
    if (segment.literal) {
      const literalSpanAttrs =
        typeof segment.sourceStartRaw === "number" && typeof segment.sourceEndRaw === "number"
          ? ` data-source-start="${segment.sourceStartRaw}" data-source-end="${segment.sourceEndRaw}"`
          : "";
      segmentMarkup =
        `<g data-tex-literal="${escapeXmlAttribute(segment.literal.reason)}"${literalSpanAttrs}>` +
        segmentMarkup +
        "</g>";
    }
    if (segment.color) {
      segmentMarkup = `<g fill="${escapeXmlAttribute(segment.color)}">${segmentMarkup}</g>`;
    }
    pieces.push(segmentMarkup);
  }
  pieces.push("</g>");
  return pieces.join("");
}

function texReportLineXOffset<Space extends SourceCoordinateSpace>(
  line: ParagraphLayoutReport<Space>["lines"][number],
  lineLeft: TexLineX,
  options: {
    readonly linePlacementByIndex?: ReadonlyMap<
      number,
      TexVListLayout<Space>["linePlacements"][number]
    >;
  }
): TexVListLocalX {
  if (line.segments.some((segment) => segment.role === "list-label")) {
    return texVListLocalX(0);
  }
  const placement = options.linePlacementByIndex?.get(line.lineIndex);
  if (!placement) {
    return texVListLocalX(0);
  }
  const lineRootLeft = projectTexLineXToVList(
    lineLeft,
    texLineX(0),
    texVListX(0)
  );
  return texVListLocalX(Math.max(
    0,
    texVListLocalXFromOrigin(placement.x, lineRootLeft)
  ));
}

function renderTexInlineMathSvg(
  body: string,
  x: TexHBoxX,
  baseline: TexHBoxY
): string {
  return `<g data-tex-inline-math="true" transform="translate(${formatPt(x)} ${formatPt(baseline)}) scale(${formatPt(texLength(1 / TEX_MATH_SVG_UNITS_PER_PT))})">${body}</g>`;
}

function texReportLineTop<Space extends SourceCoordinateSpace>(
  paragraphId: string,
  lineIndex: number,
  options: {
    readonly lineHeightPt?: TexLength;
    readonly linePlacementByIndex?: ReadonlyMap<
      number,
      TexVListLayout<Space>["linePlacements"][number]
    >;
  }
): TexVListY {
  if (options.linePlacementByIndex) {
    const placement = options.linePlacementByIndex.get(lineIndex);
    if (!placement) {
      throw new Error(
        `TeX vlist layout for paragraph '${paragraphId}' is missing line placement ${lineIndex}.`
      );
    }
    return placement.y;
  }
  return texVListY(lineIndex * (options.lineHeightPt ?? 0));
}

export function renderTexVListSvgMetadata(
  items: readonly PositionedTexVListItem[],
  width: number
): string {
  return renderTexVListSvgMetadataItems(items, texLength(width), {
    originX: texVListX(0),
    originY: texVListY(0),
  });
}

type TexVListSvgOrigin = {
  readonly originX?: TexVListX;
  readonly originY?: TexVListY;
};

function texVListSvgTranslateX(
  position: TexVListX,
  origin?: TexVListX
): TexVListLocalX {
  return texVListLocalXFromOrigin(position, origin ?? texVListX(0));
}

function texVListSvgTranslateY(
  position: TexVListY,
  origin?: TexVListY
): TexVListLocalY {
  return texVListLocalYFromOrigin(position, origin ?? texVListY(0));
}

function renderTexVListSvgMetadataItems(
  items: readonly PositionedTexVListItem[],
  width: TexLength,
  origin: TexVListSvgOrigin
): string {
  const pieces: string[] = [];
  for (const item of items) {
    if (item.item.kind === "placeholder") {
      pieces.push(renderTexPlaceholderSvgMetadata(item, width, origin));
      continue;
    }
    if (item.item.kind === "hbox" || item.item.kind === "penalty" || item.item.kind === "rule") {
      pieces.push(renderTexVListLeafBoxSvgMetadata(item, undefined, origin));
      continue;
    }
    if (item.item.kind === "display-math") {
      pieces.push(renderTexDisplayMathSvgContent(
        item,
        origin
      ));
      continue;
    }
    if (item.item.kind !== "vbox") {
      continue;
    }
    pieces.push(renderTexVBoxSvgMetadata(item, width, { ...origin, close: false }));
    if (item.children?.length) {
      pieces.push(renderTexVListSvgMetadataItems(
        item.children,
        width,
        { originX: item.x, originY: texVListY(item.y) }
      ));
    }
    pieces.push("</g>");
  }
  return pieces.join("");
}

function renderTexVBoxSvgMetadata(
  item: PositionedTexVListItem,
  width: TexLength,
  options: TexVListSvgOrigin & { readonly close?: boolean } = {}
): string {
  if (item.item.kind !== "vbox") {
    return "";
  }
  const boxWidth = texLength(Math.max(width, item.metrics.width));
  const boxHeight = texLength(item.metrics.height + item.metrics.depth);
  const pieces = [
    `<g transform="translate(${formatPt(texVListSvgTranslateX(item.x, options.originX))} ${formatPt(texVListSvgTranslateY(texVListY(item.y), options.originY))})" pointer-events="none">`,
    `<rect x="0" y="0" width="${formatPt(boxWidth)}" height="${formatPt(boxHeight)}" fill="none" />`,
  ];
  if (options.close ?? true) {
    pieces.push("</g>");
  }
  return pieces.join("");
}

function renderTexPlaceholderSvgMetadata(
  item: PositionedTexVListItem,
  width: TexLength,
  origin: TexVListSvgOrigin = {},
  context?: ResolvedTexSvgRenderContext
): string {
  if (item.item.kind !== "placeholder") {
    return "";
  }
  const boxHeight = texLength(item.metrics.height + item.metrics.depth);
  const boxWidth = texLength(Math.max(width, item.metrics.width));
  const pieces = [
    `<g transform="translate(${formatPt(texVListSvgTranslateX(item.x, origin.originX))} ${formatPt(texVListSvgTranslateY(texVListY(item.y), origin.originY))})" pointer-events="none">`,
    `<rect x="0" y="0" width="${formatPt(boxWidth)}" height="${formatPt(boxHeight)}" fill="none" />`,
  ];
  const literalText = item.item.literalText;
  if (literalText && context) {
    pieces.push(renderTexPlaceholderLiteralSvg(
      literalText,
      item.item.sourceSpan,
      texHBoxY(item.metrics.height),
      context
    ));
  }
  pieces.push("</g>");
  return pieces.join("");
}

function renderTexPlaceholderLiteralSvg(
  literalText: string,
  sourceSpan: { readonly start: number; readonly end: number },
  baseline: TexHBoxY,
  context: ResolvedTexSvgRenderContext
): string {
  const font = context.textFontProfile.resolveTextFont(
    { family: "typewriter", series: "medium", shape: "upright" },
    context.baseFontSizePt,
    context.metricProvider
  );
  // The literal face is monospaced, so a single shaped character gives the
  // advance used for word spacing.
  const spaceAdvance = texLength(context.metricProvider.shapeText("x", font).width);
  const pieces = [
    `<g data-tex-literal="display-math-unsupported" data-source-start="${sourceSpan.start}" data-source-end="${sourceSpan.end}">`,
  ];
  let cursor = texHBoxX(0);
  const pattern = /([ \n]+)|([^ \n]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(literalText)) !== null) {
    if (match[1] !== undefined) {
      cursor = texHBoxX(cursor + spaceAdvance * match[1].length);
      continue;
    }
    pieces.push(renderTexGlyphRun(
      match[0],
      font,
      cursor,
      baseline,
      context.metricProvider
    ));
    cursor = texHBoxX(
      cursor + context.metricProvider.shapeText(match[0], font).width
    );
  }
  pieces.push("</g>");
  return pieces.join("");
}

function renderTexVListLeafBoxSvgMetadata(
  item: PositionedTexVListItem,
  context?: ResolvedTexSvgRenderContext,
  origin: TexVListSvgOrigin = {}
): string {
  if (item.item.kind !== "hbox" && item.item.kind !== "penalty" && item.item.kind !== "rule") {
    return "";
  }
  const boxHeight = texLength(item.metrics.height + item.metrics.depth);
  const roleAttribute = item.item.kind === "hbox" && item.item.role
    ? ` data-tex-hbox-role="${item.item.role.kind}"` +
      (item.item.role.kind === "list-label"
        ? ` data-tex-list-item-index="${item.item.role.itemIndex}"` +
          (item.item.role.itemCommandSpan
            ? ` data-source-start="${item.item.role.itemCommandSpan.start}" data-source-end="${item.item.role.itemCommandSpan.end}"`
            : "")
        : "")
    : "";
  return [
    `<g${roleAttribute} transform="translate(${formatPt(texVListSvgTranslateX(item.x, origin.originX))} ${formatPt(texVListSvgTranslateY(texVListY(item.y), origin.originY))})" pointer-events="none">`,
    `<rect x="0" y="0" width="${formatPt(texLength(item.metrics.width))}" height="${formatPt(boxHeight)}" fill="none" />`,
    ...(item.item.kind === "hbox" && context
      ? item.item.box.renderItems.map((renderItem) =>
          renderTexHBoxRenderItemSvg(renderItem, context)
        )
      : []),
    "</g>",
  ].join("");
}

function renderTexDisplayMathSvgContent(
  item: PositionedTexVListItem,
  origin: TexVListSvgOrigin = {}
): string {
  if (item.item.kind !== "display-math") {
    return "";
  }
  const boxHeight = texLength(item.metrics.height + item.metrics.depth);
  return [
    `<g data-tex-display-math="true" data-source-start="${item.item.sourceSpan.start}" data-source-end="${item.item.sourceSpan.end}" transform="translate(${formatPt(texVListSvgTranslateX(item.x, origin.originX))} ${formatPt(texVListSvgTranslateY(texVListY(item.y), origin.originY))})" pointer-events="none">`,
    `<rect x="0" y="0" width="${formatPt(texLength(item.metrics.width))}" height="${formatPt(boxHeight)}" fill="none" />`,
    renderTexInlineMathSvg(
      item.item.box.svgBody ?? "",
      texHBoxX(0),
      texHBoxY(item.metrics.height)
    ),
    "</g>",
  ].join("");
}

function renderTexHBoxRenderItemSvg(
  item: TexRenderItem,
  context: ResolvedTexSvgRenderContext
): string {
  if (item.kind === "tex-math-svg") {
    return renderTexInlineMathSvg(
      item.svgBody,
      texHBoxX(item.x),
      texHBoxY(item.baseline)
    );
  }
  const font = context.metricProvider.resolveFont({
    fontId: item.fontId,
    atPt: texLength(item.atPt),
  });
  const body = item.kind === "tex-glyph"
    ? renderTexGlyphCode(item.code, font, texHBoxX(item.x), texHBoxY(item.baseline), item.sourceSpan)
    : renderTexGlyphRun(
      item.text,
      font,
      texHBoxX(item.x),
      texHBoxY(item.baseline),
      context.metricProvider
    );
  return item.color ? `<g fill="${escapeXmlAttribute(item.color)}">${body}</g>` : body;
}

function renderTexRuleSvgContent(
  item: PositionedTexVListItem,
  origin: TexVListSvgOrigin = {}
): string {
  if (item.item.kind !== "rule") {
    return "";
  }
  const boxHeight = texLength(item.metrics.height + item.metrics.depth);
  return [
    `<g transform="translate(${formatPt(texVListSvgTranslateX(item.x, origin.originX))} ${formatPt(texVListSvgTranslateY(texVListY(item.y), origin.originY))})" pointer-events="none">`,
    `<rect x="0" y="0" width="${formatPt(texLength(item.metrics.width))}" height="${formatPt(boxHeight)}" fill="currentColor" />`,
    "</g>",
  ].join("");
}

function renderTexGlyphRun(
  text: string,
  font: ResolvedTexFont,
  x: TexHBoxX,
  baseline: TexHBoxY,
  metricProvider: TexMetricProvider,
  sourceSpan?: { readonly start: number; readonly end: number }
): string {
  const shaped = metricProvider.shapeText(
    text,
    font,
    {
      ...(sourceSpan ? { sourceStart: sourceSpan.start } : {}),
      includeCaretStops: false,
    }
  );
  const pieces: string[] = [];
  let placement: TexGlyphSvgPlacement | undefined;
  let cursor = texHBoxX(x);
  for (const item of shaped.items) {
    if (item.kind === "kern") {
      cursor = texHBoxX(cursor + item.width);
      continue;
    }
    if (item.code === 32) {
      cursor = texHBoxX(cursor + item.width);
      continue;
    }
    placement ??= texGlyphSvgPlacement(font, baseline);
    const glyphItem = sourceSpan && text.length === 1
      ? { ...item, sourceStart: sourceSpan.start, sourceEnd: sourceSpan.end }
      : item;
    pieces.push(renderTexGlyphPath(
      glyphItem,
      font,
      cursor,
      baseline,
      Boolean(sourceSpan),
      placement
    ));
    cursor = texHBoxX(cursor + item.width);
  }
  return pieces.join("");
}

function renderTexGlyphCode(
  code: number,
  font: ResolvedTexFont,
  x: TexHBoxX,
  baseline: TexHBoxY,
  sourceSpan?: { readonly start: number; readonly end: number }
): string {
  return renderTexGlyphPath({
    kind: "glyph",
    fontId: font.id,
    code,
    sourceStart: sourceSpan?.start ?? 0,
    sourceEnd: sourceSpan?.end ?? 0,
    width: texLength(0),
    height: texLength(0),
    depth: texLength(0),
    italicCorrection: texLength(0),
    components: [code],
  }, font, x, baseline, Boolean(sourceSpan));
}

function renderTexGlyphPath(
  item: Extract<TexShapedItem, { kind: "glyph" }>,
  font: ResolvedTexFont,
  x: TexHBoxX,
  baseline: TexHBoxY,
  sourceBacked = false,
  placement?: TexGlyphSvgPlacement
): string {
  if (item.code === 32) {
    return "";
  }
  const d = texGlyphSvgPath(font, item.code);
  if (!d) {
    return "";
  }
  const formatted = placement ?? texGlyphSvgPlacement(font, baseline);
  const sourceAttrs = sourceBacked
    ? ` data-source-start="${item.sourceStart}" data-source-end="${item.sourceEnd}"`
    : "";
  return `<path data-tex-font="${formatted.fontId}" data-tex-glyph="${item.code}"${sourceAttrs} d="${d}" transform="translate(${formatPt(x)} ${formatted.baseline})${formatted.scaleSuffix}" data-tex-font-at-pt="${formatPt(font.atPt)}" />`;
}

type TexGlyphSvgPlacement = {
  readonly fontId: string;
  readonly baseline: string;
  readonly scaleSuffix: string;
};

function texGlyphSvgPlacement(font: ResolvedTexFont, baseline: TexHBoxY): TexGlyphSvgPlacement {
  const scale = font.atPt / 10;
  return {
    fontId: escapeXmlAttribute(font.id),
    baseline: formatPt(baseline),
    scaleSuffix: Math.abs(scale - 1) > 1e-6 ? ` scale(${formatPt(scale)})` : "",
  };
}

function texAlignAttributeValue(alignment: TexParagraphAlignment): string {
  switch (alignment) {
    case "ragged-left":
      return "right";
    case "center":
      return "center";
    case "justified":
      return "justify";
    case "ragged-right":
    default:
      return "left";
  }
}

function formatPt(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return Number(value.toFixed(6)).toString();
}

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

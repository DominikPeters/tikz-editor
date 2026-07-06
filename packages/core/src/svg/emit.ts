import type {
  ResolvedPattern,
  ResolvedStyle,
  SceneClipPath,
  SceneElement,
  SceneFigure,
  ScenePathCommand,
  ShadowLayer
} from "../semantic/types.js";
import { pt } from "../coords/scalars.js";
import { svgBounds, svgPoint } from "../coords/points.js";
import type { SvgBounds, SvgPoint, WorldPoint } from "../coords/points.js";
import type { SvgTransform, WorldTransform } from "../coords/transforms.js";
import { worldToSvgPoint as convertWorldToSvgPoint, mapWorldTransformToSvgTransform as convertWorldToSvgTransform } from "../coords/svg.js";
import { COLOR_HEX } from "../semantic/style/constants.js";
import { SHADOW_INHERIT_FILL, SHADOW_INHERIT_STROKE } from "../semantic/types.js";
import { renderPathWithArrows } from "./arrows/render.js";
import { computeSvgEllipseBounds, computeSvgPathBounds, transformSvgBounds } from "./geometry.js";
import type { RenderedArrowTipPath } from "./arrows/types.js";
import { createSvgModelBuilder, serializeSvgModel } from "./model.js";
import { computeViewBox } from "./viewbox.js";
import type { EmitSvgOptions, EmitSvgResult, SvgRenderModel, SvgRenderPart, SvgViewBox } from "./types.js";
import { formatSvgNumber as fmt } from "./format.js";

type ShadowRenderableStyle = Pick<
  ResolvedStyle,
  | "stroke"
  | "fill"
  | "fillPattern"
  | "patternColor"
  | "fillRule"
  | "doubleStroke"
  | "doubleDistance"
  | "doubleLineCenterDistance"
  | "doubleColor"
  | "lineWidth"
  | "dashArray"
  | "dashOffset"
  | "lineCap"
  | "lineJoin"
  | "opacity"
  | "strokeOpacity"
  | "fillOpacity"
  | "shadeEnabled"
  | "shading"
  | "shadingAngle"
  | "axisTopColor"
  | "axisMiddleColor"
  | "axisBottomColor"
  | "radialInnerColor"
  | "radialOuterColor"
  | "ballColor"
  | "bilinearLowerLeft"
  | "bilinearLowerRight"
  | "bilinearUpperLeft"
  | "bilinearUpperRight"
>;

type PatternRenderableStyle = Pick<ResolvedStyle, "fill" | "fillPattern" | "patternColor">;

type PatternRenderContext = {
  globalYPhase: number;
};

type ShadingTransform = {
  centerX: number;
  centerY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
};

type SvgModelReuseContext = {
  affectedSourceIds: Set<string>;
  previousPartsByElementId: Map<string, SvgRenderPart[]>;
};

type AppendSvgPart = (basePartId: string, sourceId: string, elementId: string | null, markup: string) => void;

type ResolveFillPaint = (style: ShadowRenderableStyle, sourceId: string, bounds: SvgBounds | null) => string | null;

type StyledSvgShape =
  | { kind: "path"; d: string }
  | { kind: "circle"; cx: number; cy: number; radius: number }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number };

const PGF_SHADE_SCALE_FACTOR = 0.01992528;
const PGF_SHADE_CANONICAL_SIZE = 100.375;
const PGF_SHADE_CANONICAL_HALF = PGF_SHADE_CANONICAL_SIZE / 2;
const PGF_BALL_FOCUS_OFFSET = PGF_SHADE_CANONICAL_HALF * 0.2;
const PLAIN_TEXT_SERIF_FONT_STACK = "MJX-NCM, CMU Serif, Latin Modern Roman, Times New Roman, serif";
const PLAIN_TEXT_SANS_FONT_STACK = "MJX-NCM-Sans, CMU Sans Serif, Latin Modern Sans, Helvetica, Arial, sans-serif";
const PLAIN_TEXT_MONO_FONT_STACK = "MJX-NCM-Monospace, Latin Modern Mono, CMU Typewriter Text, Courier New, monospace";

export function emitSvg(scene: SceneFigure, opts: EmitSvgOptions = {}): EmitSvgResult {
  const model = emitSvgModel(scene, opts);
  return {
    svg: serializeSvgModel(model, opts.includeXmlns !== false),
    viewBox: model.viewBox,
    model,
    diagnostics: model.diagnostics
  };
}

export function emitSvgModel(scene: SceneFigure, opts: EmitSvgOptions = {}): SvgRenderModel {
  const padding = opts.padding ?? 12;
  const viewBox = opts.viewBox ?? computeViewBox(scene, padding);

  const diagnostics: EmitSvgResult["diagnostics"] = [];
  const modelBuilder = createSvgModelBuilder();
  const gradientIdBySignature = new Map<string, string>();
  const gradientDefById = new Map<string, string>();
  const patternIdBySignature = new Map<string, string>();
  const patternDefById = new Map<string, string>();
  const shadowMaskDefById = new Map<string, string>();
  const clipPathSvgIdBySceneId = new Map<string, string>();
  const clipPathDefBySceneId = new Map<string, string>();
  const unsupportedShadingNames = new Set<string>();
  const elementClipChainsById = new Map<string, readonly SceneClipPath[]>(
    scene.elements.map((element) => [element.id, element.clipChain ?? []])
  );

  const appendPart = (
    basePartId: string,
    sourceId: string,
    elementId: string | null,
    markup: string
  ): void => {
    const clipChain = elementId ? elementClipChainsById.get(elementId) : undefined;
    const wrappedMarkup = clipChain && clipChain.length > 0 ? wrapMarkupWithClipChain(markup, clipChain) : markup;
    modelBuilder.addPart({
      basePartId,
      sourceId,
      elementId,
      markup: wrappedMarkup
    });
  };

  const ensureGradientDefinition = (signature: string, kind: string, buildDef: (id: string) => string): string => {
    const existing = gradientIdBySignature.get(signature);
    if (existing) {
      return existing;
    }

    const id = `tikz-shading-${kind}-${stableSvgIdComponent(signature)}`;
    gradientIdBySignature.set(signature, id);
    gradientDefById.set(id, buildDef(id));
    return id;
  };

  const ensurePatternDefinition = (signature: string, buildDef: (id: string) => string): string => {
    const existing = patternIdBySignature.get(signature);
    if (existing) {
      return existing;
    }

    const id = `tikz-pattern-${stableSvgIdComponent(signature)}`;
    patternIdBySignature.set(signature, id);
    patternDefById.set(id, buildDef(id));
    return id;
  };

  const ensureCircularShadowMaskDefinition = (): string => {
    const id = "tikz-shadow-mask-circle-fuzzy-15";
    if (shadowMaskDefById.has(id)) {
      return id;
    }

    shadowMaskDefById.set(id, renderCircularShadowMaskDefinition(id, `${id}-gradient`));
    return id;
  };

  const ensureClipPathDefinition = (clipPath: SceneClipPath): string | null => {
    const existing = clipPathSvgIdBySceneId.get(clipPath.id);
    if (existing) {
      return existing;
    }
    const d = encodePathData(clipPath.commands, viewBox);
    if (d.length === 0) {
      return null;
    }
    const svgId = `tikz-clip-${clipPathSvgIdBySceneId.size + 1}`;
    clipPathSvgIdBySceneId.set(clipPath.id, svgId);
    clipPathDefBySceneId.set(
      clipPath.id,
      `<clipPath id="${svgId}" clipPathUnits="userSpaceOnUse"><path d="${escapeAttr(d)}"${
        clipPath.fillRule === "evenodd" ? ` clip-rule="evenodd"` : ""
      } /></clipPath>`
    );
    return svgId;
  };

  const wrapMarkupWithClipChain = (markup: string, clipChain: readonly SceneClipPath[]): string => {
    let wrapped = markup;
    for (const clipPath of clipChain) {
      const clipSvgId = ensureClipPathDefinition(clipPath);
      if (!clipSvgId) {
        continue;
      }
      wrapped = `<g clip-path="url(#${escapeAttr(clipSvgId)})">${wrapped}</g>`;
    }
    return wrapped;
  };

  const resolveShadingFill = (style: ShadowRenderableStyle, sourceId: string, bounds: SvgBounds | null): string | null => {
    if (!style.shadeEnabled) {
      return null;
    }

    const shadingTransform = bounds ? computeShadingTransform(bounds, style.shadingAngle) : null;
    if (!shadingTransform) {
      return null;
    }

    const shadingName = normalizeShadingName(style.shading);
    if (!shadingName || shadingName === "axis") {
      const signature = JSON.stringify({
        kind: "axis",
        transform: signatureShadingTransform(shadingTransform),
        top: style.axisTopColor,
        middle: style.axisMiddleColor,
        bottom: style.axisBottomColor
      });
      const id = ensureGradientDefinition(signature, "axis", (gradientId) =>
        renderAxisGradientDefinition(gradientId, shadingTransform, style.axisTopColor, style.axisMiddleColor, style.axisBottomColor)
      );
      return `url(#${id})`;
    }

    if (shadingName === "radial") {
      const signature = JSON.stringify({
        kind: "radial",
        transform: signatureShadingTransform(shadingTransform),
        inner: style.radialInnerColor,
        outer: style.radialOuterColor
      });
      const id = ensureGradientDefinition(signature, "radial", (gradientId) =>
        renderRadialGradientDefinition(gradientId, shadingTransform, style.radialInnerColor, style.radialOuterColor)
      );
      return `url(#${id})`;
    }

    if (shadingName === "ball") {
      const signature = JSON.stringify({
        kind: "ball",
        transform: signatureShadingTransform(shadingTransform),
        color: style.ballColor
      });
      const id = ensureGradientDefinition(signature, "ball", (gradientId) =>
        renderBallGradientDefinition(gradientId, shadingTransform, style.ballColor)
      );
      return `url(#${id})`;
    }

    if (!unsupportedShadingNames.has(shadingName)) {
      unsupportedShadingNames.add(shadingName);
      diagnostics.push({
        code: `unsupported-shading:${shadingName}`,
        message: `Shading "${shadingName}" is not currently supported in SVG output (source ${sourceId}).`
      });
    }

    return null;
  };

  const patternGlobalYPhase = viewBox.y * 2 + viewBox.height;

  const resolvePatternFill = (style: PatternRenderableStyle): string | null => {
    if (!style.fillPattern || !style.fill || style.fill === "none") {
      return null;
    }

    const pattern = style.fillPattern;
    const effectivePatternColor = pattern.kind === "legacy" && pattern.inherentlyColored ? null : style.patternColor;
    const signature = JSON.stringify({
      pattern,
      patternColor: effectivePatternColor
    });
    const id = ensurePatternDefinition(signature, (patternId) =>
      renderPatternDefinition(patternId, pattern, effectivePatternColor, patternGlobalYPhase)
    );
    return `url(#${id})`;
  };

  const resolveFillPaint = (style: ShadowRenderableStyle, sourceId: string, bounds: SvgBounds | null): string | null => {
    return resolveShadingFill(style, sourceId, bounds) ?? resolvePatternFill(style);
  };

  const reuseContext = createSvgModelReuseContext(scene, opts.reuse, viewBox);

  const registerDefsForElement = (element: SceneElement): void => {
    for (const clipPath of element.clipChain ?? []) {
      ensureClipPathDefinition(clipPath);
    }
    const needsShadowDefs = element.style.shadowLayers.length > 0;
    const needsShadingDefs = element.style.shadeEnabled;
    const needsPatternDefs = hasActivePatternFill(element.style);
    if (!needsShadowDefs && !needsShadingDefs) {
      if (needsPatternDefs) {
        resolvePatternFill(element.style);
      }
      return;
    }
    let elementBounds: SvgBounds | null;
    const svgElementTransform = element.transform ? worldTransformToSvgTransform(element.transform, viewBox) : null;
    if (element.kind === "Path") {
      if (!hasDrawablePathCommands(element.commands)) {
        return;
      }
      const renderedPath = renderPathWithArrows(element);
      if (!hasDrawablePathCommands(renderedPath.shaftCommands)) {
        return;
      }
      const d = encodePathData(renderedPath.shaftCommands, viewBox);
      if (d.length === 0) {
        return;
      }
      elementBounds = computeSvgPathBounds(renderedPath.shaftCommands, viewBox);
      if (elementBounds && svgElementTransform) {
        elementBounds = transformSvgBounds(elementBounds, svgElementTransform);
      }
    } else if (element.kind === "Circle") {
      const center = toSvgPoint(element.center, viewBox);
      elementBounds = svgBounds(
        pt(center.x - element.radius),
        pt(center.y - element.radius),
        pt(center.x + element.radius),
        pt(center.y + element.radius)
      );
      if (svgElementTransform) {
        elementBounds = transformSvgBounds(elementBounds, svgElementTransform);
      }
    } else if (element.kind === "Ellipse") {
      const center = toSvgPoint(element.center, viewBox);
      elementBounds = computeSvgEllipseBounds(center.x, center.y, element.rx, element.ry, element.rotation ?? 0);
      if (svgElementTransform) {
        elementBounds = transformSvgBounds(elementBounds, svgElementTransform);
      }
    } else {
      return;
    }

    for (const layer of element.style.shadowLayers) {
      const layerStyle = resolveShadowLayerStyle(layer.style as ShadowRenderableStyle, element.style);
      if (layer.fade === "circle-fuzzy-edge-15") {
        ensureCircularShadowMaskDefinition();
      }
      resolveFillPaint(layerStyle, element.sourceRef.sourceId, elementBounds);
    }
    resolveFillPaint(element.style, element.sourceRef.sourceId, elementBounds);
  };

  for (const element of scene.elements) {
    if (reuseContext) {
      registerDefsForElement(element);
      if (tryReuseElementParts(modelBuilder, reuseContext, element)) {
        continue;
      }
    }

    if (element.kind === "Path") {
      if (!hasDrawablePathCommands(element.commands)) {
        diagnostics.push({
          code: "empty-path",
          message: `Skipping path ${element.id} because it has no drawable segments.`
        });
        continue;
      }

      const renderedPath = renderPathWithArrows(element);
      const shaftHasDrawableSegment = hasDrawablePathCommands(renderedPath.shaftCommands);
      if (shaftHasDrawableSegment) {
        const d = encodePathData(renderedPath.shaftCommands, viewBox);
        if (d.length > 0) {
          const svgElementTransform = element.transform ? worldTransformToSvgTransform(element.transform, viewBox) : null;
          const rawPathBounds = computeSvgPathBounds(renderedPath.shaftCommands, viewBox);
          if (!rawPathBounds) {
            continue;
          }
          const pathBounds = svgElementTransform ? transformSvgBounds(rawPathBounds, svgElementTransform) : rawPathBounds;
          emitShadowShapeParts({
            appendPart,
            sourceId: element.sourceRef.sourceId,
            elementId: element.id,
            shadowPartKind: "path",
            shape: { kind: "path", d },
            bounds: pathBounds,
            shadowLayers: element.style.shadowLayers,
            baseStyle: element.style,
            resolveFillPaint,
            ensureCircularShadowMaskDefinition
          });

          appendStyledShapeParts({
            appendPart,
            basePartId: `${element.id}:shaft`,
            sourceId: element.sourceRef.sourceId,
            elementId: element.id,
            shape: { kind: "path", d },
            style: element.style,
            bounds: pathBounds,
            resolveFillPaint,
            transforms: svgElementTransform ? [formatMatrix(svgElementTransform)] : []
          });
        }
      }

      for (const tipPath of renderedPath.tipPaths) {
        const d = encodePathData(tipPath.commands, viewBox);
        if (d.length === 0) {
          continue;
        }
        const attrs = arrowTipAttributes(element.style, tipPath);
        const svgElementTransform = element.transform ? worldTransformToSvgTransform(element.transform, viewBox) : null;
        if (svgElementTransform) {
          attrs.push(`transform="${formatMatrix(svgElementTransform)}"`);
        }
        appendPart(
          `${element.id}:tip:${tipPath.side}:${tipPath.index}:${tipPath.tipKind}:${tipPath.bend ? "bend" : "flat"}`,
          element.sourceRef.sourceId,
          element.id,
          `<path data-source-id="${escapeAttr(element.sourceRef.sourceId)}" data-arrow-tip-kind="${escapeAttr(tipPath.tipKind)}" ` +
            `data-arrow-side="${tipPath.side}" data-arrow-index="${tipPath.index}" data-arrow-bend="${tipPath.bend ? "true" : "false"}" ` +
            `d="${escapeAttr(d)}" ${attrs.join(" ")} />`
        );
      }
      continue;
    }

    if (element.kind === "Circle") {
      const center = toSvgPoint(element.center, viewBox);
      const svgElementTransform = element.transform ? worldTransformToSvgTransform(element.transform, viewBox) : null;
      const circleBounds: SvgBounds = svgBounds(
        pt(center.x - element.radius),
        pt(center.y - element.radius),
        pt(center.x + element.radius),
        pt(center.y + element.radius)
      );
      const transformedCircleBounds = svgElementTransform ? transformSvgBounds(circleBounds, svgElementTransform) : circleBounds;
      emitShadowShapeParts({
        appendPart,
        sourceId: element.sourceRef.sourceId,
        elementId: element.id,
        shadowPartKind: "circle",
        shape: { kind: "circle", cx: center.x, cy: center.y, radius: element.radius },
        bounds: transformedCircleBounds,
        shadowLayers: element.style.shadowLayers,
        baseStyle: element.style,
        resolveFillPaint,
        ensureCircularShadowMaskDefinition
      });
      appendStyledShapeParts({
        appendPart,
        basePartId: `${element.id}:circle`,
        sourceId: element.sourceRef.sourceId,
        elementId: element.id,
        shape: { kind: "circle", cx: center.x, cy: center.y, radius: element.radius },
        style: element.style,
        bounds: transformedCircleBounds,
        resolveFillPaint,
        transforms: svgElementTransform ? [formatMatrix(svgElementTransform)] : []
      });
      continue;
    }

    if (element.kind === "Ellipse") {
      const center = toSvgPoint(element.center, viewBox);
      const svgElementTransform = element.transform ? worldTransformToSvgTransform(element.transform, viewBox) : null;
      const ellipseBounds = computeSvgEllipseBounds(center.x, center.y, element.rx, element.ry, element.rotation ?? 0);
      const transformedEllipseBounds = svgElementTransform ? transformSvgBounds(ellipseBounds, svgElementTransform) : ellipseBounds;
      const ellipseRotationTransforms = ellipseTransformAttributes(element.rotation ?? 0, center.x, center.y);
      emitShadowShapeParts({
        appendPart,
        sourceId: element.sourceRef.sourceId,
        elementId: element.id,
        shadowPartKind: "ellipse",
        shape: { kind: "ellipse", cx: center.x, cy: center.y, rx: element.rx, ry: element.ry },
        bounds: transformedEllipseBounds,
        shadowLayers: element.style.shadowLayers,
        baseStyle: element.style,
        resolveFillPaint,
        ensureCircularShadowMaskDefinition,
        transforms: ellipseRotationTransforms
      });
      appendStyledShapeParts({
        appendPart,
        basePartId: `${element.id}:ellipse`,
        sourceId: element.sourceRef.sourceId,
        elementId: element.id,
        shape: { kind: "ellipse", cx: center.x, cy: center.y, rx: element.rx, ry: element.ry },
        style: element.style,
        bounds: transformedEllipseBounds,
        resolveFillPaint,
        transforms: [
          ...(svgElementTransform ? [formatMatrix(svgElementTransform)] : []),
          ...ellipseRotationTransforms
        ]
      });
      continue;
    }

    const position = toSvgPoint(element.position, viewBox);
    const textBlockWidth = element.textBlockWidth ?? estimateTextBlockWidth(element.text, element.style.fontSize);
    const textBlockHeight = element.textBlockHeight ?? Math.max(1, element.text.split("\n").length) * element.style.fontSize * 1.15;
    const rotation = element.rotation ?? 0;
    const hasRotation = Math.abs(rotation) > 1e-6;
    const svgElementTransform = element.transform ? worldTransformToSvgTransform(element.transform, viewBox) : null;
    if (element.textRenderInfo?.mode === "mathjax") {
      const rendered = opts.textEngine?.renderFromCache(element.textRenderInfo.cacheKey) ?? null;
      if (!rendered) {
        diagnostics.push({
          code: "missing-mathjax-text-render",
          message: `Missing cached MathJax text render payload for ${element.id}.`
        });
      } else {
        const textColor = element.style.textColor ?? "#000000";
        const textOpacity = element.style.textOpacity;
        const x = position.x - textBlockWidth / 2;
        const y = position.y - textBlockHeight / 2;
        const renderedViewBox = `${fmt(rendered.viewBox.x)} ${fmt(rendered.viewBox.y)} ${fmt(rendered.viewBox.width)} ${fmt(rendered.viewBox.height)}`;
        const paragraphAttr =
          element.textRenderInfo.paragraphId != null
            ? ` data-paragraph-id="${escapeAttr(element.textRenderInfo.paragraphId)}"`
            : "";
        const layoutKindAttr = ` data-text-layout-kind="${escapeAttr(element.textRenderInfo.layoutKind)}"`;
        const sceneTextIdAttr = ` data-scene-text-id="${escapeAttr(element.id)}"`;
        const preserveAspectRatio = resolveMathJaxPreserveAspectRatio(element.textRenderInfo.paragraphAlignment);
        const preserveAspectRatioAttr =
          preserveAspectRatio != null
            ? ` preserveAspectRatio="${escapeAttr(preserveAspectRatio)}"`
            : "";
        const renderedSvg = `<svg data-source-id="${escapeAttr(element.sourceRef.sourceId)}" data-text-renderer="mathjax"${paragraphAttr}${layoutKindAttr}${sceneTextIdAttr} x="${fmt(x)}" y="${fmt(y)}" width="${fmt(textBlockWidth)}" height="${fmt(textBlockHeight)}" viewBox="${renderedViewBox}"${preserveAspectRatioAttr} color="${escapeAttr(textColor)}" opacity="${fmt(textOpacity)}" overflow="visible">${rendered.body}</svg>`;
        if (hasRotation || svgElementTransform) {
          const transforms: string[] = [];
          if (svgElementTransform) transforms.push(formatMatrix(svgElementTransform));
          if (hasRotation) transforms.push(`rotate(${fmt(-rotation)} ${fmt(position.x)} ${fmt(position.y)})`);
          appendPart(
            `${element.id}:text:mathjax:rotated`,
            element.sourceRef.sourceId,
            element.id,
            `<g transform="${transforms.join(" ")}">${renderedSvg}</g>`
          );
        } else {
          appendPart(`${element.id}:text:mathjax`, element.sourceRef.sourceId, element.id, renderedSvg);
        }
        continue;
      }
    }
    const textX = alignedTextAnchorX(position.x, textBlockWidth, element.style.textAlign);
    const attrs = styleAttributes(element.style, true);
    const textTransforms: string[] = [];
    if (svgElementTransform) textTransforms.push(formatMatrix(svgElementTransform));
    if (hasRotation) textTransforms.push(`rotate(${fmt(-rotation)} ${fmt(position.x)} ${fmt(position.y)})`);
    if (textTransforms.length > 0) {
      attrs.push(`transform="${textTransforms.join(" ")}"`);
    }
    const textBody = encodeTextBody(element.text, textX, position.y);
    appendPart(
      `${element.id}:text`,
      element.sourceRef.sourceId,
      element.id,
      `<text data-source-id="${escapeAttr(element.sourceRef.sourceId)}" x="${fmt(textX)}" y="${fmt(position.y)}" ${attrs.join(" ")}>${textBody}</text>`
    );
  }

  const defsParts = [
    ...gradientDefById.values(),
    ...patternDefById.values(),
    ...shadowMaskDefById.values(),
    ...clipPathDefBySceneId.values()
  ];
  return modelBuilder.build({
    viewBox,
    defs: defsParts,
    diagnostics
  });
}

function resolveMathJaxPreserveAspectRatio(
  alignment: ResolvedStyle["textAlign"] | "justified" | "ragged-right" | "ragged-left" | undefined
): "xMinYMid meet" | "xMidYMid meet" | "xMaxYMid meet" | undefined {
  if (alignment === "center" || alignment === "flush center") {
    return "xMidYMid meet";
  }
  if (alignment === "right" || alignment === "flush right" || alignment === "ragged-left") {
    return "xMaxYMid meet";
  }
  if (
    alignment === "left" ||
    alignment === "flush left" ||
    alignment === "justify" ||
    alignment === "none" ||
    alignment === "ragged-right" ||
    alignment === "justified"
  ) {
    return "xMinYMid meet";
  }
  return undefined;
}

function encodePathData(commands: ScenePathCommand[], viewBox: { y: number; height: number }): string {
  const chunks: string[] = [];
  for (const command of commands) {
    if (command.kind === "Z") {
      chunks.push("Z");
      continue;
    }

    if (command.kind === "A") {
      const to = toSvgPoint(command.to, viewBox);
      const sweep = command.sweep ? 0 : 1;
      chunks.push(
        // Path points are mirrored into SVG space (`toSvgPoint`), so arc rotation must be mirrored too.
        `A ${fmt(command.rx)} ${fmt(command.ry)} ${fmt(-command.xAxisRotation)} ${command.largeArc ? 1 : 0} ${sweep} ${fmt(to.x)} ${fmt(to.y)}`
      );
      continue;
    }

    if (command.kind === "C") {
      const c1 = toSvgPoint(command.c1, viewBox);
      const c2 = toSvgPoint(command.c2, viewBox);
      const to = toSvgPoint(command.to, viewBox);
      chunks.push(`C ${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(to.x)} ${fmt(to.y)}`);
      continue;
    }

    const point = toSvgPoint(command.to, viewBox);
    chunks.push(`${command.kind} ${fmt(point.x)} ${fmt(point.y)}`);
  }
  return chunks.join(" ");
}

function appendStyledShapeParts(args: {
  appendPart: AppendSvgPart;
  basePartId: string;
  sourceId: string;
  elementId: string | null;
  shape: StyledSvgShape;
  style: ShadowRenderableStyle;
  bounds: SvgBounds | null;
  resolveFillPaint: ResolveFillPaint;
  transforms?: readonly string[];
}): void {
  const markups = renderStyledShapeMarkups(args);
  if (markups.length === 2) {
    args.appendPart(`${args.basePartId}:outer`, args.sourceId, args.elementId, markups[0]);
    args.appendPart(`${args.basePartId}:inner`, args.sourceId, args.elementId, markups[1]);
    return;
  }
  if (markups[0]) {
    args.appendPart(args.basePartId, args.sourceId, args.elementId, markups[0]);
  }
}

function renderStyledShapeMarkups(args: {
  sourceId: string;
  shape: StyledSvgShape;
  style: ShadowRenderableStyle;
  bounds: SvgBounds | null;
  resolveFillPaint: ResolveFillPaint;
  transforms?: readonly string[];
}): string[] {
  const transforms = args.transforms ?? [];
  if (shouldEmitDoubleStroke(args.style)) {
    const outerFill = args.resolveFillPaint(args.style, args.sourceId, args.bounds);
    const outerAttrs = styleAttributes(args.style, false, {
      lineWidth: doubleOuterLineWidth(args.style),
      fill: outerFill ?? undefined
    });
    appendTransformAttribute(outerAttrs, transforms);
    const innerAttrs = styleAttributes(args.style, false, {
      stroke: args.style.doubleColor,
      fill: "none",
      lineWidth: doubleInnerLineWidth(args.style)
    });
    appendTransformAttribute(innerAttrs, transforms);
    return [
      renderStyledShapeElement(args.sourceId, args.shape, outerAttrs),
      renderStyledShapeElement(args.sourceId, args.shape, innerAttrs)
    ];
  }

  const resolvedFill = args.resolveFillPaint(args.style, args.sourceId, args.bounds);
  const attrs = styleAttributes(args.style, false, {
    fill: resolvedFill ?? undefined
  });
  appendTransformAttribute(attrs, transforms);
  return [renderStyledShapeElement(args.sourceId, args.shape, attrs)];
}

function renderStyledShapeElement(sourceId: string, shape: StyledSvgShape, attrs: readonly string[]): string {
  const sourceAttr = `data-source-id="${escapeAttr(sourceId)}"`;
  const styleAttrs = attrs.join(" ");
  if (shape.kind === "path") {
    return `<path ${sourceAttr} d="${escapeAttr(shape.d)}" ${styleAttrs} />`;
  }
  if (shape.kind === "circle") {
    return `<circle ${sourceAttr} cx="${fmt(shape.cx)}" cy="${fmt(shape.cy)}" r="${fmt(shape.radius)}" ${styleAttrs} />`;
  }
  return `<ellipse ${sourceAttr} cx="${fmt(shape.cx)}" cy="${fmt(shape.cy)}" rx="${fmt(shape.rx)}" ry="${fmt(shape.ry)}" ${styleAttrs} />`;
}

function appendTransformAttribute(attrs: string[], transforms: readonly string[]): void {
  if (transforms.length > 0) {
    attrs.push(`transform="${transforms.join(" ")}"`);
  }
}

function ellipseTransformAttributes(rotation: number, cx: number, cy: number): string[] {
  return Math.abs(rotation) > 1e-6 ? [`rotate(${fmt(-rotation)} ${fmt(cx)} ${fmt(cy)})`] : [];
}

function emitShadowShapeParts(args: {
  appendPart: AppendSvgPart;
  sourceId: string;
  elementId: string | null;
  shadowPartKind: string;
  shape: StyledSvgShape;
  bounds: SvgBounds | null;
  shadowLayers: ShadowLayer[];
  baseStyle: ResolvedStyle;
  resolveFillPaint: ResolveFillPaint;
  ensureCircularShadowMaskDefinition: () => string;
  transforms?: readonly string[];
}): void {
  for (let index = 0; index < args.shadowLayers.length; index += 1) {
    const layer = args.shadowLayers[index];
    const layerStyle = resolveShadowLayerStyle(layer.style as ShadowRenderableStyle, args.baseStyle);
    const groupTransform = shadowTransformMatrix(layer, args.bounds);
    const maskId = layer.fade === "circle-fuzzy-edge-15" ? args.ensureCircularShadowMaskDefinition() : null;
    const shapes = renderStyledShapeMarkups({
      sourceId: args.sourceId,
      shape: args.shape,
      style: layerStyle,
      bounds: args.bounds,
      resolveFillPaint: args.resolveFillPaint,
      transforms: args.transforms
    });

    const groupAttrs = shadowGroupAttributes(args.sourceId, index + 1, layer, groupTransform, maskId);
    args.appendPart(
      `${args.elementId ?? args.sourceId}:shadow:${args.shadowPartKind}:${index + 1}`,
      args.sourceId,
      args.elementId,
      `<g ${groupAttrs.join(" ")}>${shapes.join("")}</g>`
    );
  }
}

function shadowGroupAttributes(
  sourceId: string,
  index: number,
  layer: ShadowLayer,
  transform: string | null,
  maskId: string | null
): string[] {
  const attrs: string[] = [
    `data-source-id="${escapeAttr(sourceId)}"`,
    `data-shadow-layer="${index}"`
  ];
  if (layer.fade !== "none") {
    attrs.push(`data-shadow-fade="${escapeAttr(layer.fade)}"`);
  }
  if (transform) {
    attrs.push(`transform="${escapeAttr(transform)}"`);
  }
  if (maskId) {
    attrs.push(`mask="url(#${escapeAttr(maskId)})"`);
  }
  return attrs;
}

function shadowTransformMatrix(layer: ShadowLayer, bounds: SvgBounds | null): string | null {
  const scale = Number.isFinite(layer.scale) ? layer.scale : 1;
  const dx = Number.isFinite(layer.xshift) ? layer.xshift : 0;
  const dy = Number.isFinite(layer.yshift) ? -layer.yshift : 0;

  let e = dx;
  let f = dy;
  if (bounds) {
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    e += cx - scale * cx;
    f += cy - scale * cy;
  }

  if (Math.abs(scale - 1) <= 1e-6 && Math.abs(e) <= 1e-6 && Math.abs(f) <= 1e-6) {
    return null;
  }

  return `matrix(${fmt(scale)} 0 0 ${fmt(scale)} ${fmt(e)} ${fmt(f)})`;
}

function renderCircularShadowMaskDefinition(maskId: string, gradientId: string): string {
  return (
    `<radialGradient id="${escapeAttr(gradientId)}" gradientUnits="objectBoundingBox" cx="0.5" cy="0.5" r="0.5">` +
    `<stop offset="85%" stop-color="#ffffff" stop-opacity="1" />` +
    `<stop offset="100%" stop-color="#ffffff" stop-opacity="0" />` +
    `</radialGradient>` +
    `<mask id="${escapeAttr(maskId)}" maskUnits="objectBoundingBox" maskContentUnits="objectBoundingBox">` +
    `<rect x="0" y="0" width="1" height="1" fill="url(#${escapeAttr(gradientId)})" />` +
    `</mask>`
  );
}

function resolveShadowLayerStyle(layerStyle: ShadowRenderableStyle, baseStyle: ResolvedStyle): ShadowRenderableStyle {
  const inheritsFill = layerStyle.fill === SHADOW_INHERIT_FILL;
  return {
    ...layerStyle,
    stroke: layerStyle.stroke === SHADOW_INHERIT_STROKE ? baseStyle.stroke : layerStyle.stroke,
    fill: inheritsFill ? baseStyle.fill : layerStyle.fill,
    fillPattern: inheritsFill ? baseStyle.fillPattern : layerStyle.fillPattern,
    patternColor: inheritsFill ? baseStyle.patternColor : layerStyle.patternColor
  };
}

function hasActivePatternFill(style: PatternRenderableStyle): boolean {
  return style.fillPattern != null && style.fill != null && style.fill !== "none";
}

function arrowTipAttributes(style: ResolvedStyle, tipPath: RenderedArrowTipPath): string[] {
  return [
    `stroke="${escapeAttr(tipPath.stroke)}"`,
    `fill="${escapeAttr(tipPath.fill)}"`,
    `stroke-width="${fmt(tipPath.strokeWidth)}"`,
    `stroke-linecap="${tipPath.lineCap}"`,
    `stroke-linejoin="${tipPath.lineJoin}"`,
    `stroke-opacity="${fmt(style.strokeOpacity)}"`,
    `fill-opacity="${fmt(style.fillOpacity)}"`
  ];
}

function normalizeShadingName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

function computeShadingTransform(bounds: SvgBounds, angle: number): ShadingTransform | null {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  const resolvedAngle = Number.isFinite(angle) ? angle : 0;
  const theta = (resolvedAngle * Math.PI) / 180;
  const absSin = Math.abs(Math.sin(theta));
  const absCos = Math.abs(Math.cos(theta));
  const denom = absCos + absSin;
  if (denom <= 1e-9) {
    return null;
  }

  const scaleX = (PGF_SHADE_SCALE_FACTOR * (width * absCos + height * absSin)) / denom;
  const scaleY = (PGF_SHADE_SCALE_FACTOR * (width * absSin + height * absCos)) / denom;
  if (Math.abs(scaleX) <= 1e-4 || Math.abs(scaleY) <= 1e-4) {
    return null;
  }

  return {
    centerX: (bounds.minX + bounds.maxX) / 2,
    centerY: (bounds.minY + bounds.maxY) / 2,
    scaleX,
    scaleY,
    // Scene coordinates are mirrored into SVG space, so shading rotations must be mirrored too.
    rotation: -resolvedAngle
  };
}

function signatureShadingTransform(transform: ShadingTransform): string {
  return [
    fmt(transform.centerX),
    fmt(transform.centerY),
    fmt(transform.scaleX),
    fmt(transform.scaleY),
    fmt(transform.rotation)
  ].join(",");
}

function shadingTransformAttribute(transform: ShadingTransform): string {
  return `translate(${fmt(transform.centerX)} ${fmt(transform.centerY)}) ` +
    `rotate(${fmt(transform.rotation)}) scale(${fmt(transform.scaleX)} ${fmt(transform.scaleY)})`;
}

function renderAxisGradientDefinition(
  id: string,
  transform: ShadingTransform,
  topColor: string,
  middleColor: string,
  bottomColor: string
): string {
  const transformAttr = shadingTransformAttribute(transform);
  return (
    `<linearGradient id="${escapeAttr(id)}" gradientUnits="userSpaceOnUse" ` +
    `x1="0" y1="${fmt(PGF_SHADE_CANONICAL_HALF)}" x2="0" y2="${fmt(-PGF_SHADE_CANONICAL_HALF)}" ` +
    `gradientTransform="${escapeAttr(transformAttr)}">` +
    `<stop offset="0%" stop-color="${escapeAttr(bottomColor)}" />` +
    `<stop offset="25%" stop-color="${escapeAttr(bottomColor)}" />` +
    `<stop offset="50%" stop-color="${escapeAttr(middleColor)}" />` +
    `<stop offset="75%" stop-color="${escapeAttr(topColor)}" />` +
    `<stop offset="100%" stop-color="${escapeAttr(topColor)}" />` +
    `</linearGradient>`
  );
}

function renderRadialGradientDefinition(id: string, transform: ShadingTransform, innerColor: string, outerColor: string): string {
  const transformAttr = shadingTransformAttribute(transform);
  return (
    `<radialGradient id="${escapeAttr(id)}" gradientUnits="userSpaceOnUse" ` +
    `cx="0" cy="0" r="${fmt(PGF_SHADE_CANONICAL_HALF)}" fx="0" fy="0" ` +
    `gradientTransform="${escapeAttr(transformAttr)}">` +
    `<stop offset="0%" stop-color="${escapeAttr(innerColor)}" />` +
    `<stop offset="50%" stop-color="${escapeAttr(outerColor)}" />` +
    `<stop offset="100%" stop-color="${escapeAttr(outerColor)}" />` +
    `</radialGradient>`
  );
}

function renderBallGradientDefinition(id: string, transform: ShadingTransform, ballColor: string): string {
  const light15 = mixColors(ballColor, "#ffffff", 0.15) ?? ballColor;
  const light75 = mixColors(ballColor, "#ffffff", 0.75) ?? ballColor;
  const dark70 = mixColors(ballColor, "#000000", 0.7) ?? ballColor;
  const dark50 = mixColors(ballColor, "#000000", 0.5) ?? ballColor;
  const transformAttr = shadingTransformAttribute(transform);

  return (
    `<radialGradient id="${escapeAttr(id)}" gradientUnits="userSpaceOnUse" ` +
    `cx="0" cy="0" r="${fmt(PGF_SHADE_CANONICAL_HALF)}" ` +
    `fx="${fmt(-PGF_BALL_FOCUS_OFFSET)}" fy="${fmt(-PGF_BALL_FOCUS_OFFSET)}" ` +
    `gradientTransform="${escapeAttr(transformAttr)}">` +
    `<stop offset="0%" stop-color="${escapeAttr(light15)}" />` +
    `<stop offset="18%" stop-color="${escapeAttr(light75)}" />` +
    `<stop offset="36%" stop-color="${escapeAttr(dark70)}" />` +
    `<stop offset="50%" stop-color="${escapeAttr(dark50)}" />` +
    `<stop offset="100%" stop-color="#000000" />` +
    `</radialGradient>`
  );
}

function renderPatternDefinition(id: string, pattern: ResolvedPattern, patternColor: string | null, globalYPhase: number): string {
  const context: PatternRenderContext = { globalYPhase };
  if (pattern.kind === "legacy") {
    return renderLegacyPatternDefinition(id, pattern, patternColor, context);
  }
  return renderMetaPatternDefinition(id, pattern, patternColor ?? "black", context);
}

function renderLegacyPatternDefinition(
  id: string,
  pattern: Extract<ResolvedPattern, { kind: "legacy" }>,
  patternColor: string | null,
  context: PatternRenderContext
): string {
  const strokeColor = patternColor ?? "black";
  const mm = 2.84527559055;

  if (pattern.name === "horizontal lines") {
    return renderPatternElement(context, id, 0, 0, 3, 3, `<path d="M -1 0.5 L 4 0.5" stroke="${escapeAttr(strokeColor)}" stroke-width="0.4" fill="none" />`);
  }
  if (pattern.name === "vertical lines") {
    return renderPatternElement(context, id, 0, 0, 3, 3, `<path d="M 0.5 -1 L 0.5 4" stroke="${escapeAttr(strokeColor)}" stroke-width="0.4" fill="none" />`);
  }
  if (pattern.name === "north east lines") {
    return renderPatternElement(
      context,
      id,
      0,
      0,
      3,
      3,
      `<path d="M -1 4 L 4 -1" stroke="${escapeAttr(strokeColor)}" stroke-width="0.4" fill="none" />`
    );
  }
  if (pattern.name === "north west lines") {
    return renderPatternElement(
      context,
      id,
      0,
      0,
      3,
      3,
      `<path d="M -1 -1 L 4 4" stroke="${escapeAttr(strokeColor)}" stroke-width="0.4" fill="none" />`
    );
  }
  if (pattern.name === "grid") {
    return renderPatternElement(
      context,
      id,
      0,
      0,
      3,
      3,
      `<path d="M 0 -1 L 0 4 M -1 0 L 4 0" stroke="${escapeAttr(strokeColor)}" stroke-width="0.4" fill="none" />`
    );
  }
  if (pattern.name === "crosshatch") {
    return renderPatternElement(
      context,
      id,
      0,
      0,
      3,
      3,
      `<path d="M -1 -1 L 4 4 M -1 4 L 4 -1" stroke="${escapeAttr(strokeColor)}" stroke-width="0.4" fill="none" />`
    );
  }
  if (pattern.name === "dots") {
    return renderPatternElement(context, id, -1, -1, 3, 3, `<circle cx="0" cy="0" r="0.5" fill="${escapeAttr(strokeColor)}" />`);
  }
  if (pattern.name === "crosshatch dots") {
    return renderPatternElement(
      context,
      id,
      -1,
      -1,
      3,
      3,
      `<circle cx="0" cy="0" r="0.5" fill="${escapeAttr(strokeColor)}" /><circle cx="1.5" cy="-1.5" r="0.5" fill="${escapeAttr(
        strokeColor
      )}" />`
    );
  }
  if (pattern.name === "fivepointed stars") {
    const center = 1 * mm;
    const radius = 1 * mm;
    const pathData = polygonPathFromPolarAngles(center, center, radius, [18, 162, 306, 90, 234]);
    return renderPatternElement(context, id, 0, 0, 3 * mm, 3 * mm, `<path d="${escapeAttr(pathData)}" fill="${escapeAttr(strokeColor)}" />`);
  }
  if (pattern.name === "sixpointed stars") {
    const center = 1 * mm;
    const radius = 1 * mm;
    const first = polygonPathFromPolarAngles(center, center, radius, [30, 150, 270]);
    const second = polygonPathFromPolarAngles(center, center, radius, [-30, -270, -150]);
    return renderPatternElement(
      context,
      id,
      0,
      0,
      3 * mm,
      3 * mm,
      `<path d="${escapeAttr(`${first} ${second}`)}" fill="${escapeAttr(strokeColor)}" fill-rule="nonzero" />`
    );
  }
  if (pattern.name === "bricks") {
    return renderPatternElement(
      context,
      id,
      0,
      0,
      4 * mm,
      4 * mm,
      `<path d="M 0 ${fmt(1 * mm)} L ${fmt(4 * mm)} ${fmt(1 * mm)} M 0 ${fmt(3 * mm)} L ${fmt(4 * mm)} ${fmt(3 * mm)} ` +
        `M ${fmt(1 * mm)} 0 L ${fmt(1 * mm)} ${fmt(1 * mm)} M ${fmt(3 * mm)} ${fmt(1 * mm)} L ${fmt(3 * mm)} ${fmt(
          3 * mm
        )} M ${fmt(1 * mm)} ${fmt(3 * mm)} L ${fmt(1 * mm)} ${fmt(4 * mm)}" ` +
        `stroke="${escapeAttr(strokeColor)}" stroke-width="0.8" fill="none" />`
    );
  }
  if (pattern.name === "checkerboard") {
    return renderPatternElement(
      context,
      id,
      0,
      0,
      4 * mm,
      4 * mm,
      `<rect x="0" y="0" width="${fmt(2 * mm)}" height="${fmt(2 * mm)}" fill="${escapeAttr(strokeColor)}" />` +
        `<rect x="${fmt(2 * mm)}" y="${fmt(2 * mm)}" width="${fmt(2 * mm)}" height="${fmt(2 * mm)}" fill="${escapeAttr(strokeColor)}" />`
    );
  }

  if (pattern.name === "checkerboard light gray") {
    const dark = mixColors("#000000", "#ffffff", 0.2) ?? "#cccccc";
    return renderPatternElement(
      context,
      id,
      0,
      0,
      4 * mm,
      4 * mm,
      `<rect x="0" y="0" width="${fmt(4 * mm)}" height="${fmt(4 * mm)}" fill="#000000" />` +
        `<rect x="0" y="0" width="${fmt(2 * mm)}" height="${fmt(2 * mm)}" fill="${escapeAttr(dark)}" />` +
        `<rect x="${fmt(2 * mm)}" y="${fmt(2 * mm)}" width="${fmt(2 * mm)}" height="${fmt(2 * mm)}" fill="${escapeAttr(dark)}" />`
    );
  }
  if (pattern.name === "horizontal lines light gray") {
    return renderHorizontalBandPattern(context, id, mixColors("#000000", "#ffffff", 0.1) ?? "#e6e6e6", mixColors("#000000", "#ffffff", 0.15) ?? "#d9d9d9");
  }
  if (pattern.name === "horizontal lines gray") {
    return renderHorizontalBandPattern(context, id, mixColors("#000000", "#ffffff", 0.3) ?? "#b3b3b3", mixColors("#000000", "#ffffff", 0.35) ?? "#a6a6a6");
  }
  if (pattern.name === "horizontal lines dark gray") {
    return renderHorizontalBandPattern(context, id, mixColors("#000000", "#ffffff", 0.9) ?? "#1a1a1a", mixColors("#000000", "#ffffff", 0.85) ?? "#262626");
  }
  if (pattern.name === "horizontal lines light blue") {
    return renderHorizontalBandPattern(context, id, mixColors("#0000ff", "#ffffff", 0.1) ?? "#e6e6ff", mixColors("#0000ff", "#ffffff", 0.15) ?? "#d9d9ff");
  }
  if (pattern.name === "horizontal lines dark blue") {
    return renderHorizontalBandPattern(context, id, mixColors("#0000ff", "#ffffff", 0.9) ?? "#1a1aff", mixColors("#0000ff", "#ffffff", 0.85) ?? "#2626ff");
  }
  if (pattern.name === "crosshatch dots gray") {
    const background = mixColors("#000000", "#ffffff", 0.2) ?? "#cccccc";
    const light = mixColors("#000000", "#ffffff", 0.1) ?? "#e6e6e6";
    const dark = mixColors("#000000", "#ffffff", 0.7) ?? "#4d4d4d";
    return renderCrosshatchDotsPattern(context, id, background, light, dark);
  }
  const steelBlue = "#afc3dd";
  const darkSteelBlue = mixColors("#000000", steelBlue, 0.5) ?? "#58626f";
  const light = mixColors(darkSteelBlue, "#ffffff", 0.1) ?? "#efeff2";
  const dark = mixColors(darkSteelBlue, "#ffffff", 0.7) ?? "#8a8f9b";
  return renderCrosshatchDotsPattern(context, id, steelBlue, light, dark);
}

function renderMetaPatternDefinition(
  id: string,
  pattern: Exclude<ResolvedPattern, { kind: "legacy" }>,
  patternColor: string,
  context: PatternRenderContext
): string {
  const transform = buildPatternTransform(pattern.xshift, pattern.yshift, pattern.angle);
  if (pattern.kind === "meta-lines") {
    const halfDistance = pattern.distance / 2;
    return renderPatternElement(
      context,
      id,
      -halfDistance,
      -halfDistance,
      pattern.distance,
      pattern.distance,
      `<path d="M ${fmt(-halfDistance)} 0 L ${fmt(halfDistance)} 0" stroke="${escapeAttr(patternColor)}" stroke-width="${fmt(
        pattern.lineWidth
      )}" fill="none" />`,
      transform
    );
  }

  if (pattern.kind === "meta-hatch") {
    const halfDistance = pattern.distance / 2;
    return renderPatternElement(
      context,
      id,
      -halfDistance,
      -halfDistance,
      pattern.distance,
      pattern.distance,
      `<path d="M ${fmt(-halfDistance)} 0 L ${fmt(halfDistance)} 0 M 0 ${fmt(-halfDistance)} L 0 ${fmt(halfDistance)}" ` +
        `stroke="${escapeAttr(patternColor)}" stroke-width="${fmt(pattern.lineWidth)}" fill="none" />`,
      transform
    );
  }

  if (pattern.kind === "meta-dots") {
    const halfDistance = pattern.distance / 2;
    return renderPatternElement(
      context,
      id,
      -halfDistance,
      -halfDistance,
      pattern.distance,
      pattern.distance,
      `<circle cx="0" cy="0" r="${fmt(pattern.radius)}" fill="${escapeAttr(patternColor)}" />`,
      transform
    );
  }

  const halfDistance = pattern.distance / 2;
  const starPath = buildStarPath(pattern.radius, pattern.points);
  return renderPatternElement(
    context,
    id,
    -halfDistance,
    -halfDistance,
    pattern.distance,
    pattern.distance,
    `<path d="${escapeAttr(starPath)}" fill="${escapeAttr(patternColor)}" />`,
    transform
  );
}

function renderHorizontalBandPattern(context: PatternRenderContext, id: string, firstColor: string, secondColor: string): string {
  return renderPatternElement(
    context,
    id,
    0,
    0,
    100,
    4,
    `<rect x="0" y="0" width="100" height="2.5" fill="${escapeAttr(firstColor)}" />` +
      `<rect x="0" y="2" width="100" height="2.5" fill="${escapeAttr(secondColor)}" />`
  );
}

function renderCrosshatchDotsPattern(
  context: PatternRenderContext,
  id: string,
  background: string,
  lightDots: string,
  darkDots: string
): string {
  return renderPatternElement(
    context,
    id,
    0,
    0,
    8,
    8,
    `<rect x="0" y="0" width="8" height="8" fill="${escapeAttr(background)}" />` +
      `<circle cx="2" cy="1.75" r="1" fill="${escapeAttr(lightDots)}" />` +
      `<circle cx="6" cy="5.75" r="1" fill="${escapeAttr(lightDots)}" />` +
      `<circle cx="2" cy="2.25" r="1" fill="${escapeAttr(darkDots)}" />` +
      `<circle cx="6" cy="6.25" r="1" fill="${escapeAttr(darkDots)}" />`
  );
}

function renderPatternElement(
  context: PatternRenderContext,
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  body: string,
  patternTransform?: string | null
): string {
  const transformParts: string[] = [];
  const effectiveGlobalPhase = context.globalYPhase - y;
  if (Math.abs(effectiveGlobalPhase) > 1e-6) {
    // Keep pattern coordinates in the same affine y frame as toSvgPoint: y_svg = C - y.
    transformParts.push(`translate(0 ${fmt(effectiveGlobalPhase)})`);
  }
  if (patternTransform && patternTransform.trim().length > 0) {
    transformParts.push(patternTransform.trim());
  }
  const transformAttr = transformParts.length > 0 ? ` patternTransform="${escapeAttr(transformParts.join(" "))}"` : "";
  const offsetBody =
    Math.abs(x) > 1e-6 || Math.abs(y) > 1e-6 ? `<g transform="translate(${fmt(-x)} ${fmt(-y)})">${body}</g>` : body;
  return (
    `<pattern id="${escapeAttr(id)}" patternUnits="userSpaceOnUse" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(width)}" height="${fmt(
      height
    )}"${transformAttr}>` +
    offsetBody +
    `</pattern>`
  );
}

function buildPatternTransform(xshift: number, yshift: number, angle: number): string | null {
  const transforms: string[] = [];
  if (Math.abs(xshift) > 1e-6 || Math.abs(yshift) > 1e-6) {
    transforms.push(`translate(${fmt(xshift)} ${fmt(-yshift)})`);
  }
  if (Math.abs(angle) > 1e-6) {
    transforms.push(`rotate(${fmt(-angle)})`);
  }
  return transforms.length > 0 ? transforms.join(" ") : null;
}

function buildStarPath(radius: number, points: number): string {
  const outer = polarPoint(90, radius);
  const commands: string[] = [`M ${fmt(outer.x)} ${fmt(outer.y)}`];
  const step = 180 / points;
  for (let i = 1; i <= points; i += 1) {
    const inner = polarPoint(90 + 2 * i * step - step, radius * 0.5);
    const outerPoint = polarPoint(90 + 2 * i * step, radius);
    commands.push(`L ${fmt(inner.x)} ${fmt(inner.y)}`);
    commands.push(`L ${fmt(outerPoint.x)} ${fmt(outerPoint.y)}`);
  }
  commands.push("Z");
  return commands.join(" ");
}

function polygonPathFromPolarAngles(centerX: number, centerY: number, radius: number, angles: number[]): string {
  if (angles.length === 0) {
    return "";
  }
  const points = angles.map((angle) => {
    const point = polarPoint(angle, radius);
    return {
      x: centerX + point.x,
      y: centerY + point.y
    };
  });
  const [first, ...rest] = points;
  return `M ${fmt(first.x)} ${fmt(first.y)} ${rest.map((point) => `L ${fmt(point.x)} ${fmt(point.y)}`).join(" ")} Z`;
}

function polarPoint(angleDeg: number, radius: number): SvgPoint {
  const radians = (angleDeg * Math.PI) / 180;
  return svgPoint(
    pt(radius * Math.cos(radians)),
    pt(-radius * Math.sin(radians))
  );
}

function mixColors(first: string, second: string, ratioFirst: number): string | null {
  const c1 = toRgb(first);
  const c2 = toRgb(second);
  if (!c1 || !c2) {
    return null;
  }

  const t = clamp01(ratioFirst);
  return rgbToHex({
    r: Math.round(c1.r * t + c2.r * (1 - t)),
    g: Math.round(c1.g * t + c2.g * (1 - t)),
    b: Math.round(c1.b * t + c2.b * (1 - t))
  });
}

function toRgb(color: string): { r: number; g: number; b: number } | null {
  const normalized = color.trim().toLowerCase();
  if (normalized in COLOR_HEX) {
    return hexToRgb(COLOR_HEX[normalized]);
  }
  if (/^#[0-9a-f]{3}$/i.test(normalized) || /^#[0-9a-f]{6}$/i.test(normalized)) {
    return hexToRgb(normalized);
  }
  return null;
}

function styleAttributes(
  style: ResolvedStyle | ShadowRenderableStyle,
  isText = false,
  overrides: { stroke?: string | null; fill?: string | null; lineWidth?: number } = {}
): string[] {
  const attrs: string[] = [];
  if (isText) {
    const textStyle = style as ResolvedStyle;
    const textColor = textStyle.textColor ?? "#000000";
    attrs.push(`fill="${escapeAttr(textColor)}"`);
    attrs.push(`fill-opacity="${fmt(textStyle.textOpacity)}"`);
    if (textStyle.fontFamily === "sans") {
      attrs.push(`font-family="${PLAIN_TEXT_SANS_FONT_STACK}"`);
    } else if (textStyle.fontFamily === "monospace") {
      attrs.push(`font-family="${PLAIN_TEXT_MONO_FONT_STACK}"`);
    } else {
      attrs.push(`font-family="${PLAIN_TEXT_SERIF_FONT_STACK}"`);
    }
    attrs.push(`font-size="${fmt(textStyle.fontSize)}"`);
    if (textStyle.fontWeight === "bold") {
      attrs.push(`font-weight="700"`);
    }
    if (textStyle.fontStyle === "italic") {
      attrs.push(`font-style="italic"`);
    }
    attrs.push(`text-anchor="${textAnchorForAlign(textStyle.textAlign)}"`);
    attrs.push(`dominant-baseline="middle"`);
    attrs.push(`xml:space="preserve"`);
    return attrs;
  }

  attrs.push(`stroke="${escapeAttr(overrides.stroke ?? style.stroke ?? "none")}"`);
  attrs.push(`fill="${escapeAttr(overrides.fill ?? (style.fill && style.fill !== "none" ? style.fill : "none"))}"`);
  if (style.fillRule === "evenodd") {
    attrs.push(`fill-rule="evenodd"`);
  }
  attrs.push(`stroke-width="${fmt(overrides.lineWidth ?? style.lineWidth)}"`);
  attrs.push(`stroke-linecap="${style.lineCap}"`);
  attrs.push(`stroke-linejoin="${style.lineJoin}"`);
  attrs.push(`stroke-opacity="${fmt(style.strokeOpacity)}"`);
  attrs.push(`fill-opacity="${fmt(style.fillOpacity)}"`);
  if (style.dashArray && style.dashArray.length > 0) {
    attrs.push(`stroke-dasharray="${style.dashArray.map((entry) => fmt(entry)).join(" ")}"`);
    if (Math.abs(style.dashOffset) > 1e-6) {
      attrs.push(`stroke-dashoffset="${fmt(style.dashOffset)}"`);
    }
  }
  return attrs;
}

function shouldEmitDoubleStroke(style: {
  stroke: string | null;
  lineWidth: number;
  doubleStroke: boolean;
  doubleDistance: number;
  doubleLineCenterDistance: number | null;
  doubleColor: string;
}): boolean {
  return style.doubleStroke && style.stroke != null && style.stroke !== "none" && doubleInnerLineWidth(style) > 0;
}

function doubleInnerLineWidth(style: { lineWidth: number; doubleDistance: number; doubleLineCenterDistance: number | null }): number {
  return style.doubleLineCenterDistance == null ? style.doubleDistance : Math.max(0, style.doubleLineCenterDistance - style.lineWidth);
}

function doubleOuterLineWidth(style: { lineWidth: number; doubleDistance: number; doubleLineCenterDistance: number | null }): number {
  return style.doubleLineCenterDistance == null ? style.lineWidth * 2 + style.doubleDistance : style.lineWidth + style.doubleLineCenterDistance;
}

function toSvgPoint(point: WorldPoint, viewBox: Pick<SvgViewBox, "y" | "height">): SvgPoint {
  return convertWorldToSvgPoint(point, viewBox);
}

function worldTransformToSvgTransform(
  matrix: WorldTransform,
  viewBox: { y: number; height: number }
): SvgTransform {
  return convertWorldToSvgTransform(matrix, viewBox);
}

function formatMatrix(matrix: SvgTransform): string {
  return `matrix(${fmt(matrix.a)} ${fmt(matrix.b)} ${fmt(matrix.c)} ${fmt(matrix.d)} ${fmt(matrix.e)} ${fmt(matrix.f)})`;
}

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace(/^#/, "");
  const value = normalized.length === 3 ? normalized.split("").map((char) => char + char).join("") : normalized;
  const parsed = Number.parseInt(value, 16);
  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255
  };
}

function rgbToHex(rgb: { r: number; g: number; b: number }): string {
  return (
    "#" +
    [rgb.r, rgb.g, rgb.b]
      .map((component) => Math.max(0, Math.min(255, component)))
      .map((component) => component.toString(16).padStart(2, "0"))
      .join("")
  );
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttr(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;");
}

function textAnchorForAlign(
  align: "left" | "flush left" | "right" | "flush right" | "center" | "flush center" | "justify" | "none" | undefined
): "start" | "middle" | "end" {
  if (!align) {
    return "middle";
  }
  if (align === "left" || align === "flush left" || align === "justify") {
    return "start";
  }
  if (align === "right" || align === "flush right") {
    return "end";
  }
  return "middle";
}

function alignedTextAnchorX(
  centerX: number,
  blockWidth: number,
  align: "left" | "flush left" | "right" | "flush right" | "center" | "flush center" | "justify" | "none" | undefined
): number {
  if (!Number.isFinite(blockWidth) || blockWidth <= 0) {
    return centerX;
  }
  if (align === "left" || align === "flush left" || align === "justify") {
    return centerX - blockWidth / 2;
  }
  if (align === "right" || align === "flush right") {
    return centerX + blockWidth / 2;
  }
  return centerX;
}

function estimateTextBlockWidth(text: string, fontSize: number): number {
  const lines = text.split("\n");
  const maxChars = lines.reduce((max, line) => Math.max(max, line.length), 0);
  if (maxChars <= 0) {
    return 0;
  }
  return maxChars * fontSize * 0.7;
}

function encodeTextBody(text: string, x: number, y: number): string {
  const lines = text.split("\n");
  if (lines.length <= 1) {
    return escapeText(text);
  }

  const lineHeightEm = 1.15;
  const startOffsetEm = -((lines.length - 1) * lineHeightEm) / 2;
  return lines
    .map((line, index) => {
      if (index === 0) {
        return `<tspan x="${fmt(x)}" y="${fmt(y)}" dy="${fmt(startOffsetEm)}em">${escapeText(line)}</tspan>`;
      }
      return `<tspan x="${fmt(x)}" dy="${fmt(lineHeightEm)}em">${escapeText(line)}</tspan>`;
    })
    .join("");
}

function stableSvgIdComponent(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(36)}-${input.length.toString(36)}`;
}

function hasDrawablePathCommands(commands: ScenePathCommand[]): boolean {
  return commands.some((command) => command.kind === "L" || command.kind === "C" || command.kind === "A");
}

function createSvgModelReuseContext(
  scene: SceneFigure,
  reuse: EmitSvgOptions["reuse"] | undefined,
  viewBox: SvgRenderModel["viewBox"]
): SvgModelReuseContext | null {
  if (scene.hasStatefulGraphicsState || scene.elements.some((element) => (element.clipChain?.length ?? 0) > 0)) {
    return null;
  }
  if (!reuse?.previousModel || !reuse.affectedSourceIds || reuse.affectedSourceIds.length === 0) {
    return null;
  }
  if (!hasReusableModelInvariants(reuse.previousModel)) {
    return null;
  }
  if (!sameViewBox(reuse.previousModel.viewBox, viewBox)) {
    return null;
  }

  const previousPartsByElementId = new Map<string, SvgRenderPart[]>();
  for (const part of reuse.previousModel.parts) {
    if (!part.elementId) {
      return null;
    }
    const existing = previousPartsByElementId.get(part.elementId);
    if (existing) {
      existing.push(part);
    } else {
      previousPartsByElementId.set(part.elementId, [part]);
    }
  }

  return {
    affectedSourceIds: new Set(reuse.affectedSourceIds),
    previousPartsByElementId
  };
}

function tryReuseElementParts(
  modelBuilder: ReturnType<typeof createSvgModelBuilder>,
  context: SvgModelReuseContext,
  element: SceneElement
): boolean {
  if (context.affectedSourceIds.has(element.sourceRef.sourceId)) {
    return false;
  }
  const reusableParts = context.previousPartsByElementId.get(element.id);
  if (!reusableParts || reusableParts.length === 0) {
    return false;
  }
  for (const part of reusableParts) {
    if (part.sourceId !== element.sourceRef.sourceId || part.elementId !== element.id) {
      return false;
    }
  }
  for (const part of reusableParts) {
    modelBuilder.addExistingPart(part);
  }
  return true;
}

function hasReusableModelInvariants(model: SvgRenderModel): boolean {
  const partIds = new Set<string>();
  for (let index = 0; index < model.parts.length; index += 1) {
    const part = model.parts.at(index);
    if (!part) {
      return false;
    }
    if (part.order !== index) {
      return false;
    }
    if (partIds.has(part.partId)) {
      return false;
    }
    partIds.add(part.partId);
  }
  return true;
}

function sameViewBox(left: SvgRenderModel["viewBox"], right: SvgRenderModel["viewBox"]): boolean {
  return (
    Math.abs(left.x - right.x) <= 1e-9 &&
    Math.abs(left.y - right.y) <= 1e-9 &&
    Math.abs(left.width - right.width) <= 1e-9 &&
    Math.abs(left.height - right.height) <= 1e-9
  );
}

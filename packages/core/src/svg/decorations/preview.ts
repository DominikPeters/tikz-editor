import { worldBounds, worldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import { applyDecorationToPath } from "../../semantic/decorations/index.js";
import { defaultStyle } from "../../semantic/style/defaults.js";
import type { DecorationStyle, SceneElement, SceneFigure, ScenePath } from "../../semantic/types.js";
import { MAIN_SCENE_LAYER } from "../../semantic/types.js";
import { emitSvg } from "../emit.js";

const PREVIEW_SOURCE_SPAN = { from: 0, to: 0 } as const;
const PREVIEW_CACHE = new Map<string, string>();

export function renderPathMorphingDecorationPreviewSvg(
  decorationName: string,
  lineWidth: number
): string {
  const canonicalName = canonicalDecorationName(decorationName) ?? "none";
  const normalizedLineWidth = normalizePreviewLineWidth(lineWidth);
  const roundedLineWidth = roundToHundredths(normalizedLineWidth);
  const previewStrokeWidth = roundToHundredths(
    Math.max(1, Math.min(3.2, roundedLineWidth * 1.4))
  );
  const cacheKey = `${canonicalName}:${roundedLineWidth.toFixed(2)}`;
  const cached = PREVIEW_CACHE.get(cacheKey);
  if (cached) {
    return cached;
  }

  const baseStyle = defaultStyle();
  const style = {
    ...baseStyle,
    stroke: "#555555",
    fill: "none",
    drawExplicit: true,
    lineWidth: previewStrokeWidth,
    decoration: {
      ...baseStyle.decoration,
      enabled: canonicalName !== "none",
      name: canonicalName === "none" ? null : canonicalName,
      params: {}
    },
    decorationPreActions: [],
    decorationPostActions: []
  };
  const path: ScenePath = {
    kind: "Path",
    id: "preview:path-morphing",
    runtimeId: "preview:path-morphing",
    layer: MAIN_SCENE_LAYER,
    sourceRef: { sourceId: "preview:path-morphing", sourceSpan: PREVIEW_SOURCE_SPAN, sourceFingerprint: "" },
    style,
    styleChain: [],
    commands: [
      { kind: "M", to: worldPoint(pt(4), pt(8)) },
      { kind: "L", to: worldPoint(pt(52), pt(8)) }
    ]
  };
  const figure: SceneFigure = {
    kind: "SceneFigure",
    span: PREVIEW_SOURCE_SPAN,
    requiredTikzLibraries: [],
    layers: [{ name: MAIN_SCENE_LAYER, order: 0 }],
    elements: applyPathMorphingDecoration(path, style.decoration)
  };
  const bounds = computeDecorationPreviewBounds(figure.elements);
  if (bounds) {
    figure.bounds = bounds;
  }
  const rendered = emitSvg(figure, { padding: 2 });
  PREVIEW_CACHE.set(cacheKey, rendered.svg);
  return rendered.svg;
}

export function clearPathMorphingDecorationPreviewCache(): void {
  PREVIEW_CACHE.clear();
}

function applyPathMorphingDecoration(path: ScenePath, decoration: DecorationStyle): SceneElement[] {
  if (!decoration.enabled) {
    return [path];
  }
  const outcome = applyDecorationToPath(path, decoration, "preview:path-morphing");
  return outcome.elements;
}

function canonicalDecorationName(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function normalizePreviewLineWidth(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) {
    return 0.8;
  }
  return Math.min(4, Math.max(0.2, raw));
}

function roundToHundredths(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeDecorationPreviewBounds(elements: readonly SceneElement[]): SceneFigure["bounds"] | undefined {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const element of elements) {
    if (element.kind === "Path") {
      for (const command of element.commands) {
        if (command.kind === "M" || command.kind === "L" || command.kind === "A") {
          minX = Math.min(minX, command.to.x);
          minY = Math.min(minY, command.to.y);
          maxX = Math.max(maxX, command.to.x);
          maxY = Math.max(maxY, command.to.y);
          continue;
        }
        if (command.kind === "C") {
          minX = Math.min(minX, command.c1.x, command.c2.x, command.to.x);
          minY = Math.min(minY, command.c1.y, command.c2.y, command.to.y);
          maxX = Math.max(maxX, command.c1.x, command.c2.x, command.to.x);
          maxY = Math.max(maxY, command.c1.y, command.c2.y, command.to.y);
        }
      }
      continue;
    }

    if (element.kind === "Circle") {
      minX = Math.min(minX, element.center.x - element.radius);
      minY = Math.min(minY, element.center.y - element.radius);
      maxX = Math.max(maxX, element.center.x + element.radius);
      maxY = Math.max(maxY, element.center.y + element.radius);
      continue;
    }

    if (element.kind === "Ellipse") {
      minX = Math.min(minX, element.center.x - element.rx);
      minY = Math.min(minY, element.center.y - element.ry);
      maxX = Math.max(maxX, element.center.x + element.rx);
      maxY = Math.max(maxY, element.center.y + element.ry);
      continue;
    }

    minX = Math.min(minX, element.position.x);
    minY = Math.min(minY, element.position.y);
    maxX = Math.max(maxX, element.position.x + (element.textBlockWidth ?? 0));
    maxY = Math.max(maxY, element.position.y + (element.textBlockHeight ?? 0));
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return undefined;
  }

  return worldBounds(pt(minX), pt(minY), pt(maxX), pt(maxY));
}

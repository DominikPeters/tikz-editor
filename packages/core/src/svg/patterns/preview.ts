import { worldBounds, worldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import { parseLength } from "../../semantic/coords/parse-length.js";
import { defaultStyle } from "../../semantic/style/defaults.js";
import type { LegacyPatternName, ResolvedPattern, SceneFigure, ScenePath } from "../../semantic/types.js";
import { MAIN_SCENE_LAYER } from "../../semantic/types.js";
import { emitSvg } from "../emit.js";

type PreviewPatternPreset = LegacyPatternName | "Lines" | "Hatch" | "Dots" | "Stars";

const PREVIEW_SOURCE_SPAN = { from: 0, to: 0 } as const;
const PREVIEW_CACHE = new Map<PreviewPatternPreset, string>();
const STARS_DEFAULT_DISTANCE_PT = parseLength("3mm", "pt") ?? 8.5358;
const STARS_DEFAULT_RADIUS_PT = parseLength("1mm", "pt") ?? 2.8453;

export function renderFillPatternPreviewSvg(pattern: PreviewPatternPreset): string {
  const cached = PREVIEW_CACHE.get(pattern);
  if (cached) {
    return cached;
  }

  const baseStyle = defaultStyle();
  const style = {
    ...baseStyle,
    stroke: "#6e6e6e",
    fill: "black",
    fillPattern: previewPatternToResolvedPattern(pattern),
    patternColor: "#434343",
    drawExplicit: true,
    lineWidth: 0.25
  };
  const path: ScenePath = {
    kind: "Path",
    id: `preview:pattern:${pattern}`,
    runtimeId: `preview:pattern:${pattern}`,
    layer: MAIN_SCENE_LAYER,
    sourceRef: { sourceId: `preview:pattern:${pattern}`, sourceSpan: PREVIEW_SOURCE_SPAN, sourceFingerprint: "" },
    style,
    styleChain: [],
    commands: [
      { kind: "M", to: worldPoint(pt(4), pt(3)) },
      { kind: "L", to: worldPoint(pt(52), pt(3)) },
      { kind: "L", to: worldPoint(pt(52), pt(13)) },
      { kind: "L", to: worldPoint(pt(4), pt(13)) },
      { kind: "Z" }
    ]
  };
  const figure: SceneFigure = {
    kind: "SceneFigure",
    span: PREVIEW_SOURCE_SPAN,
    requiredTikzLibraries: [],
    layers: [{ name: MAIN_SCENE_LAYER, order: 0 }],
    elements: [path],
    bounds: worldBounds(pt(4), pt(3), pt(52), pt(13))
  };
  const rendered = emitSvg(figure, { padding: 2 });
  const namespaced = namespaceSvgIds(rendered.svg, `preview-pattern-${slugifyPatternName(pattern)}`);
  PREVIEW_CACHE.set(pattern, namespaced);
  return namespaced;
}

export function clearFillPatternPreviewCache(): void {
  PREVIEW_CACHE.clear();
}

function previewPatternToResolvedPattern(pattern: PreviewPatternPreset): ResolvedPattern {
  if (pattern === "Lines") {
    return {
      kind: "meta-lines",
      distance: 3,
      angle: 0,
      xshift: 0,
      yshift: 0,
      lineWidth: 0.5
    };
  }
  if (pattern === "Hatch") {
    return {
      kind: "meta-hatch",
      distance: 3,
      angle: 0,
      xshift: 0,
      yshift: 0,
      lineWidth: 0.5
    };
  }
  if (pattern === "Dots") {
    return {
      kind: "meta-dots",
      distance: 3,
      angle: 0,
      xshift: 0,
      yshift: 0,
      radius: 0.6
    };
  }
  if (pattern === "Stars") {
    return {
      kind: "meta-stars",
      distance: STARS_DEFAULT_DISTANCE_PT,
      angle: 0,
      xshift: 0,
      yshift: 0,
      radius: STARS_DEFAULT_RADIUS_PT,
      points: 5
    };
  }
  return {
    kind: "legacy",
    name: pattern,
    inherentlyColored: patternInherentlyColored(pattern)
  };
}

function patternInherentlyColored(pattern: LegacyPatternName): boolean {
  return (
    pattern === "checkerboard light gray" ||
    pattern === "horizontal lines light gray" ||
    pattern === "horizontal lines gray" ||
    pattern === "horizontal lines dark gray" ||
    pattern === "horizontal lines light blue" ||
    pattern === "horizontal lines dark blue" ||
    pattern === "crosshatch dots gray" ||
    pattern === "crosshatch dots light steel blue"
  );
}

function slugifyPatternName(pattern: string): string {
  return pattern
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "pattern";
}

function namespaceSvgIds(svg: string, suffix: string): string {
  const idMatches = [...svg.matchAll(/\bid="([^"]+)"/g)];
  const idMap = new Map<string, string>();
  let index = 1;
  const sourceIds = new Set(idMatches.map((match) => match[1]));
  for (const sourceId of sourceIds) {
    idMap.set(sourceId, `${sourceId}-${suffix}-${index}`);
    index += 1;
  }

  let result = svg;
  for (const [sourceId, targetId] of idMap) {
    const escapedSourceId = escapeRegExp(sourceId);
    result = result.replace(new RegExp(`\\bid="${escapedSourceId}"`, "g"), `id="${targetId}"`);
    result = result.replace(new RegExp(`url\\(#${escapedSourceId}\\)`, "g"), `url(#${targetId})`);
    result = result.replace(new RegExp(`\\bhref="#${escapedSourceId}"`, "g"), `href="#${targetId}"`);
    result = result.replace(new RegExp(`\\bxlink:href="#${escapedSourceId}"`, "g"), `xlink:href="#${targetId}"`);
  }
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

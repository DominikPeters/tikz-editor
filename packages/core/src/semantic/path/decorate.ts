import { applyDecorationToPath } from "../decorations/index.js";
import type { PgfRandom } from "../pgfmath/rng.js";
import type { ResolvedStyle, SceneElement, ScenePath } from "../types.js";
import { appendCircleSubpath, appendEllipseSubpath } from "./elements.js";
import type { DiagnosticPushFn, FeatureMarkFn } from "./types.js";

export function decoratePathElements(
  elements: SceneElement[],
  decoration: ResolvedStyle["decoration"],
  mode: "replace" | "collect",
  statementId: string,
  rng: PgfRandom,
  markFeature: FeatureMarkFn,
  pushDiagnostic: DiagnosticPushFn
): SceneElement[] {
  const output: SceneElement[] = [];
  const decorationName = canonicalDecorationName(decoration.name);
  if (decorationName) {
    markDecorationFeature(decorationName, "supported", markFeature);
  }

  for (const element of elements) {
    const path = toDecoratablePathElement(element);
    if (!path) {
      if (mode === "replace") {
        output.push(element);
      }
      continue;
    }

    const outcome = applyDecorationToPath(path, decoration, `${statementId}:${element.id}`, rng);
    if (outcome.kind === "unsupported") {
      markDecorationFeature(outcome.name, "unsupported", markFeature);
      pushDiagnostic(
        `unsupported-decoration-name:${outcome.name}`,
        outcome.reason === "deferred"
          ? `Decoration \`${outcome.name}\` is parsed but deferred because it requires dynamic TeX code execution.`
          : `Decoration \`${outcome.name}\` is not implemented; keeping the undecorated path.`,
        path.sourceRef.sourceSpan.from,
        path.sourceRef.sourceSpan.to
      );
      if (mode === "replace") {
        output.push(element);
      } else {
        output.push(...outcome.elements);
      }
      continue;
    }

    output.push(...outcome.elements);
  }

  return output;
}

function toDecoratablePathElement(element: SceneElement): ScenePath | null {
  if (element.kind === "Path") {
    return element;
  }

  if (element.kind === "Circle") {
    const commands: ScenePath["commands"] = [];
    appendCircleSubpath(commands, element.center, element.radius);
    return {
      kind: "Path",
      id: `${element.id}:as-path`,
      runtimeId: `${element.runtimeId}:as-path`,
      layer: element.layer,
      sourceRef: {
        sourceId: element.sourceRef.sourceId,
        sourceSpan: element.sourceRef.sourceSpan,
        sourceFingerprint: element.sourceRef.sourceFingerprint
      },
      origin: element.origin,
      style: cloneStyleForDecoration(element.style),
      styleChain: element.styleChain.map((entry) => ({ ...entry })),
      commands
    };
  }

  if (element.kind === "Ellipse") {
    const commands: ScenePath["commands"] = [];
    appendEllipseSubpath(commands, element.center, element.rx, element.ry, element.rotation ?? 0);
    return {
      kind: "Path",
      id: `${element.id}:as-path`,
      runtimeId: `${element.runtimeId}:as-path`,
      layer: element.layer,
      sourceRef: {
        sourceId: element.sourceRef.sourceId,
        sourceSpan: element.sourceRef.sourceSpan,
        sourceFingerprint: element.sourceRef.sourceFingerprint
      },
      origin: element.origin,
      style: cloneStyleForDecoration(element.style),
      styleChain: element.styleChain.map((entry) => ({ ...entry })),
      commands
    };
  }

  return null;
}

function cloneStyleForDecoration(style: ResolvedStyle): ResolvedStyle {
  return {
    ...style,
    decoration: {
      ...style.decoration,
      params: { ...style.decoration.params }
    },
    decorationPreActions: style.decorationPreActions.map((entry) => ({
      ...entry,
      params: { ...entry.params }
    })),
    decorationPostActions: style.decorationPostActions.map((entry) => ({
      ...entry,
      params: { ...entry.params }
    })),
    shadowLayers: style.shadowLayers.map((layer) => ({
      ...layer,
      style: { ...layer.style }
    }))
  };
}

function canonicalDecorationName(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

export function markDecorationFeature(nameRaw: string, status: "supported" | "unsupported", markFeature: FeatureMarkFn): void {
  const name = canonicalDecorationName(nameRaw);
  if (!name || name === "none") {
    return;
  }

  if (
    name === "zigzag" ||
    name === "straight zigzag" ||
    name === "random steps" ||
    name === "saw" ||
    name === "bent" ||
    name === "bumps" ||
    name === "coil" ||
    name === "snake" ||
    name === "lineto" ||
    name === "curveto" ||
    name === "moveto"
  ) {
    markFeature("decoration_pathmorphing", status);
    return;
  }

  if (
    name === "ticks" ||
    name === "expanding waves" ||
    name === "waves" ||
    name === "border" ||
    name === "brace" ||
    name === "text along path"
  ) {
    markFeature("decoration_pathreplacing", status);
    return;
  }

  if (name === "koch curve type 1" || name === "koch curve type 2" || name === "koch snowflake" || name === "cantor set") {
    markFeature("decoration_fractals", status);
    return;
  }

  if (name === "crosses" || name === "triangles") {
    markFeature("decoration_shape_marks", status);
    return;
  }

  if (name === "footprints") {
    markFeature("decoration_footprints", status);
    return;
  }

  if (name === "shape backgrounds") {
    markFeature("decoration_shape_backgrounds", status);
  }
}

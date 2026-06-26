import { parseCoordinateLike, parseLength } from "../coords/parse-length.js";
import { pt } from "../../coords/scalars.js";
import { worldTransform } from "../../coords/transforms.js";
import { multiplyMatrix, rotationMatrix, scaleMatrix, translationMatrix } from "../transform.js";
import { worldPoint, worldVector } from "../../coords/points.js";
import type { WorldPoint, WorldVector } from "../../coords/points.js";
import type { WorldTransform } from "../../coords/transforms.js";
import type { DecorationStyle, SceneElement, ScenePath, ScenePathCommand } from "../types.js";
import { normalizeColor } from "../style/colors.js";
import { normalizeOptionValue, parseStyleValueAsOptionList } from "../style/option-utils.js";
import {
  commandsToSegments,
  hasDrawablePathCommands,
  sampleFrameFromEndExtrapolated,
  sampleFrameFromStartExtrapolated,
  splitPathIntoSubpaths,
  totalSegmentLength,
  type PathSegment,
  sliceSegment
} from "../../geometry/path-sampler.js";
import type { PgfRandom } from "../pgfmath/rng.js";

type SampleFrame = {
  point: WorldPoint;
  tangent: WorldVector;
  normal: WorldVector;
};

type DecorationTransformSpec = {
  matrix: WorldTransform;
  shiftOnly: boolean;
};

function wp(x: number, y: number): WorldPoint {
  return worldPoint(pt(x), pt(y));
}

const DEFERRED_DECORATIONS = new Set(["markings", "show path construction", "text effects along path"]);

const SUPPORTED_DECORATIONS = new Set([
  "lineto",
  "moveto",
  "curveto",
  "zigzag",
  "straight zigzag",
  "random steps",
  "saw",
  "bent",
  "bumps",
  "coil",
  "snake",
  "ticks",
  "expanding waves",
  "waves",
  "border",
  "brace",
  "crosses",
  "triangles",
  "koch curve type 1",
  "koch curve type 2",
  "koch snowflake",
  "cantor set",
  "footprints",
  "shape backgrounds",
  "text along path"
]);

export type DecorationApplyResult =
  | {
      kind: "decorated";
      elements: SceneElement[];
    }
  | {
      kind: "unsupported";
      reason: "deferred" | "unknown";
      name: string;
      elements: SceneElement[];
    };

export function applyDecorationToPath(
  path: ScenePath,
  decoration: DecorationStyle,
  seedRaw: string,
  rng?: PgfRandom
): DecorationApplyResult {
  const name = canonicalDecorationName(decoration.name);
  if (!name || name === "none") {
    return {
      kind: "decorated",
      elements: [clonePath(path)]
    };
  }

  if (DEFERRED_DECORATIONS.has(name)) {
    return {
      kind: "unsupported",
      reason: "deferred",
      name,
      elements: [clonePath(path)]
    };
  }

  if (!SUPPORTED_DECORATIONS.has(name)) {
    return {
      kind: "unsupported",
      reason: "unknown",
      name,
      elements: [clonePath(path)]
    };
  }

  if (name === "text along path") {
    return {
      kind: "decorated",
      elements: decorateTextAlongPath(path, decoration, seedRaw)
    };
  }

  const decoratedCommands = decorateCommands(path.commands, decoration, seedRaw, name, rng);
  const decoratedPath = clonePath(path);
  decoratedPath.id = `${path.id}:decorated:${sanitizeDecorationName(name)}`;
  decoratedPath.undecoratedCommands = path.commands.map((command) => cloneCommand(command));
  decoratedPath.commands = decoratedCommands;
  decoratedPath.style = {
    ...decoratedPath.style,
    decoration: {
      ...decoratedPath.style.decoration,
      enabled: false,
      params: { ...decoratedPath.style.decoration.params }
    },
    decorationPreActions: [],
    decorationPostActions: []
  };

  return {
    kind: "decorated",
    elements: [decoratedPath]
  };
}

function clonePath(path: ScenePath): ScenePath {
  return {
    ...path,
    style: {
      ...path.style,
      decoration: {
        ...path.style.decoration,
        params: { ...path.style.decoration.params }
      },
      decorationPreActions: path.style.decorationPreActions.map((entry) => ({
        ...entry,
        params: { ...entry.params }
      })),
      decorationPostActions: path.style.decorationPostActions.map((entry) => ({
        ...entry,
        params: { ...entry.params }
      }))
    },
    styleChain: path.styleChain.map((entry) => ({ ...entry })),
    undecoratedCommands: path.undecoratedCommands?.map((command) => cloneCommand(command)),
    commands: path.commands.map((command) => cloneCommand(command))
  };
}

function cloneCommand(command: ScenePathCommand): ScenePathCommand {
  if (command.kind === "M" || command.kind === "L") {
    return { kind: command.kind, to: { ...command.to } };
  }
  if (command.kind === "C") {
    return { kind: "C", c1: { ...command.c1 }, c2: { ...command.c2 }, to: { ...command.to } };
  }
  if (command.kind === "A") {
    return {
      kind: "A",
      rx: command.rx,
      ry: command.ry,
      xAxisRotation: command.xAxisRotation,
      largeArc: command.largeArc,
      sweep: command.sweep,
      to: { ...command.to }
    };
  }
  return { kind: "Z" };
}

function decorateCommands(
  commands: ScenePathCommand[],
  decoration: DecorationStyle,
  seedRaw: string,
  mainName: string,
  rng?: PgfRandom
): ScenePathCommand[] {
  const transformSpec = parseDecorationTransform(decoration.transformRaw);
  const subpaths = splitPathIntoSubpaths(commands).filter(hasDrawablePathCommands);
  const allCommands: ScenePathCommand[] = [];

  subpaths.forEach((subpath, subpathIndex) => {
    const expandedSubpath = expandSubpathForDecoration(subpath);
    const segments = commandsToSegments(expandedSubpath);
    if (segments.length === 0) {
      return;
    }

    const totalLength = totalSegmentLength(segments);
    const isClosed = isClosedSubpath(subpath);
    const preLength = clampLength(decoration.preLength, 0, totalLength);
    const postLength = clampLength(decoration.postLength, 0, totalLength - preLength);
    const mainStart = preLength;
    const mainEnd = Math.max(mainStart, totalLength - postLength);

    const pieces: Array<{ name: string; start: number; end: number }> = [];
    if (preLength > 1e-6) {
      pieces.push({ name: canonicalDecorationName(decoration.pre) ?? "lineto", start: 0, end: preLength });
    }
    pieces.push({ name: mainName, start: mainStart, end: mainEnd });
    if (postLength > 1e-6) {
      pieces.push({ name: canonicalDecorationName(decoration.post) ?? "lineto", start: mainEnd, end: totalLength });
    }

    for (let pieceIndex = 0; pieceIndex < pieces.length; pieceIndex += 1) {
      const piece = pieces[pieceIndex];
      const pieceSegments = sliceSegmentsByRange(segments, piece.start, piece.end);
      if (pieceSegments.length === 0) {
        continue;
      }

      const seed = `${seedRaw}:${subpathIndex}:${pieceIndex}:${piece.name}`;
      const polylines = decorateSegments(pieceSegments, piece.name, decoration, transformSpec, seed, rng);
      for (const polyline of polylines) {
        if (polyline.length === 0) {
          continue;
        }
        allCommands.push({ kind: "M", to: polyline[0] });
        for (let index = 1; index < polyline.length; index += 1) {
          allCommands.push({ kind: "L", to: polyline[index] });
        }
        const coversFullSubpath = piece.start <= 1e-6 && Math.abs(piece.end - totalLength) <= 1e-6;
        if (isClosed && coversFullSubpath) {
          allCommands.push({ kind: "Z" });
        }
      }
    }
  });

  if (allCommands.length === 0) {
    return commands.map((command) => cloneCommand(command));
  }
  return allCommands;
}

type TextAlongPathAlign = "left" | "right" | "center";

type TextAlongPathOptions = {
  text: string;
  reversePath: boolean;
  textColor: string | null;
  align: TextAlongPathAlign;
  leftIndent: number;
  rightIndent: number;
};

function decorateTextAlongPath(path: ScenePath, decoration: DecorationStyle, seedRaw: string): SceneElement[] {
  const textOptions = parseTextAlongPathOptions(path, decoration);
  if (textOptions.text.length === 0) {
    return [];
  }

  const characters = Array.from(textOptions.text);
  const transformSpec = parseDecorationTransform(decoration.transformRaw);
  const subpaths = splitPathIntoSubpaths(path.commands).filter(hasDrawablePathCommands);
  const elements: SceneElement[] = [];

  for (let subpathIndex = 0; subpathIndex < subpaths.length; subpathIndex += 1) {
    const subpath = subpaths[subpathIndex];
    const expandedSubpath = expandSubpathForDecoration(subpath);
    const segments = commandsToSegments(expandedSubpath);
    if (segments.length === 0) {
      continue;
    }

    const totalLength = totalSegmentLength(segments);
    if (totalLength <= 1e-6) {
      continue;
    }

    const leftIndent = clampLength(textOptions.leftIndent, 0, totalLength);
    const rightIndent = clampLength(textOptions.rightIndent, 0, totalLength - leftIndent);
    const startLimit = leftIndent;
    const endLimit = totalLength - rightIndent;
    const availableLength = endLimit - startLimit;
    if (availableLength <= 1e-6) {
      continue;
    }

    const advances = characters.map((character) => estimateTextAlongPathAdvance(character, path.style.fontSize));
    const textLength = advances.reduce((sum, advance) => sum + advance, 0);
    let cursor = startLimit;
    if (textOptions.align === "right") {
      cursor += Math.max(0, availableLength - textLength);
    } else if (textOptions.align === "center") {
      cursor += Math.max(0, (availableLength - textLength) / 2);
    }

    for (let characterIndex = 0; characterIndex < characters.length; characterIndex += 1) {
      const character = characters[characterIndex];
      const advance = advances[characterIndex];
      const centerDistance = cursor + advance / 2;
      const endDistance = cursor + advance;
      if (endDistance > endLimit + 1e-6) {
        break;
      }

      const frame = sampleTextAlongPathFrame(segments, centerDistance, textOptions.reversePath);
      if (!frame) {
        cursor = endDistance;
        continue;
      }

      const position = pointFromFrame(frame, 0, 0, decoration, transformSpec);
      const angle = (Math.atan2(frame.tangent.y, frame.tangent.x) * 180) / Math.PI;
      const style = cloneStyleForTextAlongPath(path.style, textOptions.textColor);
      const lineHeight = Math.max(1, style.fontSize * 1.05);
      elements.push({
        kind: "Text",
        id: `${path.id}:decorated:${sanitizeDecorationName(seedRaw)}:text-along-path:${subpathIndex}:${characterIndex}`,
        runtimeId: `${path.runtimeId}:decorated:${sanitizeDecorationName(seedRaw)}:text-along-path:${subpathIndex}:${characterIndex}`,
        layer: path.layer,
        sourceRef: {
          sourceId: path.sourceRef.sourceId,
          sourceSpan: path.sourceRef.sourceSpan,
          sourceFingerprint: path.sourceRef.sourceFingerprint
        },
        origin: path.origin,
        style,
        styleChain: path.styleChain.map((entry) => ({ ...entry })),
        position,
        text: character,
        textBlockWidth: advance,
        textBlockHeight: lineHeight,
        rotation: angle
      });

      cursor = endDistance;
    }
  }

  return elements;
}

function parseTextAlongPathOptions(path: ScenePath, decoration: DecorationStyle): TextAlongPathOptions {
  const textRaw = decoration.params.text ?? "";
  const text = normalizeTextAlongPathInput(textRaw);
  const reversePath = parseBooleanLike(decoration.params["reverse path"], false);
  const textColor = resolveTextAlongPathColor(path, decoration.params["text color"]);

  let align: TextAlongPathAlign = "left";
  const directAlign = parseTextAlongPathAlign(decoration.params["text align/align"]);
  if (directAlign) {
    align = directAlign;
  }

  let leftIndent = parseLength(decoration.params["text align/left indent"] ?? "", "pt") ?? 0;
  let rightIndent = parseLength(decoration.params["text align/right indent"] ?? "", "pt") ?? 0;
  const textAlignRaw = decoration.params["text align"];
  if (textAlignRaw) {
    const nested = parseStyleValueAsOptionList(textAlignRaw);
    if (nested) {
      for (const entry of nested.entries) {
        if (entry.kind === "flag") {
          const parsedAlign = parseTextAlongPathAlign(entry.key);
          if (parsedAlign) {
            align = parsedAlign;
          }
          continue;
        }
        if (entry.kind !== "kv") {
          continue;
        }
        const key = normalizeOptionValue(entry.key).toLowerCase().replace(/\s+/g, " ");
        if (key === "align") {
          const parsedAlign = parseTextAlongPathAlign(entry.valueRaw);
          if (parsedAlign) {
            align = parsedAlign;
          }
          continue;
        }
        if (key === "left indent") {
          const parsed = parseLength(entry.valueRaw, "pt");
          if (parsed != null) {
            leftIndent = parsed;
          }
          continue;
        }
        if (key === "right indent") {
          const parsed = parseLength(entry.valueRaw, "pt");
          if (parsed != null) {
            rightIndent = parsed;
          }
        }
      }
    } else {
      const parsedAlign = parseTextAlongPathAlign(textAlignRaw);
      if (parsedAlign) {
        align = parsedAlign;
      }
    }
  }

  return {
    text,
    reversePath,
    textColor,
    align,
    leftIndent,
    rightIndent
  };
}

function normalizeTextAlongPathInput(raw: string): string {
  const escapedSpacePlaceholder = "\u0000";
  const collapsed = raw
    .replaceAll("\\space", escapedSpacePlaceholder)
    .replaceAll("\\ ", escapedSpacePlaceholder)
    .replace(/\s+/g, " ")
    .replaceAll(escapedSpacePlaceholder, " ");
  return collapsed.trim();
}

function parseTextAlongPathAlign(raw: string | null | undefined): TextAlongPathAlign | null {
  if (!raw) {
    return null;
  }
  const normalized = normalizeOptionValue(raw).toLowerCase().replace(/\s+/g, " ");
  if (normalized === "left") {
    return "left";
  }
  if (normalized === "right") {
    return "right";
  }
  if (normalized === "center") {
    return "center";
  }
  return null;
}

function parseBooleanLike(raw: string | null | undefined, fallback: boolean): boolean {
  if (!raw) {
    return fallback;
  }
  const normalized = normalizeOptionValue(raw).toLowerCase();
  if (normalized.length === 0 || normalized === "true" || normalized === "yes" || normalized === "on" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "no" || normalized === "off" || normalized === "0") {
    return false;
  }
  return fallback;
}

function resolveTextAlongPathColor(path: ScenePath, rawColor: string | undefined): string | null {
  if (!rawColor) {
    return path.style.textColor;
  }
  const currentColor = path.style.textColor ?? path.style.stroke ?? path.style.fill ?? "black";
  return normalizeColor(rawColor, { currentColor });
}

function cloneStyleForTextAlongPath(pathStyle: ScenePath["style"], textColor: string | null): ScenePath["style"] {
  return {
    ...pathStyle,
    textColor,
    textAlign: "center",
    decoration: {
      ...pathStyle.decoration,
      enabled: false,
      params: { ...pathStyle.decoration.params }
    },
    decorationPreActions: [],
    decorationPostActions: [],
    shadowLayers: pathStyle.shadowLayers.map((layer) => ({
      ...layer,
      style: { ...layer.style }
    }))
  };
}

function estimateTextAlongPathAdvance(character: string, fontSize: number): number {
  if (character === " ") {
    return Math.max(0.5, fontSize * 0.35);
  }
  if (character === "." || character === "," || character === ":" || character === ";" || character === "'" || character === "`") {
    return Math.max(0.5, fontSize * 0.3);
  }
  if (character === "!" || character === "|" || character === "i" || character === "l") {
    return Math.max(0.5, fontSize * 0.33);
  }
  if (character >= "A" && character <= "Z") {
    return Math.max(0.5, fontSize * 0.68);
  }
  return Math.max(0.5, fontSize * 0.56);
}

function sampleTextAlongPathFrame(segments: PathSegment[], distance: number, reversePath: boolean): SampleFrame | null {
  const sampled = reversePath ? sampleFrameFromEndExtrapolated(segments, distance) : sampleFrameFromStartExtrapolated(segments, distance);
  if (!sampled) {
    return null;
  }
  if (!reversePath) {
    return sampled;
  }
  return {
    point: sampled.point,
    tangent: worldVector(pt(-1 * sampled.tangent.x), pt(-1 * sampled.tangent.y)),
    normal: worldVector(pt(-1 * sampled.normal.x), pt(-1 * sampled.normal.y))
  };
}

function decorateSegments(
  segments: PathSegment[],
  name: string,
  decoration: DecorationStyle,
  transformSpec: DecorationTransformSpec,
  seedRaw: string,
  rng?: PgfRandom
): WorldPoint[][] {
  const canonical = canonicalDecorationName(name) ?? "lineto";

  switch (canonical) {
    case "moveto":
      return decorateMoveto(segments, decoration, transformSpec);
    case "lineto":
    case "curveto":
      return [decorateLineto(segments, decoration, transformSpec)];
    case "zigzag":
      return [decorateZigzag(segments, decoration, transformSpec)];
    case "straight zigzag":
      return [decorateStraightZigzag(segments, decoration, transformSpec)];
    case "random steps":
      return [decorateRandomSteps(segments, decoration, transformSpec, seedRaw, rng)];
    case "saw":
      return [decorateSaw(segments, decoration, transformSpec)];
    case "bent":
      return [decorateBent(segments, decoration, transformSpec)];
    case "bumps":
      return [decorateBumps(segments, decoration, transformSpec)];
    case "coil":
      return [decorateWave(segments, decoration, transformSpec, "coil")];
    case "snake":
      return [decorateWave(segments, decoration, transformSpec, "snake")];
    case "waves":
      return [decorateWave(segments, decoration, transformSpec, "waves")];
    case "expanding waves":
      return [decorateWave(segments, decoration, transformSpec, "expanding waves")];
    case "ticks":
      return decorateTicksLike(segments, decoration, transformSpec, "ticks");
    case "border":
      return decorateTicksLike(segments, decoration, transformSpec, "border");
    case "crosses":
      return decorateShapeMarks(segments, decoration, transformSpec, "crosses");
    case "triangles":
      return decorateShapeMarks(segments, decoration, transformSpec, "triangles");
    case "footprints":
      return decorateShapeMarks(segments, decoration, transformSpec, "footprints");
    case "shape backgrounds":
      return decorateShapeMarks(segments, decoration, transformSpec, "shape backgrounds");
    case "brace":
      return [decorateBrace(segments, decoration, transformSpec)];
    case "koch curve type 1":
      return applyFractal(segments, decoration, transformSpec, "koch1");
    case "koch curve type 2":
      return applyFractal(segments, decoration, transformSpec, "koch2");
    case "koch snowflake":
      return applyFractal(segments, decoration, transformSpec, "snowflake");
    case "cantor set":
      return applyFractal(segments, decoration, transformSpec, "cantor");
    default:
      return [decorateLineto(segments, decoration, transformSpec)];
  }
}

function decorateLineto(segments: PathSegment[], decoration: DecorationStyle, transformSpec: DecorationTransformSpec): WorldPoint[] {
  return samplePolyline(segments, Math.max(2, getSegmentLength(decoration) / 2), decoration, transformSpec, () => 0);
}

function decorateMoveto(segments: PathSegment[], decoration: DecorationStyle, transformSpec: DecorationTransformSpec): WorldPoint[][] {
  const total = totalSegmentLength(segments);
  if (total <= 1e-9) {
    return [];
  }
  const firstFrame = sampleFrameFromStartExtrapolated(segments, 0);
  const endFrame = sampleFrameFromStartExtrapolated(segments, total);
  if (!firstFrame || !endFrame) {
    return [];
  }
  return [[
    pointFromFrame(firstFrame, 0, 0, decoration, transformSpec),
    pointFromFrame(endFrame, 0, 0, decoration, transformSpec)
  ]];
}

function decorateZigzag(segments: PathSegment[], decoration: DecorationStyle, transformSpec: DecorationTransformSpec): WorldPoint[] {
  const segmentLength = Math.max(0.5, getSegmentLength(decoration));
  const half = segmentLength / 2;
  const total = totalSegmentLength(segments);
  const points: WorldPoint[] = [];

  const pushAt = (distance: number, offset: number): void => {
    const frame = sampleFrameFromStartExtrapolated(segments, distance);
    if (!frame) {
      return;
    }
    points.push(pointFromFrame(frame, 0, offset, decoration, transformSpec));
  };

  pushAt(0, 0);
  let index = 1;
  for (let distance = half; distance < total - 1e-6; distance += half, index += 1) {
    const offset = index % 2 === 1 ? getAmplitude(decoration) : -getAmplitude(decoration);
    pushAt(distance, offset);
  }
  pushAt(total, 0);
  return points;
}

function decorateStraightZigzag(segments: PathSegment[], decoration: DecorationStyle, transformSpec: DecorationTransformSpec): WorldPoint[] {
  const zigzag = decorateZigzag(segments, decoration, transformSpec);
  if (zigzag.length <= 2) {
    return zigzag;
  }

  const filtered: WorldPoint[] = [];
  for (let index = 0; index < zigzag.length; index += 1) {
    if (index === 0 || index === zigzag.length - 1 || index % 2 === 1) {
      filtered.push(zigzag[index]);
    }
  }
  return filtered;
}

function decorateRandomSteps(
  segments: PathSegment[],
  decoration: DecorationStyle,
  transformSpec: DecorationTransformSpec,
  seedRaw: string,
  rng?: PgfRandom
): WorldPoint[] {
  const random = rng ? () => rng.rand() : makeDeterministicRandom(seedRaw);
  const polylines: WorldPoint[][] = [];

  for (let index = 0; index < segments.length; index += 1) {
    const segmentSeed = `${seedRaw}:segment:${index}`;
    const segmentRandom = rng
      ? random
      : index === 0
        ? random
        : makeDeterministicRandom(segmentSeed);
    const segmentWorldPoints = decorateRandomStepsOnSegment(segments[index], decoration, transformSpec, segmentRandom);
    if (segmentWorldPoints.length > 0) {
      polylines.push(segmentWorldPoints);
    }
  }

  return flattenSegmentPolylines(polylines);
}

function decorateRandomStepsOnSegment(
  segment: PathSegment,
  decoration: DecorationStyle,
  transformSpec: DecorationTransformSpec,
  random: () => number
): WorldPoint[] {
  const segmentLength = Math.max(1, getSegmentLength(decoration));
  const amplitude = getAmplitude(decoration);
  const total = segment.length;
  if (total <= 1e-9) {
    return [];
  }

  const points: WorldPoint[] = [];
  const startFrame = sampleFrameFromStartExtrapolated([segment], 0);
  if (!startFrame) {
    return points;
  }
  points.push(pointFromFrame(startFrame, 0, 0, decoration, transformSpec));

  for (let stateStart = 0; stateStart + 1.5 * segmentLength <= total + 1e-9; stateStart += segmentLength) {
    const frame = sampleFrameFromStartExtrapolated([segment], stateStart);
    if (!frame) {
      continue;
    }
    const jitterX = random() * amplitude;
    const jitterY = random() * amplitude;
    points.push(pointFromFrame(frame, segmentLength + jitterX, jitterY, decoration, transformSpec));
  }

  const endFrame = sampleFrameFromStartExtrapolated([segment], total);
  if (endFrame) {
    points.push(pointFromFrame(endFrame, 0, 0, decoration, transformSpec));
  }
  return dedupeWorldPoints(points);
}

function decorateSaw(segments: PathSegment[], decoration: DecorationStyle, transformSpec: DecorationTransformSpec): WorldPoint[] {
  const segmentLength = Math.max(0.5, getSegmentLength(decoration));
  const amplitude = getAmplitude(decoration);
  const total = totalSegmentLength(segments);
  const points: WorldPoint[] = [];

  const startFrame = sampleFrameFromStartExtrapolated(segments, 0);
  if (!startFrame) {
    return points;
  }
  points.push(pointFromFrame(startFrame, 0, 0, decoration, transformSpec));

  for (let distance = 0; distance < total - 1e-6; distance += segmentLength) {
    const peakDistance = Math.min(total, distance + segmentLength / 2);
    const endDistance = Math.min(total, distance + segmentLength);
    const peakFrame = sampleFrameFromStartExtrapolated(segments, peakDistance);
    const endFrame = sampleFrameFromStartExtrapolated(segments, endDistance);
    if (peakFrame) {
      points.push(pointFromFrame(peakFrame, 0, amplitude, decoration, transformSpec));
    }
    if (endFrame) {
      points.push(pointFromFrame(endFrame, 0, 0, decoration, transformSpec));
    }
  }

  return points;
}

function decorateBent(segments: PathSegment[], decoration: DecorationStyle, transformSpec: DecorationTransformSpec): WorldPoint[] {
  const total = totalSegmentLength(segments);
  const amplitude = getAmplitude(decoration);
  const aspect = getNumberParam(decoration, "aspect", 0.5);
  const points: WorldPoint[] = [];

  const startFrame = sampleFrameFromStartExtrapolated(segments, 0);
  const midFrame = sampleFrameFromStartExtrapolated(segments, clampLength(total * aspect, 0, total));
  const endFrame = sampleFrameFromStartExtrapolated(segments, total);
  if (!startFrame || !midFrame || !endFrame) {
    return decorateLineto(segments, decoration, transformSpec);
  }

  points.push(pointFromFrame(startFrame, 0, 0, decoration, transformSpec));
  points.push(pointFromFrame(midFrame, 0, amplitude, decoration, transformSpec));
  points.push(pointFromFrame(endFrame, 0, 0, decoration, transformSpec));
  return points;
}

function decorateWave(
  segments: PathSegment[],
  decoration: DecorationStyle,
  transformSpec: DecorationTransformSpec,
  kind: "bumps" | "coil" | "snake" | "waves" | "expanding waves"
): WorldPoint[] {
  const total = totalSegmentLength(segments);
  if (total <= 1e-9) {
    return [];
  }

  const segmentLength = Math.max(1, getSegmentLength(decoration));
  const amplitude = kind === "waves" || kind === "expanding waves" ? getStartRadius(decoration) : getAmplitude(decoration);
  const cycles = Math.max(1, total / segmentLength);
  const samples = Math.max(16, Math.ceil(cycles * 12));
  const points: WorldPoint[] = [];

  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const distance = t * total;
    const frame = sampleFrameFromStartExtrapolated(segments, distance);
    if (!frame) {
      continue;
    }

    let envelope = 1;
    if (kind === "expanding waves") {
      envelope = 0.5 + 0.5 * t;
    }

    let phaseScale = 1;
    if (kind === "coil") {
      phaseScale = 2;
    }

    const phase = t * cycles * Math.PI * 2 * phaseScale;
    let offset = Math.sin(phase) * amplitude * envelope;
    if (kind === "bumps") {
      offset = Math.abs(Math.sin(phase)) * amplitude;
    }
    if (index === 0 || index === samples) {
      offset = 0;
    }

    points.push(pointFromFrame(frame, 0, offset, decoration, transformSpec));
  }

  return points;
}

function decorateBumps(segments: PathSegment[], decoration: DecorationStyle, transformSpec: DecorationTransformSpec): WorldPoint[] {
  const bumpSegmentLength = Math.max(1, getSegmentLength(decoration));
  const stateWidth = 0.5 * bumpSegmentLength;
  const amplitude = getAmplitude(decoration);
  const polylines: WorldPoint[][] = [];

  for (const segment of segments) {
    const total = segment.length;
    if (total <= 1e-9) {
      continue;
    }

    const segmentPolyline: WorldPoint[] = [];
    const startFrame = sampleFrameFromStartExtrapolated([segment], 0);
    if (startFrame) {
      segmentPolyline.push(pointFromFrame(startFrame, 0, 0, decoration, transformSpec));
    }

    for (let stateStart = 0; stateStart + 0.51 * bumpSegmentLength <= total + 1e-9; stateStart += stateWidth) {
      const frame = sampleFrameFromStartExtrapolated([segment], stateStart);
      if (!frame) {
        continue;
      }

      const firstCurve = sampleCubic(
        wp(0, 0),
        wp(0, 0.555 * amplitude),
        wp(0.11125 * bumpSegmentLength, amplitude),
        wp(0.25 * bumpSegmentLength, amplitude),
        6
      );
      const secondCurve = sampleCubic(
        wp(0.25 * bumpSegmentLength, amplitude),
        wp(0.38875 * bumpSegmentLength, amplitude),
        wp(0.5 * bumpSegmentLength, 0.5 * amplitude),
        wp(0.5 * bumpSegmentLength, 0),
        6
      );

      const localWorldPoints = [...firstCurve, ...secondCurve.slice(1)];
      for (const local of localWorldPoints) {
        segmentPolyline.push(pointFromFrame(frame, local.x, local.y, decoration, transformSpec));
      }
    }

    const endFrame = sampleFrameFromStartExtrapolated([segment], total);
    if (endFrame) {
      segmentPolyline.push(pointFromFrame(endFrame, 0, 0, decoration, transformSpec));
    }

    const deduped = dedupeWorldPoints(segmentPolyline);
    if (deduped.length > 0) {
      polylines.push(deduped);
    }
  }

  return flattenSegmentPolylines(polylines);
}

function decorateTicksLike(
  segments: PathSegment[],
  decoration: DecorationStyle,
  transformSpec: DecorationTransformSpec,
  kind: "ticks" | "border"
): WorldPoint[][] {
  const spacing = Math.max(1, getSegmentLength(decoration));
  const total = totalSegmentLength(segments);
  const amplitude = getAmplitude(decoration);
  const angleDegrees = getNumberParam(decoration, "angle", 45);
  const angleRadians = (angleDegrees * Math.PI) / 180;
  const polylines: WorldPoint[][] = [];

  for (let distance = 0; distance <= total + 1e-6; distance += spacing) {
    const frame = sampleFrameFromStartExtrapolated(segments, Math.min(distance, total));
    if (!frame) {
      continue;
    }

    if (kind === "ticks") {
      const top = pointFromFrame(frame, 0, amplitude, decoration, transformSpec);
      const bottom = pointFromFrame(frame, 0, -amplitude, decoration, transformSpec);
      polylines.push([top, bottom]);
      continue;
    }

    const endLocalX = Math.cos(angleRadians) * amplitude;
    const endLocalY = Math.sin(angleRadians) * amplitude;
    const start = pointFromFrame(frame, 0, 0, decoration, transformSpec);
    const end = pointFromFrame(frame, endLocalX, endLocalY, decoration, transformSpec);
    polylines.push([start, end]);
  }

  return polylines;
}

function decorateShapeMarks(
  segments: PathSegment[],
  decoration: DecorationStyle,
  transformSpec: DecorationTransformSpec,
  kind: "crosses" | "triangles" | "footprints" | "shape backgrounds"
): WorldPoint[][] {
  const spacing = getShapeSpacing(decoration);
  const total = totalSegmentLength(segments);
  const width = getShapeWidth(decoration);
  const height = getShapeHeight(decoration);
  const shapeName = canonicalDecorationName(decoration.params["shape"] ?? "circle") ?? "circle";
  const followPath = !transformSpec.shiftOnly;
  const polylines: WorldPoint[][] = [];

  for (let distance = 0; distance <= total + 1e-6; distance += spacing) {
    const frame = sampleFrameFromStartExtrapolated(segments, Math.min(distance, total));
    if (!frame) {
      continue;
    }

    if (kind === "crosses") {
      polylines.push([
        pointFromFrame(frame, -width / 2, height / 2, decoration, transformSpec, followPath),
        pointFromFrame(frame, width / 2, -height / 2, decoration, transformSpec, followPath)
      ]);
      polylines.push([
        pointFromFrame(frame, -width / 2, -height / 2, decoration, transformSpec, followPath),
        pointFromFrame(frame, width / 2, height / 2, decoration, transformSpec, followPath)
      ]);
      continue;
    }

    if (kind === "triangles") {
      polylines.push([
        pointFromFrame(frame, 0, height / 2, decoration, transformSpec, followPath),
        pointFromFrame(frame, width / 2, -height / 2, decoration, transformSpec, followPath),
        pointFromFrame(frame, -width / 2, -height / 2, decoration, transformSpec, followPath),
        pointFromFrame(frame, 0, height / 2, decoration, transformSpec, followPath)
      ]);
      continue;
    }

    if (kind === "footprints") {
      const toe = pointFromFrame(frame, width / 2, 0, decoration, transformSpec, followPath);
      const heelTop = pointFromFrame(frame, -width / 2, height / 2, decoration, transformSpec, followPath);
      const heelBottom = pointFromFrame(frame, -width / 2, -height / 2, decoration, transformSpec, followPath);
      polylines.push([heelTop, toe, heelBottom]);
      continue;
    }

    const backgroundPolylines = makeShapeBackgroundPolylines(frame, shapeName, width, height, decoration, transformSpec, followPath);
    polylines.push(...backgroundPolylines);
  }

  return polylines;
}

function makeShapeBackgroundPolylines(
  frame: SampleFrame,
  shapeName: string,
  width: number,
  height: number,
  decoration: DecorationStyle,
  transformSpec: DecorationTransformSpec,
  followPath: boolean
): WorldPoint[][] {
  const pointsToPolyline = (entries: WorldPoint[]): WorldPoint[] =>
    entries.map((entry) => pointFromFrame(frame, entry.x, entry.y, decoration, transformSpec, followPath));

  if (shapeName === "rectangle") {
    return [
      pointsToPolyline([
        worldPoint(pt(-width / 2), pt(-height / 2)),
        worldPoint(pt(width / 2), pt(-height / 2)),
        worldPoint(pt(width / 2), pt(height / 2)),
        worldPoint(pt(-width / 2), pt(height / 2)),
        worldPoint(pt(-width / 2), pt(-height / 2))
      ])
    ];
  }

  if (shapeName === "triangle" || shapeName === "triangles") {
    return [
      pointsToPolyline([
        worldPoint(pt(0), pt(height / 2)),
        worldPoint(pt(width / 2), pt(-height / 2)),
        worldPoint(pt(-width / 2), pt(-height / 2)),
        worldPoint(pt(0), pt(height / 2))
      ])
    ];
  }

  // default: approximate circle/ellipse
  const samples = 10;
  const points: WorldPoint[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const angle = (index / samples) * Math.PI * 2;
    points.push(worldPoint(
      pt(Math.cos(angle) * width * 0.5),
      pt(Math.sin(angle) * height * 0.5)
    ));
  }
  return [pointsToPolyline(points)];
}

function decorateBrace(segments: PathSegment[], decoration: DecorationStyle, transformSpec: DecorationTransformSpec): WorldPoint[] {
  const total = totalSegmentLength(segments);
  if (total <= 1e-9) {
    return [];
  }

  const amplitude = getAmplitude(decoration);
  const aspect = clampLength(getNumberParam(decoration, "aspect", 0.5), 0, 1);
  let yc = aspect * total;
  if (2 * amplitude > yc) {
    yc = 0.5 * yc;
  } else {
    yc = amplitude;
  }

  let xc = aspect * total - total;
  if (-2 * amplitude < xc) {
    xc = -0.5 * xc;
  } else {
    xc = amplitude;
  }

  const localWorldPoints: WorldPoint[] = [];
  localWorldPoints.push(...sampleCubic(
    worldPoint(pt(0), pt(0)),
    worldPoint(pt(0.15 * yc), pt(0.3 * amplitude)),
    worldPoint(pt(0.5 * yc), pt(0.5 * amplitude)),
    worldPoint(pt(yc), pt(0.5 * amplitude)),
    10
  ));
  localWorldPoints.push(worldPoint(pt(aspect * total - yc), pt(0.5 * amplitude)));
  localWorldPoints.push(...sampleCubic(
    worldPoint(pt(aspect * total - yc), pt(0.5 * amplitude)),
    worldPoint(pt(aspect * total - 0.5 * yc), pt(0.5 * amplitude)),
    worldPoint(pt(aspect * total - 0.15 * yc), pt(0.7 * amplitude)),
    worldPoint(pt(aspect * total), pt(1 * amplitude)),
    10
  ));
  localWorldPoints.push(...sampleCubic(
    worldPoint(pt(aspect * total), pt(1 * amplitude)),
    worldPoint(pt(aspect * total + 0.15 * xc), pt(0.7 * amplitude)),
    worldPoint(pt(aspect * total + 0.5 * xc), pt(0.5 * amplitude)),
    worldPoint(pt(aspect * total + xc), pt(0.5 * amplitude)),
    10
  ));
  localWorldPoints.push(worldPoint(pt(total - xc), pt(0.5 * amplitude)));
  localWorldPoints.push(...sampleCubic(
    worldPoint(pt(total - xc), pt(0.5 * amplitude)),
    worldPoint(pt(total - 0.5 * xc), pt(0.5 * amplitude)),
    worldPoint(pt(total - 0.15 * xc), pt(0.3 * amplitude)),
    worldPoint(pt(total), pt(0)),
    10
  ));

  const points: WorldPoint[] = [];
  for (const local of dedupeLocalWorldPoints(localWorldPoints)) {
    const distance = clampLength(local.x, 0, total);
    const frame = sampleFrameFromStartExtrapolated(segments, distance);
    if (!frame) {
      continue;
    }
    points.push(pointFromFrame(frame, 0, local.y, decoration, transformSpec));
  }

  return points;
}

function applyFractal(
  segments: PathSegment[],
  decoration: DecorationStyle,
  transformSpec: DecorationTransformSpec,
  variant: "koch1" | "koch2" | "snowflake" | "cantor"
): WorldPoint[][] {
  const base = samplePolyline(segments, Math.max(1, getSegmentLength(decoration) / 2), decoration, transformSpec, () => 0);
  if (base.length < 2) {
    return [base];
  }

  if (variant === "cantor") {
    const polylines: WorldPoint[][] = [];
    for (let index = 0; index < base.length - 1; index += 1) {
      const from = base[index];
      const to = base[index + 1];
      const p1 = interpolateWorldPoint(from, to, 0);
      const p2 = interpolateWorldPoint(from, to, 1 / 3);
      const p3 = interpolateWorldPoint(from, to, 2 / 3);
      const p4 = interpolateWorldPoint(from, to, 1);
      polylines.push([p1, p2]);
      polylines.push([p3, p4]);
    }
    return polylines;
  }

  const pattern =
    variant === "koch1"
      ? [
          { x: 0, y: 0 },
          { x: 1 / 3, y: 0 },
          { x: 1 / 3, y: 1 / 3 },
          { x: 2 / 3, y: 1 / 3 },
          { x: 2 / 3, y: 0 },
          { x: 1, y: 0 }
        ]
      : variant === "koch2"
        ? [
            { x: 0, y: 0 },
            { x: 1 / 4, y: 0 },
            { x: 1 / 4, y: 1 / 4 },
            { x: 1 / 2, y: 1 / 4 },
            { x: 1 / 2, y: 0 },
            { x: 1 / 2, y: -1 / 4 },
            { x: 3 / 4, y: -1 / 4 },
            { x: 3 / 4, y: 0 },
            { x: 1, y: 0 }
          ]
        : [
            { x: 0, y: 0 },
            { x: 1 / 3, y: 0 },
            { x: 1 / 2, y: Math.sqrt(3) / 6 },
            { x: 2 / 3, y: 0 },
            { x: 1, y: 0 }
          ];

  const out: WorldPoint[] = [];
  for (let index = 0; index < base.length - 1; index += 1) {
    const from = base[index];
    const to = base[index + 1];
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    for (let patternIndex = 0; patternIndex < pattern.length; patternIndex += 1) {
      const local = pattern[patternIndex];
      if (index > 0 && patternIndex === 0) {
        continue;
      }
      out.push(wp(from.x + dx * local.x - dy * local.y, from.y + dy * local.x + dx * local.y));
    }
  }

  return [out];
}

function samplePolyline(
  segments: PathSegment[],
  spacing: number,
  decoration: DecorationStyle,
  transformSpec: DecorationTransformSpec,
  offsetAtDistance: (distance: number, total: number) => number
): WorldPoint[] {
  const total = totalSegmentLength(segments);
  if (total <= 1e-9) {
    return [];
  }

  const points: WorldPoint[] = [];
  const effectiveSpacing = Math.max(0.5, spacing);
  for (let distance = 0; distance <= total + 1e-6; distance += effectiveSpacing) {
    const clampedDistance = Math.min(distance, total);
    const frame = sampleFrameFromStartExtrapolated(segments, clampedDistance);
    if (!frame) {
      continue;
    }
    points.push(pointFromFrame(frame, 0, offsetAtDistance(clampedDistance, total), decoration, transformSpec));
  }

  const endFrame = sampleFrameFromStartExtrapolated(segments, total);
  if (endFrame) {
    const endWorldPoint = pointFromFrame(endFrame, 0, offsetAtDistance(total, total), decoration, transformSpec);
    const last = points[points.length - 1];
    if (!last || Math.hypot(last.x - endWorldPoint.x, last.y - endWorldPoint.y) > 1e-9) {
      points.push(endWorldPoint);
    }
  }

  return points;
}

function pointFromFrame(
  frame: SampleFrame,
  localX: number,
  localY: number,
  decoration: DecorationStyle,
  transformSpec: DecorationTransformSpec,
  followPath = true
): WorldPoint {
  const raisedY = localY + decoration.raise;
  const mirroredY = decoration.mirror ? -raisedY : raisedY;
  const transformed = applyDecorationMatrix(transformSpec.matrix, wp(localX, mirroredY));
  if (!followPath) {
    return wp(frame.point.x + transformed.x, frame.point.y + transformed.y);
  }
  return wp(
    frame.point.x + frame.tangent.x * transformed.x + frame.normal.x * transformed.y,
    frame.point.y + frame.tangent.y * transformed.x + frame.normal.y * transformed.y
  );
}

function applyDecorationMatrix(matrix: WorldTransform, point: WorldPoint): WorldPoint {
  return wp(
    matrix.a * point.x + matrix.c * point.y + matrix.e,
    matrix.b * point.x + matrix.d * point.y + matrix.f
  );
}

function parseDecorationTransform(raw: string | null): DecorationTransformSpec {
  const identity = worldTransform(1, 0, 0, 1, 0, 0);
  const defaultSpec: DecorationTransformSpec = {
    matrix: identity,
    shiftOnly: false
  };
  if (!raw || raw.trim().length === 0) {
    return defaultSpec;
  }

  const options = parseStyleValueAsOptionList(raw);
  if (!options) {
    return defaultSpec;
  }

  let transform = identity;
  let shiftOnly = false;
  for (const entry of options.entries) {
    if (entry.kind === "flag" && entry.key.trim().toLowerCase() === "shift only") {
      shiftOnly = true;
      continue;
    }
    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "shift only") {
      const normalized = normalizeOptionValue(entry.valueRaw).toLowerCase();
      if (normalized.length === 0 || normalized === "true" || normalized === "yes" || normalized === "on" || normalized === "1") {
        shiftOnly = true;
      }
      continue;
    }
    if (entry.key === "xshift") {
      const value = parseLength(entry.valueRaw, "pt");
      if (value != null) {
        transform = multiplyMatrix(transform, translationMatrix(value, 0));
      }
      continue;
    }
    if (entry.key === "yshift") {
      const value = parseLength(entry.valueRaw, "pt");
      if (value != null) {
        transform = multiplyMatrix(transform, translationMatrix(0, value));
      }
      continue;
    }
    if (entry.key === "shift") {
      const parsed = parseCoordinateLike(normalizeOptionValue(entry.valueRaw));
      if (!parsed) {
        continue;
      }
      const x = parseLength(parsed.x, "cm");
      const y = parseLength(parsed.y, "cm");
      if (x == null || y == null) {
        continue;
      }
      transform = multiplyMatrix(transform, translationMatrix(x, y));
      continue;
    }
    if (entry.key === "scale") {
      const value = Number(entry.valueRaw);
      if (Number.isFinite(value)) {
        transform = multiplyMatrix(transform, scaleMatrix(value, value));
      }
      continue;
    }
    if (entry.key === "xscale") {
      const value = Number(entry.valueRaw);
      if (Number.isFinite(value)) {
        transform = multiplyMatrix(transform, scaleMatrix(value, 1));
      }
      continue;
    }
    if (entry.key === "yscale") {
      const value = Number(entry.valueRaw);
      if (Number.isFinite(value)) {
        transform = multiplyMatrix(transform, scaleMatrix(1, value));
      }
      continue;
    }
    if (entry.key === "rotate") {
      const value = Number(entry.valueRaw);
      if (Number.isFinite(value)) {
        transform = multiplyMatrix(transform, rotationMatrix(value));
      }
    }
  }

  return {
    matrix: transform,
    shiftOnly
  };
}

function getSegmentLength(decoration: DecorationStyle): number {
  return getLengthParam(decoration, "segment length", 10);
}

function getAmplitude(decoration: DecorationStyle): number {
  return getLengthParam(decoration, "amplitude", 2.5);
}

function getStartRadius(decoration: DecorationStyle): number {
  return getLengthParam(decoration, "start radius", 2.5);
}

function getShapeWidth(decoration: DecorationStyle): number {
  const size = getLengthParam(decoration, "shape size", Number.NaN);
  if (Number.isFinite(size)) {
    return size;
  }
  return getLengthParam(decoration, "shape width", getLengthParam(decoration, "shape start width", 2.5));
}

function getShapeHeight(decoration: DecorationStyle): number {
  const size = getLengthParam(decoration, "shape size", Number.NaN);
  if (Number.isFinite(size)) {
    return size;
  }
  return getLengthParam(decoration, "shape height", getLengthParam(decoration, "shape start height", 2.5));
}

function getShapeSpacing(decoration: DecorationStyle): number {
  const raw = decoration.params["shape sep"];
  if (!raw) {
    return Math.max(1, getSegmentLength(decoration));
  }

  const firstToken = raw.split(",")[0]?.trim() ?? raw;
  const parsed = parseLength(firstToken, "pt");
  if (parsed == null) {
    return Math.max(1, getSegmentLength(decoration));
  }
  return Math.max(1, parsed);
}

function getLengthParam(decoration: DecorationStyle, key: string, fallback: number): number {
  const raw = decoration.params[key];
  if (!raw) {
    return fallback;
  }
  const parsed = parseLength(raw, "pt");
  return parsed ?? fallback;
}

function getNumberParam(decoration: DecorationStyle, key: string, fallback: number): number {
  const raw = decoration.params[key];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(normalizeOptionValue(raw));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sliceSegmentsByRange(segments: PathSegment[], start: number, end: number): PathSegment[] {
  const result: PathSegment[] = [];
  let cursor = 0;

  for (const segment of segments) {
    const segmentStart = cursor;
    const segmentEnd = cursor + segment.length;
    cursor = segmentEnd;

    if (end <= segmentStart) {
      break;
    }
    if (start >= segmentEnd) {
      continue;
    }

    const localStart = Math.max(0, start - segmentStart);
    const localEnd = Math.min(segment.length, end - segmentStart);
    const sliced = sliceSegment(segment, localStart, localEnd);
    if (sliced) {
      result.push(sliced);
    }
  }

  return result;
}

function isClosedSubpath(commands: ScenePathCommand[]): boolean {
  if (commands.length === 0) {
    return false;
  }

  const hasCloseCommand = commands.some((command) => command.kind === "Z");
  if (hasCloseCommand) {
    return true;
  }

  const firstMove = commands.find((command): command is Extract<ScenePathCommand, { kind: "M" }> => command.kind === "M");
  if (!firstMove) {
    return false;
  }

  let lastWorldPoint: WorldPoint | null = null;
  for (const command of commands) {
    if (command.kind === "M" || command.kind === "L" || command.kind === "A" || command.kind === "C") {
      lastWorldPoint = command.to;
    }
  }
  if (!lastWorldPoint) {
    return false;
  }

  return Math.hypot(lastWorldPoint.x - firstMove.to.x, lastWorldPoint.y - firstMove.to.y) <= 1e-6;
}

function expandSubpathForDecoration(commands: ScenePathCommand[]): ScenePathCommand[] {
  const expanded: ScenePathCommand[] = [];
  let subpathStart: WorldPoint | null = null;
  let currentWorldPoint: WorldPoint | null = null;

  for (const command of commands) {
    if (command.kind === "M") {
      expanded.push(cloneCommand(command));
      subpathStart = { ...command.to };
      currentWorldPoint = { ...command.to };
      continue;
    }

    if (command.kind === "Z") {
      if (subpathStart && currentWorldPoint) {
        if (Math.hypot(subpathStart.x - currentWorldPoint.x, subpathStart.y - currentWorldPoint.y) > 1e-6) {
          expanded.push({
            kind: "L",
            to: { ...subpathStart }
          });
        }
        currentWorldPoint = { ...subpathStart };
      }
      continue;
    }

    expanded.push(cloneCommand(command));
    currentWorldPoint = { ...command.to };
  }

  return expanded;
}

function sampleCubic(p0: WorldPoint, p1: WorldPoint, p2: WorldPoint, p3: WorldPoint, steps: number): WorldPoint[] {
  const points: WorldPoint[] = [];
  const clampedSteps = Math.max(1, steps);
  for (let index = 0; index <= clampedSteps; index += 1) {
    const t = index / clampedSteps;
    const oneMinusT = 1 - t;
    points.push(
      worldPoint(
        pt(oneMinusT * oneMinusT * oneMinusT * p0.x +
          3 * oneMinusT * oneMinusT * t * p1.x +
          3 * oneMinusT * t * t * p2.x +
          t * t * t * p3.x),
        pt(oneMinusT * oneMinusT * oneMinusT * p0.y +
          3 * oneMinusT * oneMinusT * t * p1.y +
          3 * oneMinusT * t * t * p2.y +
          t * t * t * p3.y)
      )
    );
  }
  return points;
}

function dedupeLocalWorldPoints(points: WorldPoint[]): WorldPoint[] {
  const deduped: WorldPoint[] = [];
  for (const point of points) {
    const last = deduped[deduped.length - 1];
    if (!last || Math.hypot(last.x - point.x, last.y - point.y) > 1e-6) {
      deduped.push(point);
    }
  }
  return deduped;
}

function dedupeWorldPoints(points: WorldPoint[]): WorldPoint[] {
  const deduped: WorldPoint[] = [];
  for (const point of points) {
    const last = deduped[deduped.length - 1];
    if (!last || Math.hypot(last.x - point.x, last.y - point.y) > 1e-6) {
      deduped.push(point);
    }
  }
  return deduped;
}

function flattenSegmentPolylines(polylines: WorldPoint[][]): WorldPoint[] {
  const output: WorldPoint[] = [];
  for (const polyline of polylines) {
    if (polyline.length === 0) {
      continue;
    }
    if (output.length === 0) {
      output.push(...polyline);
      continue;
    }
    const first = polyline[0];
    const last = output[output.length - 1];
    if (!last || Math.hypot(last.x - first.x, last.y - first.y) > 1e-6) {
      output.push(first);
    }
    output.push(...polyline.slice(1));
  }
  return output;
}

function canonicalDecorationName(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized.startsWith("name=")) {
    return canonicalDecorationName(normalized.slice(5));
  }
  return normalized.length > 0 ? normalized : null;
}

function sanitizeDecorationName(raw: string): string {
  return raw.replace(/[^a-z0-9]+/gi, "-").replace(/(^-+|-+$)/g, "");
}

function clampLength(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function makeDeterministicRandom(seedRaw: string): () => number {
  let state = 0x811c9dc5;
  for (let index = 0; index < seedRaw.length; index += 1) {
    state ^= seedRaw.charCodeAt(index);
    state = Math.imul(state, 0x01000193);
  }
  if (state === 0) {
    state = 0x12345678;
  }

  return () => {
    state = Math.imul(state, 1664525) + 1013904223;
    state >>>= 0;
    return state / 0x100000000;
  };
}

function interpolateWorldPoint(from: WorldPoint, to: WorldPoint, t: number): WorldPoint {
  return wp(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
}

export function isDecorationDeferred(name: string): boolean {
  return DEFERRED_DECORATIONS.has(canonicalDecorationName(name) ?? "");
}

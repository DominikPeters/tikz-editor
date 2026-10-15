import { requireArrayValue } from "../../utils/collections.js";
import { worldPoint, worldVector } from "../../coords/points.js";
import type { WorldPoint, WorldVector } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import { splitAllAtTopLevel } from "../../domains/coordinates/parse.js";
import type { Span } from "../../ast/types.js";
import type { OptionListAst } from "../../options/types.js";
import {
  appendNamedPathElements,
  readNamedPath,
  type SemanticContext,
  writeContextMacroBinding,
  writeNamedCoordinate
} from "../context.js";
import { applyNameScope } from "../nodes/named-coordinates.js";
import type { SceneElement, SceneEllipse, ScenePath } from "../types.js";

type SampledSegment = {
  from: WorldPoint;
  to: WorldPoint;
  paramStart: number;
  paramEnd: number;
};

type SampledPath = {
  segments: SampledSegment[];
  totalLength: number;
  hasCubic: boolean;
};

type IntersectionPoint = {
  point: WorldPoint;
  firstParam: number;
  secondParam: number;
  discoveryOrder: number;
};

type IntersectionBucketIndex = {
  bucketSize: number;
  buckets: Map<string, IntersectionPoint[]>;
};

function wp(x: number, y: number): WorldPoint {
  return worldPoint(pt(x), pt(y));
}

function wv(x: number, y: number): WorldVector {
  return worldVector(pt(x), pt(y));
}

export type NameIntersectionsDirective = {
  firstPathName: string;
  secondPathName: string;
  prefix: string;
  byNames: string[];
  sortBy?: string;
  totalMacro?: string;
  span: Span;
};

export type PathIntersectionDirectives = {
  namedPathNames: string[];
  nameIntersections?: NameIntersectionsDirective;
  diagnostics: string[];
};

export function collectPathIntersectionDirectives(optionLists: OptionListAst[]): PathIntersectionDirectives {
  const namedPathNames: string[] = [];
  const diagnostics: string[] = [];
  let nameIntersections: NameIntersectionsDirective | undefined;

  for (const optionList of optionLists) {
    for (const entry of optionList.entries) {
      if (entry.kind !== "kv") {
        continue;
      }

      if (entry.key === "name path" || entry.key === "name path global" || entry.key === "name path local") {
        const pathName = normalizePathName(entry.valueRaw);
        if (pathName.length > 0) {
          namedPathNames.push(pathName);
        }
        continue;
      }

      if (entry.key !== "name intersections") {
        continue;
      }

      const parsed = parseNameIntersectionsDirective(entry.valueRaw, entry.span);
      diagnostics.push(...parsed.diagnostics);
      if (parsed.directive) {
        nameIntersections = parsed.directive;
      }
    }
  }

  return {
    namedPathNames: Array.from(new Set(namedPathNames)),
    ...(nameIntersections === undefined ? {} : { nameIntersections: nameIntersections }),
    diagnostics
  };
}

export function applyNameIntersectionsDirective(directive: NameIntersectionsDirective, context: SemanticContext): string[] {
  const diagnostics: string[] = [];
  const firstLookup = resolveNamedPath(directive.firstPathName, context);
  if (!firstLookup) {
    diagnostics.push(`unknown-named-path:${directive.firstPathName}`);
    return diagnostics;
  }

  const secondLookup = resolveNamedPath(directive.secondPathName, context);
  if (!secondLookup) {
    diagnostics.push(`unknown-named-path:${directive.secondPathName}`);
    return diagnostics;
  }

  const firstSampled = sampleSceneElements(firstLookup.elements);
  const secondSampled = sampleSceneElements(secondLookup.elements);
  if (firstSampled.segments.length === 0 || secondSampled.segments.length === 0) {
    if (directive.totalMacro) {
      writeIntersectionTotalMacro(directive.totalMacro, 0, context);
    }
    return diagnostics;
  }

  const intersections = intersectSampledPaths(firstSampled, secondSampled);
  sortIntersections(intersections, directive.sortBy, firstLookup.name, secondLookup.name, firstSampled.hasCubic, secondSampled.hasCubic);

  for (let i = 0; i < intersections.length; i += 1) {
    const point = requireArrayValue(intersections, i).point;
    const generatedName = `${directive.prefix}-${i + 1}`;
    writeNamedCoordinate(context, applyNameScope(generatedName, context), point);
  }

  for (let i = 0; i < directive.byNames.length && i < intersections.length; i += 1) {
    const alias = requireArrayValue(directive.byNames, i);
    if (alias.length === 0) {
      continue;
    }
    writeNamedCoordinate(context, applyNameScope(alias, context), requireArrayValue(intersections, i).point);
  }

  if (directive.totalMacro) {
    writeIntersectionTotalMacro(directive.totalMacro, intersections.length, context);
  }

  return diagnostics;
}

export function registerNamedPath(pathName: string, elements: SceneElement[], context: SemanticContext): boolean {
  const normalizedName = normalizePathName(pathName);
  if (normalizedName.length === 0) {
    return false;
  }

  const scopedName = applyNameScope(normalizedName, context);
  const geometryElements = elements.filter(isGeometricElement);
  const producerSourceIds = new Set(geometryElements.map((element) => element.sourceRef.sourceId));
  appendNamedPathElements(context, scopedName, geometryElements, producerSourceIds);
  return true;
}

function normalizePathName(raw: string): string {
  let normalized = raw.trim();
  while (normalized.startsWith("{") && normalized.endsWith("}") && normalized.length >= 2) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized;
}

function parseNameIntersectionsDirective(
  raw: string,
  span: Span
): { directive: NameIntersectionsDirective | null; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const normalized = unwrapOuterBraces(raw.trim());
  if (normalized.length === 0) {
    diagnostics.push("invalid-name-intersections");
    return { directive: null, diagnostics };
  }

  const entries = splitAllAtTopLevel(normalized, ",").map((part) => part.trim()).filter((part) => part.length > 0);
  let firstPathName: string | null = null;
  let secondPathName: string | null = null;
  let prefix = "intersection";
  let sortBy: string | undefined;
  let totalMacro: string | undefined;
  let byNames: string[] = [];

  for (const entry of entries) {
    const separator = findTopLevelEquals(entry);
    if (separator === -1) {
      continue;
    }

    const key = entry.slice(0, separator).trim().toLowerCase();
    const valueRaw = entry.slice(separator + 1).trim();
    if (key === "of") {
      const pair = splitAtTopLevelKeyword(valueRaw, "and");
      if (!pair) {
        diagnostics.push("invalid-name-intersections-of");
      } else {
        firstPathName = normalizePathName(pair.left);
        secondPathName = normalizePathName(pair.right);
      }
      continue;
    }

    if (key === "name") {
      const normalizedPrefix = normalizePathName(valueRaw);
      if (normalizedPrefix.length > 0) {
        prefix = normalizedPrefix;
      }
      continue;
    }

    if (key === "by") {
      byNames = parseByList(valueRaw);
      continue;
    }

    if (key === "sort by") {
      const normalizedSortBy = normalizePathName(valueRaw);
      if (normalizedSortBy.length > 0) {
        sortBy = normalizedSortBy;
      }
      continue;
    }

    if (key === "total") {
      const normalizedMacro = normalizeMacroToken(valueRaw);
      if (normalizedMacro) {
        totalMacro = normalizedMacro;
      }
    }
  }

  if (!firstPathName || !secondPathName) {
    diagnostics.push("invalid-name-intersections-of");
    return { directive: null, diagnostics };
  }

  return {
    directive: {
      firstPathName,
      secondPathName,
      prefix,
      byNames,
      ...(sortBy === undefined ? {} : { sortBy: sortBy }),
      ...(totalMacro === undefined ? {} : { totalMacro: totalMacro }),
      span
    },
    diagnostics
  };
}

function parseByList(raw: string): string[] {
  const normalized = unwrapOuterBraces(raw.trim());
  if (normalized.length === 0) {
    return [];
  }

  const entries = splitAllAtTopLevel(normalized, ",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  const names: string[] = [];

  for (const entry of entries) {
    let remainder = entry;
    while (remainder.startsWith("[")) {
      const bracket = findMatchingBracket(remainder, 0);
      if (bracket === -1) {
        break;
      }
      remainder = remainder.slice(bracket + 1).trim();
    }

    const normalizedName = normalizePathName(remainder);
    if (normalizedName.length > 0) {
      names.push(normalizedName);
    }
  }

  return names;
}

function unwrapOuterBraces(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function findTopLevelEquals(input: string): number {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < input.length; i += 1) {
    const char = input.charAt(i);
    if (char === "\\") {
      i += 1;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (char === "=" && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      return i;
    }
  }

  return -1;
}

function splitAtTopLevelKeyword(input: string, keyword: string): { left: string; right: string } | null {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  const needle = ` ${keyword} `;

  for (let i = 0; i <= input.length - needle.length; i += 1) {
    const char = input.charAt(i);
    if (char === "\\") {
      i += 1;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      const candidate = input.slice(i, i + needle.length).toLowerCase();
      if (candidate === needle) {
        return {
          left: input.slice(0, i).trim(),
          right: input.slice(i + needle.length).trim()
        };
      }
    }
  }

  return null;
}

function resolveNamedPath(rawName: string, context: SemanticContext): { name: string; elements: SceneElement[] } | null {
  const normalized = normalizePathName(rawName);
  if (normalized.length === 0) {
    return null;
  }

  const scoped = applyNameScope(normalized, context);
  const candidates = scoped === normalized ? [normalized] : [scoped, normalized];
  for (const candidate of candidates) {
    const elements = readNamedPath(context, candidate);
    if (elements) {
      return { name: candidate, elements };
    }
  }

  return null;
}

function sampleSceneElements(elements: SceneElement[]): SampledPath {
  const rawSegments: Array<{ from: WorldPoint; to: WorldPoint }> = [];
  let hasCubic = false;

  for (const element of elements) {
    if (element.kind === "Path") {
      hasCubic = hasCubic || pathHasCubicSegments(element);
      rawSegments.push(...samplePathElementSegments(element));
      continue;
    }
    if (element.kind === "Circle") {
      rawSegments.push(...sampleCircleSegments(element.center, element.radius, 96));
      continue;
    }
    if (element.kind === "Ellipse") {
      rawSegments.push(...sampleEllipseSegments(element, 96));
    }
  }

  const segments: SampledSegment[] = [];
  let cumulative = 0;
  for (const segment of rawSegments) {
    const length = distance(segment.from, segment.to);
    if (!Number.isFinite(length) || length <= 1e-9) {
      continue;
    }
    segments.push({
      from: segment.from,
      to: segment.to,
      paramStart: cumulative,
      paramEnd: cumulative + length
    });
    cumulative += length;
  }

  return {
    segments,
    totalLength: cumulative,
    hasCubic
  };
}

function pathHasCubicSegments(path: ScenePath): boolean {
  return path.commands.some((command) => command.kind === "C");
}

function samplePathElementSegments(path: ScenePath): Array<{ from: WorldPoint; to: WorldPoint }> {
  const segments: Array<{ from: WorldPoint; to: WorldPoint }> = [];
  let current: WorldPoint | null = null;
  let subpathStart: WorldPoint | null = null;

  for (const command of path.commands) {
    if (command.kind === "M") {
      current = command.to;
      subpathStart = command.to;
      continue;
    }
    if (command.kind === "L") {
      if (current) {
        segments.push({ from: current, to: command.to });
      }
      current = command.to;
      continue;
    }
    if (command.kind === "C") {
      if (!current) {
        current = command.to;
        continue;
      }
      let previous = current;
      const steps = 24;
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        const next = cubicBezierPoint(current, command.c1, command.c2, command.to, t);
        segments.push({ from: previous, to: next });
        previous = next;
      }
      current = command.to;
      continue;
    }
    if (command.kind === "A") {
      if (current) {
        segments.push({ from: current, to: command.to });
      }
      current = command.to;
      continue;
    }
    if (command.kind === "Z") {
      if (current && subpathStart) {
        segments.push({ from: current, to: subpathStart });
        current = subpathStart;
      }
    }
  }

  return segments;
}

function sampleCircleSegments(center: WorldPoint, radius: number, steps: number): Array<{ from: WorldPoint; to: WorldPoint }> {
  if (!Number.isFinite(radius) || radius <= 1e-9) {
    return [];
  }

  const segments: Array<{ from: WorldPoint; to: WorldPoint }> = [];
  for (let i = 0; i < steps; i += 1) {
    const start = (2 * Math.PI * i) / steps;
    const end = (2 * Math.PI * (i + 1)) / steps;
    const from = wp(center.x + radius * Math.cos(start), center.y + radius * Math.sin(start));
    const to = wp(center.x + radius * Math.cos(end), center.y + radius * Math.sin(end));
    segments.push({ from, to });
  }
  return segments;
}

function sampleEllipseSegments(ellipse: SceneEllipse, steps: number): Array<{ from: WorldPoint; to: WorldPoint }> {
  if (!Number.isFinite(ellipse.rx) || !Number.isFinite(ellipse.ry) || ellipse.rx <= 1e-9 || ellipse.ry <= 1e-9) {
    return [];
  }

  const rotationRadians = ((ellipse.rotation ?? 0) * Math.PI) / 180;
  const cosRotation = Math.cos(rotationRadians);
  const sinRotation = Math.sin(rotationRadians);

  const segments: Array<{ from: WorldPoint; to: WorldPoint }> = [];
  for (let i = 0; i < steps; i += 1) {
    const start = (2 * Math.PI * i) / steps;
    const end = (2 * Math.PI * (i + 1)) / steps;
    const from = ellipsePoint(ellipse.center, ellipse.rx, ellipse.ry, cosRotation, sinRotation, start);
    const to = ellipsePoint(ellipse.center, ellipse.rx, ellipse.ry, cosRotation, sinRotation, end);
    segments.push({ from, to });
  }
  return segments;
}

function ellipsePoint(
  center: WorldPoint,
  rx: number,
  ry: number,
  cosRotation: number,
  sinRotation: number,
  angle: number
): WorldPoint {
  const ux = rx * Math.cos(angle);
  const uy = ry * Math.sin(angle);
  return wp(
    center.x + ux * cosRotation - uy * sinRotation,
    center.y + ux * sinRotation + uy * cosRotation
  );
}

function cubicBezierPoint(p0: WorldPoint, p1: WorldPoint, p2: WorldPoint, p3: WorldPoint, t: number): WorldPoint {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return wp(
    mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
    mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y
  );
}

function intersectSampledPaths(first: SampledPath, second: SampledPath): IntersectionPoint[] {
  const intersections: IntersectionPoint[] = [];
  const dedupeTolerance = 1e-3;
  const index: IntersectionBucketIndex = {
    bucketSize: dedupeTolerance,
    buckets: new Map<string, IntersectionPoint[]>()
  };

  for (const firstSegment of first.segments) {
    const firstSegmentLength = distance(firstSegment.from, firstSegment.to);
    for (const secondSegment of second.segments) {
      const secondSegmentLength = distance(secondSegment.from, secondSegment.to);
      const intersection = intersectSegments(firstSegment.from, firstSegment.to, secondSegment.from, secondSegment.to);
      if (!intersection) {
        continue;
      }

      const firstParamAbsolute = firstSegment.paramStart + intersection.t * firstSegmentLength;
      const secondParamAbsolute = secondSegment.paramStart + intersection.u * secondSegmentLength;
      const firstParam = first.totalLength > 1e-9 ? firstParamAbsolute / first.totalLength : 0;
      const secondParam = second.totalLength > 1e-9 ? secondParamAbsolute / second.totalLength : 0;
      const existing = findIndexedIntersection(index, intersection.point, dedupeTolerance);
      if (existing) {
        existing.firstParam = Math.min(existing.firstParam, firstParam);
        existing.secondParam = Math.min(existing.secondParam, secondParam);
        continue;
      }

      const entry = {
        point: intersection.point,
        firstParam,
        secondParam,
        discoveryOrder: intersections.length
      };
      intersections.push(entry);
      addIndexedIntersection(index, entry);
    }
  }

  return intersections;
}

function findIndexedIntersection(
  index: IntersectionBucketIndex,
  point: WorldPoint,
  tolerance: number
): IntersectionPoint | undefined {
  const originX = quantizeBucket(point.x, index.bucketSize);
  const originY = quantizeBucket(point.y, index.bucketSize);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const bucket = index.buckets.get(bucketKey(originX + dx, originY + dy));
      if (!bucket) {
        continue;
      }
      for (const entry of bucket) {
        if (distance(entry.point, point) <= tolerance) {
          return entry;
        }
      }
    }
  }
  return undefined;
}

function addIndexedIntersection(index: IntersectionBucketIndex, entry: IntersectionPoint): void {
  const bucketX = quantizeBucket(entry.point.x, index.bucketSize);
  const bucketY = quantizeBucket(entry.point.y, index.bucketSize);
  const key = bucketKey(bucketX, bucketY);
  const bucket = index.buckets.get(key);
  if (bucket) {
    bucket.push(entry);
    return;
  }
  index.buckets.set(key, [entry]);
}

function quantizeBucket(value: number, bucketSize: number): number {
  return Math.round(value / bucketSize);
}

function bucketKey(x: number, y: number): string {
  return `${x},${y}`;
}

function sortIntersections(
  intersections: IntersectionPoint[],
  sortBy: string | undefined,
  firstPathName: string,
  secondPathName: string,
  firstHasCubic: boolean,
  secondHasCubic: boolean
): void {
  if (intersections.length <= 1) {
    return;
  }

  if (!sortBy) {
    if (firstHasCubic && secondHasCubic) {
      intersections.sort(
        (left, right) =>
          Math.abs(left.firstParam - left.secondParam) - Math.abs(right.firstParam - right.secondParam) ||
          left.firstParam - right.firstParam ||
          left.secondParam - right.secondParam ||
          left.discoveryOrder - right.discoveryOrder
      );
      return;
    }
    intersections.sort((left, right) => left.discoveryOrder - right.discoveryOrder);
    return;
  }

  const normalized = normalizePathName(sortBy);
  const firstNormalized = normalizePathName(firstPathName);
  const secondNormalized = normalizePathName(secondPathName);
  if (normalized === firstNormalized) {
    intersections.sort((left, right) => left.firstParam - right.firstParam || left.discoveryOrder - right.discoveryOrder);
    return;
  }

  if (normalized === secondNormalized) {
    intersections.sort((left, right) => left.secondParam - right.secondParam || left.discoveryOrder - right.discoveryOrder);
    return;
  }

  intersections.sort((left, right) => left.discoveryOrder - right.discoveryOrder);
}

function intersectSegments(
  p1: WorldPoint,
  p2: WorldPoint,
  q1: WorldPoint,
  q2: WorldPoint
): { point: WorldPoint; t: number; u: number } | null {
  const r = wv(p2.x - p1.x, p2.y - p1.y);
  const s = wv(q2.x - q1.x, q2.y - q1.y);
  const denominator = cross(r, s);
  if (Math.abs(denominator) <= 1e-9) {
    return null;
  }

  const qp = wv(q1.x - p1.x, q1.y - p1.y);
  const tRaw = cross(qp, s) / denominator;
  const uRaw = cross(qp, r) / denominator;
  if (tRaw < -1e-9 || tRaw > 1 + 1e-9 || uRaw < -1e-9 || uRaw > 1 + 1e-9) {
    return null;
  }

  const t = Math.max(0, Math.min(1, tRaw));
  const u = Math.max(0, Math.min(1, uRaw));
  return {
    point: wp(p1.x + t * r.x, p1.y + t * r.y),
    t,
    u
  };
}

function writeIntersectionTotalMacro(rawName: string, total: number, context: SemanticContext): void {
  const normalized = normalizeMacroToken(rawName);
  if (!normalized) {
    return;
  }
  writeContextMacroBinding(context, normalized, {
    kind: "text",
    value: String(total),
    provenance: []
  });
}

function normalizeMacroToken(raw: string): string | null {
  const normalized = normalizePathName(raw);
  if (normalized.length === 0) {
    return null;
  }

  const match = normalized.match(/^\\(?:[A-Za-z@]+|.)/);
  if (!match) {
    return null;
  }
  return match[0];
}

function findMatchingBracket(input: string, start: number): number {
  if (input.charAt(start) !== "[") {
    return -1;
  }

  let depth = 0;
  for (let i = start; i < input.length; i += 1) {
    const char = input.charAt(i);
    if (char === "\\") {
      i += 1;
      continue;
    }
    if (char === "[") {
      depth += 1;
      continue;
    }
    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function isGeometricElement(element: SceneElement): boolean {
  return element.kind === "Path" || element.kind === "Circle" || element.kind === "Ellipse";
}

function distance(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function cross(a: WorldVector, b: WorldVector): number {
  return a.x * b.y - a.y * b.x;
}

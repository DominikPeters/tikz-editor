import type { PathOptionItem } from "../../ast/types.js";
import type { OptionListAst } from "../../options/types.js";
import { resolveContextColorAliasValue, type ProvenanceOptionList, type SemanticContext } from "../context.js";
import { currentAnchorForDirection, parseDirectionalKey } from "../path/node-positioning.js";
import { resolveContextDelta } from "../style/resolve.js";
import { cloneCustomStyleRegistry } from "../style/custom-styles.js";
import { expandOptionListMacros } from "../style/macro-options.js";
import type { StyleTraceLayerInput } from "../style-chain.js";
import type { ResolvedStyle } from "../types.js";
import { parseBooleanishNormalized } from "../../utils/booleanish.js";
import type { NodeLayer, NodeShape } from "./types.js";
import { normalizeOptionValue } from "./utils.js";
import { identityMatrix, inverseMatrix, multiplyMatrix } from "../transform.js";
import type { WorldTransform } from "../../coords/transforms.js";
import { defaultStyle } from "../style/defaults.js";

export function withDefaultNodePosition(options: OptionListAst | undefined, defaultPos: number | undefined): OptionListAst | undefined {
  if (defaultPos == null) {
    return options;
  }

  const hasExplicitPosition =
    options?.entries.some(
      (entry) =>
        (entry.kind === "kv" && entry.key === "pos") ||
        (entry.kind === "flag" &&
          (entry.key === "midway" ||
            entry.key === "near start" ||
            entry.key === "near end" ||
            entry.key === "very near start" ||
            entry.key === "very near end" ||
            entry.key === "at start" ||
            entry.key === "at end"))
    ) ?? false;

  if (hasExplicitPosition) {
    return options;
  }

  const syntheticEntry = {
    kind: "kv" as const,
    key: "pos",
    valueRaw: String(defaultPos),
    span: options?.span ?? { from: 0, to: 0 },
    raw: `pos=${defaultPos}`
  };

  if (!options) {
    return {
      span: { from: 0, to: 0 },
      raw: `[pos=${defaultPos}]`,
      entries: [syntheticEntry]
    };
  }

  return {
    span: options.span,
    raw: `${options.raw}, pos=${defaultPos}`,
    entries: [...options.entries, syntheticEntry]
  };
}

export function resolveNodeStyle(
  options: PathOptionItem["options"] | undefined,
  baseStyle: ResolvedStyle,
  context: SemanticContext,
  transformScale = 1
): ResolvedStyle {
  let resolvedStyle = { ...baseStyle };
  if (options) {
    const frame = context.stack[context.stack.length - 1];
    const expanded = expandOptionListMacros([options], frame.macroBindings, context.macroTraceCollector ?? undefined);
    const layers: StyleTraceLayerInput[] =
      expanded.length > 0
        ? [
            {
              kind: "command",
              sourceRef: {
                sourceId: "__node-style__",
                sourceSpan: options.span,
                sourceKind: "node-options",
                label: "node"
              },
              rawOptions: expanded
            }
          ]
        : [];
    const resolved = resolveContextDelta(
      baseStyle,
      frame.transform,
      layers,
      cloneCustomStyleRegistry(frame.customStyles),
      undefined,
      [],
      (raw) => resolveContextColorAliasValue(context, raw)
    );
    resolvedStyle = resolved.style;
  }

  if (Math.abs(transformScale - 1) <= 1e-6) {
    return resolvedStyle;
  }

  return {
    ...resolvedStyle,
    lineWidth: resolvedStyle.lineWidth * transformScale,
    doubleDistance: resolvedStyle.doubleDistance * transformScale,
    doubleLineCenterDistance:
      resolvedStyle.doubleLineCenterDistance == null ? null : resolvedStyle.doubleLineCenterDistance * transformScale,
    fontSize: resolvedStyle.fontSize * transformScale
  };
}

export function resolveNodeOptionScale(
  options: PathOptionItem["options"] | undefined,
  baseStyle: ResolvedStyle,
  context: SemanticContext
): number {
  if (!options) {
    return 1;
  }

  const frame = context.stack[context.stack.length - 1];
  const expanded = expandOptionListMacros([options], frame.macroBindings, context.macroTraceCollector ?? undefined);
  const layers: StyleTraceLayerInput[] =
    expanded.length > 0
      ? [
          {
            kind: "command",
            sourceRef: {
              sourceId: "__node-scale__",
              sourceSpan: options.span,
              sourceKind: "node-options",
              label: "node"
            },
            rawOptions: expanded
          }
        ]
      : [];
  const resolved = resolveContextDelta(
    baseStyle,
    frame.transform,
    layers,
    cloneCustomStyleRegistry(frame.customStyles),
    undefined,
    [],
    (raw) => resolveContextColorAliasValue(context, raw)
  );
  return computeRelativeTransformScale(frame.transform, resolved.transform);
}

export function resolveNodeOptionTransform(
  options: PathOptionItem["options"] | undefined,
  baseStyle: ResolvedStyle,
  context: SemanticContext
): WorldTransform {
  if (!options) {
    return identityMatrix();
  }

  const frame = context.stack[context.stack.length - 1];
  const expanded = expandOptionListMacros([options], frame.macroBindings, context.macroTraceCollector ?? undefined);
  const layers: StyleTraceLayerInput[] =
    expanded.length > 0
      ? [
          {
            kind: "command",
            sourceRef: {
              sourceId: "__node-transform__",
              sourceSpan: options.span,
              sourceKind: "node-options",
              label: "node"
            },
            rawOptions: expanded
          }
        ]
      : [];
  const resolved = resolveContextDelta(
    baseStyle,
    frame.transform,
    layers,
    cloneCustomStyleRegistry(frame.customStyles),
    undefined,
    [],
    (raw) => resolveContextColorAliasValue(context, raw)
  );

  return computeRelativeTransformMatrix(frame.transform, resolved.transform);
}

export type EveryShapeNodeStyleBucketKey =
  | "everyRectangleNodeStyles"
  | "everyCircleNodeStyles"
  | "everyDiamondNodeStyles"
  | "everyTrapeziumNodeStyles"
  | "everyIsoscelesTriangleNodeStyles"
  | "everyKiteNodeStyles"
  | "everyDartNodeStyles"
  | "everyCircularSectorNodeStyles"
  | "everyCylinderNodeStyles"
  | "everyCloudNodeStyles"
  | "everyStarburstNodeStyles"
  | "everySignalNodeStyles"
  | "everyTapeNodeStyles"
  | "everyRectangleCalloutNodeStyles"
  | "everyEllipseCalloutNodeStyles"
  | "everyCloudCalloutNodeStyles"
  | "everySingleArrowNodeStyles"
  | "everyDoubleArrowNodeStyles";

export type EveryShapeNodeStyleBuckets<T> = Record<EveryShapeNodeStyleBucketKey, T[]>;

const EVERY_SHAPE_NODE_STYLE_BUCKET_BY_SHAPE: Partial<Record<NodeShape, EveryShapeNodeStyleBucketKey>> = {
  circle: "everyCircleNodeStyles",
  rectangle: "everyRectangleNodeStyles",
  "rounded rectangle": "everyRectangleNodeStyles",
  "chamfered rectangle": "everyRectangleNodeStyles",
  "cross out": "everyRectangleNodeStyles",
  "strike out": "everyRectangleNodeStyles",
  "rectangle split": "everyRectangleNodeStyles",
  "magnifying glass": "everyCircleNodeStyles",
  "circle split": "everyCircleNodeStyles",
  "circle solidus": "everyCircleNodeStyles",
  "ellipse split": "everyCircleNodeStyles",
  "diamond split": "everyDiamondNodeStyles",
  diamond: "everyDiamondNodeStyles",
  trapezium: "everyTrapeziumNodeStyles",
  "isosceles triangle": "everyIsoscelesTriangleNodeStyles",
  kite: "everyKiteNodeStyles",
  dart: "everyDartNodeStyles",
  "circular sector": "everyCircularSectorNodeStyles",
  cylinder: "everyCylinderNodeStyles",
  cloud: "everyCloudNodeStyles",
  starburst: "everyStarburstNodeStyles",
  signal: "everySignalNodeStyles",
  tape: "everyTapeNodeStyles",
  "rectangle callout": "everyRectangleCalloutNodeStyles",
  "ellipse callout": "everyEllipseCalloutNodeStyles",
  "cloud callout": "everyCloudCalloutNodeStyles",
  "single arrow": "everySingleArrowNodeStyles",
  "double arrow": "everyDoubleArrowNodeStyles"
};

export function resolveEveryShapeNodeStyleLists<T>(
  shape: NodeShape,
  buckets: EveryShapeNodeStyleBuckets<T>
): T[] {
  const bucket = EVERY_SHAPE_NODE_STYLE_BUCKET_BY_SHAPE[shape];
  return bucket ? buckets[bucket] : [];
}

export function resolveEffectiveNodeOptions(params: {
  statementOptions: OptionListAst | undefined;
  nodeOptions: OptionListAst | undefined;
  everyNodeStyles: NodeStyleOptionList[];
  everyFitStyles?: NodeStyleOptionList[];
  applyEveryFitStyles?: boolean;
  syntheticOptions?: OptionListAst[];
} & EveryShapeNodeStyleBuckets<NodeStyleOptionList>): OptionListAst | undefined {
  const everyFitStyles = params.applyEveryFitStyles ? (params.everyFitStyles ?? []) : [];
  const syntheticOptions = params.syntheticOptions ?? [];
  const base = mergeOptionLists([
    ...params.everyNodeStyles.map(optionListFromNodeStyleSource),
    ...everyFitStyles.map(optionListFromNodeStyleSource),
    params.statementOptions,
    params.nodeOptions,
    ...syntheticOptions
  ]);
  const shape = resolveNodeShape(base);
  const shapeStyles = resolveEveryShapeNodeStyleLists(shape, params);

  return mergeOptionLists([
    ...params.everyNodeStyles.map(optionListFromNodeStyleSource),
    ...everyFitStyles.map(optionListFromNodeStyleSource),
    ...shapeStyles.map(optionListFromNodeStyleSource),
    params.statementOptions,
    params.nodeOptions,
    ...syntheticOptions
  ]);
}

export function expandNodeOptionsForShape(
  options: OptionListAst | undefined,
  context: SemanticContext
): OptionListAst | undefined {
  if (!options) {
    return undefined;
  }

  const frame = context.stack[context.stack.length - 1];
  const expanded = expandOptionListMacros([options], frame.macroBindings, context.macroTraceCollector ?? undefined);
  if (expanded.length === 0) {
    return options;
  }

  const resolved = resolveContextDelta(
    defaultStyle(),
    frame.transform,
    [
      {
        kind: "command",
        sourceRef: {
          sourceId: "__node-options-expand__",
          sourceSpan: options.span,
          sourceKind: "node-options",
          label: "node"
        },
        rawOptions: expanded
      }
    ],
    cloneCustomStyleRegistry(frame.customStyles),
    undefined,
    [],
    (raw) => resolveContextColorAliasValue(context, raw)
  );

  return resolved.expandedOptionLists[0] ?? options;
}

type NodeStyleOptionList = OptionListAst | ProvenanceOptionList;

function optionListFromNodeStyleSource(source: NodeStyleOptionList): OptionListAst {
  return "options" in source ? source.options : source;
}

function mergeOptionLists(lists: Array<OptionListAst | undefined>): OptionListAst | undefined {
  const present = lists.filter((entry): entry is OptionListAst => Boolean(entry));
  if (present.length === 0) {
    return undefined;
  }

  const spanFrom = present.reduce((min, list) => Math.min(min, list.span.from), Number.POSITIVE_INFINITY);
  const spanTo = present.reduce((max, list) => Math.max(max, list.span.to), 0);
  return {
    span: {
      from: Number.isFinite(spanFrom) ? spanFrom : 0,
      to: spanTo
    },
    raw: present.map((list) => list.raw).join(", "),
    entries: present.flatMap((list) => list.entries)
  };
}

export function computeTransformScale(transform: { a: number; b: number; c: number; d: number }): number {
  const sx = Math.hypot(transform.a, transform.b);
  const sy = Math.hypot(transform.c, transform.d);
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) {
    return 1;
  }
  const averaged = (sx + sy) / 2;
  if (!Number.isFinite(averaged) || averaged <= 1e-6) {
    return 1;
  }
  return averaged;
}

export function computeTransformRotation(transform: { a: number; b: number; c: number; d: number }): number {
  const xScale = Math.hypot(transform.a, transform.b);
  const yScale = Math.hypot(transform.c, transform.d);
  if (!Number.isFinite(xScale) || !Number.isFinite(yScale)) {
    return 0;
  }

  if (xScale > 1e-6) {
    return (Math.atan2(transform.b, transform.a) * 180) / Math.PI;
  }
  if (yScale > 1e-6) {
    return (Math.atan2(-transform.c, transform.d) * 180) / Math.PI;
  }
  return 0;
}

function computeRelativeTransformScale(
  baseTransform: { a: number; b: number; c: number; d: number },
  resolvedTransform: { a: number; b: number; c: number; d: number }
): number {
  const base = computeTransformScale(baseTransform);
  const resolved = computeTransformScale(resolvedTransform);
  if (!Number.isFinite(resolved) || resolved <= 1e-6) {
    return 1;
  }
  if (!Number.isFinite(base) || base <= 1e-6) {
    return resolved;
  }
  return resolved / base;
}

function computeRelativeTransformMatrix(baseTransform: WorldTransform, resolvedTransform: WorldTransform): WorldTransform {
  const inverseBase = inverseMatrix(baseTransform);
  if (!inverseBase) {
    return resolvedTransform;
  }
  return multiplyMatrix(inverseBase, resolvedTransform);
}

export function resolveNodeShape(options: PathOptionItem["options"] | undefined): NodeShape {
  if (!options) {
    return "rectangle";
  }

  let shape: NodeShape = "rectangle";
  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (
        entry.key === "circle" ||
        entry.key === "rectangle" ||
        entry.key === "rounded rectangle" ||
        entry.key === "chamfered rectangle" ||
        entry.key === "cross out" ||
        entry.key === "strike out" ||
        entry.key === "ellipse" ||
        entry.key === "magnifying glass" ||
        entry.key === "circle split" ||
        entry.key === "circle solidus" ||
        entry.key === "ellipse split" ||
        entry.key === "diamond split" ||
        entry.key === "rectangle split" ||
        entry.key === "diamond" ||
        entry.key === "trapezium" ||
        entry.key === "semicircle" ||
        entry.key === "regular polygon" ||
        entry.key === "star" ||
        entry.key === "isosceles triangle" ||
        entry.key === "kite" ||
        entry.key === "dart" ||
        entry.key === "circular sector" ||
        entry.key === "cylinder" ||
        entry.key === "cloud" ||
        entry.key === "starburst" ||
        entry.key === "signal" ||
        entry.key === "tape" ||
        entry.key === "rectangle callout" ||
        entry.key === "ellipse callout" ||
        entry.key === "cloud callout" ||
        entry.key === "single arrow" ||
        entry.key === "double arrow" ||
        entry.key === "coordinate"
      ) {
        shape = entry.key;
      }
      continue;
    }
    if (entry.kind === "kv" && entry.key === "shape") {
      const normalized = normalizeOptionValue(entry.valueRaw).toLowerCase();
      if (
        normalized === "circle" ||
        normalized === "rectangle" ||
        normalized === "rounded rectangle" ||
        normalized === "chamfered rectangle" ||
        normalized === "cross out" ||
        normalized === "strike out" ||
        normalized === "ellipse" ||
        normalized === "magnifying glass" ||
        normalized === "circle split" ||
        normalized === "circle solidus" ||
        normalized === "ellipse split" ||
        normalized === "diamond split" ||
        normalized === "rectangle split" ||
        normalized === "diamond" ||
        normalized === "trapezium" ||
        normalized === "semicircle" ||
        normalized === "regular polygon" ||
        normalized === "star" ||
        normalized === "isosceles triangle" ||
        normalized === "kite" ||
        normalized === "dart" ||
        normalized === "circular sector" ||
        normalized === "cylinder" ||
        normalized === "cloud" ||
        normalized === "starburst" ||
        normalized === "signal" ||
        normalized === "tape" ||
        normalized === "rectangle callout" ||
        normalized === "ellipse callout" ||
        normalized === "cloud callout" ||
        normalized === "single arrow" ||
        normalized === "double arrow" ||
        normalized === "coordinate"
      ) {
        shape = normalized;
      }
    }
  }
  return shape;
}

export function resolveNodeAnchor(options: PathOptionItem["options"] | undefined): string {
  if (!options) {
    return "center";
  }

  let anchor = "center";
  for (const entry of options.entries) {
    if (entry.kind === "kv") {
      if (entry.key === "anchor") {
        const normalized = normalizeOptionValue(entry.valueRaw).toLowerCase().replaceAll("_", " ");
        if (normalized.length > 0) {
          anchor = normalized;
        }
        continue;
      }

      const directional = parseDirectionalKey(entry.key);
      if (directional) {
        anchor = directional.legacyOf ? "center" : currentAnchorForDirection(directional.direction);
      }
      continue;
    }

    if (entry.kind !== "flag") {
      continue;
    }

    if (entry.key === "centered") {
      anchor = "center";
      continue;
    }

    const directional = parseDirectionalKey(entry.key);
    if (directional) {
      anchor = directional.legacyOf ? "center" : currentAnchorForDirection(directional.direction);
    }
  }

  return anchor;
}

export function resolveNodeLayer(options: PathOptionItem["options"] | undefined, context: SemanticContext): NodeLayer {
  let mode: NodeLayer = context.stack[context.stack.length - 1]?.nodeLayerMode ?? "front";
  if (!options) {
    return mode;
  }

  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "behind path") {
        mode = "behind";
      } else if (entry.key === "in front of path") {
        mode = "front";
      }
      continue;
    }

    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "behind path") {
      const boolish = parseBoolish(entry.valueRaw);
      if (boolish != null) {
        mode = boolish ? "behind" : "front";
      }
      continue;
    }
    if (entry.key === "in front of path") {
      const boolish = parseBoolish(entry.valueRaw);
      if (boolish != null) {
        mode = boolish ? "front" : "behind";
      }
    }
  }

  return mode;
}

function parseBoolish(raw: string): boolean | null {
  return parseBooleanishNormalized(normalizeOptionValue(raw));
}

import type { NodeItem, PathItem, PathStatement, Span, Statement } from "../../ast/types.js";
import { pt } from "../../coords/scalars.js";
import { worldPoint, type WorldPoint } from "../../coords/points.js";
import type { FrameTransform } from "../../coords/transforms.js";
import type { OptionEntry, OptionListAst } from "../../options/types.js";
import { evaluateTikzFigure } from "../../semantic/evaluate.js";
import { resolveMatrixMode } from "../../semantic/nodes/matrix.js";
import { parseDirectionalKey } from "../../semantic/path/node-positioning.js";
import { normalizeOptionValue } from "../../semantic/path/shared.js";
import type { EditHandlePositioningContext, EvaluateOptions, NodeAnchorTarget } from "../../semantic/types.js";
import { worldToLocal, localToSourceUnits } from "../coords.js";
import { CM_PER_PT, formatNumber } from "../format.js";
import { normalizeOptionKey } from "../option-key.js";
import { parseTikzForEdit, type EditParseOptions } from "../parse-options.js";
import { resolvePropertyTarget, type PropertyTarget, type PropertyTargetOptionsFormat } from "../property-target.js";
import { rewritePositioningFromContext } from "../rewrite.js";
import { collectSourceWorldBounds } from "../snapping/index.js";
import { applyTextReplacements, parseStatementSnapshot, type TextReplacement } from "../statement-ops.js";
import type { EditActionResult } from "../actions.js";

export type PositionNodeRelativeToAction = {
  kind: "positionNodeRelativeTo";
  nodeId: string;
  targetNodeName: string;
  targetNodeSourceId: string;
};

export type ConvertNodePositionToAbsoluteAction = {
  kind: "convertNodePositionToAbsolute";
  nodeId: string;
};

export type PositionNodeRelativeToPreview = {
  direction: string;
  currentAnchor: WorldPoint;
  targetAnchor: WorldPoint;
};

export type PositionNodeRelativeToPreflight = {
  result: EditActionResult;
  preview: PositionNodeRelativeToPreview | null;
};

const POSITIONING_DIRECTIONS = [
  "above",
  "below",
  "left",
  "right",
  "above left",
  "above right",
  "below left",
  "below right"
] as const;

type PositioningDirection = (typeof POSITIONING_DIRECTIONS)[number];

const DIRECTION_ANCHORS: Record<PositioningDirection, { target: string; current: string }> = {
  above: { target: "north", current: "south" },
  below: { target: "south", current: "north" },
  left: { target: "west", current: "east" },
  right: { target: "east", current: "west" },
  "above left": { target: "north west", current: "south east" },
  "above right": { target: "north east", current: "south west" },
  "below left": { target: "south west", current: "north east" },
  "below right": { target: "south east", current: "north west" }
};

const BASIC_ANCHORS = [
  "center",
  "north",
  "south",
  "east",
  "west",
  "north east",
  "north west",
  "south east",
  "south west"
] as const;

const PLACEMENT_OPTION_KEYS = new Set(["at", "xshift", "yshift"]);
const CARDINAL_SNAP_RATIO = 0.25;

type NodeRef = {
  statement: PathStatement;
  node: NodeItem;
  nodeSourceId: string;
};

type AnchorMap = Map<string, WorldPoint>;

export function applyPositionNodeRelativeToAction(
  source: string,
  action: PositionNodeRelativeToAction,
  evaluateOptions: EvaluateOptions | undefined,
  parseOptions: EditParseOptions
): EditActionResult {
  return preflightPositionNodeRelativeToAction(source, action, evaluateOptions, parseOptions).result;
}

export function preflightPositionNodeRelativeToAction(
  source: string,
  action: PositionNodeRelativeToAction,
  evaluateOptions: EvaluateOptions | undefined,
  parseOptions: EditParseOptions
): PositionNodeRelativeToPreflight {
  const nodeResolution = resolveEditableNodeRef(source, action.nodeId, parseOptions);
  if (nodeResolution.kind !== "found") {
    return unsupportedPreflight(nodeResolution.reason);
  }

  const targetResolution = resolveEditableNodeRef(source, action.targetNodeSourceId, parseOptions);
  if (targetResolution.kind !== "found") {
    return unsupportedPreflight("Relative positioning target must be a named node.");
  }
  if (targetResolution.nodeRef.nodeSourceId === nodeResolution.nodeRef.nodeSourceId) {
    return unsupportedPreflight("Cannot position a node relative to itself.");
  }
  if (targetResolution.nodeRef.node.span.from >= nodeResolution.nodeRef.node.span.from) {
    return unsupportedPreflight("Relative positioning target must appear before the selected node.");
  }
  if ((targetResolution.nodeRef.node.name ?? "").trim() !== action.targetNodeName.trim()) {
    return unsupportedPreflight("Relative positioning target name no longer matches the source.");
  }

  const parsed = parseTikzForEdit(source, parseOptions);
  const semantic = evaluateTikzFigure(parsed.figure, source, evaluateOptions);
  const placement = resolveRelativePlacementContext({
    semantic,
    nodeSourceId: nodeResolution.nodeRef.nodeSourceId,
    targetNodeName: action.targetNodeName,
    targetNodeSourceId: targetResolution.nodeRef.nodeSourceId,
    explicitAnchor: resolveExplicitAnchor(nodeResolution.nodeRef.node.options)
  });
  if (placement.kind !== "found") {
    return unsupportedPreflight(placement.reason);
  }

  const positioningEntry = rewritePositioningFromContext(placement.currentCenter, placement.context);
  if (!positioningEntry) {
    return unsupportedPreflight("Could not serialize relative positioning option.");
  }
  if (hasNegativePositioningDistance(positioningEntry)) {
    return unsupportedPreflight("Selected target would require a negative positioning distance.");
  }

  const rewritten = rewriteNodePlacementSource({
    source,
    nodeRef: nodeResolution.nodeRef,
    target: nodeResolution.propertyTarget,
    placementEntry: positioningEntry,
    insertAbsoluteAt: null,
    removeInlineAt: true
  });
  if (!rewritten) {
    return unsupportedPreflight("Relative positioning would not change the source.");
  }
  const result: EditActionResult = {
    kind: "success",
    newSource: rewritten.source,
    patches: rewritten.patches,
    selectedSourceIds: [nodeResolution.nodeRef.nodeSourceId],
    changedSourceIds: [nodeResolution.nodeRef.nodeSourceId]
  };
  return {
    result,
    preview: positionNodeRelativeToPreview(placement.context, positioningEntry)
  };
}

function unsupportedPreflight(reason: string): PositionNodeRelativeToPreflight {
  return {
    result: { kind: "unsupported", reason },
    preview: null
  };
}

function positionNodeRelativeToPreview(
  context: EditHandlePositioningContext,
  positioningEntry: string
): PositionNodeRelativeToPreview | null {
  const key = positioningEntry.slice(0, Math.max(0, positioningEntry.indexOf("="))).trim();
  const direction = parseDirectionalKey(key)?.direction ?? context.direction;
  const anchors = context.anchorOffsetsByDirection?.[direction];
  if (!anchors) {
    return null;
  }
  return {
    direction,
    currentAnchor: anchorFromCenter(context.currentCenter, anchors.currentAnchor),
    targetAnchor: anchorFromCenter(context.targetCenter, anchors.targetAnchor)
  };
}

export function applyConvertNodePositionToAbsoluteAction(
  source: string,
  action: ConvertNodePositionToAbsoluteAction,
  evaluateOptions: EvaluateOptions | undefined,
  parseOptions: EditParseOptions
): EditActionResult {
  const nodeResolution = resolveEditableNodeRef(source, action.nodeId, parseOptions);
  if (nodeResolution.kind !== "found") {
    return { kind: "unsupported", reason: nodeResolution.reason };
  }

  const parsed = parseTikzForEdit(source, parseOptions);
  const semantic = evaluateTikzFigure(parsed.figure, source, evaluateOptions);
  if (hasPathAttachment(semantic.scene.elements, nodeResolution.nodeRef.nodeSourceId)) {
    return { kind: "unsupported", reason: "Path-attached nodes cannot be converted to absolute positioning." };
  }

  const positioningHandle = semantic.editHandles.find(
    (handle) =>
      handle.sourceRef.sourceId === nodeResolution.nodeRef.nodeSourceId &&
      handle.kind === "node-position" &&
      handle.handleType === "node-positioning"
  );
  if (positioningHandle?.handleType !== "node-positioning") {
    return { kind: "unsupported", reason: "Selected node is not relatively positioned." };
  }

  const absolutePoint = resolveAbsolutePlacementPoint({
    semantic,
    nodeSourceId: nodeResolution.nodeRef.nodeSourceId,
    center: positioningHandle.world,
    explicitAnchor: resolveExplicitAnchor(nodeResolution.nodeRef.node.options)
  });
  if (absolutePoint.kind !== "found") {
    return { kind: "unsupported", reason: absolutePoint.reason };
  }

  const coordinate = formatPlacementCoordinateFromWorld(
    absolutePoint.world,
    positioningHandle.transform as unknown as FrameTransform
  );
  const rewritten = rewriteNodePlacementSource({
    source,
    nodeRef: nodeResolution.nodeRef,
    target: nodeResolution.propertyTarget,
    placementEntry: null,
    insertAbsoluteAt: coordinate,
    removeInlineAt: false
  });
  if (!rewritten) {
    return { kind: "unsupported", reason: "Absolute positioning would not change the source." };
  }
  return {
    kind: "success",
    newSource: rewritten.source,
    patches: rewritten.patches,
    selectedSourceIds: [nodeResolution.nodeRef.nodeSourceId],
    changedSourceIds: [nodeResolution.nodeRef.nodeSourceId]
  };
}

function resolveEditableNodeRef(
  source: string,
  nodeId: string,
  parseOptions: EditParseOptions
):
  | { kind: "found"; nodeRef: NodeRef; propertyTarget: PropertyTarget }
  | { kind: "unsupported"; reason: string } {
  const property = resolvePropertyTarget(source, nodeId, parseOptions);
  if (property.kind !== "found") {
    return { kind: "unsupported", reason: property.reason };
  }
  if (
    property.target.kind !== "node-item" &&
    !(property.target.kind === "path-statement" && property.target.pathCommand === "node")
  ) {
    return { kind: "unsupported", reason: "Only standalone or inline nodes can use relative positioning." };
  }

  const snapshot = parseStatementSnapshot(source, parseOptions);
  const nodeRef = findNodeRefBySourceId(snapshot.all.map((ref) => ref.statement), nodeId);
  if (!nodeRef) {
    return { kind: "unsupported", reason: "Could not resolve selected node source." };
  }
  if (nodeRef.node.adornment) {
    return { kind: "unsupported", reason: "Node labels and pins cannot use relative positioning." };
  }
  if (nodeRef.statement.items.some((item) => item.kind === "ChildOperation") || nodeRef.statement.id.includes(":tree-child:")) {
    return { kind: "unsupported", reason: "Tree nodes cannot use relative positioning in this version." };
  }
  if (resolveMatrixMode(nodeRef.node.options).enabled) {
    return { kind: "unsupported", reason: "Matrix nodes cannot use relative positioning in this version." };
  }

  return { kind: "found", nodeRef, propertyTarget: property.target };
}

function resolveRelativePlacementContext(input: {
  semantic: ReturnType<typeof evaluateTikzFigure>;
  nodeSourceId: string;
  targetNodeName: string;
  targetNodeSourceId: string;
  explicitAnchor: string | null;
}):
  | { kind: "found"; currentCenter: WorldPoint; context: EditHandlePositioningContext }
  | { kind: "unsupported"; reason: string } {
  if (hasPathAttachment(input.semantic.scene.elements, input.nodeSourceId)) {
    return { kind: "unsupported", reason: "Path-attached nodes cannot use relative positioning." };
  }
  if (hasPathAttachment(input.semantic.scene.elements, input.targetNodeSourceId)) {
    return { kind: "unsupported", reason: "Path-attached target nodes cannot use relative positioning." };
  }

  const currentHandle = input.semantic.editHandles.find(
    (handle) =>
      handle.sourceRef.sourceId === input.nodeSourceId &&
      handle.kind === "node-position" &&
      handle.handleType !== "path-attachment"
  );
  const currentCenter = currentHandle?.world ?? sourceBoundsCenter(input.semantic, input.nodeSourceId);
  if (!currentCenter) {
    return { kind: "unsupported", reason: "Could not resolve selected node position." };
  }

  const targetCenter =
    input.semantic.nodeAnchorTargets.find(
      (target) =>
        target.nodeName === input.targetNodeName &&
        target.nodeSourceId === input.targetNodeSourceId &&
        target.anchor === "center"
    )?.world ?? sourceBoundsCenter(input.semantic, input.targetNodeSourceId);
  if (!targetCenter) {
    return { kind: "unsupported", reason: "Could not resolve target node center." };
  }

  const boundsBySource = collectSourceWorldBounds(input.semantic.scene.elements);
  const currentAnchors = resolveAnchorMap({
    anchorTargets: input.semantic.nodeAnchorTargets,
    nodeSourceId: input.nodeSourceId,
    center: currentCenter,
    bounds: boundsBySource.get(input.nodeSourceId) ?? null
  });
  const targetAnchors = resolveAnchorMap({
    anchorTargets: input.semantic.nodeAnchorTargets,
    nodeSourceId: input.targetNodeSourceId,
    center: targetCenter,
    bounds: boundsBySource.get(input.targetNodeSourceId) ?? null
  });
  const anchorOffsetsByDirection = buildAnchorOffsetsByDirection({
    currentCenter,
    targetCenter,
    currentAnchors,
    targetAnchors,
    currentAnchorOverride: input.explicitAnchor
  });
  if (!anchorOffsetsByDirection) {
    return { kind: "unsupported", reason: "Could not resolve node anchors for relative positioning." };
  }

  return {
    kind: "found",
    currentCenter,
    context: {
      direction: initialDirectionFromCenters(currentCenter, targetCenter),
      targetNodeName: input.targetNodeName,
      targetCenter,
      currentCenter,
      legacyOf: false,
      anchorOffsetsByDirection,
      targetAnchorHW: halfWidth(targetAnchors, targetCenter),
      targetAnchorHH: halfHeight(targetAnchors, targetCenter),
      currentAnchorHW: halfWidth(currentAnchors, currentCenter),
      currentAnchorHH: halfHeight(currentAnchors, currentCenter)
    }
  };
}

function resolveAbsolutePlacementPoint(input: {
  semantic: ReturnType<typeof evaluateTikzFigure>;
  nodeSourceId: string;
  center: WorldPoint;
  explicitAnchor: string | null;
}): { kind: "found"; world: WorldPoint } | { kind: "unsupported"; reason: string } {
  if (!input.explicitAnchor || input.explicitAnchor === "center") {
    return { kind: "found", world: input.center };
  }

  const anchors = resolveAnchorMap({
    anchorTargets: input.semantic.nodeAnchorTargets,
    nodeSourceId: input.nodeSourceId,
    center: input.center,
    bounds: collectSourceWorldBounds(input.semantic.scene.elements).get(input.nodeSourceId) ?? null
  });
  const anchorPoint = anchors.get(input.explicitAnchor);
  if (!anchorPoint) {
    return { kind: "unsupported", reason: `Cannot preserve unsupported anchor "${input.explicitAnchor}".` };
  }
  return { kind: "found", world: anchorPoint };
}

function rewriteNodePlacementSource(input: {
  source: string;
  nodeRef: NodeRef;
  target: PropertyTarget;
  placementEntry: string | null;
  insertAbsoluteAt: string | null;
  removeInlineAt: boolean;
}): { source: string; patches: ReturnType<typeof applyTextReplacements>["patches"] } | null {
  const replacements: TextReplacement[] = [];

  const optionsReplacement = rewritePlacementOptions(
    input.nodeRef.node.options,
    input.target.optionsFormat ?? "bracketed",
    input.placementEntry
  );
  const nodeOptionsSpan = input.nodeRef.node.optionsSpan ?? input.nodeRef.node.options?.span;
  if (nodeOptionsSpan) {
    const previous = input.source.slice(nodeOptionsSpan.from, nodeOptionsSpan.to);
    if (previous !== optionsReplacement) {
      replacements.push({ span: nodeOptionsSpan, text: optionsReplacement });
    }
  } else if (input.placementEntry) {
    replacements.push({
      span: { from: input.target.insertOffset, to: input.target.insertOffset },
      text: wrapSerializedOptions(input.placementEntry, input.target.optionsFormat ?? "bracketed")
    });
  }

  if (input.removeInlineAt) {
    const removal = resolveInlineAtRemovalSpan(input.source, input.nodeRef);
    if (removal) {
      replacements.push({ span: removal, text: "" });
    }
  }

  if (input.insertAbsoluteAt) {
    const inlineAt = resolveInlineAtCoordinateReplacementSpan(input.nodeRef.node);
    if (inlineAt) {
      replacements.push({ span: inlineAt, text: input.insertAbsoluteAt });
    } else {
      const offset = resolveInlineAtInsertionOffset(input.source, input.nodeRef.node);
      replacements.push({
        span: { from: offset, to: offset },
        text: buildInlineAtInsertion(input.source, offset, input.insertAbsoluteAt)
      });
    }
  }

  if (replacements.length === 0) {
    return null;
  }
  const applied = applyTextReplacements(input.source, replacements);
  if (applied.source === input.source) {
    return null;
  }
  return { source: applied.source, patches: applied.patches };
}

function rewritePlacementOptions(
  options: OptionListAst | undefined,
  format: PropertyTargetOptionsFormat,
  placementEntry: string | null
): string {
  if (!options) {
    return placementEntry ? wrapSerializedOptions(placementEntry, format) : "";
  }

  const parts: string[] = [];
  let insertedPlacement = false;
  for (const entry of options.entries) {
    if (shouldRemovePlacementOption(entry)) {
      continue;
    }
    if (placementEntry && !insertedPlacement && optionEntryKey(entry) === "anchor") {
      parts.push(placementEntry);
      insertedPlacement = true;
    }
    const normalized = normalizeOptionEntryRaw(entry);
    if (normalized.length > 0) {
      parts.push(normalized);
    }
  }
  if (placementEntry && !insertedPlacement) {
    parts.push(placementEntry);
  }
  if (parts.length === 0) {
    return format === "bracketed" ? "" : wrapSerializedOptions("", format);
  }
  return wrapSerializedOptions(parts.join(", "), format);
}

function shouldRemovePlacementOption(entry: OptionEntry): boolean {
  const key = optionEntryKey(entry);
  if (!key) {
    return false;
  }
  return PLACEMENT_OPTION_KEYS.has(key) || parseDirectionalKey(key) != null;
}

function optionEntryKey(entry: OptionEntry): string | null {
  if (entry.kind !== "kv" && entry.kind !== "flag") {
    return null;
  }
  return normalizeOptionKey(entry.key);
}

function normalizeOptionEntryRaw(entry: OptionEntry): string {
  const raw = entry.raw.trim();
  if (raw.length > 0) {
    return raw;
  }
  if (entry.kind === "kv") {
    return `${entry.key}=${entry.valueRaw}`;
  }
  if (entry.kind === "flag") {
    return entry.key;
  }
  return "";
}

function wrapSerializedOptions(content: string, format: PropertyTargetOptionsFormat): string {
  switch (format) {
    case "bare":
      return content;
    case "braced":
      return `{${content}}`;
    case "bracketed":
    default:
      return `[${content}]`;
  }
}

function findNodeRefBySourceId(statements: readonly Statement[], sourceId: string): NodeRef | null {
  for (const statement of statements) {
    if (statement.kind === "Scope") {
      const nested = findNodeRefBySourceId(statement.body, sourceId);
      if (nested) {
        return nested;
      }
      continue;
    }
    if (statement.kind !== "Path") {
      continue;
    }
    const statementHasTreeChildren = statement.items.some((item) => item.kind === "ChildOperation");
    const isSyntheticTreeChildStatement = statement.id.includes(":tree-child:");
    for (const item of statement.items) {
      if (item.kind !== "Node") {
        continue;
      }
      const nodeSourceId =
        item.adornment != null || statement.command === "node" || statementHasTreeChildren || isSyntheticTreeChildStatement
          ? statement.id
          : item.id;
      if (nodeSourceId === sourceId) {
        return { statement, node: item, nodeSourceId };
      }
    }
  }
  return null;
}

function sourceBoundsCenter(semantic: ReturnType<typeof evaluateTikzFigure>, sourceId: string): WorldPoint | null {
  const bounds = collectSourceWorldBounds(semantic.scene.elements).get(sourceId);
  if (!bounds) {
    return null;
  }
  return worldPoint(pt((bounds.minX + bounds.maxX) / 2), pt((bounds.minY + bounds.maxY) / 2));
}

function resolveAnchorMap(input: {
  anchorTargets: readonly NodeAnchorTarget[];
  nodeSourceId: string;
  center: WorldPoint;
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
}): AnchorMap {
  const anchors = new Map<string, WorldPoint>();
  for (const target of input.anchorTargets) {
    if (target.nodeSourceId !== input.nodeSourceId || target.tier !== "basic") {
      continue;
    }
    anchors.set(normalizeAnchorName(target.anchor), target.world);
  }
  anchors.set("center", anchors.get("center") ?? input.center);

  if (input.bounds) {
    const minX = input.bounds.minX;
    const maxX = input.bounds.maxX;
    const minY = input.bounds.minY;
    const maxY = input.bounds.maxY;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const fallback: Array<[string, WorldPoint]> = [
      ["north", worldPoint(pt(midX), pt(maxY))],
      ["south", worldPoint(pt(midX), pt(minY))],
      ["east", worldPoint(pt(maxX), pt(midY))],
      ["west", worldPoint(pt(minX), pt(midY))],
      ["north east", worldPoint(pt(maxX), pt(maxY))],
      ["north west", worldPoint(pt(minX), pt(maxY))],
      ["south east", worldPoint(pt(maxX), pt(minY))],
      ["south west", worldPoint(pt(minX), pt(minY))]
    ];
    for (const [anchor, point] of fallback) {
      if (!anchors.has(anchor)) {
        anchors.set(anchor, point);
      }
    }
  }
  return anchors;
}

function buildAnchorOffsetsByDirection(input: {
  currentCenter: WorldPoint;
  targetCenter: WorldPoint;
  currentAnchors: AnchorMap;
  targetAnchors: AnchorMap;
  currentAnchorOverride: string | null;
}): EditHandlePositioningContext["anchorOffsetsByDirection"] | null {
  const offsets: NonNullable<EditHandlePositioningContext["anchorOffsetsByDirection"]> = {};
  const currentOverride = input.currentAnchorOverride ? normalizeAnchorName(input.currentAnchorOverride) : null;
  if (currentOverride && !input.currentAnchors.has(currentOverride)) {
    return null;
  }

  for (const direction of POSITIONING_DIRECTIONS) {
    const targetAnchor = anchorOffset(input.targetAnchors, DIRECTION_ANCHORS[direction].target, input.targetCenter);
    const currentAnchor = anchorOffset(
      input.currentAnchors,
      currentOverride ?? DIRECTION_ANCHORS[direction].current,
      input.currentCenter
    );
    if (!targetAnchor || !currentAnchor) {
      return null;
    }
    offsets[direction] = { targetAnchor, currentAnchor };
  }
  return offsets;
}

function anchorOffset(anchors: AnchorMap, anchor: string, center: WorldPoint): WorldPoint | null {
  const point = anchors.get(anchor);
  if (!point) {
    return null;
  }
  return worldPoint(pt(point.x - center.x), pt(point.y - center.y));
}

function anchorFromCenter(center: WorldPoint, offset: WorldPoint): WorldPoint {
  return worldPoint(pt(center.x + offset.x), pt(center.y + offset.y));
}

function halfWidth(anchors: AnchorMap, center: WorldPoint): number {
  const east = anchors.get("east");
  const west = anchors.get("west");
  if (east && west) {
    return Math.max(Math.abs(east.x - center.x), Math.abs(west.x - center.x));
  }
  return 0;
}

function halfHeight(anchors: AnchorMap, center: WorldPoint): number {
  const north = anchors.get("north");
  const south = anchors.get("south");
  if (north && south) {
    return Math.max(Math.abs(north.y - center.y), Math.abs(south.y - center.y));
  }
  return 0;
}

function initialDirectionFromCenters(currentCenter: WorldPoint, targetCenter: WorldPoint): PositioningDirection {
  const dx = currentCenter.x - targetCenter.x;
  const dy = currentCenter.y - targetCenter.y;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX < 1e-6 && absY < 1e-6) {
    return "right";
  }
  if (absY <= Math.max(absX * CARDINAL_SNAP_RATIO, 1e-6)) {
    return dx >= 0 ? "right" : "left";
  }
  if (absX <= Math.max(absY * CARDINAL_SNAP_RATIO, 1e-6)) {
    return dy >= 0 ? "above" : "below";
  }
  if (dx >= 0 && dy >= 0) {
    return "above right";
  }
  if (dx < 0 && dy >= 0) {
    return "above left";
  }
  if (dx >= 0 && dy < 0) {
    return "below right";
  }
  return "below left";
}

function resolveExplicitAnchor(options: OptionListAst | undefined): string | null {
  let anchor: string | null = null;
  for (const entry of options?.entries ?? []) {
    if (entry.kind !== "kv" || normalizeOptionKey(entry.key) !== "anchor") {
      continue;
    }
    anchor = normalizeAnchorName(normalizeOptionValue(entry.valueRaw));
  }
  if (!anchor || anchor === "base" || anchor === "mid") {
    return anchor;
  }
  return BASIC_ANCHORS.includes(anchor as (typeof BASIC_ANCHORS)[number]) ? anchor : anchor;
}

function normalizeAnchorName(anchor: string): string {
  return anchor.trim().toLowerCase().replace(/\s+/g, " ");
}

function hasNegativePositioningDistance(entry: string): boolean {
  const equals = entry.indexOf("=");
  if (equals < 0) {
    return false;
  }
  const value = entry.slice(equals + 1).trim();
  return value.startsWith("-") || value.startsWith("{-") || /\band\s*-/iu.test(value);
}

function resolveInlineAtCoordinateReplacementSpan(node: NodeItem): Span | null {
  if (!node.atSpan) {
    return null;
  }
  const atOption = findPlacementOption(node.options, "at");
  if (atOption && spanContains(atOption.span, node.atSpan)) {
    return null;
  }
  return node.atSpan;
}

function resolveInlineAtRemovalSpan(source: string, nodeRef: NodeRef): Span | null {
  const node = nodeRef.node;
  if (node.atSpan) {
    const atOption = findPlacementOption(node.options, "at");
    if (atOption && spanContains(atOption.span, node.atSpan)) {
      return null;
    }

    const searchFrom = Math.max(0, Math.min(nodeRef.statement.span.from, node.atSpan.from));
    const beforeCoordinate = source.slice(searchFrom, node.atSpan.from);
    const match = /(\s*)\bat\s*$/u.exec(beforeCoordinate);
    if (!match) {
      return null;
    }
    return {
      from: searchFrom + match.index,
      to: node.atSpan.to
    };
  }

  return resolveStandaloneNodeAtRemovalSpan(source, nodeRef);
}

function resolveStandaloneNodeAtRemovalSpan(source: string, nodeRef: NodeRef): Span | null {
  const nodeIndex = nodeRef.statement.items.findIndex((item) => item === nodeRef.node);
  if (nodeIndex < 2) {
    return null;
  }
  const atKeyword = nodeRef.statement.items[nodeIndex - 2];
  const coordinate = nodeRef.statement.items[nodeIndex - 1];
  if (!isAtKeyword(atKeyword) || coordinate?.kind !== "Coordinate") {
    return null;
  }

  const previousBoundary =
    nodeIndex >= 3
      ? (nodeRef.statement.items[nodeIndex - 3]?.span.to ?? nodeRef.statement.span.from)
      : nodeRef.statement.span.from;
  return {
    from: includeLeadingWhitespace(source, atKeyword.span.from, previousBoundary),
    to: coordinate.span.to
  };
}

function isAtKeyword(item: PathItem | undefined): boolean {
  return item?.kind === "PathKeyword" && item.keyword === "at";
}

function includeLeadingWhitespace(source: string, start: number, boundary: number): number {
  let offset = start;
  while (offset > boundary && /\s/u.test(source[offset - 1] ?? "")) {
    offset -= 1;
  }
  return offset;
}

function findPlacementOption(options: OptionListAst | undefined, key: string): OptionEntry | null {
  for (const entry of options?.entries ?? []) {
    if (optionEntryKey(entry) === key) {
      return entry;
    }
  }
  return null;
}

function buildInlineAtInsertion(source: string, offset: number, coordinate: string): string {
  const previous = offset > 0 ? source[offset - 1] ?? "" : "";
  const next = offset < source.length ? source[offset] ?? "" : "";
  const leading = previous && !/\s/u.test(previous) ? " " : "";
  const trailing = next && !/\s/u.test(next) && next !== ";" ? " " : "";
  return `${leading}at ${coordinate}${trailing}`;
}

function resolveInlineAtInsertionOffset(source: string, node: NodeItem): number {
  if (node.textSource === "group" && node.textSpan.from > 0 && source[node.textSpan.from - 1] === "{") {
    return node.textSpan.from - 1;
  }
  return node.textSpan.from;
}

function formatPlacementCoordinateFromWorld(world: WorldPoint, transform?: FrameTransform): string {
  if (transform) {
    const local = worldToLocal(world, transform);
    if (local) {
      const inSourceUnits = localToSourceUnits(local);
      return `(${formatNumber(inSourceUnits.x)},${formatNumber(inSourceUnits.y)})`;
    }
  }
  return `(${formatNumber(world.x * CM_PER_PT)},${formatNumber(world.y * CM_PER_PT)})`;
}

function hasPathAttachment(elements: ReturnType<typeof evaluateTikzFigure>["scene"]["elements"], sourceId: string): boolean {
  return elements.some(
    (element) => element.sourceRef.sourceId === sourceId && "pathAttachment" in element && element.pathAttachment != null
  );
}

function spanContains(outer: Span, inner: Span): boolean {
  return outer.from <= inner.from && inner.to <= outer.to;
}

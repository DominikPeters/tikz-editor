import { coordinateTransform } from "../coords/axis-basis.js";
import { nextEditHandleId } from "../edit-handles.js";
import type { PathItem, PathOptionItem, Span } from "../../ast/types.js";
import { frameLocalPoint, worldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import { frameTransform } from "../../coords/transforms.js";
import type { SemanticContext } from "../context.js";
import { evaluateRawCoordinate } from "../coords/evaluate.js";
import { createEditHandle } from "../edit-handles.js";
import type { DiagnosticPushFn, PlacementSegment } from "../path/types.js";
import type { WorldPoint } from "../../coords/points.js";
import { normalizeOptionValue } from "./utils.js";
import { pointAtPlacementSegment, resolvePathPositionFraction } from "../path/path-attached.js";

export { pointAtPlacementSegment };

function wp(x: number, y: number): WorldPoint {
  return worldPoint(pt(x), pt(y));
}

export function resolveNodeTargetPoint(
  item: PathItem & { kind: "Node"; atRaw?: string; atSpan?: Span; atRelativePrefix?: "+" | "++" },
  context: SemanticContext,
  handleSourceId: string,
  span: { from: number; to: number },
  pushDiagnostic: DiagnosticPushFn,
  options: PathOptionItem["options"] | undefined,
  segment: PlacementSegment | null,
  defaultPoint?: WorldPoint,
  opts: { allowImplicitOriginHandle?: boolean; explicitAtSyntax?: boolean } = {}
): WorldPoint {
  if (opts.explicitAtSyntax && defaultPoint) {
    return defaultPoint;
  }

  if (item.atRaw) {
    const evaluated = evaluateRawCoordinate(item.atRaw, context, item.atRelativePrefix);
    if (evaluated.world) {
      const handleSpan = item.atSpan ?? span;
      const handle = createEditHandle(evaluated, handleSpan, handleSourceId, "node-position", context);
      if (handle) context.editHandles.push(handle);
      return evaluated.world;
    }
    for (const code of evaluated.diagnostics) {
      pushDiagnostic(code, `Node placement issue: ${code}`, span.from, span.to);
    }
  }

  let optionAtRaw: string | null = null;
  let optionAtSpan: Span | null = null;
  for (const entry of options?.entries ?? []) {
    if (entry.kind === "kv" && entry.key === "at") {
      optionAtRaw = normalizeOptionValue(entry.valueRaw);
      optionAtSpan = entry.span;
    }
  }
  if (optionAtRaw && optionAtRaw.length > 0) {
    const evaluated = evaluateRawCoordinate(optionAtRaw, context);
    if (evaluated.world) {
      const handleSpan = optionAtSpan ?? span;
      const handle = createEditHandle(evaluated, handleSpan, handleSourceId, "node-position", context);
      if (handle) context.editHandles.push(handle);
      return evaluated.world;
    }
    for (const code of evaluated.diagnostics) {
      pushDiagnostic(code, `Node placement issue: ${code}`, span.from, span.to);
    }
  }

  const pos = resolveNodePositionFraction(options);
  if (pos != null && segment) {
    return pointAtPlacementSegment(segment, pos);
  }

  if (segment) {
    return pointAtSegmentEnd(segment);
  }

  if (opts.allowImplicitOriginHandle) {
    const frame = context.stack[context.stack.length - 1];
    const coordinateFrame = coordinateTransform(frame.transform, frame.axisBasis);
    const insertionOffset = resolveImplicitNodePlacementInsertionOffset(item, context.source);
    const implicitWorldPoint = defaultPoint ?? context.currentPoint ?? wp(0, 0);
    context.editHandles.push({
      id: nextEditHandleId(context, handleSourceId, "node-position"),
      runtimeId: nextEditHandleId(context, handleSourceId, "node-position"),
      sourceRef: {
        sourceId: handleSourceId,
        sourceSpan: { from: insertionOffset, to: insertionOffset },
        sourceFingerprint: context.sourceFingerprint
      },
      handleType: "coordinate",
      kind: "node-position",
      coordinateSpace: "frame-local",
      world: implicitWorldPoint,
      local: frameLocalPoint(pt(0), pt(0)),
      frame: frameTransform(coordinateFrame.a, coordinateFrame.b, coordinateFrame.c, coordinateFrame.d, coordinateFrame.e, coordinateFrame.f),
      transform: coordinateFrame,
      axisBasis: frame.axisBasis,
      sourceText: "",
      coordinateForm: "cartesian",
      rewriteMode: "direct",
      insertion: { kind: "node-inline-at" }
    });
  }

  return defaultPoint ?? context.currentPoint ?? wp(0, 0);
}

function resolveImplicitNodePlacementInsertionOffset(
  item: PathItem & { kind: "Node"; textSource: "group" | "option"; textSpan: Span },
  source: string
): number {
  if (item.textSource === "group" && item.textSpan.from > item.span.from && source[item.textSpan.from - 1] === "{") {
    return item.textSpan.from - 1;
  }
  return item.span.to;
}

export const resolveNodePositionFraction = resolvePathPositionFraction;

function pointAtSegmentEnd(segment: PlacementSegment): WorldPoint {
  if (segment.kind === "line" || segment.kind === "hv" || segment.kind === "cubic" || segment.kind === "arc") {
    return segment.to;
  }
  return pointAtPlacementSegment(segment, 1);
}

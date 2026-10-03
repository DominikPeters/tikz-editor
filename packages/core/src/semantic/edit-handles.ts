import type { Span } from "../ast/types.js";
import type { SemanticContext } from "./context.js";
import type { EvaluatedCoordinate } from "./coords/evaluate.js";
import type { EditHandle } from "./types.js";
import { identityMatrix } from "./transform.js";
import { worldTransform } from "../coords/transforms.js";

export function createEditHandle(
  evaluated: EvaluatedCoordinate,
  sourceSpan: Span,
  sourceId: string,
  kind: "node-position" | "path-point" | "path-control",
  context: SemanticContext,
  opts: {
    rewriteTargetHandleId?: string;
  } = {}
): EditHandle | null {
  if (!evaluated.world) return null;

  const rewriteMode = determineRewriteMode(evaluated);
  const sourceText = context.source.slice(sourceSpan.from, sourceSpan.to);
  const base = {
    // Keep IDs stable across coordinate text rewrites by avoiding source-span offsets.
    // This allows ongoing drags to continue after recompute snapshots.
    id: nextEditHandleId(context, sourceId, kind),
    runtimeId: nextEditHandleId(context, sourceId, kind),
    sourceRef: {
      sourceId,
      sourceSpan,
      sourceFingerprint: context.sourceFingerprint
    },
    kind,
    world: evaluated.world,
    sourceText,
    axisBasis: context.stack[context.stack.length - 1].axisBasis,
    sourceUnits: evaluated.sourceUnits,
    coordinateForm: evaluated.coordinateForm,
    relativePrefix: evaluated.relativePrefix,
    rewriteTargetHandleId: opts.rewriteTargetHandleId
  } as const;

  if (evaluated.coordinateForm === "calc" && evaluated.frame && !evaluated.relativePrefix) {
    return {
      ...base,
      coordinateForm: "calc",
      transform: worldTransform(evaluated.frame.a, evaluated.frame.b, evaluated.frame.c, evaluated.frame.d, evaluated.frame.e, evaluated.frame.f),
      handleType: "coordinate",
      coordinateSpace: "world-only",
      frame: evaluated.frame,
      rewriteMode: "calc"
    };
  }

  if (evaluated.kind === "transformed") {
    const frame = evaluated.frame;
    const local = evaluated.local;
    if (!frame || !local) {
      return null;
    }
    if (rewriteMode === "delta") {
      const relativeBase = evaluated.relativeBase ?? context.currentPoint;
      if (!relativeBase) {
        return null;
      }
      return {
        ...base,
        transform: worldTransform(frame.a, frame.b, frame.c, frame.d, frame.e, frame.f),
        handleType: "coordinate",
        coordinateSpace: "frame-local",
        local,
        frame,
        rewriteMode,
        relativeBase
      };
    }

    return {
      ...base,
      transform: worldTransform(frame.a, frame.b, frame.c, frame.d, frame.e, frame.f),
      handleType: "coordinate",
      coordinateSpace: "frame-local",
      local,
      frame,
      rewriteMode
    };
  }

  return {
    ...base,
    transform: identityMatrix(),
    handleType: "coordinate",
    coordinateSpace: "world-only",
    rewriteMode: "unsupported"
  };
}

function determineRewriteMode(evaluated: EvaluatedCoordinate): "direct" | "delta" | "unsupported" {
  if (evaluated.origin === "turn") return "delta";
  if (evaluated.relativePrefix) return "delta";
  if (evaluated.kind === "transformed" && evaluated.coordinateForm === "explicit") return "direct";
  const form = evaluated.coordinateForm;
  if (form === "cartesian" || form === "polar" || form === "xyz") return "direct";
  // named, calc, explicit world-only (perpendicular/intersection), unknown
  return "unsupported";
}

// Counters follow the handle array, so restoring a compact checkpoint rebuilds
// them from that prefix. Appending handles for another object cannot renumber us.
const handleCounters = new WeakMap<SemanticContext, { handles: EditHandle[]; count: number; byOwner: Map<string, number> }>();
export function nextEditHandleId(context: SemanticContext, sourceId: string, kind: string): string {
  let state = handleCounters.get(context);
  if (state?.handles !== context.editHandles || state.count > context.editHandles.length) {
    state = { handles: context.editHandles, count: 0, byOwner: new Map() };
    handleCounters.set(context, state);
  }
  for (; state.count < context.editHandles.length; state.count++) {
    const handle = context.editHandles[state.count];
    const key = `${handle.sourceRef.sourceId}:${handle.kind}`;
    state.byOwner.set(key, (state.byOwner.get(key) ?? 0) + 1);
  }
  return `handle:${sourceId}:${kind}:${state.byOwner.get(`${sourceId}:${kind}`) ?? 0}`;
}

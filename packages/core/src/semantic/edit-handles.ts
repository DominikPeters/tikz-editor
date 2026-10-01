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
    id: `handle:${sourceId}:${kind}:${context.editHandles.length}`,
    runtimeId: `handle:${sourceId}:${kind}:${context.editHandles.length}`,
    sourceRef: {
      sourceId,
      sourceSpan,
      sourceFingerprint: context.sourceFingerprint
    },
    kind,
    world: evaluated.world,
    sourceText,
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
      const relativeBase = context.currentPoint;
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
  if (evaluated.relativePrefix) return "delta";
  if (evaluated.kind === "transformed" && evaluated.coordinateForm === "explicit") return "direct";
  const form = evaluated.coordinateForm;
  if (form === "cartesian" || form === "polar" || form === "xyz") return "direct";
  // named, calc, explicit world-only (perpendicular/intersection), unknown
  return "unsupported";
}

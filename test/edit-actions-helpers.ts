import { expect } from "vitest";
import type { WorldPoint } from "../packages/core/src/coords/points.js";
import type { EditHandle } from "../packages/core/src/semantic/types.js";
import { identityMatrix } from "../packages/core/src/semantic/transform.js";
import type { applyEditAction } from "../packages/core/src/edit/actions.js";
import { PT_PER_CM } from "../packages/core/src/edit/format.js";
import { computeSourceFingerprint } from "../packages/core/src/utils/source-fingerprint.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { collectSourceWorldBounds } from "../packages/core/src/edit/snapping/geometry.js";
import { applySourcePatches } from "../packages/core/src/edit/source-patches.js";
import { wb } from "./coords-helpers.js";

export const cm = (v: number) => v * PT_PER_CM;

function mergeTestBounds(
  left: ReturnType<typeof wb>,
  right: ReturnType<typeof wb>
) {
  return wb(
    Math.min(left.minX, right.minX),
    Math.min(left.minY, right.minY),
    Math.max(left.maxX, right.maxX),
    Math.max(left.maxY, right.maxY)
  );
}

export function scopeBodyBounds(source: string): ReturnType<typeof wb> | null {
  const parsed = parseTikz(source, { recover: true });
  const evaluated = evaluateTikzFigure(parsed.figure, source);
  const boundsBySource = collectSourceWorldBounds(evaluated.scene.elements);
  const scope = parsed.figure.body.find((statement) => statement.kind === "Scope");
  if (!scope || scope.kind !== "Scope") {
    return null;
  }

  let merged: ReturnType<typeof wb> | null = null;
  for (const child of scope.body) {
    const bounds = boundsBySource.get(child.id);
    if (!bounds) {
      continue;
    }
    merged = merged ? mergeTestBounds(merged, bounds) : bounds;
  }
  return merged;
}

export function makeHandle(
  source: string,
  overrides: Partial<EditHandle> & {
    world: WorldPoint;
    sourceSpan: { from: number; to: number };
    sourceId?: string;
  }
): EditHandle {
  const { world, sourceSpan, sourceId, ...rest } = overrides;
  const span = sourceSpan;
  const transform = rest.transform ?? identityMatrix();
  const kind = rest.kind ?? "path-point";
  const rewriteMode = rest.rewriteMode ?? "direct";
  return {
    id: `handle-${span.from}-${span.to}`,
    runtimeId: `runtime:handle-${span.from}-${span.to}`,
    sourceRef: {
      sourceId: sourceId ?? "elem-1",
      sourceSpan: span,
      sourceFingerprint: computeSourceFingerprint(source)
    },
    handleType: "coordinate",
    coordinateSpace: "frame-local",
    kind,
    world: world,
    local: rest.local ?? world,
    frame: rest.frame ?? transform,
    transform,
    sourceText: source.slice(span.from, span.to),
    coordinateForm: overrides.coordinateForm ?? "cartesian",
    rewriteMode,
    ...rest
  } as EditHandle;
}

export function expectPatchesReconstructSource(
  previousSource: string,
  result: Extract<ReturnType<typeof applyEditAction>, { kind: "success" | "partial" }>
): void {
  const replayed = applySourcePatches(previousSource, result.patches);
  expect(replayed.kind).toBe("success");
  if (replayed.kind !== "success") return;
  expect(replayed.source).toBe(result.newSource);
}

import type { EditHandle } from "@tikz-editor/core/semantic/types";
import type { WorldPoint } from "../coords/types";
import { analyzeExplicitPathStatement } from "@tikz-editor/core/edit/path-editing";
import type { PathStatement, Statement } from "@tikz-editor/core/ast/types";
import { parseTikzForEdit, type EditParseOptions } from "@tikz-editor/core/edit/parse-options";

const ENDPOINT_SNAP_RADIUS_PX = 10;

export type PathEndpointSnap = {
  elementId: string;
  end: "start" | "end";
  world: WorldPoint;
};

/**
 * Check if a point is near the endpoint of an existing open path.
 * Returns the nearest matching endpoint, or null.
 */
export function resolvePathEndpointSnap(input: {
  pointerWorld: WorldPoint;
  zoom: number;
  editHandles: readonly EditHandle[];
  source: string;
  parseOptions?: EditParseOptions;
}): PathEndpointSnap | null {
  const zoom = Math.max(input.zoom, 1e-6);
  const snapRadius = ENDPOINT_SNAP_RADIUS_PX / zoom;
  const snapRadiusSq = snapRadius * snapRadius;

  // Group path-point handles by sourceId
  const handlesBySource = new Map<string, EditHandle[]>();
  for (const handle of input.editHandles) {
    if (handle.kind !== "path-point") continue;
    const existing = handlesBySource.get(handle.sourceRef.sourceId);
    if (existing) {
      existing.push(handle);
    } else {
      handlesBySource.set(handle.sourceRef.sourceId, [handle]);
    }
  }

  // Parse once to find path statements
  const parsed = parseTikzForEdit(input.source, {
    ...input.parseOptions,
  });

  let bestSnap: PathEndpointSnap | null = null;
  let bestDistSq = snapRadiusSq;

  for (const [sourceId, handles] of handlesBySource) {
    const statement = findPathStatementById(parsed.figure.body, sourceId);
    if (!statement) continue;

    const analyzed = analyzeExplicitPathStatement(input.source, statement);
    if (analyzed.kind !== "eligible") continue;
    if (analyzed.analysis.closed) continue;

    const analysis = analyzed.analysis;
    const firstAnchor = analysis.anchors[0];
    const lastAnchor = analysis.anchors[analysis.anchors.length - 1];
    if (!firstAnchor || !lastAnchor) continue;

    // Find handles matching first and last anchor spans
    for (const handle of handles) {
      const span = handle.sourceRef.sourceSpan;
      const isFirst = span.from === firstAnchor.item.span.from && span.to === firstAnchor.item.span.to;
      const isLast = span.from === lastAnchor.item.span.from && span.to === lastAnchor.item.span.to;
      if (!isFirst && !isLast) continue;

      const dx = handle.world.x - input.pointerWorld.x;
      const dy = handle.world.y - input.pointerWorld.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestSnap = {
          elementId: sourceId,
          end: isLast ? "end" : "start",
          world: handle.world
        };
      }
    }
  }

  return bestSnap;
}

function findPathStatementById(statements: readonly Statement[], elementId: string): PathStatement | null {
  for (const statement of statements) {
    if (statement.kind === "Path" && statement.id === elementId) {
      return statement;
    }
    if (statement.kind === "Scope") {
      const nested = findPathStatementById(statement.body, elementId);
      if (nested) return nested;
    }
  }
  return null;
}

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
  bypass?: boolean;
  pointerWorld: WorldPoint;
  zoom: number;
  editHandles: readonly EditHandle[];
  source: string;
  parseOptions?: EditParseOptions;
}): PathEndpointSnap | null {
  if (input.bypass) return null;
  const zoom = Math.max(input.zoom, 1e-6);
  const snapRadius = ENDPOINT_SNAP_RADIUS_PX / zoom;
  const snapRadiusSq = snapRadius * snapRadius;

  let bestSnap: PathEndpointSnap | null = null;
  let bestDistSq = snapRadiusSq;
  for (const endpoint of openPathEndpoints(input.editHandles, input.source, input.parseOptions)) {
    const dx = endpoint.world.x - input.pointerWorld.x;
    const dy = endpoint.world.y - input.pointerWorld.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestSnap = endpoint;
    }
  }
  return bestSnap;
}

// Pointer moves ask again with the same snapshot: find the endpoints once per
// handle list and source.
const endpointCache = new WeakMap<readonly EditHandle[], { source: string; endpoints: readonly PathEndpointSnap[] }>();

function openPathEndpoints(
  editHandles: readonly EditHandle[],
  source: string,
  parseOptions: EditParseOptions | undefined
): readonly PathEndpointSnap[] {
  const cached = endpointCache.get(editHandles);
  if (cached?.source === source) return cached.endpoints;

  const handlesBySource = new Map<string, EditHandle[]>();
  for (const handle of editHandles) {
    if (handle.kind !== "path-point") continue;
    const existing = handlesBySource.get(handle.sourceRef.sourceId);
    if (existing) {
      existing.push(handle);
    } else {
      handlesBySource.set(handle.sourceRef.sourceId, [handle]);
    }
  }

  const parsed = parseTikzForEdit(source, { ...parseOptions });
  const statements = new Map<string, PathStatement>();
  collectPathStatements(parsed.figure.body, statements);
  const endpoints: PathEndpointSnap[] = [];
  for (const [sourceId, handles] of handlesBySource) {
    const statement = statements.get(sourceId);
    if (!statement) continue;

    const analyzed = analyzeExplicitPathStatement(source, statement);
    if (analyzed.kind !== "eligible") continue;
    if (analyzed.analysis.closed) continue;

    const analysis = analyzed.analysis;
    const firstAnchor = analysis.anchors[0];
    const lastAnchor = analysis.anchors[analysis.anchors.length - 1];
    if (!firstAnchor || !lastAnchor) continue;

    // Handles matching the first and last anchor spans
    for (const handle of handles) {
      const span = handle.sourceRef.sourceSpan;
      const isFirst = span.from === firstAnchor.item.span.from && span.to === firstAnchor.item.span.to;
      const isLast = span.from === lastAnchor.item.span.from && span.to === lastAnchor.item.span.to;
      if (!isFirst && !isLast) continue;
      endpoints.push({ elementId: sourceId, end: isLast ? "end" : "start", world: handle.world });
    }
  }
  endpointCache.set(editHandles, { source, endpoints });
  return endpoints;
}

function collectPathStatements(statements: readonly Statement[], into: Map<string, PathStatement>): void {
  for (const statement of statements) {
    if (statement.kind === "Path") {
      into.set(statement.id, statement);
    } else if (statement.kind === "Scope") {
      collectPathStatements(statement.body, into);
    }
  }
}

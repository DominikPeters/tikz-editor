import type { Statement } from "@tikz-editor/core/ast/types";
import { axisBodyStatements } from "@tikz-editor/core/ast/walk";
import { pt, svgBounds, worldBounds } from "@tikz-editor/core/coords/index";
import type { SceneElement } from "@tikz-editor/core/semantic/types";
import type { SvgBounds, SvgPoint, WorldBounds } from "../coords/types";
import type { SourceBoundsMap } from "./types";

export type ScopeOverlayNode = {
  scopeId: string;
  parentScopeId: string | null;
  childStatementIds: string[];
  bounds: SvgBounds | null;
};

export type ScopeOverlayIndex = {
  scopesById: Map<string, ScopeOverlayNode>;
  ancestorScopeIdsBySourceId: Map<string, string[]>;
  boundsByScopeId: Map<string, SvgBounds>;
};

export type ResolveScopeAwareSelectionTargetInput = {
  hitTargetId: string;
  hitSourceId: string;
  scopeOverlay: ScopeOverlayIndex;
  focusedScopeId?: string | null;
};

/**
 * The parts of pgfplots axes the scene draws: axis id → its plot and
 * description ids, and each axis' outer bounding box (from the axis' edit
 * geometry). An axis is a container like a scope: one click selects it, a
 * second click on a plot, label or legend selects that part.
 */
export type AxisOverlayParts = {
  partIdsByAxisId: ReadonlyMap<string, readonly string[]>;
  boundsByAxisId: ReadonlyMap<string, SvgBounds>;
};

export function collectAxisOverlayParts(
  sceneElements: readonly SceneElement[] | undefined,
  viewBox: { y: number; height: number } | null | undefined
): AxisOverlayParts {
  const partIdsByAxisId = new Map<string, string[]>();
  const boundsByAxisId = new Map<string, SvgBounds>();
  for (const element of sceneElements ?? []) {
    const info = element.kind === "Path" ? element.pgfplotsAxis : undefined;
    if (info && viewBox) {
      const { a, b, c, d, e, f } = info.frame;
      const corners = [[info.bbox.minX, info.bbox.minY], [info.bbox.maxX, info.bbox.minY], [info.bbox.minX, info.bbox.maxY], [info.bbox.maxX, info.bbox.maxY]]
        .map(([x = 0, y = 0]) => ({ x: a * x + c * y + e, y: b * x + d * y + f }));
      const xs = corners.map((p) => p.x);
      const ys = corners.map((p) => viewBox.y + viewBox.height - (p.y - viewBox.y));
      boundsByAxisId.set(info.axisId, svgBounds(pt(Math.min(...xs)), pt(Math.min(...ys)), pt(Math.max(...xs)), pt(Math.max(...ys))));
    }
    const match = /^(axis:\d+):(?:plot:\d+|xlabel|ylabel|title|legend)$/u.exec(element.sourceRef.sourceId);
    if (match?.[1]) {
      const list = partIdsByAxisId.get(match[1]) ?? [];
      if (!list.includes(element.sourceRef.sourceId)) list.push(element.sourceRef.sourceId);
      partIdsByAxisId.set(match[1], list);
    }
  }
  return { partIdsByAxisId, boundsByAxisId };
}

export function buildScopeOverlayIndex(
  statements: readonly Statement[] | undefined,
  boundsBySourceId: SourceBoundsMap,
  axisParts?: AxisOverlayParts
): ScopeOverlayIndex {
  const scopesById = new Map<string, ScopeOverlayNode>();
  const ancestorScopeIdsBySourceId = new Map<string, string[]>();
  const boundsByScopeId = new Map<string, SvgBounds>();

  if (!statements || statements.length === 0) {
    return {
      scopesById,
      ancestorScopeIdsBySourceId,
      boundsByScopeId
    };
  }

  const visit = (
    items: readonly Statement[],
    parentScopeId: string | null,
    ancestors: string[]
  ): SvgBounds | null => {
    let mergedBounds: SvgBounds | null = null;

    for (const statement of items) {
      ancestorScopeIdsBySourceId.set(statement.id, [...ancestors]);

      if (statement.kind === "Axis") {
        // Plots and descriptions are parts of the axis; its TikZ statements are children too.
        const partIds = axisParts?.partIdsByAxisId.get(statement.id) ?? [];
        for (const partId of partIds) ancestorScopeIdsBySourceId.set(partId, [...ancestors, statement.id]);
        const body = axisBodyStatements(statement);
        const childBounds = visit(body, statement.id, [...ancestors, statement.id]);
        const ownBounds = boundsBySourceId.get(statement.id) ?? null;
        let axisBounds = axisParts?.boundsByAxisId.get(statement.id) ?? null;
        if (!axisBounds) {
          axisBounds = ownBounds;
          for (const partId of partIds) {
            const partBounds = boundsBySourceId.get(partId);
            if (partBounds) axisBounds = axisBounds ? mergeBounds(axisBounds, partBounds) : partBounds;
          }
          if (childBounds) axisBounds = axisBounds ? mergeBounds(axisBounds, childBounds) : childBounds;
        }
        scopesById.set(statement.id, {
          scopeId: statement.id,
          parentScopeId,
          childStatementIds: [...partIds, ...body.map((entry) => entry.id)],
          bounds: axisBounds
        });
        if (axisBounds) {
          boundsByScopeId.set(statement.id, axisBounds);
          mergedBounds = mergedBounds ? mergeBounds(mergedBounds, axisBounds) : axisBounds;
        }
        continue;
      }

      if (statement.kind !== "Scope") {
        const ownBounds = boundsBySourceId.get(statement.id) ?? null;
        if (ownBounds) {
          mergedBounds = mergedBounds ? mergeBounds(mergedBounds, ownBounds) : ownBounds;
        }
        continue;
      }

      const childBounds = visit(statement.body, statement.id, [...ancestors, statement.id]);
      scopesById.set(statement.id, {
        scopeId: statement.id,
        parentScopeId,
        childStatementIds: statement.body.map((entry) => entry.id),
        bounds: childBounds
      });
      if (childBounds) {
        boundsByScopeId.set(statement.id, childBounds);
        mergedBounds = mergedBounds ? mergeBounds(mergedBounds, childBounds) : childBounds;
      }
    }

    return mergedBounds;
  };

  visit(statements, null, []);

  return {
    scopesById,
    ancestorScopeIdsBySourceId,
    boundsByScopeId
  };
}

/**
 * World bounds of a scope: the union of its members' bounds, recursing into
 * nested scopes. Element bounds are keyed by source id and never include
 * scopes, which draw nothing of their own.
 */
export function scopeWorldBounds(
  scopeOverlay: ScopeOverlayIndex,
  scopeId: string,
  boundsBySourceId: ReadonlyMap<string, WorldBounds>
): WorldBounds | null {
  const scope = scopeOverlay.scopesById.get(scopeId);
  if (!scope) return null;
  // A pgfplots axis draws its box, ticks and tick labels itself.
  let merged: WorldBounds | null = boundsBySourceId.get(scopeId) ?? null;
  for (const childId of scope.childStatementIds) {
    const bounds = boundsBySourceId.get(childId)
      ?? (scopeOverlay.scopesById.has(childId) ? scopeWorldBounds(scopeOverlay, childId, boundsBySourceId) : null);
    if (!bounds) continue;
    merged = merged
      ? worldBounds(
        pt(Math.min(merged.minX, bounds.minX)),
        pt(Math.min(merged.minY, bounds.minY)),
        pt(Math.max(merged.maxX, bounds.maxX)),
        pt(Math.max(merged.maxY, bounds.maxY))
      )
      : bounds;
  }
  return merged;
}

export function augmentScopeOverlayWithMatrices(
  baseOverlay: ScopeOverlayIndex,
  sceneElements: readonly SceneElement[] | undefined,
  boundsBySourceId: SourceBoundsMap
): ScopeOverlayIndex {
  if (!sceneElements || sceneElements.length === 0) {
    return baseOverlay;
  }

  const matrixToCells = new Map<string, Set<string>>();
  for (const element of sceneElements) {
    const matrixCell = element.matrixCell;
    if (!matrixCell) {
      continue;
    }
    const matrixId = matrixCell.matrixSourceId.trim();
    const cellId = matrixCell.cellSourceId.trim();
    if (matrixId.length === 0 || cellId.length === 0) {
      continue;
    }
    let cells = matrixToCells.get(matrixId);
    if (!cells) {
      cells = new Set<string>();
      matrixToCells.set(matrixId, cells);
    }
    cells.add(cellId);
  }

  if (matrixToCells.size === 0) {
    return baseOverlay;
  }

  const scopesById = new Map(baseOverlay.scopesById);
  const ancestorScopeIdsBySourceId = new Map(baseOverlay.ancestorScopeIdsBySourceId);
  const boundsByScopeId = new Map(baseOverlay.boundsByScopeId);

  for (const [matrixSourceId, cellIds] of matrixToCells.entries()) {
    const matrixAncestors = ancestorScopeIdsBySourceId.get(matrixSourceId) ?? [];
    const parentScopeId = matrixAncestors.length > 0 ? matrixAncestors[matrixAncestors.length - 1] ?? null : null;

    let matrixBounds = boundsBySourceId.get(matrixSourceId) ?? null;
    if (!matrixBounds) {
      for (const cellId of cellIds) {
        const cellBounds = boundsBySourceId.get(cellId);
        if (!cellBounds) {
          continue;
        }
        matrixBounds = matrixBounds ? mergeBounds(matrixBounds, cellBounds) : cellBounds;
      }
    }

    scopesById.set(matrixSourceId, {
      scopeId: matrixSourceId,
      parentScopeId,
      childStatementIds: [...cellIds],
      bounds: matrixBounds
    });

    ancestorScopeIdsBySourceId.set(matrixSourceId, [...matrixAncestors]);
    if (matrixBounds) {
      boundsByScopeId.set(matrixSourceId, matrixBounds);
    }

    for (const cellId of cellIds) {
      const existingAncestors = ancestorScopeIdsBySourceId.get(cellId) ?? matrixAncestors;
      const withoutMatrix = existingAncestors.filter((ancestorId) => ancestorId !== matrixSourceId);
      ancestorScopeIdsBySourceId.set(cellId, [...withoutMatrix, matrixSourceId]);
    }
  }

  return {
    scopesById,
    ancestorScopeIdsBySourceId,
    boundsByScopeId
  };
}

export function resolveScopeAwarePointerDownTarget(
  input: ResolveScopeAwareSelectionTargetInput
): string {
  const { hitTargetId, hitSourceId, scopeOverlay, focusedScopeId = null } = input;
  const ancestorScopes = scopeOverlay.ancestorScopeIdsBySourceId.get(hitSourceId) ?? [];
  const outermost = resolveOutermostScopeUnderFocus(ancestorScopes, focusedScopeId);
  return outermost ?? hitTargetId;
}

export function resolveScopeAwarePointerUpDrillTarget(input: {
  selectedScopeId: string | null;
  hitSourceId: string;
  scopeOverlay: ScopeOverlayIndex;
}): string | null {
  const { selectedScopeId, hitSourceId, scopeOverlay } = input;
  if (!selectedScopeId || !scopeOverlay.scopesById.has(selectedScopeId)) {
    return null;
  }
  const ancestorScopes = scopeOverlay.ancestorScopeIdsBySourceId.get(hitSourceId) ?? [];
  return resolveDirectChildWithinScope(selectedScopeId, hitSourceId, ancestorScopes);
}

export function resolveScopeAwareContextMenuTarget(input: {
  hitTargetId: string;
  hitSourceId: string;
  selectedSourceIds: ReadonlySet<string>;
  scopeOverlay: ScopeOverlayIndex;
  focusedScopeId?: string | null;
}): string {
  const {
    hitTargetId,
    hitSourceId,
    selectedSourceIds,
    scopeOverlay,
    focusedScopeId = null
  } = input;
  const singleSelectedId = selectedSourceIds.size === 1 ? [...selectedSourceIds][0] ?? null : null;
  const ancestorScopes = scopeOverlay.ancestorScopeIdsBySourceId.get(hitSourceId) ?? [];

  if (
    singleSelectedId &&
    (singleSelectedId === hitTargetId || singleSelectedId === hitSourceId)
  ) {
    return singleSelectedId;
  }

  if (singleSelectedId && scopeOverlay.scopesById.has(singleSelectedId) && ancestorScopes.includes(singleSelectedId)) {
    return singleSelectedId;
  }

  return resolveScopeAwarePointerDownTarget({
    hitTargetId,
    hitSourceId,
    scopeOverlay,
    focusedScopeId
  });
}

export function resolveScopeAwareMarqueeSelection(input: {
  selectionBounds: SvgBounds;
  sourceBoundsById: SourceBoundsMap;
  scopeOverlay: ScopeOverlayIndex;
}): string[] {
  const { selectionBounds, sourceBoundsById, scopeOverlay } = input;
  const selectedScopeIds = new Set<string>();

  for (const [scopeId, bounds] of scopeOverlay.boundsByScopeId) {
    if (boundsContainedWithin(bounds, selectionBounds)) {
      selectedScopeIds.add(scopeId);
    }
  }

  const selectedIds: string[] = [];
  for (const [sourceId, bounds] of sourceBoundsById) {
    if (!boundsContainedWithin(bounds, selectionBounds)) {
      continue;
    }
    const ancestors = scopeOverlay.ancestorScopeIdsBySourceId.get(sourceId) ?? [];
    if (ancestors.length === 0) {
      selectedIds.push(sourceId);
    }
  }

  for (const scopeId of selectedScopeIds) {
    const ancestors = scopeOverlay.ancestorScopeIdsBySourceId.get(scopeId) ?? [];
    if (ancestors.some((ancestorId) => selectedScopeIds.has(ancestorId))) {
      continue;
    }
    selectedIds.push(scopeId);
  }

  return selectedIds;
}

export function resolveFocusedScopeIdForSelection(
  selectedSourceId: string,
  scopeOverlay: ScopeOverlayIndex
): string | null {
  const selectedScope = scopeOverlay.scopesById.get(selectedSourceId);
  if (selectedScope) {
    return selectedScope.parentScopeId;
  }
  const ancestors = scopeOverlay.ancestorScopeIdsBySourceId.get(selectedSourceId) ?? [];
  return ancestors.at(-1) ?? null;
}

export type EscapeStepUp =
  | { kind: "deselect-handle" }
  | { kind: "select-container"; containerId: string; focusedScopeId: string | null }
  | { kind: "clear" };

/**
 * What Escape does on the canvas: it steps out one level, as the deck's
 * Escape selects an object's parent. An active point handle is deselected
 * first; a selection inside a container (a scope, a matrix, a pgfplots axis)
 * selects that container; a selection with no container clears.
 */
export function resolveEscapeStepUp(input: {
  selectedSourceIds: ReadonlySet<string>;
  activeHandleId: string | null;
  scopeOverlay: ScopeOverlayIndex;
}): EscapeStepUp {
  const { selectedSourceIds, activeHandleId, scopeOverlay } = input;
  if (activeHandleId && selectedSourceIds.size > 0) {
    return { kind: "deselect-handle" };
  }
  let container: string | null = null;
  for (const id of selectedSourceIds) {
    const ancestors = scopeOverlay.ancestorScopeIdsBySourceId.get(id) ?? [];
    const parent = ancestors.at(-1) ?? null;
    if (!parent || (container !== null && container !== parent)) {
      return { kind: "clear" };
    }
    container = parent;
  }
  if (!container) {
    return { kind: "clear" };
  }
  return { kind: "select-container", containerId: container, focusedScopeId: resolveFocusedScopeIdForSelection(container, scopeOverlay) };
}

export function isSourceWithinScope(
  scopeId: string | null | undefined,
  sourceId: string,
  scopeOverlay: ScopeOverlayIndex
): boolean {
  if (!scopeId) {
    return false;
  }
  const ancestors = scopeOverlay.ancestorScopeIdsBySourceId.get(sourceId) ?? [];
  return ancestors.includes(scopeId);
}

export function isSvgPointWithinScopeBounds(
  scopeId: string | null | undefined,
  point: SvgPoint,
  scopeOverlay: ScopeOverlayIndex
): boolean {
  if (!scopeId) {
    return false;
  }
  const bounds = scopeOverlay.boundsByScopeId.get(scopeId);
  if (!bounds) {
    return false;
  }
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

function resolveDirectChildWithinScope(
  scopeId: string,
  hitSourceId: string,
  ancestorScopes: readonly string[]
): string | null {
  const scopeIndex = ancestorScopes.indexOf(scopeId);
  if (scopeIndex < 0) {
    return null;
  }
  if (scopeIndex < ancestorScopes.length - 1) {
    return ancestorScopes[scopeIndex + 1] ?? null;
  }
  return hitSourceId;
}

function resolveOutermostScopeUnderFocus(
  ancestorScopes: readonly string[],
  focusedScopeId: string | null
): string | null {
  if (ancestorScopes.length === 0) {
    return null;
  }
  if (!focusedScopeId) {
    return ancestorScopes[0] ?? null;
  }
  const focusedIndex = ancestorScopes.indexOf(focusedScopeId);
  if (focusedIndex < 0) {
    return ancestorScopes[0] ?? null;
  }
  if (focusedIndex >= ancestorScopes.length - 1) {
    return null;
  }
  return ancestorScopes[focusedIndex + 1] ?? null;
}

function mergeBounds(a: SvgBounds, b: SvgBounds): SvgBounds {
  return svgBounds(
    pt(Math.min(a.minX, b.minX)),
    pt(Math.min(a.minY, b.minY)),
    pt(Math.max(a.maxX, b.maxX)),
    pt(Math.max(a.maxY, b.maxY))
  );
}

function boundsContainedWithin(inner: SvgBounds, outer: SvgBounds): boolean {
  return (
    inner.minX >= outer.minX &&
    inner.maxX <= outer.maxX &&
    inner.minY >= outer.minY &&
    inner.maxY <= outer.maxY
  );
}

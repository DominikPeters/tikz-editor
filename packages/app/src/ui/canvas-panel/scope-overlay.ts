import type { Statement } from "tikz-editor/ast/types";
import { pt, svgBounds } from "tikz-editor/coords/index";
import type { SceneElement } from "tikz-editor/semantic/types";
import type { SvgBounds, SvgPoint } from "../coords/types";
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

export function buildScopeOverlayIndex(
  statements: readonly Statement[] | undefined,
  boundsBySourceId: SourceBoundsMap
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
  return ancestors.length > 0 ? ancestors[ancestors.length - 1] : null;
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

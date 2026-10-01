import type { EditHandle } from "@tikz-editor/core/semantic/types";

export type DragCapability = {
  draggableHandleIds: ReadonlySet<string>;
  draggableSourceIds: ReadonlySet<string>;
};

export function computeDragCapability(editHandles: readonly EditHandle[]): DragCapability {
  const handlesById = new Map(editHandles.map((handle) => [handle.id, handle]));
  const rewriteTargetsByHandleId = new Map<string, EditHandle | null>();
  for (const handle of editHandles) {
    rewriteTargetsByHandleId.set(handle.id, handle.rewriteTargetHandleId ? handlesById.get(handle.rewriteTargetHandleId) ?? null : handle);
  }

  // Multiple distinct rewrite targets claiming exactly the same span conflict.
  // Shared aliases of one target do not. Build this once for the entire scene.
  const targetIdsBySpan = new Map<string, Set<string>>();
  const spanKey = (target: EditHandle) => `${target.sourceRef.sourceSpan.from}:${target.sourceRef.sourceSpan.to}`;
  for (const target of rewriteTargetsByHandleId.values()) {
    if (!target) continue;
    const key = spanKey(target);
    const ids = targetIdsBySpan.get(key) ?? new Set<string>();
    ids.add(target.id);
    targetIdsBySpan.set(key, ids);
  }
  const conflicts = (target: EditHandle) => (targetIdsBySpan.get(spanKey(target))?.size ?? 0) > 1;

  const draggableHandleIds = new Set<string>();
  for (const handle of editHandles) {
    const rewriteTarget = rewriteTargetsByHandleId.get(handle.id) ?? null;
    if (!rewriteTarget) {
      continue;
    }
    if (rewriteTarget.rewriteMode === "unsupported") {
      if (!isNamedEndpointDetachHandle(handle)) {
        continue;
      }
      if (conflicts(rewriteTarget)) {
        continue;
      }
      draggableHandleIds.add(handle.id);
      continue;
    }
    if (conflicts(rewriteTarget)) {
      continue;
    }
    draggableHandleIds.add(handle.id);
  }

  const handlesBySourceId = new Map<string, EditHandle[]>();
  for (const handle of editHandles) {
    const sourceId = handle.sourceRef.sourceId;
    const existing = handlesBySourceId.get(sourceId);
    if (existing) {
      existing.push(handle);
    } else {
      handlesBySourceId.set(sourceId, [handle]);
    }
  }

  const draggableSourceIds = new Set<string>();
  for (const [sourceId, handles] of handlesBySourceId) {
    if (handles.length === 0) {
      continue;
    }
    const sourceFullyRewritable = handles.every((handle) => {
      const rewriteTarget = rewriteTargetsByHandleId.get(handle.id) ?? null;
      if (!rewriteTarget || rewriteTarget.rewriteMode === "unsupported") {
        return false;
      }
      return !conflicts(rewriteTarget);
    });
    if (sourceFullyRewritable) {
      draggableSourceIds.add(sourceId);
    }
  }

  return { draggableHandleIds, draggableSourceIds };
}

function isNamedEndpointDetachHandle(handle: EditHandle): boolean {
  return handle.kind === "path-point" && handle.coordinateForm === "named";
}

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildMatrixInspectorDescriptor,
  buildTreeInspectorDescriptor,
  TIKZPICTURE_GLOBAL_TARGET_ID,
  type InspectorDescriptor,
  type InspectorSection,
  type SetPropertyWriteTarget,
  type InspectorSnapshot
} from "tikz-editor/edit/inspector";
import {
  DEFAULT_TRANSFORM_INSPECTOR_VALUES,
  resolveTransformInspectorMutationContextFromOptionEntries,
  resolveTransformInspectorValues,
  transformRotateInspectorLabel,
  type TransformInspectorKey,
  type TransformInspectorMutationContext
} from "tikz-editor/edit/property-write-builders";
import { resolvePropertyTarget } from "tikz-editor/edit/property-target";
import { buildStylesCascadeModel } from "tikz-editor/edit/styles-cascade";
import { resolveFigureBoundsState } from "tikz-editor/edit/figure-bounds";
import type { SceneElement } from "tikz-editor/semantic/types";
import { getSharedEditAnalysisView, getSharedEditAnalysisSession } from "../../edit-analysis-manager";
import { useProjectNamedColorSwatches } from "../../colors/project-named-colors";
import type { EditorAction } from "../../store/types";
import { useEditorStore } from "../../store/store";
import { actionAvailability } from "../editor-commands";
import {
  buildInspectorPropertyProvenanceMap,
  buildMultiInspectorModel,
  buildMultiInspectorPropertyProvenanceMap,
  sameOrderedStringArrays,
  type InspectorPropertyProvenanceMap,
  type MultiInspectorModel
} from "./panel-helpers";

export function inspectorElementPriority(sourceId: string, element: SceneElement): number {
  if (!sourceId.includes(":tree-child:")) {
    return 0;
  }

  let priority = 0;
  if (element.adornment) {
    priority += 1000;
  }
  if (element.kind === "Path" && element.id.includes(":edge-from-parent:")) {
    priority += 400;
  }
  if (element.kind === "Text") {
    priority += 50;
  }
  if (element.kind === "Path" && element.id.startsWith("scene-node-box:")) {
    priority -= 20;
  }
  return priority;
}

function buildScopeTransformWriteTarget(
  scopeId: string,
  writable: boolean,
  reason: string | undefined,
  key: TransformInspectorKey,
  context: TransformInspectorMutationContext
): SetPropertyWriteTarget {
  return {
    mode: "setProperty",
    elementId: scopeId,
    level: "command",
    key,
    transformContext: {
      key,
      values: { ...context.values },
      presence: context.presence ? { ...context.presence } : undefined
    },
    writable,
    reason
  };
}

function buildScopeInspectorDescriptor(
  source: string,
  scopeId: string,
  parseOptions: InspectorSnapshot["parseOptions"]
): InspectorDescriptor {
  const resolved = resolvePropertyTarget(source, scopeId, parseOptions ?? {});
  const writable = resolved.kind === "found";
  const readOnlyReason = resolved.kind === "not-found" ? resolved.reason : undefined;
  const transformContext = resolveTransformInspectorMutationContextFromOptionEntries(
    resolved.kind === "found" ? resolved.target.options?.entries : null
  );
  const transformValues = transformContext.values;
  const sections: InspectorSection[] = [
    {
      id: "transform",
      title: "Transform",
      sourceLevel: "command",
      properties: [
        {
          kind: "number",
          id: "xshift",
          label: "X shift",
          value: transformValues.xshift,
          step: 0.1,
          unit: "pt",
          defaultValue: DEFAULT_TRANSFORM_INSPECTOR_VALUES.xshift,
          write: buildScopeTransformWriteTarget(scopeId, writable, readOnlyReason, "xshift", transformContext)
        },
        {
          kind: "number",
          id: "yshift",
          label: "Y shift",
          value: transformValues.yshift,
          step: 0.1,
          unit: "pt",
          defaultValue: DEFAULT_TRANSFORM_INSPECTOR_VALUES.yshift,
          write: buildScopeTransformWriteTarget(scopeId, writable, readOnlyReason, "yshift", transformContext)
        },
        {
          kind: "number",
          id: "xscale",
          label: "X scale",
          value: transformValues.xscale,
          step: 0.1,
          defaultValue: DEFAULT_TRANSFORM_INSPECTOR_VALUES.xscale,
          write: buildScopeTransformWriteTarget(scopeId, writable, readOnlyReason, "xscale", transformContext)
        },
        {
          kind: "number",
          id: "yscale",
          label: "Y scale",
          value: transformValues.yscale,
          step: 0.1,
          defaultValue: DEFAULT_TRANSFORM_INSPECTOR_VALUES.yscale,
          write: buildScopeTransformWriteTarget(scopeId, writable, readOnlyReason, "yscale", transformContext)
        },
        {
          kind: "number",
          id: "rotate",
          label: transformRotateInspectorLabel(transformContext),
          value: transformValues.rotate,
          step: 1,
          unit: "deg",
          defaultValue: DEFAULT_TRANSFORM_INSPECTOR_VALUES.rotate,
          write: buildScopeTransformWriteTarget(scopeId, writable, readOnlyReason, "rotate", transformContext)
        }
      ]
    }
  ];

  return {
    elementKind: "scope",
    elementId: scopeId,
    writeTargetId: writable ? scopeId : null,
    readOnlyReason,
    sections
  };
}

export type FrozenInspectorView = {
  selectedSourceIds: string[];
  descriptor: InspectorDescriptor | null;
  multiModel: MultiInspectorModel | null;
  singlePropertyProvenance: InspectorPropertyProvenanceMap;
  multiPropertyProvenance: InspectorPropertyProvenanceMap;
};

type FrozenPropertyProvenanceView = {
  selectedSourceIds: string[];
  perElementPropertyProvenance: InspectorPropertyProvenanceMap[];
  singlePropertyProvenance: InspectorPropertyProvenanceMap;
  multiPropertyProvenance: InspectorPropertyProvenanceMap;
};

export function useInspectorModel(args: {
  selectedIds: ReadonlySet<string>;
  dispatch: (action: EditorAction) => void;
  getInspectorDescriptor: (element: SceneElement, context: InspectorSnapshot) => InspectorDescriptor;
}) {
  const { selectedIds, dispatch, getInspectorDescriptor } = args;
  const [{ source, snapshot }, setSourceSnapshot] = useState(() => {
    const s = useEditorStore.getState();
    return { source: s.source, snapshot: s.snapshot };
  });
  const [{ activeDocumentId, activeFigureId, sourceRevision }, setAnalysisInputs] = useState(() => {
    const s = useEditorStore.getState();
    return {
      activeDocumentId: s.activeDocumentId,
      activeFigureId: s.activeFigureId,
      sourceRevision: s.sourceRevision
    };
  });

  useEffect(() => {
    return useEditorStore.subscribe((s, prev) => {
      const k = s.activeCanvasDragKind;
      if (k === "element" || k === "resize" || k === "rotate" || k === "handle") return;
      if (s.source !== prev.source || s.snapshot !== prev.snapshot) {
        // When the source has changed but the snapshot hasn't caught up yet
        // (snapshot.source !== source), skip the update. The expensive inspector
        // useMemo hooks (descriptors, provenance) would use mismatched sources,
        // causing cache misses and redundant full parses. Wait for SNAPSHOT_READY
        // to bring both into sync, then update in one shot.
        if (s.source !== s.snapshot.source) {
          return;
        }
        setSourceSnapshot({ source: s.source, snapshot: s.snapshot });
      }
    });
  }, []);

  useEffect(() => {
    return useEditorStore.subscribe((s) => {
      const k = s.activeCanvasDragKind;
      if (k === "element" || k === "resize" || k === "rotate" || k === "handle") {
        return;
      }
      if (s.source !== s.snapshot.source) {
        return;
      }
      setAnalysisInputs((current) => {
        if (
          current.activeDocumentId === s.activeDocumentId &&
          current.activeFigureId === s.activeFigureId &&
          current.sourceRevision === s.sourceRevision
        ) {
          return current;
        }
        return {
          activeDocumentId: s.activeDocumentId,
          activeFigureId: s.activeFigureId,
          sourceRevision: s.sourceRevision
        };
      });
    });
  }, []);

  const rawSelectedSourceIds = useMemo(() => [...selectedIds], [selectedIds]);
  const selectedSourceIds = rawSelectedSourceIds;
  const selectedSourceIdSet = useMemo(() => new Set(selectedSourceIds), [selectedSourceIds]);
  const activeCanvasDragKind = useEditorStore((s) => s.activeCanvasDragKind);
  const projectNamedColorSwatches = useProjectNamedColorSwatches();
  const freezePropertyProvenance =
    activeCanvasDragKind === "element" ||
    activeCanvasDragKind === "resize" ||
    activeCanvasDragKind === "rotate" ||
    activeCanvasDragKind === "handle";
  const frozenPropertyProvenanceRef = useRef<FrozenPropertyProvenanceView | null>(null);
  const editAnalysisView = useMemo(
    () =>
      getSharedEditAnalysisView({
        documentId: activeDocumentId,
        sourceRevision,
        source,
        activeFigureId,
        snapshot
      }),
    [activeDocumentId, activeFigureId, snapshot, source, sourceRevision]
  );
  const parseOptions = useMemo(
    () => ({
      activeFigureId,
      analysisView: editAnalysisView,
      analysisSession: getSharedEditAnalysisSession(),
      colorAliases: snapshot.semanticResult?.colorAliases ?? null
    }),
    [activeFigureId, editAnalysisView, snapshot.semanticResult]
  );
  const globalTransformValues = useMemo(
    () => resolveTransformInspectorValues(source, TIKZPICTURE_GLOBAL_TARGET_ID, parseOptions),
    [parseOptions, source]
  );
  const figureBoundsState = useMemo(
    () => resolveFigureBoundsState(source, parseOptions),
    [parseOptions, source]
  );

  const selectedElementBySourceId = useMemo(() => {
    const bySource = new Map<string, SceneElement>();
    const bestPriorityBySource = new Map<string, number>();
    for (const element of snapshot.scene?.elements ?? []) {
      const targetId = element.adornment?.targetId ?? element.sourceRef.sourceId;
      if (!selectedSourceIdSet.has(targetId)) {
        continue;
      }
      const priority = inspectorElementPriority(targetId, element);
      const existingPriority = bestPriorityBySource.get(targetId);
      if (existingPriority != null && priority >= existingPriority) {
        continue;
      }
      bestPriorityBySource.set(targetId, priority);
      bySource.set(targetId, element);
    }

    return bySource;
  }, [selectedSourceIdSet, snapshot.scene]);

  const selectedElements = useMemo(() => {
    return selectedSourceIds
      .map((sourceId) => selectedElementBySourceId.get(sourceId))
      .filter((element): element is SceneElement => element != null);
  }, [selectedElementBySourceId, selectedSourceIds]);

  const descriptorEntries = useMemo(() => {
    return selectedSourceIds.map((sourceId) => {
      const matrixDescriptor = buildMatrixInspectorDescriptor(snapshot.source, sourceId, parseOptions);
      if (matrixDescriptor) {
        return matrixDescriptor;
      }

      const selectedElement = selectedElementBySourceId.get(sourceId) ?? null;
      const treeDescriptor = buildTreeInspectorDescriptor(snapshot.source, sourceId, selectedElement, parseOptions);
      if (treeDescriptor) {
        return treeDescriptor;
      }

      if (sourceId.startsWith("scope:")) {
        return buildScopeInspectorDescriptor(snapshot.source, sourceId, parseOptions);
      }

      const element = selectedElement;
      if (!element) {
        return null;
      }

      return getInspectorDescriptor(element, {
        source: snapshot.source,
        editHandles: snapshot.editHandles,
        parseOptions
      });
    });
  }, [getInspectorDescriptor, parseOptions, selectedElementBySourceId, selectedSourceIds, snapshot.editHandles, snapshot.source]);

  const descriptors = useMemo(() => {
    return descriptorEntries.filter((entry): entry is InspectorDescriptor => entry != null);
  }, [descriptorEntries]);

  const descriptor = selectedSourceIds.length === 1 ? descriptorEntries[0] ?? null : null;

  const multiModel = useMemo(() => {
    if (selectedSourceIds.length <= 1) {
      return null;
    }
    return buildMultiInspectorModel(descriptors, selectedSourceIds.length);
  }, [descriptors, selectedSourceIds.length]);

  const canReuseFrozenPropertyProvenance =
    freezePropertyProvenance &&
    frozenPropertyProvenanceRef.current != null &&
    sameOrderedStringArrays(frozenPropertyProvenanceRef.current.selectedSourceIds, selectedSourceIds);

  const perElementPropertyProvenance = useMemo<InspectorPropertyProvenanceMap[]>(() => {
    if (canReuseFrozenPropertyProvenance) {
      return frozenPropertyProvenanceRef.current?.perElementPropertyProvenance ?? [];
    }
    return selectedSourceIds.map((sourceId, index) => {
      const element = selectedElementBySourceId.get(sourceId);
      const elementDescriptor = descriptorEntries[index];
      if (!element || !elementDescriptor) {
        return {};
      }
      const cascadeModel = buildStylesCascadeModel(
        element,
        {
          source: snapshot.source,
          editHandles: snapshot.editHandles,
          parseOptions
        },
        elementDescriptor
      );
      return buildInspectorPropertyProvenanceMap(cascadeModel);
    });
  }, [
    canReuseFrozenPropertyProvenance,
    descriptorEntries,
    parseOptions,
    selectedElementBySourceId,
    selectedSourceIds,
    snapshot.editHandles,
    snapshot.source
  ]);

  const singlePropertyProvenance = useMemo<InspectorPropertyProvenanceMap>(() => {
    if (selectedSourceIds.length !== 1) {
      return {};
    }
    return perElementPropertyProvenance[0] ?? {};
  }, [perElementPropertyProvenance, selectedSourceIds.length]);

  const multiPropertyProvenance = useMemo<InspectorPropertyProvenanceMap>(() => {
    return buildMultiInspectorPropertyProvenanceMap(
      multiModel,
      perElementPropertyProvenance,
      selectedSourceIds.length
    );
  }, [multiModel, perElementPropertyProvenance, selectedSourceIds.length]);

  const [frozenInspectorView, setFrozenInspectorView] = useState<FrozenInspectorView | null>(null);

  useEffect(() => {
    if (freezePropertyProvenance) {
      return;
    }
    const current = frozenPropertyProvenanceRef.current;
    if (
      current &&
      sameOrderedStringArrays(current.selectedSourceIds, selectedSourceIds) &&
      current.perElementPropertyProvenance === perElementPropertyProvenance &&
      current.singlePropertyProvenance === singlePropertyProvenance &&
      current.multiPropertyProvenance === multiPropertyProvenance
    ) {
      return;
    }
    frozenPropertyProvenanceRef.current = {
      selectedSourceIds: [...selectedSourceIds],
      perElementPropertyProvenance,
      singlePropertyProvenance,
      multiPropertyProvenance
    };
  }, [
    freezePropertyProvenance,
    multiPropertyProvenance,
    perElementPropertyProvenance,
    selectedSourceIds,
    singlePropertyProvenance
  ]);

  const usingFrozenInspectorView =
    frozenInspectorView != null &&
    sameOrderedStringArrays(frozenInspectorView.selectedSourceIds, selectedSourceIds);
  const renderedDescriptor = usingFrozenInspectorView
    ? frozenInspectorView.descriptor
    : descriptor;
  const renderedMultiModel = usingFrozenInspectorView
    ? frozenInspectorView.multiModel
    : multiModel;
  const renderedSinglePropertyProvenance = usingFrozenInspectorView
    ? frozenInspectorView.singlePropertyProvenance
    : singlePropertyProvenance;
  const renderedMultiPropertyProvenance = usingFrozenInspectorView
    ? frozenInspectorView.multiPropertyProvenance
    : multiPropertyProvenance;

  const commandContext = useMemo(
    () => ({
      source,
      activeFigureId,
      parseOptions,
      snapshotSource: snapshot.source,
      scene: snapshot.scene,
      editHandles: snapshot.editHandles,
      selectedElementIds: selectedSourceIdSet,
      dispatch
    }),
    [activeFigureId, dispatch, parseOptions, selectedSourceIdSet, snapshot.editHandles, snapshot.scene, snapshot.source, source]
  );
  const arrangeAvailability = useMemo(
    () => actionAvailability(commandContext),
    [commandContext]
  );

  return {
    source,
    snapshot,
    selectedSourceIds,
    projectNamedColorSwatches,
    globalTransformValues,
    figureBoundsState,
    selectedElements,
    descriptors,
    descriptor,
    multiModel,
    singlePropertyProvenance,
    multiPropertyProvenance,
    renderedDescriptor,
    renderedMultiModel,
    renderedSinglePropertyProvenance,
    renderedMultiPropertyProvenance,
    commandContext,
    arrangeAvailability,
    frozenInspectorView,
    setFrozenInspectorView
  };
}

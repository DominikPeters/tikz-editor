import type { EditAction } from "@tikz-editor/core/edit/actions";
import { useCallback, useRef } from "react";
import type {
  ArrowTipPresetId,
  ArrowTipSide,
  DashStylePresetId,
  FillModePresetId,
  FillPatternMetaOptionKey,
  FillPatternPresetId,
  FillShadingPresetId,
  InspectorPaintToggle,
  LineCapPresetId,
  LineJoinPresetId,
  NodeFontFamilyId,
  NodeFontSizePresetId,
  NodeShapePresetId,
  PathMorphingDecorationPresetId,
  SetPropertyWriteTarget
} from "@tikz-editor/core/edit/inspector";
import {
  buildArrowTipSetPropertyMutation,
  buildDashStyleSetPropertyMutation,
  buildFillModeSetPropertyMutations,
  buildFillPatternOptionSetPropertyMutation,
  buildFillPatternSetPropertyMutation,
  buildFillShadingSetPropertyMutations,
  buildLineCapSetPropertyMutation,
  buildLineJoinSetPropertyMutation,
  buildNodeFontSetPropertyMutation,
  buildNodeInnerSepSetPropertyMutation,
  buildNodeShapeSetPropertyMutation,
  buildPathMorphingDecorationSetPropertyMutations,
  buildRoundedCornersSetPropertyMutation,
  type ArrowTipWriteTarget,
  type FillPatternOptionMutationContext,
  type NodeFontMutationContext
} from "@tikz-editor/core/edit/property-write-builders";
import { buildPropertyMutations, propertyIdForWriteKey, type PropertyWriteMutation } from "@tikz-editor/core/edit/property-registry";
import { documentDiffPatch } from "@tikz-editor/core/edit/patch";
import { useEditorStore } from "../../store/store";
import type { EditorAction } from "../../store/types";

export type ApplySetPropertyOptions = {
  key?: string;
  propertyId?: SetPropertyWriteTarget["propertyId"];
  clearKeys?: string[];
  recordInHistory?: boolean;
};

type RememberedPaint = {
  mutations: readonly PropertyWriteMutation[];
  /** The source just after the checkbox switched the paint off, and just before. */
  exact: { documentId: string; revision: number; source: string; restoreSource: string };
};

function dispatchPaintWrites(
  dispatch: (action: EditorAction) => void,
  writes: ReadonlyArray<readonly [InspectorPaintToggle, readonly PropertyWriteMutation[]]>,
  options: ApplySetPropertyOptions
): void {
  const actions: Extract<EditAction, { kind: "setProperty" }>[] = writes.flatMap(([{ write }, mutations]) =>
    mutations.map((mutation) => ({
      kind: "setProperty" as const,
      elementId: write.elementId,
      level: write.level,
      key: mutation.key,
      value: mutation.value,
      ...(mutation.propertyId === undefined ? {} : { propertyId: mutation.propertyId }),
      ...(mutation.clearKeys === undefined ? {} : { clearKeys: mutation.clearKeys })
    }))
  );
  if (actions.length > 0) dispatch({ type: "APPLY_EDIT_ACTION", ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory }), action: { kind: "setProperties", actions } });
}

export function useInspectorMutations(dispatch: (action: EditorAction) => void) {
  // The paint a Stroke/Fill checkbox switched off, by element, so switching it
  // back on in this session restores it instead of a plain `draw` / `fill`.
  // While nothing else has changed the source, the exact earlier text comes
  // back; after other edits, the remembered writes bring the paint back.
  const rememberedPaint = useRef(new Map<string, RememberedPaint>());

  const applyPaintToggle = useCallback((
    toggles: readonly InspectorPaintToggle[],
    enabled: boolean,
    options: ApplySetPropertyOptions = {}
  ): void => {
    const changing = toggles.filter((toggle) =>
      toggle.write.writable && toggle.write.elementId.length > 0 && toggle.enabled !== enabled
    );
    if (changing.length === 0) return;
    const memoryKey = (toggle: InspectorPaintToggle) => `${toggle.write.elementId}:${toggle.paint}`;
    const before = useEditorStore.getState();

    if (enabled) {
      const remembered = changing.map((toggle) => rememberedPaint.current.get(memoryKey(toggle)));
      for (const toggle of changing) rememberedPaint.current.delete(memoryKey(toggle));
      const exact = remembered[0]?.exact;
      if (
        exact
        && remembered.every((entry) => entry?.exact === exact)
        && exact.documentId === before.activeDocumentId
        && exact.revision === before.sourceRevision
        && exact.source === before.source
      ) {
        dispatch({
          type: "APPLY_SOURCE_PATCHES",
          documentId: exact.documentId,
          baseRevision: exact.revision,
          patches: [documentDiffPatch(exact.source, exact.restoreSource)],
          changedSourceIds: changing.map((toggle) => toggle.write.elementId)
        });
        return;
      }
      dispatchPaintWrites(dispatch, changing.map((toggle, index) => [toggle, remembered[index]?.mutations ?? toggle.enable]), options);
      return;
    }

    dispatchPaintWrites(dispatch, changing.map((toggle) => [toggle, toggle.disable]), options);
    const after = useEditorStore.getState();
    if (after.sourceRevision === before.sourceRevision) return;
    const exact = { documentId: after.activeDocumentId, revision: after.sourceRevision, source: after.source, restoreSource: before.source };
    for (const toggle of changing) {
      rememberedPaint.current.set(memoryKey(toggle), { mutations: toggle.restore.length > 0 ? toggle.restore : toggle.enable, exact });
    }
  }, [dispatch]);

  const applySetProperty = useCallback(
    (
      write: SetPropertyWriteTarget,
      value: string,
      options: ApplySetPropertyOptions = {}
    ): void => {
      if (!write.writable || write.elementId.length === 0) return;
      const resolvedPropertyId = options.propertyId ?? (options.key ? propertyIdForWriteKey(options.key) ?? undefined : write.propertyId);
      const [mutation] = buildPropertyMutations({
        ...(resolvedPropertyId == null ? {} : { propertyId: resolvedPropertyId }),
        key: options.key ?? write.key,
        value,
        ...(options.clearKeys === undefined ? {} : { clearKeys: options.clearKeys })
      });
      if (!mutation) return;
      dispatch({
        type: "APPLY_EDIT_ACTION",
        ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory }),
        action: {
          kind: "setProperty",
          elementId: write.elementId,
          level: write.level,
          key: mutation.key,
          value: mutation.value,
          ...(mutation.propertyId === undefined ? {} : { propertyId: mutation.propertyId }),
          ...(mutation.clearKeys === undefined ? {} : { clearKeys: mutation.clearKeys })
        }
      });
    },
    [dispatch]
  );

  const applySetPropertyMany = useCallback(
    (
      writes: readonly SetPropertyWriteTarget[],
      value: string,
      options: ApplySetPropertyOptions = {}
    ): void => {
      const writable = writes.filter((write) => write.writable && write.elementId.length > 0);
      if (writable.length === 0) {
        return;
      }

      const actions: Extract<EditAction, { kind: "setProperty" }>[] = [];
      for (const write of writable) {
        const resolvedPropertyId = options.propertyId ?? (options.key ? propertyIdForWriteKey(options.key) ?? undefined : write.propertyId);
        const [mutation] = buildPropertyMutations({
          ...(resolvedPropertyId == null ? {} : { propertyId: resolvedPropertyId }),
          key: options.key ?? write.key,
          value,
          ...(options.clearKeys === undefined ? {} : { clearKeys: options.clearKeys })
        });
        if (!mutation) {
          continue;
        }
        actions.push({
          kind: "setProperty",
          elementId: write.elementId,
          level: write.level,
          key: mutation.key,
          value: mutation.value,
          ...(mutation.propertyId === undefined ? {} : { propertyId: mutation.propertyId }),
          ...(mutation.clearKeys === undefined ? {} : { clearKeys: mutation.clearKeys })
        });
      }
      if (actions.length > 0) dispatch({ type: "APPLY_EDIT_ACTION", ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory }), action: { kind: "setProperties", actions } });
    },
    [dispatch]
  );

  const colorSyntaxClearKeys = useCallback((syntaxValue: string | null): string[] | undefined => {
    const normalized = syntaxValue?.trim() ?? "";
    return normalized.length > 0 ? [normalized] : undefined;
  }, []);

  const normalizeColorSetPropertyChange = useCallback((
    write: SetPropertyWriteTarget,
    nextValue: string,
    syntaxValue: string | null
  ): { value: string; clearKeys?: string[] } => {
    if (write.key === "text" && nextValue === "none") {
      const clearKeySet = new Set<string>(["text", "text color"]);
      for (const key of colorSyntaxClearKeys(syntaxValue) ?? []) {
        clearKeySet.add(key);
      }
      return {
        value: "",
        clearKeys: [...clearKeySet]
      };
    }
    if (nextValue === "none" && write.clearOnNoneKeys) {
      return {
        value: "",
        clearKeys: write.clearOnNoneKeys
      };
    }

    const clearKeys = colorSyntaxClearKeys(syntaxValue);
    return { value: nextValue, ...(clearKeys === undefined ? {} : { clearKeys }) };
  }, [colorSyntaxClearKeys]);

  const applyArrowTipValue = useCallback((
    write: ArrowTipWriteTarget,
    side: ArrowTipSide,
    value: Exclude<ArrowTipPresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void => {
    const mutation = buildArrowTipSetPropertyMutation(write.arrowContext, side, value);
    applySetProperty(write, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory })
    });
  }, [applySetProperty]);

  const applyArrowTipValueMany = useCallback((
    writes: readonly ArrowTipWriteTarget[],
    side: ArrowTipSide,
    value: Exclude<ArrowTipPresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void => {
    const writable = writes.filter((write) => write.writable && write.elementId.length > 0);
    if (writable.length === 0) {
      return;
    }

    const actions: Extract<EditAction, { kind: "setProperty" }>[] = [];
    for (const write of writable) {
      const mutation = buildArrowTipSetPropertyMutation(write.arrowContext, side, value);
      actions.push({
        kind: "setProperty",
        elementId: write.elementId,
        level: write.level,
        key: mutation.key,
        value: mutation.value,
        clearKeys: mutation.clearKeys
      });
    }
    if (actions.length > 0) dispatch({ type: "APPLY_EDIT_ACTION", ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory }), action: { kind: "setProperties", actions } });
  }, [dispatch]);

  const applyDashStyleValue = useCallback((
    write: SetPropertyWriteTarget,
    value: Exclude<DashStylePresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void => {
    const mutation = buildDashStyleSetPropertyMutation(value);
    applySetProperty(write, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory })
    });
  }, [applySetProperty]);

  const applyDashStyleValueMany = useCallback((
    writes: readonly SetPropertyWriteTarget[],
    value: Exclude<DashStylePresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void => {
    const mutation = buildDashStyleSetPropertyMutation(value);
    applySetPropertyMany(writes, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory })
    });
  }, [applySetPropertyMany]);

  const applyLineCapValue = useCallback((
    write: SetPropertyWriteTarget,
    value: Exclude<LineCapPresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void => {
    const mutation = buildLineCapSetPropertyMutation(value);
    applySetProperty(write, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory })
    });
  }, [applySetProperty]);

  const applyLineCapValueMany = useCallback((
    writes: readonly SetPropertyWriteTarget[],
    value: Exclude<LineCapPresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void => {
    const mutation = buildLineCapSetPropertyMutation(value);
    applySetPropertyMany(writes, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory })
    });
  }, [applySetPropertyMany]);

  const applyLineJoinValue = useCallback((
    write: SetPropertyWriteTarget,
    value: Exclude<LineJoinPresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void => {
    const mutation = buildLineJoinSetPropertyMutation(value);
    applySetProperty(write, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory })
    });
  }, [applySetProperty]);

  const applyLineJoinValueMany = useCallback((
    writes: readonly SetPropertyWriteTarget[],
    value: Exclude<LineJoinPresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void => {
    const mutation = buildLineJoinSetPropertyMutation(value);
    applySetPropertyMany(writes, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory })
    });
  }, [applySetPropertyMany]);

  const applyFillModeValue = useCallback((
    write: SetPropertyWriteTarget,
    value: Exclude<FillModePresetId, "custom">,
    context: {
      fillColor: string | null;
      patternColor: string | null;
      shading: FillShadingPresetId;
      pattern: FillPatternPresetId;
    },
    options: ApplySetPropertyOptions = {}
  ): void => {
    if (!write.writable || write.elementId.length === 0) {
      return;
    }

    const mutations = buildFillModeSetPropertyMutations(value, context);
    if (mutations.length === 0) {
      return;
    }

    const actions: Extract<EditAction, { kind: "setProperty" }>[] = [];
    for (const mutation of mutations) {
      actions.push({
        kind: "setProperty",
        elementId: write.elementId,
        level: write.level,
        key: mutation.key,
        value: mutation.value,
        clearKeys: mutation.clearKeys
      });
    }
    if (actions.length > 0) dispatch({ type: "APPLY_EDIT_ACTION", ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory }), action: { kind: "setProperties", actions } });
  }, [dispatch]);

  const applyFillModeValueMany = useCallback((
    writes: readonly SetPropertyWriteTarget[],
    value: Exclude<FillModePresetId, "custom">,
    contexts: ReadonlyArray<{
      fillColor: string | null;
      patternColor: string | null;
      shading: FillShadingPresetId;
      pattern: FillPatternPresetId;
    }>,
    options: ApplySetPropertyOptions = {}
  ): void => {
    const writableWrites = writes
      .map((write, index) => ({ write, context: contexts[index] }))
      .filter(
        (entry): entry is { write: SetPropertyWriteTarget; context: NonNullable<(typeof contexts)[number]> } =>
          entry.write.writable && entry.write.elementId.length > 0 && entry.context != null
      );

    if (writableWrites.length === 0) {
      return;
    }

    const actions: Extract<EditAction, { kind: "setProperty" }>[] = [];
    for (const { write, context } of writableWrites) {
      const mutations = buildFillModeSetPropertyMutations(value, context);
      for (const mutation of mutations) {
        actions.push({
          kind: "setProperty",
          elementId: write.elementId,
          level: write.level,
          key: mutation.key,
          value: mutation.value,
          clearKeys: mutation.clearKeys
        });
      }
    }
    if (actions.length > 0) dispatch({ type: "APPLY_EDIT_ACTION", ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory }), action: { kind: "setProperties", actions } });
  }, [dispatch]);

  const applyFillShadingValue = useCallback((
    write: SetPropertyWriteTarget,
    value: Exclude<FillShadingPresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void => {
    if (!write.writable || write.elementId.length === 0) {
      return;
    }
    const mutations = buildFillShadingSetPropertyMutations(value);
    if (mutations.length === 0) {
      return;
    }
    const actions: Extract<EditAction, { kind: "setProperty" }>[] = [];
    for (const mutation of mutations) {
      actions.push({
        kind: "setProperty",
        elementId: write.elementId,
        level: write.level,
        key: mutation.key,
        value: mutation.value,
        clearKeys: mutation.clearKeys
      });
    }
    if (actions.length > 0) dispatch({ type: "APPLY_EDIT_ACTION", ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory }), action: { kind: "setProperties", actions } });
  }, [dispatch]);

  const applyFillShadingValueMany = useCallback((
    writes: readonly SetPropertyWriteTarget[],
    value: Exclude<FillShadingPresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void => {
    const writable = writes.filter((write) => write.writable && write.elementId.length > 0);
    if (writable.length === 0) {
      return;
    }
    const mutations = buildFillShadingSetPropertyMutations(value);
    if (mutations.length === 0) {
      return;
    }

    const actions: Extract<EditAction, { kind: "setProperty" }>[] = [];
    for (const write of writable) {
      for (const mutation of mutations) {
        actions.push({
          kind: "setProperty",
          elementId: write.elementId,
          level: write.level,
          key: mutation.key,
          value: mutation.value,
          clearKeys: mutation.clearKeys
        });
      }
    }
    if (actions.length > 0) dispatch({ type: "APPLY_EDIT_ACTION", ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory }), action: { kind: "setProperties", actions } });
  }, [dispatch]);

  const applyFillPatternValue = useCallback((
    write: SetPropertyWriteTarget,
    value: Exclude<FillPatternPresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void => {
    const mutation = buildFillPatternSetPropertyMutation(value);
    applySetProperty(write, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory })
    });
  }, [applySetProperty]);

  const applyFillPatternValueMany = useCallback((
    writes: readonly SetPropertyWriteTarget[],
    value: Exclude<FillPatternPresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void => {
    const mutation = buildFillPatternSetPropertyMutation(value);
    applySetPropertyMany(writes, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory })
    });
  }, [applySetPropertyMany]);

  const applyFillPatternOptionValue = useCallback((
    write: SetPropertyWriteTarget,
    option: FillPatternMetaOptionKey,
    value: number,
    context: FillPatternOptionMutationContext,
    options: ApplySetPropertyOptions = {}
  ): void => {
    const mutation = buildFillPatternOptionSetPropertyMutation(context, option, value);
    applySetProperty(write, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory })
    });
  }, [applySetProperty]);

  const applyFillPatternOptionValueMany = useCallback((
    writes: readonly SetPropertyWriteTarget[],
    option: FillPatternMetaOptionKey,
    value: number,
    contexts: readonly FillPatternOptionMutationContext[],
    options: ApplySetPropertyOptions = {}
  ): void => {
    const writableEntries = writes
      .map((write, index) => {
        const context = contexts[index];
        return context ? { write, context } : null;
      })
      .filter(
        (entry): entry is { write: SetPropertyWriteTarget; context: FillPatternOptionMutationContext } =>
          entry != null && entry.write.writable && entry.write.elementId.length > 0
      );
    if (writableEntries.length === 0) {
      return;
    }

    const actions: Extract<EditAction, { kind: "setProperty" }>[] = [];
    for (const entry of writableEntries) {
      const mutation = buildFillPatternOptionSetPropertyMutation(entry.context, option, value);
      actions.push({
        kind: "setProperty",
        elementId: entry.write.elementId,
        level: entry.write.level,
        key: mutation.key,
        value: mutation.value,
        clearKeys: mutation.clearKeys
      });
    }
    if (actions.length > 0) dispatch({ type: "APPLY_EDIT_ACTION", ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory }), action: { kind: "setProperties", actions } });
  }, [dispatch]);

  const applyPathMorphingDecorationValue = useCallback((
    write: SetPropertyWriteTarget,
    value: Exclude<PathMorphingDecorationPresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void => {
    if (!write.writable || write.elementId.length === 0) {
      return;
    }
    const mutations = buildPathMorphingDecorationSetPropertyMutations(value);
    if (mutations.length === 0) {
      return;
    }

    const actions: Extract<EditAction, { kind: "setProperty" }>[] = [];
    for (const mutation of mutations) {
      actions.push({
        kind: "setProperty",
        elementId: write.elementId,
        level: write.level,
        key: mutation.key,
        value: mutation.value,
        clearKeys: mutation.clearKeys
      });
    }
    if (actions.length > 0) dispatch({ type: "APPLY_EDIT_ACTION", ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory }), action: { kind: "setProperties", actions } });
  }, [dispatch]);

  const applyPathMorphingDecorationValueMany = useCallback((
    writes: readonly SetPropertyWriteTarget[],
    value: Exclude<PathMorphingDecorationPresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void => {
    const writable = writes.filter((write) => write.writable && write.elementId.length > 0);
    if (writable.length === 0) {
      return;
    }

    const mutations = buildPathMorphingDecorationSetPropertyMutations(value);
    if (mutations.length === 0) {
      return;
    }

    const actions: Extract<EditAction, { kind: "setProperty" }>[] = [];
    for (const write of writable) {
      for (const mutation of mutations) {
        actions.push({
          kind: "setProperty",
          elementId: write.elementId,
          level: write.level,
          key: mutation.key,
          value: mutation.value,
          clearKeys: mutation.clearKeys
        });
      }
    }
    if (actions.length > 0) dispatch({ type: "APPLY_EDIT_ACTION", ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory }), action: { kind: "setProperties", actions } });
  }, [dispatch]);

  const applyRoundedCornersValue = useCallback((
    write: SetPropertyWriteTarget,
    enabled: boolean,
    radius: number,
    disableRequiresSharpCorners = true,
    options: ApplySetPropertyOptions = {}
  ): void => {
    const mutation = buildRoundedCornersSetPropertyMutation(enabled, radius, disableRequiresSharpCorners);
    applySetProperty(write, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory })
    });
  }, [applySetProperty]);

  const applyRoundedCornersValueMany = useCallback((
    writes: readonly SetPropertyWriteTarget[],
    enabled: boolean,
    radius: number,
    disableRequiresSharpCorners = true,
    options: ApplySetPropertyOptions = {}
  ): void => {
    const mutation = buildRoundedCornersSetPropertyMutation(enabled, radius, disableRequiresSharpCorners);
    applySetPropertyMany(writes, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory })
    });
  }, [applySetPropertyMany]);

  const applyNodeShapeValue = useCallback((
    write: SetPropertyWriteTarget,
    value: Exclude<NodeShapePresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void => {
    const mutation = buildNodeShapeSetPropertyMutation(value);
    applySetProperty(write, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory })
    });
  }, [applySetProperty]);

  const applyNodeShapeValueMany = useCallback((
    writes: readonly SetPropertyWriteTarget[],
    value: Exclude<NodeShapePresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void => {
    const mutation = buildNodeShapeSetPropertyMutation(value);
    applySetPropertyMany(writes, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory })
    });
  }, [applySetPropertyMany]);

  const applyNodeInnerSepValue = useCallback((
    write: SetPropertyWriteTarget,
    value: number,
    options: ApplySetPropertyOptions = {}
  ): void => {
    const mutation = buildNodeInnerSepSetPropertyMutation(value);
    applySetProperty(write, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory })
    });
  }, [applySetProperty]);

  const applyNodeInnerSepValueMany = useCallback((
    writes: readonly SetPropertyWriteTarget[],
    value: number,
    options: ApplySetPropertyOptions = {}
  ): void => {
    const mutation = buildNodeInnerSepSetPropertyMutation(value);
    applySetPropertyMany(writes, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory })
    });
  }, [applySetPropertyMany]);

  const applyNodeFontValue = useCallback((
    write: SetPropertyWriteTarget,
    context: NodeFontMutationContext,
    values: {
      family: NodeFontFamilyId;
      weight: "normal" | "bold";
      style: "normal" | "italic";
      sizePreset: NodeFontSizePresetId;
      customSizePt: number | null;
    },
    options: ApplySetPropertyOptions = {}
  ): void => {
    const mutation = buildNodeFontSetPropertyMutation(context, values);
    applySetProperty(write, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory })
    });
  }, [applySetProperty]);

  const applyNodeFontValueMany = useCallback((
    writes: readonly SetPropertyWriteTarget[],
    contexts: ReadonlyArray<{
      context: NodeFontMutationContext;
      values: {
        family: NodeFontFamilyId;
        weight: "normal" | "bold";
        style: "normal" | "italic";
        sizePreset: NodeFontSizePresetId;
        customSizePt: number | null;
      };
    }>,
    nextValues: Partial<{
      family: NodeFontFamilyId;
      weight: "normal" | "bold";
      style: "normal" | "italic";
      sizePreset: NodeFontSizePresetId;
      customSizePt: number | null;
    }>,
    options: ApplySetPropertyOptions = {}
  ): void => {
    const writableEntries = writes
      .map((write, index) => {
        const context = contexts[index];
        return context ? { write, context } : null;
      })
      .filter(
        (
          entry
        ): entry is {
          write: SetPropertyWriteTarget;
          context: {
            context: NodeFontMutationContext;
            values: {
              family: NodeFontFamilyId;
              weight: "normal" | "bold";
              style: "normal" | "italic";
              sizePreset: NodeFontSizePresetId;
              customSizePt: number | null;
            };
          };
        } => entry != null && entry.write.writable && entry.write.elementId.length > 0
      );

    if (writableEntries.length === 0) {
      return;
    }

    const actions: Extract<EditAction, { kind: "setProperty" }>[] = [];
    for (const entry of writableEntries) {
      const mutation = buildNodeFontSetPropertyMutation(entry.context.context, {
        ...entry.context.values,
        ...nextValues
      });
      actions.push({
        kind: "setProperty",
        elementId: entry.write.elementId,
        level: entry.write.level,
        key: mutation.key,
        value: mutation.value,
        clearKeys: mutation.clearKeys
      });
    }
    if (actions.length > 0) dispatch({ type: "APPLY_EDIT_ACTION", ...(options.recordInHistory === undefined ? {} : { recordInHistory: options.recordInHistory }), action: { kind: "setProperties", actions } });
  }, [dispatch]);

  return {
    applyPaintToggle,
    applySetProperty,
    applySetPropertyMany,
    normalizeColorSetPropertyChange,
    applyArrowTipValue,
    applyArrowTipValueMany,
    applyDashStyleValue,
    applyDashStyleValueMany,
    applyLineCapValue,
    applyLineCapValueMany,
    applyLineJoinValue,
    applyLineJoinValueMany,
    applyFillModeValue,
    applyFillModeValueMany,
    applyFillShadingValue,
    applyFillShadingValueMany,
    applyFillPatternValue,
    applyFillPatternValueMany,
    applyFillPatternOptionValue,
    applyFillPatternOptionValueMany,
    applyPathMorphingDecorationValue,
    applyPathMorphingDecorationValueMany,
    applyRoundedCornersValue,
    applyRoundedCornersValueMany,
    applyNodeShapeValue,
    applyNodeShapeValueMany,
    applyNodeInnerSepValue,
    applyNodeInnerSepValueMany,
    applyNodeFontValue,
    applyNodeFontValueMany
  };
}

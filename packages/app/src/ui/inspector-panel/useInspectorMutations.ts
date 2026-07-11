import { useCallback } from "react";
import type {
  ArrowTipPresetId,
  ArrowTipSide,
  DashStylePresetId,
  FillModePresetId,
  FillPatternMetaOptionKey,
  FillPatternPresetId,
  FillShadingPresetId,
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
import { buildPropertyMutations, propertyIdForWriteKey } from "@tikz-editor/core/edit/property-registry";
import type { EditorAction } from "../../store/types";

export type ApplySetPropertyOptions = {
  key?: string;
  propertyId?: SetPropertyWriteTarget["propertyId"];
  clearKeys?: string[];
  recordInHistory?: boolean;
};

export function useInspectorMutations(dispatch: (action: EditorAction) => void) {
  const applySetProperty = useCallback(
    (
      write: SetPropertyWriteTarget,
      value: string,
      options: ApplySetPropertyOptions = {}
    ): void => {
      if (!write.writable || write.elementId.length === 0) return;
      const [mutation] = buildPropertyMutations({
        propertyId: options.propertyId ?? (options.key ? propertyIdForWriteKey(options.key) ?? undefined : write.propertyId),
        key: options.key ?? write.key,
        value,
        clearKeys: options.clearKeys
      });
      if (!mutation) return;
      dispatch({
        type: "APPLY_EDIT_ACTION",
        recordInHistory: options.recordInHistory,
        action: {
          kind: "setProperty",
          elementId: write.elementId,
          level: write.level,
          key: mutation.key,
          value: mutation.value,
          propertyId: mutation.propertyId,
          clearKeys: mutation.clearKeys
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

      const mergeKey = options.recordInHistory === false ? undefined : `multi-set:${Date.now().toString(36)}`;
      for (const write of writable) {
        const [mutation] = buildPropertyMutations({
          propertyId: options.propertyId ?? (options.key ? propertyIdForWriteKey(options.key) ?? undefined : write.propertyId),
          key: options.key ?? write.key,
          value,
          clearKeys: options.clearKeys
        });
        if (!mutation) {
          continue;
        }
        dispatch({
          type: "APPLY_EDIT_ACTION",
          historyMergeKey: mergeKey,
          recordInHistory: options.recordInHistory,
          action: {
            kind: "setProperty",
            elementId: write.elementId,
            level: write.level,
            key: mutation.key,
            value: mutation.value,
            propertyId: mutation.propertyId,
            clearKeys: mutation.clearKeys
          }
        });
      }
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

    return {
      value: nextValue,
      clearKeys: colorSyntaxClearKeys(syntaxValue)
    };
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
      recordInHistory: options.recordInHistory
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

    const mergeKey = options.recordInHistory === false ? undefined : `multi-set:${Date.now().toString(36)}`;
    for (const write of writable) {
      const mutation = buildArrowTipSetPropertyMutation(write.arrowContext, side, value);
      dispatch({
        type: "APPLY_EDIT_ACTION",
        historyMergeKey: mergeKey,
        recordInHistory: options.recordInHistory,
        action: {
          kind: "setProperty",
          elementId: write.elementId,
          level: write.level,
          key: mutation.key,
          value: mutation.value,
          clearKeys: mutation.clearKeys
        }
      });
    }
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
      recordInHistory: options.recordInHistory
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
      recordInHistory: options.recordInHistory
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
      recordInHistory: options.recordInHistory
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
      recordInHistory: options.recordInHistory
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
      recordInHistory: options.recordInHistory
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
      recordInHistory: options.recordInHistory
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

    const mergeKey = options.recordInHistory === false ? undefined : `multi-set:${Date.now().toString(36)}`;
    for (const mutation of mutations) {
      dispatch({
        type: "APPLY_EDIT_ACTION",
        historyMergeKey: mergeKey,
        recordInHistory: options.recordInHistory,
        action: {
          kind: "setProperty",
          elementId: write.elementId,
          level: write.level,
          key: mutation.key,
          value: mutation.value,
          clearKeys: mutation.clearKeys
        }
      });
    }
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

    const mergeKey = options.recordInHistory === false ? undefined : `multi-set:${Date.now().toString(36)}`;
    for (const { write, context } of writableWrites) {
      const mutations = buildFillModeSetPropertyMutations(value, context);
      for (const mutation of mutations) {
        dispatch({
          type: "APPLY_EDIT_ACTION",
          historyMergeKey: mergeKey,
          recordInHistory: options.recordInHistory,
          action: {
            kind: "setProperty",
            elementId: write.elementId,
            level: write.level,
            key: mutation.key,
            value: mutation.value,
            clearKeys: mutation.clearKeys
          }
        });
      }
    }
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
    const mergeKey = options.recordInHistory === false ? undefined : `multi-set:${Date.now().toString(36)}`;
    for (const mutation of mutations) {
      dispatch({
        type: "APPLY_EDIT_ACTION",
        historyMergeKey: mergeKey,
        recordInHistory: options.recordInHistory,
        action: {
          kind: "setProperty",
          elementId: write.elementId,
          level: write.level,
          key: mutation.key,
          value: mutation.value,
          clearKeys: mutation.clearKeys
        }
      });
    }
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

    const mergeKey = options.recordInHistory === false ? undefined : `multi-set:${Date.now().toString(36)}`;
    for (const write of writable) {
      for (const mutation of mutations) {
        dispatch({
          type: "APPLY_EDIT_ACTION",
          historyMergeKey: mergeKey,
          recordInHistory: options.recordInHistory,
          action: {
            kind: "setProperty",
            elementId: write.elementId,
            level: write.level,
            key: mutation.key,
            value: mutation.value,
            clearKeys: mutation.clearKeys
          }
        });
      }
    }
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
      recordInHistory: options.recordInHistory
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
      recordInHistory: options.recordInHistory
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
      recordInHistory: options.recordInHistory
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

    const mergeKey = options.recordInHistory === false ? undefined : `multi-set:${Date.now().toString(36)}`;
    for (const entry of writableEntries) {
      const mutation = buildFillPatternOptionSetPropertyMutation(entry.context, option, value);
      dispatch({
        type: "APPLY_EDIT_ACTION",
        historyMergeKey: mergeKey,
        recordInHistory: options.recordInHistory,
        action: {
          kind: "setProperty",
          elementId: entry.write.elementId,
          level: entry.write.level,
          key: mutation.key,
          value: mutation.value,
          clearKeys: mutation.clearKeys
        }
      });
    }
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

    const mergeKey = options.recordInHistory === false ? undefined : `multi-set:${Date.now().toString(36)}`;
    for (const mutation of mutations) {
      dispatch({
        type: "APPLY_EDIT_ACTION",
        historyMergeKey: mergeKey,
        recordInHistory: options.recordInHistory,
        action: {
          kind: "setProperty",
          elementId: write.elementId,
          level: write.level,
          key: mutation.key,
          value: mutation.value,
          clearKeys: mutation.clearKeys
        }
      });
    }
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

    const mergeKey = options.recordInHistory === false ? undefined : `multi-set:${Date.now().toString(36)}`;
    for (const write of writable) {
      for (const mutation of mutations) {
        dispatch({
          type: "APPLY_EDIT_ACTION",
          historyMergeKey: mergeKey,
          recordInHistory: options.recordInHistory,
          action: {
            kind: "setProperty",
            elementId: write.elementId,
            level: write.level,
            key: mutation.key,
            value: mutation.value,
            clearKeys: mutation.clearKeys
          }
        });
      }
    }
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
      recordInHistory: options.recordInHistory
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
      recordInHistory: options.recordInHistory
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
      recordInHistory: options.recordInHistory
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
      recordInHistory: options.recordInHistory
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
      recordInHistory: options.recordInHistory
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
      recordInHistory: options.recordInHistory
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
      recordInHistory: options.recordInHistory
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

    const mergeKey = options.recordInHistory === false ? undefined : `multi-set:${Date.now().toString(36)}`;
    for (const entry of writableEntries) {
      const mutation = buildNodeFontSetPropertyMutation(entry.context.context, {
        ...entry.context.values,
        ...nextValues
      });
      dispatch({
        type: "APPLY_EDIT_ACTION",
        historyMergeKey: mergeKey,
        recordInHistory: options.recordInHistory,
        action: {
          kind: "setProperty",
          elementId: entry.write.elementId,
          level: entry.write.level,
          key: mutation.key,
          value: mutation.value,
          clearKeys: mutation.clearKeys
        }
      });
    }
  }, [dispatch]);

  return {
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

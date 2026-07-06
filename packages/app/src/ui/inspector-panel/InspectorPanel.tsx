import {
RiAlignCenter,
RiAlignJustify,
RiAlignLeft,
RiAlignRight,
RiBold,
RiFontMono,
RiFontSansSerif,
RiFontSerif,
RiItalic
} from "@remixicon/react";
import { useCallback,useEffect,useMemo,useState,type FocusEvent,type JSX } from "react";
import { CM_PER_PT, formatNumber } from "tikz-editor/edit/format";
import {
getInspectorDescriptor,
NODE_INNER_SEP_DEFAULT,
TIKZPICTURE_GLOBAL_TARGET_ID,
type InspectorProperty,
type NodeFontFamilyId,
type NodeFontSizePresetId,
type NodeTextAlignInspectorValue,
type SetPropertyWriteTarget,
type ShadowPresetId
} from "tikz-editor/edit/inspector";
import {
buildNodeMinimumDimensionSetPropertyMutations,
buildShadowMutationContextForPreset,
buildShadowSetPropertyMutations,
buildTransformSetPropertyMutations,
type NodeMinimumDimensionKey,
type ShadowMutationContext
} from "tikz-editor/edit/property-write-builders";
import { propertyIdForWriteKey } from "tikz-editor/edit/property-registry";
import { BASIC_PICKER_COLORS } from "../../colors/color-palette";
import { useProjectNamedColorSwatches } from "../../colors/project-named-colors";
import { useEditorStore } from "../../store/store";
import { getInspectorPropertyCapabilityStatus } from "../capabilities";
import { ColorPickerField } from "../ColorPicker";
import { MULTI_ARRANGE_ACTIONS,type MultiArrangeAction } from "./arrange-actions";
import { InspectorMultiSection,InspectorSingleSection } from "./InspectorSections";
import {
clampNumber,
NODE_FONT_SIZE_MIXED_OPTION_VALUE,
nodeFontButtonClass,
type InspectorPropertyProvenance,
type MultiInspectorProperty,
type NodeFontSizeDropdownValue
} from "./panel-helpers";
import {
renderNodeFontSizeDropdown,
} from "./property-dropdowns";
import {
renderMultiInspectorProperty,
renderSingleInspectorProperty
} from "./property-renderers";
import { useInspectorModel } from "./useInspectorModel";
import { useInspectorMutations } from "./useInspectorMutations";
import { useInspectorPreviewScrub } from "./useInspectorPreviewScrub";
import css from "./InspectorPanel.module.css";
import { RenderedTooltip } from "../RenderedTooltip";
import { SidePanel } from "../SidePanel";
import {
getToolLabel,
isCreationToolMode,
TOOL_HINTS,
toolSupportsFill,
toolSupportsStroke
} from "../tool-config";

type NumberChangeOptions = {
  recordInHistory?: boolean;
};

type ScalarInspectorProperty =
  | Extract<InspectorProperty, { kind: "number" | "length" }>
  | Extract<MultiInspectorProperty, { kind: "number" | "length" }>;

type NumberLabelScrubBinding = {
  writable: boolean;
  value: number;
  step: number;
  min?: number;
  max?: number;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
};

export function InspectorPanel() {
  const selectedIds = useEditorStore((s) => s.selectedElementIds);
  const dispatch = useEditorStore((s) => s.dispatch);
  const toolMode = useEditorStore((s) => s.toolMode);
  const creationStrokeColor = useEditorStore((s) => s.creationStrokeColor);
  const creationFillColor = useEditorStore((s) => s.creationFillColor);
  const freehandSmoothingPx = useEditorStore((s) => s.freehandSmoothingPx);
  const toolProjectNamedColorSwatches = useProjectNamedColorSwatches();

  const {
    selectedSourceIds,
    snapshot,
    projectNamedColorSwatches,
    globalTransformValues,
    figureBoundsState,
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
    setFrozenInspectorView
  } = useInspectorModel({
    selectedIds,
    dispatch,
    getInspectorDescriptor
  });

  const [manualLineWidthCustomKeys, setManualLineWidthCustomKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [scalarDrafts, setScalarDrafts] = useState<Record<string, string>>({});
  const [scalarProvenanceLocks, setScalarProvenanceLocks] = useState<Record<string, InspectorPropertyProvenance | null>>({});
  const [optionalLengthDrafts, setOptionalLengthDrafts] = useState<Record<string, string>>({});
  const [strokeMoreOptionsOpen, setStrokeMoreOptionsOpen] = useState(false);
  const [fillMoreOptionsOpen, setFillMoreOptionsOpen] = useState(false);
  const [fillAdvancedOptionsOpen, setFillAdvancedOptionsOpen] = useState(false);

  const {
    clearHoverPreviewSession,
    restoreHoverPreviewBase,
    applyHoverPreview,
    commitAfterHoverPreview,
    beginNumberLabelScrub
  } = useInspectorPreviewScrub({
    dispatch,
    selectedSourceIds,
    descriptor,
    multiModel,
    singlePropertyProvenance,
    multiPropertyProvenance,
    setFrozenInspectorView
  });

  const {
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
  } = useInspectorMutations(dispatch);

  useEffect(() => {
    setStrokeMoreOptionsOpen(false);
    setFillAdvancedOptionsOpen(false);
    setScalarDrafts({});
    setScalarProvenanceLocks({});
    setOptionalLengthDrafts({});
  }, [selectedIds]);

  function handleNumberChange(
    property: Extract<InspectorProperty, { kind: "number" }>,
    raw: string,
    options: NumberChangeOptions = {}
  ): void {
    const write = property.write;
    if (write?.mode !== "setProperty" || !write.writable || write.elementId.length === 0) return;
    const parsed = Number(raw);
    const next = normalizeNumberPropertyDraft(property, parsed);
    if (!Number.isFinite(next)) return;
    if (write.shadowContext) {
      applyShadowParamValue(write, property.id, next, options);
      return;
    }
    if (!write.transformContext) {
      applySetProperty(write, formatNumberWriteValue(property, next), {
        clearKeys: property.clearKeys,
        recordInHistory: options.recordInHistory
      });
      return;
    }

    const mutations = buildTransformSetPropertyMutations(
      write.transformContext,
      write.transformContext.key,
      next
    );
    if (mutations.length === 0) {
      return;
    }

    const mergeKey = `single-set:${Date.now().toString(36)}`;
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
          propertyId: propertyIdForWriteKey(mutation.key) ?? undefined,
          clearKeys: mutation.clearKeys
        }
      });
    }
  }

  function renderSingleTextField(
    property: Extract<InspectorProperty, { kind: "text" }>,
    provenance: InspectorPropertyProvenance | null
  ): JSX.Element {
    const writable = property.write.writable && property.write.elementId.length > 0;
    const readOnlyReason = property.readOnlyReason ?? property.write.reason ?? null;
    const textInput = (
      <input
        className={withValueProvenanceClass(css.textInput, provenance)}
        type="text"
        value={property.value}
        disabled={!writable}
        onChange={(event) => { applySetProperty(property.write, event.currentTarget.value); }}
      />
    );
    return (
      <div>
        <div className={css.propertyLabel}>{property.label}</div>
        <div className={css.controlRow}>
          {maybeWrapWithProvenanceTooltip(provenance, textInput, true)}
        </div>
        {renderReadOnlyReasonNote(readOnlyReason)}
      </div>
    );
  }

  function handleMultiNumberChange(
    property: Extract<MultiInspectorProperty, { kind: "number" }>,
    raw: string,
    options: NumberChangeOptions = {}
  ): void {
    const parsed = Number(raw);
    const next = normalizeNumberPropertyDraft(property, parsed);
    if (!Number.isFinite(next)) return;

    const writableWrites = property.writes.filter((write) => write.writable && write.elementId.length > 0);
    if (writableWrites.length === 0) {
      return;
    }

    const mergeKey = `multi-set:${Date.now().toString(36)}`;
    for (const write of writableWrites) {
      if (!write.transformContext) {
        dispatch({
          type: "APPLY_EDIT_ACTION",
          historyMergeKey: mergeKey,
          recordInHistory: options.recordInHistory,
          action: {
            kind: "setProperty",
            elementId: write.elementId,
            level: write.level,
            key: write.key,
            value: formatNumberWriteValue(property, next),
            propertyId: write.propertyId ?? propertyIdForWriteKey(write.key) ?? undefined,
            clearKeys: property.clearKeys
          }
        });
        continue;
      }
      const mutations = buildTransformSetPropertyMutations(
        write.transformContext,
        write.transformContext.key,
        next
      );
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
            propertyId: propertyIdForWriteKey(mutation.key) ?? undefined,
          clearKeys: mutation.clearKeys
          }
        });
      }
    }
  }

  function formatNumberWriteValue(
    property: Pick<Extract<InspectorProperty, { kind: "number" }> | Extract<MultiInspectorProperty, { kind: "number" }>, "unit">,
    value: number
  ): string {
    const formatted = formatNumber(value);
    if (property.unit) {
      return `${formatted}${property.unit}`;
    }
    return formatted;
  }

  function normalizeNumberPropertyDraft(
    property: Pick<Extract<InspectorProperty, { kind: "number" }> | Extract<MultiInspectorProperty, { kind: "number" }>, "min" | "minExclusive" | "max">,
    value: number
  ): number {
    if (!Number.isFinite(value)) {
      return Number.NaN;
    }
    if (property.minExclusive != null && value <= property.minExclusive) {
      return Number.NaN;
    }
    if (property.min != null && property.max != null) {
      return clampNumber(value, property.min, property.max);
    }
    if (property.min != null) {
      return Math.max(value, property.min);
    }
    if (property.max != null) {
      return Math.min(value, property.max);
    }
    return value;
  }

  function singleScalarDraftKey(
    property: Extract<InspectorProperty, { kind: "number" }> | Extract<InspectorProperty, { kind: "length" }>
  ): string {
    const selectedKey = selectedSourceIds.length === 1 ? selectedSourceIds[0] ?? "" : "";
    const elementId = property.kind === "number" ? (property.write?.elementId ?? "") : property.write.elementId;
    return `single:${property.kind}:${property.id}:${selectedKey || elementId}`;
  }

  function multiScalarDraftKey(
    property: Extract<MultiInspectorProperty, { kind: "number" }> | Extract<MultiInspectorProperty, { kind: "length" }>
  ): string {
    const sourceIds = selectedSourceIds.length > 0
      ? selectedSourceIds
      : property.writes.map((write) => write.elementId);
    const stableIds = sourceIds
      .filter((id) => id.length > 0)
      .sort();
    return `multi:${property.kind}:${property.id}:${stableIds.join("|")}`;
  }

  function setScalarDraft(key: string, value: string): void {
    setScalarDrafts((current) => {
      if (current[key] === value) {
        return current;
      }
      return { ...current, [key]: value };
    });
  }

  function clearScalarDraft(key: string): void {
    setScalarDrafts((current) => {
      if (!(key in current)) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function scalarProvenanceForDraft(
    key: string,
    provenance: InspectorPropertyProvenance | null
  ): InspectorPropertyProvenance | null {
    return Object.hasOwn(scalarProvenanceLocks, key)
      ? scalarProvenanceLocks[key] ?? null
      : provenance;
  }

  function setScalarProvenanceLock(
    key: string,
    provenance: InspectorPropertyProvenance | null
  ): void {
    setScalarProvenanceLocks((current) => {
      if (Object.hasOwn(current, key) && current[key] === provenance) {
        return current;
      }
      return { ...current, [key]: provenance };
    });
  }

  function clearScalarProvenanceLock(key: string): void {
    setScalarProvenanceLocks((current) => {
      if (!(key in current)) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function selectInputOnNextFrame(input: HTMLInputElement): void {
    const selectIfFocused = () => {
      if (typeof document !== "undefined" && document.activeElement === input) {
        input.select();
      }
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(selectIfFocused);
      return;
    }
    setTimeout(selectIfFocused, 0);
  }

  function handleScalarInputFocus(
    event: FocusEvent<HTMLInputElement>,
    draftKey: string,
    property: ScalarInspectorProperty,
    provenance: InspectorPropertyProvenance | null
  ): void {
    setScalarProvenanceLock(draftKey, provenance);
    if (property.defaultValue == null || provenance?.kind !== "default") {
      return;
    }
    selectInputOnNextFrame(event.currentTarget);
  }

  function resetSingleNumberToDefault(property: Extract<InspectorProperty, { kind: "number" }>): void {
    if (property.defaultValue == null) {
      return;
    }
    handleNumberChange(property, String(property.defaultValue));
  }

  function resetMultiNumberToDefault(property: Extract<MultiInspectorProperty, { kind: "number" }>): void {
    if (property.defaultValue == null) {
      return;
    }
    handleMultiNumberChange(property, String(property.defaultValue));
  }

  function resetSingleLengthToDefault(property: Extract<InspectorProperty, { kind: "length" }>): void {
    if (property.defaultValue == null) {
      return;
    }
    applySingleLengthValue(property, property.defaultValue);
  }

  function resetMultiLengthToDefault(property: Extract<MultiInspectorProperty, { kind: "length" }>): void {
    if (property.defaultValue == null) {
      return;
    }
    applyMultiLengthValue(property, property.defaultValue);
  }

  function commitSingleNumberDraft(property: Extract<InspectorProperty, { kind: "number" }>, raw: string): void {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      resetSingleNumberToDefault(property);
      return;
    }
    handleNumberChange(property, trimmed);
  }

  function commitMultiNumberDraft(property: Extract<MultiInspectorProperty, { kind: "number" }>, raw: string): void {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      resetMultiNumberToDefault(property);
      return;
    }
    handleMultiNumberChange(property, trimmed);
  }

  function commitSingleLengthDraft(property: Extract<InspectorProperty, { kind: "length" }>, raw: string): void {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      resetSingleLengthToDefault(property);
      return;
    }
    const next = Number(trimmed);
    if (!Number.isFinite(next)) {
      return;
    }
    applySingleLengthValue(property, next);
  }

  function commitMultiLengthDraft(property: Extract<MultiInspectorProperty, { kind: "length" }>, raw: string): void {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      resetMultiLengthToDefault(property);
      return;
    }
    const next = Number(trimmed);
    if (!Number.isFinite(next)) {
      return;
    }
    applyMultiLengthValue(property, next);
  }

  function withValueProvenanceClass(
    className: string | undefined,
    provenance: InspectorPropertyProvenance | null
  ): string | undefined {
    if (!provenance) {
      return className;
    }
    return [className ?? "", css.provenanceValue].filter(Boolean).join(" ");
  }

  function implicitDefaultProvenance(
    property: InspectorProperty | MultiInspectorProperty
  ): InspectorPropertyProvenance | null {
    if (
      property.kind === "length"
      && property.id === "node-inner-sep"
      && Math.abs(property.value - NODE_INNER_SEP_DEFAULT) <= 1e-6
      && !("mixed" in property && property.mixed)
    ) {
      return { kind: "default", tooltip: "TikZ default" };
    }
    return null;
  }

  function provenanceTooltipContent(provenance: InspectorPropertyProvenance | null): JSX.Element | string | null {
    if (!provenance) {
      return null;
    }
    if (provenance.kind === "default") {
      return "TikZ default";
    }
    return <>set by <code>{provenance.sourceLabel}</code></>;
  }

  function maybeWrapWithProvenanceTooltip(
    provenance: InspectorPropertyProvenance | null,
    child: JSX.Element,
    block = false
  ): JSX.Element {
    const content = provenanceTooltipContent(provenance);
    if (!content) {
      return child;
    }
    return (
      <RenderedTooltip content={content} block={block}>
        {child}
      </RenderedTooltip>
    );
  }

  function applySingleLengthValue(
    property: Extract<InspectorProperty, { kind: "length" }>,
    value: number,
    options: NumberChangeOptions = {}
  ): void {
    if (property.id === "node-inner-sep") {
      applyNodeInnerSepValue(property.write, value, options);
      return;
    }
    if (
      (property.id === "node-minimum-width" || property.id === "node-minimum-height")
      && property.minimumDimensionsContext
    ) {
      const editedKey: NodeMinimumDimensionKey =
        property.id === "node-minimum-width" ? "minimum width" : "minimum height";
      const mutations = buildNodeMinimumDimensionSetPropertyMutations(
        property.minimumDimensionsContext,
        editedKey,
        value
      );
      if (mutations.length === 0) {
        return;
      }
      const mergeKey = options.recordInHistory === false ? undefined : `single-set:${Date.now().toString(36)}`;
      for (const mutation of mutations) {
        dispatch({
          type: "APPLY_EDIT_ACTION",
          historyMergeKey: mergeKey,
          recordInHistory: options.recordInHistory,
          action: {
            kind: "setProperty",
            elementId: property.write.elementId,
            level: property.write.level,
            key: mutation.key,
            value: mutation.value,
            propertyId: propertyIdForWriteKey(mutation.key) ?? undefined,
          clearKeys: mutation.clearKeys
          }
        });
      }
      return;
    }
    if (property.write.shadowContext) {
      applyShadowParamValue(property.write, property.id, value, options);
      return;
    }
    applySetProperty(property.write, `${formatNumber(value)}pt`, {
      clearKeys: property.clearKeys,
      recordInHistory: options.recordInHistory
    });
  }

  function applyShadowParamValue(
    write: SetPropertyWriteTarget,
    propertyId: string,
    value: number | string | null,
    options: NumberChangeOptions = {}
  ): void {
    if (!write.shadowContext || !write.writable || write.elementId.length === 0) return;
    const ctx = write.shadowContext;
    let nextContext: ShadowMutationContext;
    if (propertyId === "shadow-xshift") {
      nextContext = { ...ctx, xshiftPt: value as number };
    } else if (propertyId === "shadow-yshift") {
      nextContext = { ...ctx, yshiftPt: value as number };
    } else if (propertyId === "shadow-scale") {
      nextContext = { ...ctx, scale: value as number };
    } else if (propertyId === "shadow-opacity") {
      nextContext = { ...ctx, opacity: value as number };
    } else if (propertyId === "shadow-color") {
      nextContext = { ...ctx, color: value as string | null };
    } else {
      return;
    }
    const mutations = buildShadowSetPropertyMutations(nextContext);
    if (mutations.length === 0) return;
    const mergeKey = options.recordInHistory === false ? undefined : `single-set:${Date.now().toString(36)}`;
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
          propertyId: propertyIdForWriteKey(mutation.key) ?? undefined,
          clearKeys: mutation.clearKeys
        }
      });
    }
  }

  function applyShadowPresetValue(
    write: SetPropertyWriteTarget,
    context: ShadowMutationContext,
    nextPreset: ShadowPresetId
  ): void {
    if (!write.writable || write.elementId.length === 0) return;
    const nextContext =
      nextPreset === context.preset ? context : buildShadowMutationContextForPreset(nextPreset);
    const mutations = buildShadowSetPropertyMutations(nextContext);
    if (mutations.length === 0) return;
    const mergeKey = `single-set:${Date.now().toString(36)}`;
    for (const mutation of mutations) {
      dispatch({
        type: "APPLY_EDIT_ACTION",
        historyMergeKey: mergeKey,
        action: {
          kind: "setProperty",
          elementId: write.elementId,
          level: write.level,
          key: mutation.key,
          value: mutation.value,
          propertyId: propertyIdForWriteKey(mutation.key) ?? undefined,
          clearKeys: mutation.clearKeys
        }
      });
    }
  }

  function applyMultiLengthValue(
    property: Extract<MultiInspectorProperty, { kind: "length" }>,
    value: number,
    options: NumberChangeOptions = {}
  ): void {
    if (property.id === "node-inner-sep") {
      applyNodeInnerSepValueMany(property.writes, value, options);
      return;
    }
    if (
      (property.id === "node-minimum-width" || property.id === "node-minimum-height")
      && property.minimumDimensionsContexts
    ) {
      const editedKey: NodeMinimumDimensionKey =
        property.id === "node-minimum-width" ? "minimum width" : "minimum height";
      const writableEntries = property.writes
        .map((write, index) => {
          const context = property.minimumDimensionsContexts?.[index];
          return context ? { write, context } : null;
        })
        .filter(
          (
            entry
          ): entry is { write: SetPropertyWriteTarget; context: NonNullable<(typeof property.minimumDimensionsContexts)[number]> } =>
            entry != null && entry.write.writable && entry.write.elementId.length > 0
        );
      if (writableEntries.length === 0) {
        return;
      }
      const mergeKey = options.recordInHistory === false ? undefined : `multi-set:${Date.now().toString(36)}`;
      for (const { write, context } of writableEntries) {
        const mutations = buildNodeMinimumDimensionSetPropertyMutations(context, editedKey, value);
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
              propertyId: propertyIdForWriteKey(mutation.key) ?? undefined,
          clearKeys: mutation.clearKeys
            }
          });
        }
      }
      return;
    }
    applySetPropertyMany(property.writes, `${formatNumber(value)}pt`, {
      clearKeys: property.clearKeys,
      recordInHistory: options.recordInHistory
    });
  }

  function applySingleFillPatternOptionValue(
    property: Extract<InspectorProperty, { kind: "fillPatternOption" }>,
    value: number,
    options: NumberChangeOptions = {}
  ): void {
    applyFillPatternOptionValue(property.write, property.option, value, property.context, {
      recordInHistory: options.recordInHistory
    });
  }

  function applyMultiFillPatternOptionValue(
    property: Extract<MultiInspectorProperty, { kind: "fillPatternOption" }>,
    value: number,
    options: NumberChangeOptions = {}
  ): void {
    applyFillPatternOptionValueMany(property.writes, property.option, value, property.contexts, {
      recordInHistory: options.recordInHistory
    });
  }

  function singleOptionalLengthDraftKey(
    property: Extract<InspectorProperty, { kind: "optionalLength" }>
  ): string {
    return `single:${property.id}:${property.write.elementId}`;
  }

  function multiOptionalLengthDraftKey(
    property: Extract<MultiInspectorProperty, { kind: "optionalLength" }>
  ): string {
    const elementIds = property.writes
      .map((write) => write.elementId)
      .filter((id) => id.length > 0)
      .sort();
    return `multi:${property.id}:${elementIds.join("|")}`;
  }

  function setOptionalLengthDraft(key: string, value: string): void {
    setOptionalLengthDrafts((current) => {
      if (current[key] === value) {
        return current;
      }
      return { ...current, [key]: value };
    });
  }

  function clearOptionalLengthDraft(key: string): void {
    setOptionalLengthDrafts((current) => {
      if (!(key in current)) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function commitSingleOptionalLengthDraft(
    property: Extract<InspectorProperty, { kind: "optionalLength" }>,
    draftRaw: string
  ): void {
    const trimmed = draftRaw.trim();
    if (trimmed.length === 0) {
      applySetProperty(property.write, "", {
        clearKeys: property.clearKeys
      });
      return;
    }
    const next = Number(trimmed);
    if (!Number.isFinite(next)) {
      return;
    }
    applySetProperty(property.write, `${formatNumber(next)}pt`, {
      clearKeys: property.clearKeys
    });
  }

  function commitMultiOptionalLengthDraft(
    property: Extract<MultiInspectorProperty, { kind: "optionalLength" }>,
    draftRaw: string
  ): void {
    const trimmed = draftRaw.trim();
    if (trimmed.length === 0) {
      applySetPropertyMany(property.writes, "", {
        clearKeys: property.clearKeys
      });
      return;
    }
    const next = Number(trimmed);
    if (!Number.isFinite(next)) {
      return;
    }
    applySetPropertyMany(property.writes, `${formatNumber(next)}pt`, {
      clearKeys: property.clearKeys
    });
  }

  function renderScrubbableNumberLabel(
    label: string,
    binding: NumberLabelScrubBinding
  ): JSX.Element {
    const className = binding.writable
      ? `${css.propertyLabel} ${css.propertyLabelScrubbable}`
      : `${css.propertyLabel} ${css.propertyLabelScrubbableDisabled}`;
    return (
      <div
        className={className}
        onPointerDown={(event) => { beginNumberLabelScrub(event, binding); }}
      >
        {label}
      </div>
    );
  }

  function getSingleNumberPropertyState(property: Extract<InspectorProperty, { kind: "number" }>): {
    writable: boolean;
    readOnlyReason: string | null;
  } {
    const capability = getInspectorPropertyCapabilityStatus(property);
    const capabilityReadOnlyReason =
      capability.status === "unsupported" ? capability.reason : null;
    const readOnlyReason = property.readOnlyReason ?? property.write?.reason ?? capabilityReadOnlyReason;
    const writable = (property.write?.writable ?? false) && capability.status !== "unsupported";
    return { writable, readOnlyReason };
  }

  function renderSingleNumberField(
    property: Extract<InspectorProperty, { kind: "number" }>,
    compact = false,
    provenance: InspectorPropertyProvenance | null = null
  ): JSX.Element {
    const { writable, readOnlyReason } = getSingleNumberPropertyState(property);
    const draftKey = singleScalarDraftKey(property);
    const draftValue = scalarDrafts[draftKey];
    const effectiveProvenance = scalarProvenanceForDraft(draftKey, provenance);
    const valueProvenance = draftValue === undefined ? effectiveProvenance : null;
    const input = (
      <input
        className={withValueProvenanceClass(css.numberInput, valueProvenance)}
        type="number"
        step={property.step}
        min={property.min}
        max={property.max}
        value={draftValue ?? formatNumber(property.value)}
        placeholder={property.defaultValue != null ? "Default" : undefined}
        disabled={!writable}
        onFocus={(event) => { handleScalarInputFocus(event, draftKey, property, provenance); }}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          setScalarDraft(draftKey, raw);
          if (raw.trim().length === 0) {
            return;
          }
          handleNumberChange(property, raw);
        }}
        onBlur={(event) => {
          if (draftValue !== undefined) {
            commitSingleNumberDraft(property, event.currentTarget.value);
            clearScalarDraft(draftKey);
          }
          clearScalarProvenanceLock(draftKey);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (draftValue !== undefined) {
              commitSingleNumberDraft(property, event.currentTarget.value);
              clearScalarDraft(draftKey);
            }
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            clearScalarDraft(draftKey);
            event.currentTarget.blur();
          }
        }}
      />
    );
    return (
      <div className={compact ? css.compactNumberField : undefined}>
        {renderScrubbableNumberLabel(property.label, {
          writable,
          value: property.value,
          step: property.step,
          min: property.min,
          max: property.max,
          onPreview: (next) => { handleNumberChange(property, String(next), { recordInHistory: false }); },
          onCommit: (next) => { handleNumberChange(property, String(next)); }
        })}
        <div className={css.controlRow}>
          {maybeWrapWithProvenanceTooltip(effectiveProvenance, input, true)}
          {property.unit ? <span className={css.unitLabel}>{property.unit}</span> : null}
        </div>
        {renderReadOnlyReasonNote(readOnlyReason)}
      </div>
    );
  }

  function renderMultiNumberField(
    property: Extract<MultiInspectorProperty, { kind: "number" }>,
    compact = false,
    provenance: InspectorPropertyProvenance | null = null
  ): JSX.Element {
    const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
    const draftKey = multiScalarDraftKey(property);
    const draftValue = scalarDrafts[draftKey];
    const effectiveProvenance = scalarProvenanceForDraft(draftKey, provenance);
    const valueProvenance = draftValue === undefined ? effectiveProvenance : null;
    const input = (
      <input
        className={withValueProvenanceClass(css.numberInput, valueProvenance)}
        type="number"
        step={property.step}
        min={property.min}
        max={property.max}
        value={draftValue ?? (property.mixed ? "" : formatNumber(property.value))}
        placeholder={property.mixed ? "Mixed" : property.defaultValue != null ? "Default" : undefined}
        disabled={!writable}
        onFocus={(event) => { handleScalarInputFocus(event, draftKey, property, provenance); }}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          setScalarDraft(draftKey, raw);
          if (raw.trim().length === 0) {
            return;
          }
          handleMultiNumberChange(property, raw);
        }}
        onBlur={(event) => {
          if (draftValue !== undefined) {
            commitMultiNumberDraft(property, event.currentTarget.value);
            clearScalarDraft(draftKey);
          }
          clearScalarProvenanceLock(draftKey);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (draftValue !== undefined) {
              commitMultiNumberDraft(property, event.currentTarget.value);
              clearScalarDraft(draftKey);
            }
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            clearScalarDraft(draftKey);
            event.currentTarget.blur();
          }
        }}
      />
    );
    return (
      <div className={compact ? css.compactNumberField : undefined}>
        {renderScrubbableNumberLabel(property.label, {
          writable,
          value: property.value,
          step: property.step,
          min: property.min,
          max: property.max,
          onPreview: (next) => { handleMultiNumberChange(property, String(next), { recordInHistory: false }); },
          onCommit: (next) => { handleMultiNumberChange(property, String(next)); }
        })}
        <div className={css.controlRow}>
          {maybeWrapWithProvenanceTooltip(effectiveProvenance, input, true)}
          {property.unit ? <span className={css.unitLabel}>{property.unit}</span> : null}
        </div>
        {renderReadOnlyReasonNote(property.readOnlyReason)}
      </div>
    );
  }

  function renderSingleLengthField(
    property: Extract<InspectorProperty, { kind: "length" }>,
    compact = false,
    provenance: InspectorPropertyProvenance | null = null
  ): JSX.Element {
    const capability = getInspectorPropertyCapabilityStatus(property);
    const capabilityReadOnlyReason =
      capability.status === "unsupported" ? capability.reason : null;
    const readOnlyReason = property.readOnlyReason ?? property.write.reason ?? capabilityReadOnlyReason;
    const writable = property.write.writable && capability.status !== "unsupported";
    const draftKey = singleScalarDraftKey(property);
    const draftValue = scalarDrafts[draftKey];
    const effectiveProvenance = scalarProvenanceForDraft(draftKey, provenance);
    const valueProvenance = draftValue === undefined ? effectiveProvenance : null;
    const input = (
      <input
        className={withValueProvenanceClass(css.numberInput, valueProvenance)}
        type="number"
        step={property.step}
        value={draftValue ?? formatNumber(property.value)}
        placeholder={property.defaultValue != null ? "Default" : undefined}
        disabled={!writable}
        onFocus={(event) => { handleScalarInputFocus(event, draftKey, property, provenance); }}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          setScalarDraft(draftKey, raw);
          if (raw.trim().length === 0) {
            return;
          }
          const next = Number(raw);
          if (!Number.isFinite(next)) {
            return;
          }
          applySingleLengthValue(property, next);
        }}
        onBlur={(event) => {
          if (draftValue !== undefined) {
            commitSingleLengthDraft(property, event.currentTarget.value);
            clearScalarDraft(draftKey);
          }
          clearScalarProvenanceLock(draftKey);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (draftValue !== undefined) {
              commitSingleLengthDraft(property, event.currentTarget.value);
              clearScalarDraft(draftKey);
            }
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            clearScalarDraft(draftKey);
            event.currentTarget.blur();
          }
        }}
      />
    );
    return (
      <div className={compact ? css.compactNumberField : undefined}>
        {renderScrubbableNumberLabel(property.label, {
          writable,
          value: property.value,
          step: property.step,
          onPreview: (next) => { applySingleLengthValue(property, next, { recordInHistory: false }); },
          onCommit: (next) => { applySingleLengthValue(property, next); }
        })}
        <div className={css.controlRow}>
          {maybeWrapWithProvenanceTooltip(effectiveProvenance, input, true)}
          <span className={css.unitLabel}>{property.unit}</span>
        </div>
        {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
        {renderReadOnlyReasonNote(readOnlyReason)}
      </div>
    );
  }

  function renderMultiLengthField(
    property: Extract<MultiInspectorProperty, { kind: "length" }>,
    compact = false,
    provenance: InspectorPropertyProvenance | null = null
  ): JSX.Element {
    const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
    const draftKey = multiScalarDraftKey(property);
    const draftValue = scalarDrafts[draftKey];
    const effectiveProvenance = scalarProvenanceForDraft(draftKey, provenance);
    const valueProvenance = draftValue === undefined ? effectiveProvenance : null;
    const input = (
      <input
        className={withValueProvenanceClass(css.numberInput, valueProvenance)}
        type="number"
        step={property.step}
        value={draftValue ?? (property.mixed ? "" : formatNumber(property.value))}
        placeholder={property.mixed ? "Mixed" : property.defaultValue != null ? "Default" : undefined}
        disabled={!writable}
        onFocus={(event) => { handleScalarInputFocus(event, draftKey, property, provenance); }}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          setScalarDraft(draftKey, raw);
          if (raw.trim().length === 0) {
            return;
          }
          const next = Number(raw);
          if (!Number.isFinite(next)) {
            return;
          }
          applyMultiLengthValue(property, next);
        }}
        onBlur={(event) => {
          if (draftValue !== undefined) {
            commitMultiLengthDraft(property, event.currentTarget.value);
            clearScalarDraft(draftKey);
          }
          clearScalarProvenanceLock(draftKey);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (draftValue !== undefined) {
              commitMultiLengthDraft(property, event.currentTarget.value);
              clearScalarDraft(draftKey);
            }
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            clearScalarDraft(draftKey);
            event.currentTarget.blur();
          }
        }}
      />
    );
    return (
      <div className={compact ? css.compactNumberField : undefined}>
        {renderScrubbableNumberLabel(property.label, {
          writable,
          value: property.value,
          step: property.step,
          onPreview: (next) => { applyMultiLengthValue(property, next, { recordInHistory: false }); },
          onCommit: (next) => { applyMultiLengthValue(property, next); }
        })}
        <div className={css.controlRow}>
          {maybeWrapWithProvenanceTooltip(effectiveProvenance, input, true)}
          <span className={css.unitLabel}>{property.unit}</span>
        </div>
        {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
        {renderReadOnlyReasonNote(property.readOnlyReason)}
      </div>
    );
  }

  function renderSingleOptionalLengthField(
    property: Extract<InspectorProperty, { kind: "optionalLength" }>,
    compact = false,
    provenance: InspectorPropertyProvenance | null = null
  ): JSX.Element {
    const capability = getInspectorPropertyCapabilityStatus(property);
    const capabilityReadOnlyReason =
      capability.status === "unsupported" ? capability.reason : null;
    const readOnlyReason = property.readOnlyReason ?? property.write.reason ?? capabilityReadOnlyReason;
    const writable = property.write.writable && capability.status !== "unsupported";
    const draftKey = singleOptionalLengthDraftKey(property);
    const draftValue = optionalLengthDrafts[draftKey];
    const inputValue = draftValue ?? (property.value == null ? "" : formatNumber(property.value));
    const input = (
      <input
        className={withValueProvenanceClass(css.numberInput, provenance)}
        type="number"
        step={property.step}
        value={inputValue}
        placeholder="Unset"
        disabled={!writable}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          setOptionalLengthDraft(draftKey, raw);
          const trimmed = raw.trim();
          if (trimmed.length === 0) {
            applySetProperty(property.write, "", {
              clearKeys: property.clearKeys
            });
            return;
          }
          const next = Number(trimmed);
          if (!Number.isFinite(next)) {
            return;
          }
          applySetProperty(property.write, `${formatNumber(next)}pt`, {
            clearKeys: property.clearKeys
          });
        }}
        onBlur={(event) => {
          commitSingleOptionalLengthDraft(property, event.currentTarget.value);
          clearOptionalLengthDraft(draftKey);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitSingleOptionalLengthDraft(property, event.currentTarget.value);
            clearOptionalLengthDraft(draftKey);
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            clearOptionalLengthDraft(draftKey);
            event.currentTarget.blur();
          }
        }}
      />
    );
    return (
      <div className={compact ? css.compactNumberField : undefined}>
        <div className={css.propertyLabel}>{property.label}</div>
        <div className={css.controlRow}>
          {maybeWrapWithProvenanceTooltip(provenance, input, true)}
          <span className={css.unitLabel}>{property.unit}</span>
        </div>
        {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
        {renderReadOnlyReasonNote(readOnlyReason)}
      </div>
    );
  }

  function renderMultiOptionalLengthField(
    property: Extract<MultiInspectorProperty, { kind: "optionalLength" }>,
    compact = false,
    provenance: InspectorPropertyProvenance | null = null
  ): JSX.Element {
    const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
    const draftKey = multiOptionalLengthDraftKey(property);
    const draftValue = optionalLengthDrafts[draftKey];
    const inputValue = draftValue ?? (property.mixed || property.value == null ? "" : formatNumber(property.value));
    const input = (
      <input
        className={withValueProvenanceClass(css.numberInput, provenance)}
        type="number"
        step={property.step}
        value={inputValue}
        placeholder={property.mixed ? "Mixed" : "Unset"}
        disabled={!writable}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          setOptionalLengthDraft(draftKey, raw);
          const trimmed = raw.trim();
          if (trimmed.length === 0) {
            applySetPropertyMany(property.writes, "", {
              clearKeys: property.clearKeys
            });
            return;
          }
          const next = Number(trimmed);
          if (!Number.isFinite(next)) {
            return;
          }
          applySetPropertyMany(property.writes, `${formatNumber(next)}pt`, {
            clearKeys: property.clearKeys
          });
        }}
        onBlur={(event) => {
          commitMultiOptionalLengthDraft(property, event.currentTarget.value);
          clearOptionalLengthDraft(draftKey);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitMultiOptionalLengthDraft(property, event.currentTarget.value);
            clearOptionalLengthDraft(draftKey);
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            clearOptionalLengthDraft(draftKey);
            event.currentTarget.blur();
          }
        }}
      />
    );
    return (
      <div className={compact ? css.compactNumberField : undefined}>
        <div className={css.propertyLabel}>{property.label}</div>
        <div className={css.controlRow}>
          {maybeWrapWithProvenanceTooltip(provenance, input, true)}
          <span className={css.unitLabel}>{property.unit}</span>
        </div>
        {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
        {renderReadOnlyReasonNote(property.readOnlyReason)}
      </div>
    );
  }

  function renderNodeTextAlignToolbar(
    property: {
      value: NodeTextAlignInspectorValue;
      mixed: boolean;
    },
    writable: boolean,
    onValueChange: (value: NodeTextAlignInspectorValue) => void
  ): JSX.Element {
    const buttons: Array<{
      value: Exclude<NodeTextAlignInspectorValue, "unset">;
      label: string;
      icon: JSX.Element;
    }> = [
      { value: "left", label: "Align left", icon: <RiAlignLeft size={13} /> },
      { value: "center", label: "Align center", icon: <RiAlignCenter size={13} /> },
      { value: "right", label: "Align right", icon: <RiAlignRight size={13} /> },
      { value: "justify", label: "Justify", icon: <RiAlignJustify size={13} /> }
    ];

    return (
      <div className={css.controlRow}>
        <div className={css.nodeFontButtonGroup} role="group" aria-label="Text alignment">
          {buttons.map((button) => {
            const active = !property.mixed && property.value === button.value;
            return (
              <button
                key={button.value}
                type="button"
                className={`${nodeFontButtonClass(active, property.mixed)} ${css.nodeTextAlignButton}`}
                disabled={!writable}
                aria-label={button.label}
                aria-pressed={active}
                onClick={() => { onValueChange(active ? "unset" : button.value); }}
              >
                {button.icon}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function renderSingleNumberPair(
    left: Extract<InspectorProperty, { kind: "number" }>,
    right: Extract<InspectorProperty, { kind: "number" }>,
    leftProvenance: InspectorPropertyProvenance | null = null,
    rightProvenance: InspectorPropertyProvenance | null = null
  ): JSX.Element {
    return (
      <div key={`${left.id}:${right.id}`} className={css.compactNumberPair}>
        {renderSingleNumberField(left, true, leftProvenance)}
        {renderSingleNumberField(right, true, rightProvenance)}
      </div>
    );
  }

  function renderMultiNumberPair(
    left: Extract<MultiInspectorProperty, { kind: "number" }>,
    right: Extract<MultiInspectorProperty, { kind: "number" }>,
    leftProvenance: InspectorPropertyProvenance | null,
    rightProvenance: InspectorPropertyProvenance | null
  ): JSX.Element {
    return (
      <div key={`${left.id}:${right.id}`} className={css.compactNumberPair}>
        {renderMultiNumberField(left, true, leftProvenance)}
        {renderMultiNumberField(right, true, rightProvenance)}
      </div>
    );
  }

  function renderSingleLengthPair(
    left: Extract<InspectorProperty, { kind: "length" }>,
    right: Extract<InspectorProperty, { kind: "length" }>,
    leftProvenance: InspectorPropertyProvenance | null = null,
    rightProvenance: InspectorPropertyProvenance | null = null
  ): JSX.Element {
    return (
      <div key={`${left.id}:${right.id}`} className={css.compactNumberPair}>
        {renderSingleLengthField(left, true, leftProvenance)}
        {renderSingleLengthField(right, true, rightProvenance)}
      </div>
    );
  }

  function renderMultiLengthPair(
    left: Extract<MultiInspectorProperty, { kind: "length" }>,
    right: Extract<MultiInspectorProperty, { kind: "length" }>,
    leftProvenance: InspectorPropertyProvenance | null,
    rightProvenance: InspectorPropertyProvenance | null
  ): JSX.Element {
    return (
      <div key={`${left.id}:${right.id}`} className={css.compactNumberPair}>
        {renderMultiLengthField(left, true, leftProvenance)}
        {renderMultiLengthField(right, true, rightProvenance)}
      </div>
    );
  }

  function enableManualCustomLineWidth(key: string): void {
    setManualLineWidthCustomKeys((current) => {
      if (current.has(key)) {
        return current;
      }
      const next = new Set(current);
      next.add(key);
      return next;
    });
  }

  function disableManualCustomLineWidth(key: string): void {
    setManualLineWidthCustomKeys((current) => {
      if (!current.has(key)) {
        return current;
      }
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }

  function renderNodeFontToolbar(
    property: {
      family: NodeFontFamilyId;
      familyMixed: boolean;
      weight: "normal" | "bold";
      weightMixed: boolean;
      style: "normal" | "italic";
      styleMixed: boolean;
      sizePreset: NodeFontSizePresetId;
      sizePresetMixed: boolean;
      customSizePt: number | null;
      sizeOptions: Array<{ value: Exclude<NodeFontSizePresetId, "custom">; label: string }>;
      label: string;
    },
    writable: boolean,
    onFamilyChange: (family: NodeFontFamilyId) => void,
    onWeightToggle: () => void,
    onStyleToggle: () => void,
    onSizePresetChange: (sizePreset: Exclude<NodeFontSizePresetId, "custom">) => void,
    sizeValueClassName?: string,
    onSizePresetHoverPreview?: (sizePreset: Exclude<NodeFontSizePresetId, "custom">) => void,
    onSizePresetHoverPreviewEnd?: () => void,
    onSizePresetHoverPreviewLeave?: () => void
  ) {
    const boldActive = !property.weightMixed && property.weight === "bold";
    const italicActive = !property.styleMixed && property.style === "italic";
    const sizeValue: NodeFontSizeDropdownValue = property.sizePresetMixed
      ? NODE_FONT_SIZE_MIXED_OPTION_VALUE
      : property.sizePreset;
    return (
      <div className={css.nodeFontControls}>
        <div className={css.nodeFontToolbar}>
          <div className={css.nodeFontButtonGroup} role="group" aria-label="Font family">
            <button
              type="button"
              className={nodeFontButtonClass(property.family === "serif" && !property.familyMixed, property.familyMixed)}
              disabled={!writable}
              aria-label="Serif family"
              aria-pressed={!property.familyMixed && property.family === "serif"}
              onClick={() => { onFamilyChange("serif"); }}
            >
              <RiFontSerif size={13} />
            </button>
            <button
              type="button"
              className={nodeFontButtonClass(property.family === "sans" && !property.familyMixed, property.familyMixed)}
              disabled={!writable}
              aria-label="Sans family"
              aria-pressed={!property.familyMixed && property.family === "sans"}
              onClick={() => { onFamilyChange("sans"); }}
            >
              <RiFontSansSerif size={13} />
            </button>
            <button
              type="button"
              className={nodeFontButtonClass(property.family === "monospace" && !property.familyMixed, property.familyMixed)}
              disabled={!writable}
              aria-label="Monospace family"
              aria-pressed={!property.familyMixed && property.family === "monospace"}
              onClick={() => { onFamilyChange("monospace"); }}
            >
              <RiFontMono size={13} />
            </button>
          </div>
          <div className={css.nodeFontButtonGroup} role="group" aria-label="Font style">
            <button
              type="button"
              className={nodeFontButtonClass(boldActive, property.weightMixed)}
              disabled={!writable}
              aria-label="Bold"
              aria-pressed={boldActive}
              onClick={onWeightToggle}
            >
              <RiBold size={13} />
            </button>
            <button
              type="button"
              className={nodeFontButtonClass(italicActive, property.styleMixed)}
              disabled={!writable}
              aria-label="Italic"
              aria-pressed={italicActive}
              onClick={onStyleToggle}
            >
              <RiItalic size={13} />
            </button>
          </div>
          <div className={css.nodeFontSizeRow}>
            {renderNodeFontSizeDropdown(
              {
                label: `${property.label} size`,
                value: property.sizePreset,
                options: property.sizeOptions,
                customSizePt: property.customSizePt
              },
              writable,
              onSizePresetChange,
              sizeValue,
              sizeValueClassName,
              onSizePresetHoverPreview,
              onSizePresetHoverPreviewEnd,
              onSizePresetHoverPreviewLeave
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderReadOnlyReasonNote(reason: string | null | undefined): JSX.Element | null {
    if (!reason || reason === renderedDescriptor?.readOnlyReason) {
      return null;
    }
    return <div className={css.propertyNote}>{reason}</div>;
  }

  const propertyRendererApi = {
    renderedSinglePropertyProvenance,
    renderedMultiPropertyProvenance,
    implicitDefaultProvenance,
    withValueProvenanceClass,
    renderReadOnlyReasonNote,
    renderSingleTextField,
    renderSingleNumberField,
    renderSingleLengthField,
    renderSingleOptionalLengthField,
    renderMultiNumberField,
    renderMultiLengthField,
    renderMultiOptionalLengthField,
    renderNodeTextAlignToolbar,
    renderScrubbableNumberLabel,
    applySingleLengthValue,
    applyMultiLengthValue,
    maybeWrapWithProvenanceTooltip,
    commitAfterHoverPreview,
    applyNodeShapeValue,
    applyNodeShapeValueMany,
    applyHoverPreview,
    clearHoverPreviewSession,
    restoreHoverPreviewBase,
    renderNodeFontToolbar,
    applyNodeFontValue,
    applyNodeFontValueMany,
    normalizeColorSetPropertyChange,
    applySetProperty,
    applySetPropertyMany,
    projectNamedColorSwatches,
    applyFillModeValue,
    applyFillModeValueMany,
    setFillAdvancedOptionsOpen,
    applyFillShadingValue,
    applyFillShadingValueMany,
    applyFillPatternValue,
    applyFillPatternValueMany,
    applySingleFillPatternOptionValue,
    applyMultiFillPatternOptionValue,
    manualLineWidthCustomKeys,
    enableManualCustomLineWidth,
    disableManualCustomLineWidth,
    applyDashStyleValue,
    applyDashStyleValueMany,
    applyLineCapValue,
    applyLineCapValueMany,
    applyLineJoinValue,
    applyLineJoinValueMany,
    applyPathMorphingDecorationValue,
    applyPathMorphingDecorationValueMany,
    applyRoundedCornersValue,
    applyRoundedCornersValueMany,
    applyArrowTipValue,
    applyArrowTipValueMany,
    applyShadowPropertyValue: applyShadowParamValue,
    applyShadowPresetValue
  };

  function renderProperty(property: InspectorProperty) {
    return renderSingleInspectorProperty(property, propertyRendererApi);
  }

  function renderMultiProperty(property: MultiInspectorProperty) {
    return renderMultiInspectorProperty(property, propertyRendererApi);
  }

  const singleFillModeProperty = useMemo(
    () =>
      renderedDescriptor?.sections
        .find((section) => section.id === "fill")
        ?.properties.find(
          (property): property is Extract<InspectorProperty, { kind: "fillMode" }> =>
            property.kind === "fillMode"
        ),
    [renderedDescriptor]
  );
  const fillModeSingleCanWrite = Boolean(
    singleFillModeProperty &&
      singleFillModeProperty.write.writable &&
      getInspectorPropertyCapabilityStatus(singleFillModeProperty).status !== "unsupported"
  );
  const onEnableGradientFillSingle = useCallback(() => {
    if (!singleFillModeProperty || !fillModeSingleCanWrite) {
      return;
    }
    setFillAdvancedOptionsOpen(true);
    applyFillModeValue(singleFillModeProperty.write, "gradient", singleFillModeProperty.context);
  }, [singleFillModeProperty, fillModeSingleCanWrite, applyFillModeValue]);
  const onEnablePatternFillSingle = useCallback(() => {
    if (!singleFillModeProperty || !fillModeSingleCanWrite) {
      return;
    }
    setFillAdvancedOptionsOpen(true);
    applyFillModeValue(singleFillModeProperty.write, "pattern", singleFillModeProperty.context);
  }, [singleFillModeProperty, fillModeSingleCanWrite, applyFillModeValue]);

  const multiFillModeProperty = useMemo(
    () =>
      renderedMultiModel?.sections
        .find((section) => section.id === "fill")
        ?.properties.find(
          (property): property is Extract<MultiInspectorProperty, { kind: "fillMode" }> =>
            property.kind === "fillMode"
        ),
    [renderedMultiModel]
  );
  const fillModeMultiCanWrite = Boolean(
    multiFillModeProperty?.writes.some((write) => write.writable && write.elementId.length > 0)
  );
  const onEnableGradientFillMulti = useCallback(() => {
    if (!multiFillModeProperty || !fillModeMultiCanWrite) {
      return;
    }
    setFillAdvancedOptionsOpen(true);
    applyFillModeValueMany(multiFillModeProperty.writes, "gradient", multiFillModeProperty.contexts);
  }, [multiFillModeProperty, fillModeMultiCanWrite, applyFillModeValueMany]);
  const onEnablePatternFillMulti = useCallback(() => {
    if (!multiFillModeProperty || !fillModeMultiCanWrite) {
      return;
    }
    setFillAdvancedOptionsOpen(true);
    applyFillModeValueMany(multiFillModeProperty.writes, "pattern", multiFillModeProperty.contexts);
  }, [multiFillModeProperty, fillModeMultiCanWrite, applyFillModeValueMany]);

  function makeGlobalTransformNumberProperty(
    key: "xscale" | "yscale",
    label: string
  ): Extract<InspectorProperty, { kind: "number" }> {
    return {
      kind: "number",
      id: key,
      label,
      value: globalTransformValues[key],
      step: 0.1,
      write: {
        mode: "setProperty",
        elementId: TIKZPICTURE_GLOBAL_TARGET_ID,
        level: "command",
        key,
        transformContext: {
          key,
          values: globalTransformValues
        },
        writable: true
      }
    };
  }

  function currentAutoFigureBoundsCm(): { x: number; y: number; width: number; height: number } {
    const bounds = snapshot.scene?.bounds;
    if (!bounds) {
      return { x: 0, y: 0, width: 1, height: 1 };
    }
    return {
      x: bounds.minX * CM_PER_PT,
      y: bounds.minY * CM_PER_PT,
      width: Math.max(0, (bounds.maxX - bounds.minX) * CM_PER_PT),
      height: Math.max(0, (bounds.maxY - bounds.minY) * CM_PER_PT)
    };
  }

  function currentFigureBoundsControlsValue(): { x: number; y: number; width: number; height: number } {
    return figureBoundsState.mode === "fixed" ? figureBoundsState : currentAutoFigureBoundsCm();
  }

  function applyFigureBoundsValue(next: { x: number; y: number; width: number; height: number }): void {
    dispatch({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "setFigureBounds",
        mode: "fixed",
        x: next.x,
        y: next.y,
        width: Math.max(0, next.width),
        height: Math.max(0, next.height)
      }
    });
  }

  function renderFigureBoundsNumberField(
    label: string,
    value: number,
    key: "x" | "y" | "width" | "height",
    disabled: boolean
  ): JSX.Element {
    return (
      <div className={css.compactNumberField}>
        <div className={css.propertyLabel}>{label}</div>
        <div className={css.controlRow}>
          <input
            className={css.numberInput}
            type="number"
            step={0.1}
            min={key === "width" || key === "height" ? 0 : undefined}
            value={formatNumber(value)}
            disabled={disabled}
            onChange={(event) => {
              const parsed = Number(event.currentTarget.value);
              if (!Number.isFinite(parsed)) {
                return;
              }
              applyFigureBoundsValue({
                ...currentFigureBoundsControlsValue(),
                [key]: parsed
              });
            }}
          />
          <span className={css.unitLabel}>cm</span>
        </div>
      </div>
    );
  }

  function renderFigureBoundsControls(): JSX.Element {
    const values = currentFigureBoundsControlsValue();
    const fixed = figureBoundsState.mode === "fixed";
    return (
      <>
        <div className={css.property}>
          <div className={css.propertyLabel}>Mode</div>
          <div className={css.controlRow}>
            <select
              className={css.numberInput}
              value={fixed ? "fixed" : "auto"}
              onChange={(event) => {
                if (event.currentTarget.value === "auto") {
                  dispatch({
                    type: "APPLY_EDIT_ACTION",
                    action: { kind: "setFigureBounds", mode: "auto" }
                  });
                  return;
                }
                applyFigureBoundsValue(values);
              }}
            >
              <option value="auto">Auto from content</option>
              <option value="fixed">Fixed size</option>
            </select>
          </div>
        </div>
        {fixed ? (
          <>
            <div className={css.compactNumberPair}>
              {renderFigureBoundsNumberField("X", values.x, "x", false)}
              {renderFigureBoundsNumberField("Y", values.y, "y", false)}
            </div>
            <div className={css.compactNumberPair}>
              {renderFigureBoundsNumberField("Width", values.width, "width", false)}
              {renderFigureBoundsNumberField("Height", values.height, "height", false)}
            </div>
          </>
        ) : null}
      </>
    );
  }

  function renderGlobalTransformPanel() {
    const xscale = makeGlobalTransformNumberProperty("xscale", "X scale");
    const yscale = makeGlobalTransformNumberProperty("yscale", "Y scale");
    return (
      <>
        <SidePanel.Header>tikzpicture</SidePanel.Header>
        <SidePanel.Content className={css.content}>
          <div className={css.elementInfo}>
            <SidePanel.Section>
              <SidePanel.SectionHeader>
                <span>Transform</span>
              </SidePanel.SectionHeader>
              <SidePanel.SectionBody>{renderSingleNumberPair(xscale, yscale)}</SidePanel.SectionBody>
            </SidePanel.Section>
            <SidePanel.Section>
              <SidePanel.SectionHeader>
                <span>Figure Bounds</span>
              </SidePanel.SectionHeader>
              <SidePanel.SectionBody>{renderFigureBoundsControls()}</SidePanel.SectionBody>
            </SidePanel.Section>
          </div>
        </SidePanel.Content>
      </>
    );
  }

  function renderToolOptionsPanel() {
    const toolLabel = getToolLabel(toolMode);
    const hint = TOOL_HINTS[toolMode];
    const showStroke = toolSupportsStroke(toolMode);
    const showFill = toolSupportsFill(toolMode);
    const isFreehand = toolMode === "addFreehand";

    return (
      <>
        <SidePanel.Header>{toolLabel} Tool</SidePanel.Header>
        <SidePanel.Content className={css.content}>
          <div className={css.elementInfo}>
            {hint ? (
              <div className={css.toolHint}>{hint}</div>
            ) : null}

            {showStroke || showFill ? (
              <SidePanel.Section>
                <SidePanel.SectionHeader>
                  <span>Defaults</span>
                </SidePanel.SectionHeader>
                <SidePanel.SectionBody>
                  {showStroke ? (
                    <div className={css.property}>
                      <label className={css.propertyLabel}>Stroke</label>
                      <ColorPickerField
                        ariaLabel="Creation stroke color"
                        value={creationStrokeColor}
                        syntaxValue={creationStrokeColor}
                        options={BASIC_PICKER_COLORS}
                        namedColorSwatches={toolProjectNamedColorSwatches}
                        onChange={(nextValue) => {
                          dispatch({ type: "SET_CREATION_STROKE_COLOR", value: nextValue });
                        }}
                      />
                    </div>
                  ) : null}
                  {showFill ? (
                    <div className={css.property}>
                      <label className={css.propertyLabel}>Fill</label>
                      <ColorPickerField
                        ariaLabel="Creation fill color"
                        value={creationFillColor === "none" ? "" : creationFillColor}
                        syntaxValue={creationFillColor}
                        options={BASIC_PICKER_COLORS}
                        namedColorSwatches={toolProjectNamedColorSwatches}
                        onChange={(nextValue) => {
                          dispatch({ type: "SET_CREATION_FILL_COLOR", value: nextValue || "none" });
                        }}
                      />
                    </div>
                  ) : null}
                </SidePanel.SectionBody>
              </SidePanel.Section>
            ) : null}

            {isFreehand ? (
              <SidePanel.Section>
                <SidePanel.SectionHeader>
                  <span>Freehand</span>
                </SidePanel.SectionHeader>
                <SidePanel.SectionBody>
                  <div className={css.property}>
                    <label className={css.propertyLabel} htmlFor="inspector-freehand-smoothing">
                      Smoothing
                    </label>
                    <div className={css.toolSliderRow}>
                      <input
                        id="inspector-freehand-smoothing"
                        data-testid="inspector-freehand-smoothing-slider"
                        className={css.rangeInput}
                        type="range"
                        min={4}
                        max={32}
                        step={1}
                        value={freehandSmoothingPx}
                        onChange={(event) => {
                          dispatch({ type: "SET_FREEHAND_SMOOTHING", value: Number(event.currentTarget.value) });
                        }}
                      />
                      <span className={css.toolSliderValue}>{freehandSmoothingPx}px</span>
                    </div>
                  </div>
                </SidePanel.SectionBody>
              </SidePanel.Section>
            ) : null}
          </div>
        </SidePanel.Content>
      </>
    );
  }

  function renderMultiArrangeQuickActions() {
    const alignHorizontalActions = MULTI_ARRANGE_ACTIONS.filter(
      (action) =>
        action.id === "align-left" ||
        action.id === "align-center" ||
        action.id === "align-right"
    );
    const alignVerticalActions = MULTI_ARRANGE_ACTIONS.filter(
      (action) =>
        action.id === "align-top" ||
        action.id === "align-middle" ||
        action.id === "align-bottom"
    );
    const distributeActions = MULTI_ARRANGE_ACTIONS.filter((action) => action.group === "distribute");

    const renderActionButton = (action: MultiArrangeAction) => {
      const availability = arrangeAvailability[action.id];
      const disabled = !availability.enabled;
      const title = disabled && availability.reason
        ? `${action.label}\n${availability.reason}`
        : action.label;
      const Icon = action.icon;
      return (
        <RenderedTooltip key={action.id} content={title}>
          <button
            type="button"
            className={css.multiArrangeIconButton}
            aria-label={action.label}
            disabled={disabled}
            onClick={() => {
              clearHoverPreviewSession();
              action.run(commandContext);
            }}
          >
            <Icon size={14} />
          </button>
        </RenderedTooltip>
      );
    };

    return (
      <div className={css.multiArrangeRow}>
        <div className={css.multiArrangeGroup} role="group" aria-label="Align selection horizontally">
          {alignHorizontalActions.map((action) => renderActionButton(action))}
        </div>
        <div className={css.multiArrangeGroup} role="group" aria-label="Align selection vertically">
          {alignVerticalActions.map((action) => renderActionButton(action))}
        </div>
        <div className={css.multiArrangeGroup} role="group" aria-label="Distribute selection">
          {distributeActions.map((action) => renderActionButton(action))}
        </div>
      </div>
    );
  }

  return (
    <SidePanel className={css.panel}>
      {isCreationToolMode(toolMode) ? (
        renderToolOptionsPanel()
      ) : selectedSourceIds.length === 0 ? (
        renderGlobalTransformPanel()
      ) : selectedSourceIds.length === 1 ? (
        !renderedDescriptor ? (
          <SidePanel.Content>
            <p className={css.hint}>Inspector data is unavailable for the current selection.</p>
          </SidePanel.Content>
        ) : (
          <>
            <SidePanel.Header>{renderedDescriptor.elementKind}</SidePanel.Header>
            <SidePanel.Content className={css.content}>
              <div className={css.elementInfo}>
                {renderedDescriptor.readOnlyReason ? (
                  <div className={css.globalNote}>{renderedDescriptor.readOnlyReason}</div>
                ) : null}
                {renderedDescriptor.infoNote ? (
                  <div className={css.globalNote}>{renderedDescriptor.infoNote}</div>
                ) : null}

                {renderedDescriptor.sections.map((section) => (
                  <InspectorSingleSection
                    key={section.id}
                    section={section}
                    strokeMoreOptionsOpen={strokeMoreOptionsOpen}
                    setStrokeMoreOptionsOpen={setStrokeMoreOptionsOpen}
                    fillMoreOptionsOpen={fillMoreOptionsOpen}
                    setFillMoreOptionsOpen={setFillMoreOptionsOpen}
                    fillAdvancedOptionsOpen={fillAdvancedOptionsOpen}
                    setFillAdvancedOptionsOpen={setFillAdvancedOptionsOpen}
                    renderedSinglePropertyProvenance={renderedSinglePropertyProvenance}
                    renderSingleNumberPair={renderSingleNumberPair}
                    renderSingleLengthPair={renderSingleLengthPair}
                    renderProperty={renderProperty}
                    onEnableGradientFillSingle={onEnableGradientFillSingle}
                    onEnablePatternFillSingle={onEnablePatternFillSingle}
                    fillModeSingleCanWrite={fillModeSingleCanWrite}
                  />
                ))}
              </div>
            </SidePanel.Content>
          </>
        )
      ) : (
        <>
          <SidePanel.Header>
            {renderedMultiModel?.selectionCount ?? selectedSourceIds.length} selected
          </SidePanel.Header>
          <SidePanel.Content className={css.content}>
            <div className={css.elementInfo}>
              {renderMultiArrangeQuickActions()}
              {!renderedMultiModel || renderedMultiModel.sections.length === 0 ? (
                <p className={css.hint}>No shared editable properties were found across the selected elements.</p>
              ) : (
                renderedMultiModel.sections.map((section) => (
                  <InspectorMultiSection
                    key={section.id}
                    section={section}
                    strokeMoreOptionsOpen={strokeMoreOptionsOpen}
                    setStrokeMoreOptionsOpen={setStrokeMoreOptionsOpen}
                    fillMoreOptionsOpen={fillMoreOptionsOpen}
                    setFillMoreOptionsOpen={setFillMoreOptionsOpen}
                    fillAdvancedOptionsOpen={fillAdvancedOptionsOpen}
                    setFillAdvancedOptionsOpen={setFillAdvancedOptionsOpen}
                    renderedMultiPropertyProvenance={renderedMultiPropertyProvenance}
                    renderMultiNumberPair={renderMultiNumberPair}
                    renderMultiLengthPair={renderMultiLengthPair}
                    renderMultiProperty={renderMultiProperty}
                    onEnableGradientFillMulti={onEnableGradientFillMulti}
                    onEnablePatternFillMulti={onEnablePatternFillMulti}
                    fillModeMultiCanWrite={fillModeMultiCanWrite}
                  />
                ))
              )}
            </div>
          </SidePanel.Content>
        </>
      )}
    </SidePanel>
  );
}

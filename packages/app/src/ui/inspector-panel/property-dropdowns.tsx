import { CustomDropdown } from "../CustomDropdown";
import css from "./InspectorPanel.module.css";
import type {
  ArrowTipPresetId,
  ArrowTipSide,
  DashStylePresetId,
  FillModePresetId,
  FillPatternPresetId,
  FillShadingPresetId,
  LineCapPresetId,
  LineJoinPresetId,
  NodeFontSizePresetId,
  NodeShapePresetId,
  PathMorphingDecorationPresetId,
  ShadowPresetId,
  ShadowPresetOption
} from "tikz-editor/edit/inspector";
import {
  ArrowTipPreview,
  DashStylePreview,
  FillPatternPreview,
  LineCapPreview,
  LineJoinPreview,
  PathMorphingDecorationPreview,
  arrowTipPreviewPreset,
  arrowTipValueLabel,
  dashStylePreviewPreset,
  dashStyleValueLabel,
  fillModeValueLabel,
  fillPatternPreviewPreset,
  fillPatternValueLabel,
  fillShadingValueLabel,
  isSelectableArrowTipValue,
  isSelectableDashStyleValue,
  isSelectableFillModeValue,
  isSelectableFillPatternValue,
  isSelectableFillShadingValue,
  isSelectableLineCapValue,
  isSelectableLineJoinValue,
  isSelectableNodeFontSizeValue,
  isSelectableNodeShapeValue,
  isSelectablePathMorphingDecorationValue,
  isSelectableShadowPresetValue,
  lineCapPreviewPreset,
  lineCapValueLabel,
  lineJoinPreviewPreset,
  lineJoinValueLabel,
  nodeFontSizePresetPtLabel,
  nodeFontSizeValueLabel,
  nodeShapeValueLabel,
  pathMorphingDecorationPreviewPreset,
  pathMorphingDecorationValueLabel,
  shadowPresetValueLabel,
  toArrowTipDropdownOptions,
  toDashStyleDropdownOptions,
  toFillModeDropdownOptions,
  toFillPatternDropdownOptions,
  toFillShadingDropdownOptions,
  toLineCapDropdownOptions,
  toLineJoinDropdownOptions,
  toNodeFontSizeDropdownOptions,
  toNodeShapeDropdownOptions,
  toPathMorphingDecorationDropdownOptions,
  toShadowPresetDropdownOptions,
  type ArrowTipDropdownValue,
  type DashStyleDropdownValue,
  type FillModeDropdownValue,
  type FillPatternDropdownValue,
  type FillShadingDropdownValue,
  type LineCapDropdownValue,
  type LineJoinDropdownValue,
  type NodeFontSizeDropdownValue,
  type NodeShapeDropdownValue,
  type PathMorphingDecorationDropdownValue,
  type ShadowPresetDropdownValue
} from "./panel-helpers";

export function renderArrowTipDropdown(
  property: {
    id: string;
    label: string;
    side: ArrowTipSide;
    value: ArrowTipPresetId;
    options: Array<{ value: Exclude<ArrowTipPresetId, "custom">; label: string }>;
    previewLineWidth: number;
  },
  writable: boolean,
  onApply: (value: Exclude<ArrowTipPresetId, "custom">) => void,
  valueOverride?: ArrowTipDropdownValue,
  valueClassName?: string,
  onHoverPreview?: (value: Exclude<ArrowTipPresetId, "custom">) => void,
  onHoverPreviewEnd?: () => void,
  onHoverPreviewLeave?: () => void
) {
  const dropdownValue: ArrowTipDropdownValue = valueOverride ?? property.value;
  const dropdownOptions = toArrowTipDropdownOptions(property.options);
  const displayLabel = arrowTipValueLabel(dropdownValue, property.options);
  const previewPreset = arrowTipPreviewPreset(dropdownValue);

  return (
    <CustomDropdown
      ariaLabel={property.label}
      value={dropdownValue}
      options={dropdownOptions}
      disabled={!writable}
      onChange={(nextValue) => {
        if (!writable || !isSelectableArrowTipValue(nextValue)) {
          return;
        }
        onApply(nextValue);
      }}
      onOptionHover={(nextValue) => {
        if (!writable || !isSelectableArrowTipValue(nextValue) || !onHoverPreview) {
          return;
        }
        onHoverPreview(nextValue);
      }}
      onOptionHoverEnd={onHoverPreviewEnd}
      onOptionHoverLeave={onHoverPreviewLeave}
      renderValue={() => (
        <span className={css.arrowTipValue}>
          <span className={css.arrowTipValuePreview}>
            <ArrowTipPreview side={property.side} preset={previewPreset} lineWidth={property.previewLineWidth} />
          </span>
          <span className={[css.arrowTipValueLabel, valueClassName ?? ""].filter(Boolean).join(" ")}>{displayLabel}</span>
        </span>
      )}
      renderOption={(option, state) => {
        const optionPreset = option.value as Exclude<ArrowTipPresetId, "custom">;
        return (
          <span className={css.arrowTipOption}>
            <span className={css.arrowTipOptionPreview}>
              <ArrowTipPreview side={property.side} preset={optionPreset} lineWidth={property.previewLineWidth} />
            </span>
            <span className={css.arrowTipOptionLabel}>{option.label}</span>
            <span className={css.arrowTipOptionCheck} aria-hidden="true">
              {state.selected ? "✓" : ""}
            </span>
          </span>
        );
      }}
    />
  );
}

export function renderDashStyleDropdown(
  property: {
    label: string;
    value: DashStylePresetId;
    previewLineWidth: number;
    options: Array<{ value: Exclude<DashStylePresetId, "custom">; label: string }>;
  },
  writable: boolean,
  onApply: (value: Exclude<DashStylePresetId, "custom">) => void,
  valueOverride?: DashStyleDropdownValue,
  valueClassName?: string,
  onHoverPreview?: (value: Exclude<DashStylePresetId, "custom">) => void,
  onHoverPreviewEnd?: () => void,
  onHoverPreviewLeave?: () => void
) {
  const dropdownValue: DashStyleDropdownValue = valueOverride ?? property.value;
  const dropdownOptions = toDashStyleDropdownOptions(property.options);
  const displayLabel = dashStyleValueLabel(dropdownValue, property.options);
  const previewPreset = dashStylePreviewPreset(dropdownValue);

  return (
    <CustomDropdown
      ariaLabel={property.label}
      value={dropdownValue}
      options={dropdownOptions}
      disabled={!writable}
      onChange={(nextValue) => {
        if (!writable || !isSelectableDashStyleValue(nextValue)) {
          return;
        }
        onApply(nextValue);
      }}
      onOptionHover={(nextValue) => {
        if (!writable || !isSelectableDashStyleValue(nextValue) || !onHoverPreview) {
          return;
        }
        onHoverPreview(nextValue);
      }}
      onOptionHoverEnd={onHoverPreviewEnd}
      onOptionHoverLeave={onHoverPreviewLeave}
      renderValue={() => (
        <span className={css.dashStyleValue}>
          <span className={css.dashStyleValuePreview}>
            <DashStylePreview preset={previewPreset} lineWidth={property.previewLineWidth} />
          </span>
          <span className={[css.dashStyleValueLabel, valueClassName ?? ""].filter(Boolean).join(" ")}>{displayLabel}</span>
        </span>
      )}
      renderOption={(option, state) => {
        const optionPreset = option.value as Exclude<DashStylePresetId, "custom">;
        return (
          <span className={css.dashStyleOption}>
            <span className={css.dashStyleOptionPreview}>
              <DashStylePreview preset={optionPreset} lineWidth={property.previewLineWidth} />
            </span>
            <span className={css.dashStyleOptionLabel}>{option.label}</span>
            <span className={css.dashStyleOptionCheck} aria-hidden="true">
              {state.selected ? "✓" : ""}
            </span>
          </span>
        );
      }}
    />
  );
}

export function renderLineCapDropdown(
  property: {
    label: string;
    value: LineCapPresetId;
    previewLineWidth: number;
    options: Array<{ value: Exclude<LineCapPresetId, "custom">; label: string }>;
  },
  writable: boolean,
  onApply: (value: Exclude<LineCapPresetId, "custom">) => void,
  valueOverride?: LineCapDropdownValue,
  valueClassName?: string,
  onHoverPreview?: (value: Exclude<LineCapPresetId, "custom">) => void,
  onHoverPreviewEnd?: () => void,
  onHoverPreviewLeave?: () => void
) {
  const dropdownValue: LineCapDropdownValue = valueOverride ?? property.value;
  const dropdownOptions = toLineCapDropdownOptions(property.options);
  const displayLabel = lineCapValueLabel(dropdownValue, property.options);
  const previewPreset = lineCapPreviewPreset(dropdownValue);

  return (
    <CustomDropdown
      ariaLabel={property.label}
      value={dropdownValue}
      options={dropdownOptions}
      disabled={!writable}
      onChange={(nextValue) => {
        if (!writable || !isSelectableLineCapValue(nextValue)) {
          return;
        }
        onApply(nextValue);
      }}
      onOptionHover={(nextValue) => {
        if (!writable || !isSelectableLineCapValue(nextValue) || !onHoverPreview) {
          return;
        }
        onHoverPreview(nextValue);
      }}
      onOptionHoverEnd={onHoverPreviewEnd}
      onOptionHoverLeave={onHoverPreviewLeave}
      renderValue={() => (
        <span className={css.lineCapValue}>
          <span className={css.lineCapValuePreview}>
            <LineCapPreview preset={previewPreset} lineWidth={property.previewLineWidth} />
          </span>
          <span className={[css.lineCapValueLabel, valueClassName ?? ""].filter(Boolean).join(" ")}>{displayLabel}</span>
        </span>
      )}
      renderOption={(option, state) => {
        const optionPreset = option.value as Exclude<LineCapPresetId, "custom">;
        return (
          <span className={css.lineCapOption}>
            <span className={css.lineCapOptionPreview}>
              <LineCapPreview preset={optionPreset} lineWidth={property.previewLineWidth} />
            </span>
            <span className={css.lineCapOptionLabel}>{option.label}</span>
            <span className={css.lineCapOptionCheck} aria-hidden="true">
              {state.selected ? "✓" : ""}
            </span>
          </span>
        );
      }}
    />
  );
}

export function renderLineJoinDropdown(
  property: {
    label: string;
    value: LineJoinPresetId;
    previewLineWidth: number;
    options: Array<{ value: Exclude<LineJoinPresetId, "custom">; label: string }>;
  },
  writable: boolean,
  onApply: (value: Exclude<LineJoinPresetId, "custom">) => void,
  valueOverride?: LineJoinDropdownValue,
  valueClassName?: string,
  onHoverPreview?: (value: Exclude<LineJoinPresetId, "custom">) => void,
  onHoverPreviewEnd?: () => void,
  onHoverPreviewLeave?: () => void
) {
  const dropdownValue: LineJoinDropdownValue = valueOverride ?? property.value;
  const dropdownOptions = toLineJoinDropdownOptions(property.options);
  const displayLabel = lineJoinValueLabel(dropdownValue, property.options);
  const previewPreset = lineJoinPreviewPreset(dropdownValue);

  return (
    <CustomDropdown
      ariaLabel={property.label}
      value={dropdownValue}
      options={dropdownOptions}
      disabled={!writable}
      onChange={(nextValue) => {
        if (!writable || !isSelectableLineJoinValue(nextValue)) {
          return;
        }
        onApply(nextValue);
      }}
      onOptionHover={(nextValue) => {
        if (!writable || !isSelectableLineJoinValue(nextValue) || !onHoverPreview) {
          return;
        }
        onHoverPreview(nextValue);
      }}
      onOptionHoverEnd={onHoverPreviewEnd}
      onOptionHoverLeave={onHoverPreviewLeave}
      renderValue={() => (
        <span className={css.lineJoinValue}>
          <span className={css.lineJoinValuePreview}>
            <LineJoinPreview preset={previewPreset} lineWidth={property.previewLineWidth} />
          </span>
          <span className={[css.lineJoinValueLabel, valueClassName ?? ""].filter(Boolean).join(" ")}>{displayLabel}</span>
        </span>
      )}
      renderOption={(option, state) => {
        const optionPreset = option.value as Exclude<LineJoinPresetId, "custom">;
        return (
          <span className={css.lineJoinOption}>
            <span className={css.lineJoinOptionPreview}>
              <LineJoinPreview preset={optionPreset} lineWidth={property.previewLineWidth} />
            </span>
            <span className={css.lineJoinOptionLabel}>{option.label}</span>
            <span className={css.lineJoinOptionCheck} aria-hidden="true">
              {state.selected ? "✓" : ""}
            </span>
          </span>
        );
      }}
    />
  );
}

export function renderPathMorphingDecorationDropdown(
  property: {
    label: string;
    value: PathMorphingDecorationPresetId;
    previewLineWidth: number;
    options: Array<{ value: Exclude<PathMorphingDecorationPresetId, "custom">; label: string }>;
  },
  writable: boolean,
  onApply: (value: Exclude<PathMorphingDecorationPresetId, "custom">) => void,
  valueOverride?: PathMorphingDecorationDropdownValue,
  valueClassName?: string,
  onHoverPreview?: (value: Exclude<PathMorphingDecorationPresetId, "custom">) => void,
  onHoverPreviewEnd?: () => void,
  onHoverPreviewLeave?: () => void
) {
  const dropdownValue: PathMorphingDecorationDropdownValue = valueOverride ?? property.value;
  const dropdownOptions = toPathMorphingDecorationDropdownOptions(property.options);
  const displayLabel = pathMorphingDecorationValueLabel(dropdownValue, property.options);
  const previewPreset = pathMorphingDecorationPreviewPreset(dropdownValue);

  return (
    <CustomDropdown
      ariaLabel={property.label}
      value={dropdownValue}
      options={dropdownOptions}
      disabled={!writable}
      onChange={(nextValue) => {
        if (!writable || !isSelectablePathMorphingDecorationValue(nextValue)) {
          return;
        }
        onApply(nextValue);
      }}
      onOptionHover={(nextValue) => {
        if (!writable || !isSelectablePathMorphingDecorationValue(nextValue) || !onHoverPreview) {
          return;
        }
        onHoverPreview(nextValue);
      }}
      onOptionHoverEnd={onHoverPreviewEnd}
      onOptionHoverLeave={onHoverPreviewLeave}
      renderValue={() => (
        <span className={css.pathMorphingDecorationValue}>
          <span className={css.pathMorphingDecorationValuePreview}>
            <PathMorphingDecorationPreview preset={previewPreset} lineWidth={property.previewLineWidth} />
          </span>
          <span className={[css.pathMorphingDecorationValueLabel, valueClassName ?? ""].filter(Boolean).join(" ")}>{displayLabel}</span>
        </span>
      )}
      renderOption={(option, state) => {
        const optionPreset = option.value as Exclude<PathMorphingDecorationPresetId, "custom">;
        return (
          <span className={css.pathMorphingDecorationOption}>
            <span className={css.pathMorphingDecorationOptionPreview}>
              <PathMorphingDecorationPreview preset={optionPreset} lineWidth={property.previewLineWidth} />
            </span>
            <span className={css.pathMorphingDecorationOptionLabel}>{option.label}</span>
            <span className={css.pathMorphingDecorationOptionCheck} aria-hidden="true">
              {state.selected ? "✓" : ""}
            </span>
          </span>
        );
      }}
    />
  );
}

export function renderFillModeDropdown(
  property: {
    label: string;
    value: FillModePresetId;
    options: Array<{ value: Exclude<FillModePresetId, "custom">; label: string }>;
  },
  writable: boolean,
  onApply: (value: Exclude<FillModePresetId, "custom">) => void,
  valueOverride?: FillModeDropdownValue,
  valueClassName?: string
) {
  const dropdownValue: FillModeDropdownValue = valueOverride ?? property.value;
  const dropdownOptions = toFillModeDropdownOptions(property.options);
  const displayLabel = fillModeValueLabel(dropdownValue, property.options);
  return (
    <CustomDropdown
      ariaLabel={property.label}
      value={dropdownValue}
      options={dropdownOptions}
      disabled={!writable}
      onChange={(nextValue) => {
        if (!writable || !isSelectableFillModeValue(nextValue)) {
          return;
        }
        onApply(nextValue);
      }}
      renderValue={() => <span className={valueClassName}>{displayLabel}</span>}
    />
  );
}

export function renderFillShadingDropdown(
  property: {
    label: string;
    value: FillShadingPresetId;
    options: Array<{ value: Exclude<FillShadingPresetId, "custom">; label: string }>;
  },
  writable: boolean,
  onApply: (value: Exclude<FillShadingPresetId, "custom">) => void,
  valueOverride?: FillShadingDropdownValue,
  valueClassName?: string
) {
  const dropdownValue: FillShadingDropdownValue = valueOverride ?? property.value;
  const dropdownOptions = toFillShadingDropdownOptions(property.options);
  const displayLabel = fillShadingValueLabel(dropdownValue, property.options);
  return (
    <CustomDropdown
      ariaLabel={property.label}
      value={dropdownValue}
      options={dropdownOptions}
      disabled={!writable}
      onChange={(nextValue) => {
        if (!writable || !isSelectableFillShadingValue(nextValue)) {
          return;
        }
        onApply(nextValue);
      }}
      renderValue={() => <span className={valueClassName}>{displayLabel}</span>}
    />
  );
}

export function renderFillPatternDropdown(
  property: {
    label: string;
    value: FillPatternPresetId;
    options: Array<{ value: Exclude<FillPatternPresetId, "custom">; label: string }>;
  },
  writable: boolean,
  onApply: (value: Exclude<FillPatternPresetId, "custom">) => void,
  valueOverride?: FillPatternDropdownValue,
  valueClassName?: string
) {
  const dropdownValue: FillPatternDropdownValue = valueOverride ?? property.value;
  const dropdownOptions = toFillPatternDropdownOptions(property.options);
  const displayLabel = fillPatternValueLabel(dropdownValue, property.options);
  const previewPreset = fillPatternPreviewPreset(dropdownValue);
  return (
    <CustomDropdown
      ariaLabel={property.label}
      value={dropdownValue}
      options={dropdownOptions}
      disabled={!writable}
      onChange={(nextValue) => {
        if (!writable || !isSelectableFillPatternValue(nextValue)) {
          return;
        }
        onApply(nextValue);
      }}
      renderValue={() => (
        <span className={css.fillPatternValue}>
          <span className={css.fillPatternValuePreview}>
            <FillPatternPreview preset={previewPreset} />
          </span>
          <span className={[css.fillPatternValueLabel, valueClassName ?? ""].filter(Boolean).join(" ")}>{displayLabel}</span>
        </span>
      )}
      renderOption={(option, state) => {
        const optionPreset = option.value as Exclude<FillPatternPresetId, "custom">;
        return (
          <span className={css.fillPatternOption}>
            <span className={css.fillPatternOptionPreview}>
              <FillPatternPreview preset={optionPreset} />
            </span>
            <span className={css.fillPatternOptionLabel}>{option.label}</span>
            <span className={css.fillPatternOptionCheck} aria-hidden="true">
              {state.selected ? "✓" : ""}
            </span>
          </span>
        );
      }}
    />
  );
}

export function renderNodeShapeDropdown(
  property: {
    label: string;
    value: NodeShapePresetId;
    options: Array<{ value: Exclude<NodeShapePresetId, "custom">; label: string }>;
  },
  writable: boolean,
  onApply: (value: Exclude<NodeShapePresetId, "custom">) => void,
  valueOverride?: NodeShapeDropdownValue,
  valueClassName?: string,
  onHoverPreview?: (value: Exclude<NodeShapePresetId, "custom">) => void,
  onHoverPreviewEnd?: () => void,
  onHoverPreviewLeave?: () => void
) {
  const dropdownValue: NodeShapeDropdownValue = valueOverride ?? property.value;
  const dropdownOptions = toNodeShapeDropdownOptions(property.options);
  const displayLabel = nodeShapeValueLabel(dropdownValue, property.options);
  return (
    <CustomDropdown
      ariaLabel={property.label}
      value={dropdownValue}
      options={dropdownOptions}
      disabled={!writable}
      onChange={(nextValue) => {
        if (!writable || !isSelectableNodeShapeValue(nextValue)) {
          return;
        }
        onApply(nextValue);
      }}
      onOptionHover={(nextValue) => {
        if (!writable || !isSelectableNodeShapeValue(nextValue) || !onHoverPreview) {
          onHoverPreviewLeave?.();
          return;
        }
        onHoverPreview(nextValue);
      }}
      onOptionHoverEnd={onHoverPreviewEnd}
      onOptionHoverLeave={onHoverPreviewLeave}
      renderValue={() => <span className={valueClassName}>{displayLabel}</span>}
    />
  );
}

export function renderNodeFontSizeDropdown(
  property: {
    label: string;
    value: NodeFontSizePresetId;
    options: Array<{ value: Exclude<NodeFontSizePresetId, "custom">; label: string }>;
    customSizePt: number | null;
  },
  writable: boolean,
  onApply: (value: Exclude<NodeFontSizePresetId, "custom">) => void,
  valueOverride?: NodeFontSizeDropdownValue,
  valueClassName?: string,
  onHoverPreview?: (value: Exclude<NodeFontSizePresetId, "custom">) => void,
  onHoverPreviewEnd?: () => void,
  onHoverPreviewLeave?: () => void
) {
  const dropdownValue: NodeFontSizeDropdownValue = valueOverride ?? property.value;
  const dropdownOptions = toNodeFontSizeDropdownOptions(property.options);
  const displayLabel = nodeFontSizeValueLabel(dropdownValue, property.options, property.customSizePt);
  return (
    <CustomDropdown
      ariaLabel={property.label}
      value={dropdownValue}
      options={dropdownOptions}
      disabled={!writable}
      onChange={(nextValue) => {
        if (!writable || !isSelectableNodeFontSizeValue(nextValue)) {
          return;
        }
        onApply(nextValue);
      }}
      onOptionHover={(nextValue) => {
        if (!writable || !isSelectableNodeFontSizeValue(nextValue) || !onHoverPreview) {
          onHoverPreviewLeave?.();
          return;
        }
        onHoverPreview(nextValue);
      }}
      onOptionHoverEnd={onHoverPreviewEnd}
      onOptionHoverLeave={onHoverPreviewLeave}
      renderValue={() => <span className={valueClassName}>{displayLabel}</span>}
      renderOption={(option) => {
        const ptLabel = nodeFontSizePresetPtLabel(option.value as Exclude<NodeFontSizePresetId, "custom">);
        return (
          <span className={css.nodeFontSizeOption}>
            <span className={css.nodeFontSizeOptionLabel}>{option.label}</span>
            <span className={css.nodeFontSizeOptionPt}>{ptLabel}</span>
          </span>
        );
      }}
    />
  );
}

export function renderShadowPresetDropdown(
  property: {
    label: string;
    value: ShadowPresetId;
    options: ShadowPresetOption[];
  },
  writable: boolean,
  onApply: (value: ShadowPresetId) => void,
  valueOverride?: ShadowPresetDropdownValue,
  valueClassName?: string
) {
  const dropdownValue: ShadowPresetDropdownValue = valueOverride ?? property.value;
  const dropdownOptions = toShadowPresetDropdownOptions(property.options);
  const displayLabel = shadowPresetValueLabel(dropdownValue, property.options);
  return (
    <CustomDropdown
      ariaLabel={property.label}
      value={dropdownValue}
      options={dropdownOptions}
      disabled={!writable}
      onChange={(nextValue) => {
        if (!writable || !isSelectableShadowPresetValue(nextValue)) {
          return;
        }
        onApply(nextValue);
      }}
      renderValue={() => <span className={valueClassName}>{displayLabel}</span>}
    />
  );
}

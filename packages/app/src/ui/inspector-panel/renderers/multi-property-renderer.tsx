import { formatNumber } from "tikz-editor/edit/format";
import type { NodeFontFamilyId, NodeFontSizePresetId } from "tikz-editor/edit/inspector";
import { ColorPickerField } from "../../ColorPicker";
import { CustomDropdown } from "../../CustomDropdown";
import css from "../InspectorPanel.module.css";
import {
ARROW_TIP_MIXED_OPTION_VALUE,
DASH_STYLE_MIXED_OPTION_VALUE,
FILL_MODE_MIXED_OPTION_VALUE,
FILL_PATTERN_MIXED_OPTION_VALUE,
FILL_SHADING_MIXED_OPTION_VALUE,
LINE_CAP_MIXED_OPTION_VALUE,
LINE_JOIN_MIXED_OPTION_VALUE,
LINE_WIDTH_CUSTOM_OPTION_VALUE,
LINE_WIDTH_DROPDOWN_OPTIONS,
LINE_WIDTH_MIXED_OPTION_VALUE,
LINE_WIDTH_PRESET_BY_LABEL,
LineWidthPreview,
NODE_SHAPE_MIXED_OPTION_VALUE,
PATH_MORPHING_DECORATION_MIXED_OPTION_VALUE,
SHADOW_PRESET_MIXED_OPTION_VALUE,
clampNumber,
isPathMorphingSuboptionPropertyId,
lineWidthPresetLabelFromValue,
lineWidthPreviewLineWidth,
lineWidthValueLabel,
type ArrowTipDropdownValue,
type DashStyleDropdownValue,
type FillModeDropdownValue,
type FillPatternDropdownValue,
type FillShadingDropdownValue,
type LineCapDropdownValue,
type LineJoinDropdownValue,
type LineWidthDropdownValue,
type MultiInspectorProperty,
type NodeShapeDropdownValue,
type PathMorphingDecorationDropdownValue
} from "../panel-helpers";
import {
renderArrowTipDropdown,
renderDashStyleDropdown,
renderFillModeDropdown,
renderFillPatternDropdown,
renderFillShadingDropdown,
renderLineCapDropdown,
renderLineJoinDropdown,
renderNodeShapeDropdown,
renderPathMorphingDecorationDropdown,
renderShadowPresetDropdown
} from "../property-dropdowns";
import type { RenderPropertyApi } from "../property-renderer-types";
export function renderMultiInspectorProperty(property: MultiInspectorProperty, api: RenderPropertyApi) {
  const {
    renderedMultiPropertyProvenance,
    implicitDefaultProvenance,
    withValueProvenanceClass,
    renderMultiNumberField,
    renderMultiLengthField,
    renderMultiOptionalLengthField,
    renderReadOnlyReasonNote,
    renderNodeTextAlignToolbar,
    renderScrubbableNumberLabel,
    maybeWrapWithProvenanceTooltip,
    commitAfterHoverPreview,
    applyNodeShapeValueMany,
    applyHoverPreview,
    clearHoverPreviewSession,
    restoreHoverPreviewBase,
    renderNodeFontToolbar,
    applyNodeFontValueMany,
    normalizeColorSetPropertyChange,
    applySetPropertyMany,
    projectNamedColorSwatches,
    applyFillModeValueMany,
    setFillAdvancedOptionsOpen,
    applyFillShadingValueMany,
    applyFillPatternValueMany,
    applyMultiFillPatternOptionValue,
    manualLineWidthCustomKeys,
    enableManualCustomLineWidth,
    disableManualCustomLineWidth,
    applyDashStyleValueMany,
    applyLineCapValueMany,
    applyLineJoinValueMany,
    applyPathMorphingDecorationValueMany,
    applyRoundedCornersValueMany,
    applyArrowTipValueMany,
    applyShadowPresetValue
  } = api;
    const provenance = renderedMultiPropertyProvenance[property.id] ?? implicitDefaultProvenance(property);
    const valueClassName = withValueProvenanceClass(undefined, provenance);
    const propertyClassName = isPathMorphingSuboptionPropertyId(property.id)
      ? `${css.property} ${css.subProperty}`
      : css.property;
    if (property.kind === "enum") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      const mixedValue = "__mixed-enum__";
      const dropdownValue = property.mixed ? mixedValue : property.value;
      const dropdownOptions = property.mixed
        ? [{ value: mixedValue, label: "Mixed" }, ...property.options]
        : property.options;
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            <CustomDropdown
              ariaLabel={property.label}
              value={dropdownValue}
              options={dropdownOptions}
              disabled={!writable}
              onChange={(nextValue) => {
                if (nextValue === mixedValue) {
                  return;
                }
                applySetPropertyMany(property.writes, nextValue);
              }}
              renderValue={() => {
                const active = dropdownOptions.find((option) => option.value === dropdownValue);
                return <span className={valueClassName}>{active?.label ?? ""}</span>;
              }}
            />,
            true
          )}
          {renderReadOnlyReasonNote(property.readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "boolean") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      return (
        <div key={property.id} className={propertyClassName}>
          <label className={css.checkboxControl}>
            <input
              className={css.checkboxInput}
              type="checkbox"
              checked={property.value}
              ref={(input) => {
                if (input) {
                  input.indeterminate = property.mixed;
                }
              }}
              disabled={!writable}
              onChange={(event) => {
                const nextChecked = event.currentTarget.checked;
                applySetPropertyMany(
                  property.writes,
                  nextChecked ? (property.trueValue ?? "true") : (property.falseValue ?? "false"),
                  { clearKeys: property.clearKeys }
                );
              }}
            />
            <span className={withValueProvenanceClass(css.checkboxLabel, provenance)}>{property.label}</span>
          </label>
          {renderReadOnlyReasonNote(property.readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "number") {
      return (
        <div key={property.id} className={propertyClassName}>
          {renderMultiNumberField(property, false, provenance)}
        </div>
      );
    }

    if (property.kind === "length") {
      return (
        <div key={property.id} className={propertyClassName}>
          {renderMultiLengthField(property, false, provenance)}
        </div>
      );
    }

    if (property.kind === "optionalLength") {
      return (
        <div key={property.id} className={propertyClassName}>
          {renderMultiOptionalLengthField(property, true, provenance)}
        </div>
      );
    }

    if (property.kind === "nodeTextAlign") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderNodeTextAlignToolbar(
              {
                value: property.value,
                mixed: property.mixed
              },
              writable,
              (nextValue: "unset" | "left" | "center" | "right" | "justify") =>
                { applySetPropertyMany(property.writes, nextValue === "unset" ? "" : nextValue, {
                  clearKeys: property.clearKeys
                }); }
            ),
            true
          )}
          {renderReadOnlyReasonNote(property.readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "nodeShape") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      const dropdownValue: NodeShapeDropdownValue = property.mixed
        ? NODE_SHAPE_MIXED_OPTION_VALUE
        : property.value;
      const previewOwnerKey = `multi-node-shape:${property.id}`;
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderNodeShapeDropdown(
              {
                label: property.label,
                value: property.value,
                options: property.options
              },
              writable,
              (nextValue) =>
                { commitAfterHoverPreview(previewOwnerKey, () =>
                  { applyNodeShapeValueMany(property.writes, nextValue); }
                ); },
              dropdownValue,
              valueClassName,
              (nextValue) =>
                { applyHoverPreview(previewOwnerKey, () =>
                  { applyNodeShapeValueMany(property.writes, nextValue, { recordInHistory: false }); }
                ); },
              () => { clearHoverPreviewSession(previewOwnerKey); },
              () => { restoreHoverPreviewBase(previewOwnerKey); }
            ),
            true
          )}
          {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
          {renderReadOnlyReasonNote(property.readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "nodeFont") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      const nextWeight = property.weightMixed || property.weight === "normal" ? "bold" : "normal";
      const nextStyle = property.styleMixed || property.style === "normal" ? "italic" : "normal";
      const previewOwnerKey = `multi-node-font-size:${property.id}`;
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderNodeFontToolbar(
            {
              family: property.family,
              familyMixed: property.familyMixed,
              weight: property.weight,
              weightMixed: property.weightMixed,
              style: property.style,
              styleMixed: property.styleMixed,
              sizePreset: property.sizePreset,
              sizePresetMixed: property.sizePresetMixed,
              customSizePt: property.customSizePt,
              sizeOptions: property.sizeOptions,
              label: property.label
            },
            writable,
            (nextFamily: NodeFontFamilyId) =>
              { applyNodeFontValueMany(property.writes, property.contexts, {
                family: nextFamily
              }); },
            () =>
              { applyNodeFontValueMany(property.writes, property.contexts, {
                weight: nextWeight
              }); },
            () =>
              { applyNodeFontValueMany(property.writes, property.contexts, {
                style: nextStyle
              }); },
            (nextSizePreset: NodeFontSizePresetId) =>
              { commitAfterHoverPreview(previewOwnerKey, () =>
                { applyNodeFontValueMany(property.writes, property.contexts, {
                  sizePreset: nextSizePreset
                }); }
              ); },
            valueClassName,
            (nextSizePreset: NodeFontSizePresetId) =>
              { applyHoverPreview(previewOwnerKey, () =>
                { applyNodeFontValueMany(
                  property.writes,
                  property.contexts,
                  {
                    sizePreset: nextSizePreset
                  },
                  { recordInHistory: false }
                ); }
              ); },
            () => { clearHoverPreviewSession(previewOwnerKey); },
            () => { restoreHoverPreviewBase(previewOwnerKey); }
            ),
            true
          )}
          {property.notes.map((note) => (
            <div key={`${property.id}:${note}`} className={css.propertyNote}>
              {note}
            </div>
          ))}
          {renderReadOnlyReasonNote(property.readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "color") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            <ColorPickerField
              ariaLabel={property.label}
              value={property.mixed ? null : (property.value ?? "none")}
              syntaxValue={property.mixed ? null : property.syntaxValue}
              mixed={property.mixed}
              options={property.options}
              namedColorSwatches={projectNamedColorSwatches}
              disabled={!writable}
              triggerLabelClassName={valueClassName}
              onChange={(nextValue) => {
                const firstWrite = property.writes[0];
                if (!firstWrite) {
                  return;
                }
                const change = normalizeColorSetPropertyChange(firstWrite, nextValue, property.syntaxValue);
                applySetPropertyMany(property.writes, change.value, {
                  clearKeys: change.clearKeys
                });
              }}
            />,
            true
          )}
          {renderReadOnlyReasonNote(property.readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "fillMode") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      const dropdownValue: FillModeDropdownValue = property.mixed
        ? FILL_MODE_MIXED_OPTION_VALUE
        : property.value;
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderFillModeDropdown(
              {
                label: property.label,
                value: property.value,
                options: property.options
              },
              writable,
              (nextValue) => {
                applyFillModeValueMany(property.writes, nextValue, property.contexts);
                setFillAdvancedOptionsOpen(nextValue !== "solid");
              },
              dropdownValue,
              valueClassName
            ),
            true
          )}
          {renderReadOnlyReasonNote(property.readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "fillShading") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      const dropdownValue: FillShadingDropdownValue = property.mixed
        ? FILL_SHADING_MIXED_OPTION_VALUE
        : property.value;
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderFillShadingDropdown(
              {
                label: property.label,
                value: property.value,
                options: property.options
              },
              writable,
              (nextValue) => { applyFillShadingValueMany(property.writes, nextValue); },
              dropdownValue,
              valueClassName
            ),
            true
          )}
          {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
          {renderReadOnlyReasonNote(property.readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "fillPattern") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      const dropdownValue: FillPatternDropdownValue = property.mixed
        ? FILL_PATTERN_MIXED_OPTION_VALUE
        : property.value;
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderFillPatternDropdown(
              {
                label: property.label,
                value: property.value,
                options: property.options
              },
              writable,
              (nextValue) => { applyFillPatternValueMany(property.writes, nextValue); },
              dropdownValue,
              valueClassName
            ),
            true
          )}
          {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
          {renderReadOnlyReasonNote(property.readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "fillPatternOption") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      return (
        <div key={property.id} className={propertyClassName}>
          {renderScrubbableNumberLabel(property.label, {
            writable,
            value: property.value,
            step: property.step,
            onPreview: (next: number) => { applyMultiFillPatternOptionValue(property, next, { recordInHistory: false }); },
            onCommit: (next: number) => { applyMultiFillPatternOptionValue(property, next); }
          })}
          <div className={css.controlRow}>
            {maybeWrapWithProvenanceTooltip(
              provenance,
              <input
                className={withValueProvenanceClass(css.numberInput, provenance)}
                type="number"
                step={property.step}
                value={property.mixed ? "" : formatNumber(property.value)}
                disabled={!writable}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (!Number.isFinite(next)) {
                    return;
                  }
                  applyMultiFillPatternOptionValue(property, next);
                }}
              />,
              true
            )}
            {property.unit ? <span className={css.unitLabel}>{property.unit}</span> : null}
          </div>
          {renderReadOnlyReasonNote(property.readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "lineWidth") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      const elementIds = property.writes
        .map((write) => write.elementId)
        .filter((id) => id.length > 0)
        .sort();
      const lineWidthKey = `multi:${property.id}:${elementIds.join("|")}`;
      const previewOwnerKey = `multi-line-width:${lineWidthKey}`;
      const presetLabel = property.mixed ? null : lineWidthPresetLabelFromValue(property.value);
      const showCustomRange =
        manualLineWidthCustomKeys.has(lineWidthKey) || (!property.mixed && presetLabel == null);
      const dropdownValue: LineWidthDropdownValue = showCustomRange
        ? LINE_WIDTH_CUSTOM_OPTION_VALUE
        : property.mixed
          ? LINE_WIDTH_MIXED_OPTION_VALUE
          : (presetLabel ?? LINE_WIDTH_CUSTOM_OPTION_VALUE);
      const sliderValue = property.mixed ? property.averageValue : property.value;
      const dropdownDisplayLabel = lineWidthValueLabel(dropdownValue);
      const dropdownPreviewLineWidth = lineWidthPreviewLineWidth(dropdownValue, sliderValue);
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            <CustomDropdown
              ariaLabel={`${property.label} preset`}
              value={dropdownValue}
              options={LINE_WIDTH_DROPDOWN_OPTIONS}
              disabled={!writable}
              onChange={(nextValue) => {
                commitAfterHoverPreview(previewOwnerKey, () => {
                  if (!writable) {
                    return;
                  }
                  if (nextValue === LINE_WIDTH_CUSTOM_OPTION_VALUE) {
                    enableManualCustomLineWidth(lineWidthKey);
                    return;
                  }
                  const presetValue = LINE_WIDTH_PRESET_BY_LABEL.get(nextValue);
                  if (presetValue == null) {
                    return;
                  }
                  disableManualCustomLineWidth(lineWidthKey);
                  applySetPropertyMany(property.writes, "true", {
                    key: nextValue,
                    propertyId: "line-width"
                  });
                });
              }}
              onOptionHover={(nextValue) => {
                if (!writable) {
                  return;
                }
                const presetValue = LINE_WIDTH_PRESET_BY_LABEL.get(nextValue);
                if (presetValue == null) {
                  restoreHoverPreviewBase(previewOwnerKey);
                  return;
                }
                applyHoverPreview(previewOwnerKey, () => {
                  applySetPropertyMany(property.writes, "true", {
                    key: nextValue,
                    propertyId: "line-width",
                    recordInHistory: false
                  });
                });
              }}
              onOptionHoverEnd={() => { clearHoverPreviewSession(previewOwnerKey); }}
              onOptionHoverLeave={() => { restoreHoverPreviewBase(previewOwnerKey); }}
              renderValue={() => {
                return (
                  <span className={css.lineWidthValue}>
                    <span className={css.lineWidthValuePreview}>
                      <LineWidthPreview lineWidth={dropdownPreviewLineWidth} />
                    </span>
                    <span className={[css.lineWidthValueLabel, valueClassName ?? ""].filter(Boolean).join(" ")}>{dropdownDisplayLabel}</span>
                  </span>
                );
              }}
              renderOption={(option, state) => {
                const previewValue = lineWidthPreviewLineWidth(option.value, sliderValue);
                return (
                  <span className={css.lineWidthOption}>
                    <span className={css.lineWidthOptionPreview}>
                      <LineWidthPreview lineWidth={previewValue} />
                    </span>
                    <span className={css.lineWidthOptionLabel}>{option.label}</span>
                    <span className={css.lineWidthOptionCheck} aria-hidden="true">
                      {state.selected ? "✓" : ""}
                    </span>
                  </span>
                );
              }}
            />,
            true
          )}
          {showCustomRange ? (
            <>
              <input
                className={css.rangeInput}
                type="range"
                min={property.min}
                max={property.max}
                step={property.step}
                value={sliderValue}
                disabled={!writable}
                onChange={(event) => {
                  if (!writable) return;
                  const next = Number(event.currentTarget.value);
                  if (!Number.isFinite(next)) return;
                  applySetPropertyMany(property.writes, `${formatNumber(next)}pt`, {
                    key: "line width",
                    propertyId: "line-width"
                  });
                }}
              />
            </>
          ) : null}
          {renderReadOnlyReasonNote(property.readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "dashStyle") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      const dropdownValue: DashStyleDropdownValue = property.mixed ? DASH_STYLE_MIXED_OPTION_VALUE : property.value;
      const previewOwnerKey = `multi-dash-style:${property.id}`;
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderDashStyleDropdown(
              {
                label: property.label,
                value: property.value,
                previewLineWidth: property.previewLineWidth,
                options: property.options
              },
              writable,
              (nextValue) =>
                { commitAfterHoverPreview(previewOwnerKey, () =>
                  { applyDashStyleValueMany(property.writes, nextValue); }
                ); },
              dropdownValue,
              valueClassName,
              (nextValue) =>
                { applyHoverPreview(previewOwnerKey, () =>
                  { applyDashStyleValueMany(property.writes, nextValue, { recordInHistory: false }); }
                ); },
              () => { clearHoverPreviewSession(previewOwnerKey); },
              () => { restoreHoverPreviewBase(previewOwnerKey); }
            ),
            true
          )}
          {renderReadOnlyReasonNote(property.readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "lineCap") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      const dropdownValue: LineCapDropdownValue = property.mixed ? LINE_CAP_MIXED_OPTION_VALUE : property.value;
      const previewOwnerKey = `multi-line-cap:${property.id}`;
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderLineCapDropdown(
            {
              label: property.label,
              value: property.value,
              previewLineWidth: property.previewLineWidth,
              options: property.options
            },
            writable,
            (nextValue) =>
              { commitAfterHoverPreview(previewOwnerKey, () =>
                { applyLineCapValueMany(property.writes, nextValue); }
              ); },
            dropdownValue,
            valueClassName,
            (nextValue) =>
              { applyHoverPreview(previewOwnerKey, () =>
                { applyLineCapValueMany(property.writes, nextValue, { recordInHistory: false }); }
              ); },
            () => { clearHoverPreviewSession(previewOwnerKey); },
            () => { restoreHoverPreviewBase(previewOwnerKey); }
            ),
            true
          )}
          {renderReadOnlyReasonNote(property.readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "lineJoin") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      const dropdownValue: LineJoinDropdownValue = property.mixed ? LINE_JOIN_MIXED_OPTION_VALUE : property.value;
      const previewOwnerKey = `multi-line-join:${property.id}`;
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderLineJoinDropdown(
            {
              label: property.label,
              value: property.value,
              previewLineWidth: property.previewLineWidth,
              options: property.options
            },
            writable,
            (nextValue) =>
              { commitAfterHoverPreview(previewOwnerKey, () =>
                { applyLineJoinValueMany(property.writes, nextValue); }
              ); },
            dropdownValue,
            valueClassName,
            (nextValue) =>
              { applyHoverPreview(previewOwnerKey, () =>
                { applyLineJoinValueMany(property.writes, nextValue, { recordInHistory: false }); }
              ); },
            () => { clearHoverPreviewSession(previewOwnerKey); },
            () => { restoreHoverPreviewBase(previewOwnerKey); }
            ),
            true
          )}
          {renderReadOnlyReasonNote(property.readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "pathMorphingDecoration") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      const dropdownValue: PathMorphingDecorationDropdownValue = property.mixed
        ? PATH_MORPHING_DECORATION_MIXED_OPTION_VALUE
        : property.value;
      const previewOwnerKey = `multi-path-morphing:${property.id}`;
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderPathMorphingDecorationDropdown(
            {
              label: property.label,
              value: property.value,
              previewLineWidth: property.previewLineWidth,
              options: property.options
            },
            writable,
            (nextValue) =>
              { commitAfterHoverPreview(previewOwnerKey, () =>
                { applyPathMorphingDecorationValueMany(property.writes, nextValue); }
              ); },
            dropdownValue,
            valueClassName,
            (nextValue) =>
              { applyHoverPreview(previewOwnerKey, () =>
                { applyPathMorphingDecorationValueMany(property.writes, nextValue, { recordInHistory: false }); }
              ); },
            () => { clearHoverPreviewSession(previewOwnerKey); },
            () => { restoreHoverPreviewBase(previewOwnerKey); }
            ),
            true
          )}
          {renderReadOnlyReasonNote(property.readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "roundedCorners") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      const minRadius = property.min;
      const maxRadius = Math.max(minRadius, property.max);
      const defaultRadius = clampNumber(property.defaultRadius, minRadius, maxRadius);
      const selectedRadius = property.mixed ? property.averageRadius : property.radius;
      const sliderValue = clampNumber(selectedRadius, minRadius, maxRadius);
      return (
        <div key={property.id} className={propertyClassName}>
          <label className={css.checkboxControl}>
            <input
              className={css.checkboxInput}
              type="checkbox"
              checked={property.mixed ? false : property.enabled}
              disabled={!writable}
              ref={(input) => {
                if (input) {
                  input.indeterminate = property.mixed;
                }
              }}
              onChange={(event) =>
                { applyRoundedCornersValueMany(
                  property.writes,
                  event.currentTarget.checked,
                  event.currentTarget.checked ? sliderValue : defaultRadius,
                  property.disableRequiresSharpCorners
                ); }}
            />
            <span className={withValueProvenanceClass(css.checkboxLabel, provenance)}>{property.label}</span>
          </label>
          {property.enabled || property.anyEnabled ? (
            <div className={css.roundedCornersControl}>
              <input
                className={css.rangeInput}
                type="range"
                min={minRadius}
                max={maxRadius}
                step={property.step}
                value={sliderValue}
                disabled={!writable}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (!Number.isFinite(next)) {
                    return;
                  }
                  applyRoundedCornersValueMany(property.writes, true, clampNumber(next, minRadius, maxRadius));
                }}
              />
              <span className={css.roundedCornersValue}>{`${formatNumber(sliderValue)}pt`}</span>
            </div>
          ) : null}
          {renderReadOnlyReasonNote(property.readOnlyReason)}
        </div>
      );
    }

  if (property.kind === "arrowTip") {
    const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
    const dropdownValue: ArrowTipDropdownValue = property.mixed
      ? ARROW_TIP_MIXED_OPTION_VALUE
      : property.value;
    const previewOwnerKey = `multi-arrow-tip:${property.id}:${property.side}`;

    return (
      <div key={property.id} className={propertyClassName}>
        <div className={css.propertyLabel}>{property.label}</div>
        {maybeWrapWithProvenanceTooltip(
          provenance,
          renderArrowTipDropdown(
          {
            id: property.id,
            label: property.label,
            side: property.side,
            value: property.value,
            options: property.options,
            previewLineWidth: property.previewLineWidth
          },
          writable,
          (nextValue) =>
            { commitAfterHoverPreview(previewOwnerKey, () =>
              { applyArrowTipValueMany(property.writes, property.side, nextValue); }
            ); },
          dropdownValue,
          valueClassName,
          (nextValue) =>
            { applyHoverPreview(previewOwnerKey, () =>
              { applyArrowTipValueMany(property.writes, property.side, nextValue, { recordInHistory: false }); }
            ); },
          () => { clearHoverPreviewSession(previewOwnerKey); },
          () => { restoreHoverPreviewBase(previewOwnerKey); }
          ),
          true
        )}
        {renderReadOnlyReasonNote(property.readOnlyReason)}
      </div>
    );
  }

  if (property.kind === "shadowPreset") {
    const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
    const dropdownValue = property.mixed ? SHADOW_PRESET_MIXED_OPTION_VALUE : property.value;
    return (
      <div key={property.id} className={propertyClassName}>
        <div className={css.propertyLabel}>{property.label}</div>
        {maybeWrapWithProvenanceTooltip(
          provenance,
          renderShadowPresetDropdown(
            {
              label: property.label,
              value: property.value,
              options: property.options
            },
            writable,
            (nextValue) => {
              for (let i = 0; i < property.writes.length; i++) {
                const write = property.writes[i];
                const context = property.contexts[i];
                if (write && context) {
                  applyShadowPresetValue(write, context, nextValue);
                }
              }
            },
            dropdownValue,
            valueClassName
          ),
          true
        )}
        {renderReadOnlyReasonNote(property.readOnlyReason)}
      </div>
    );
  }

  return null;
}

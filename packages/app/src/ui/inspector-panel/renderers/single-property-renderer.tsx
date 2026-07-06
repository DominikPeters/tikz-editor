import { formatNumber } from "tikz-editor/edit/format";
import type { InspectorProperty, NodeFontFamilyId, NodeFontSizePresetId } from "tikz-editor/edit/inspector";
import { ColorPickerField } from "../../ColorPicker";
import { CustomDropdown } from "../../CustomDropdown";
import css from "../InspectorPanel.module.css";
import { getInspectorPropertyCapabilityStatus } from "../../capabilities";
import {
LINE_WIDTH_CUSTOM_OPTION_VALUE,
LINE_WIDTH_DROPDOWN_OPTIONS,
LINE_WIDTH_PRESET_BY_LABEL,
LineWidthPreview,
clampNumber,
isPathMorphingSuboptionPropertyId,
lineWidthPreviewLineWidth,
lineWidthValueLabel,
type LineWidthDropdownValue
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
export function renderSingleInspectorProperty(property: InspectorProperty, api: RenderPropertyApi) {
  const {
    renderedSinglePropertyProvenance,
    implicitDefaultProvenance,
    withValueProvenanceClass,
    renderSingleTextField,
    renderSingleNumberField,
    renderSingleLengthField,
    renderSingleOptionalLengthField,
    renderReadOnlyReasonNote,
    renderNodeTextAlignToolbar,
    renderScrubbableNumberLabel,
    maybeWrapWithProvenanceTooltip,
    commitAfterHoverPreview,
    applyNodeShapeValue,
    applyHoverPreview,
    clearHoverPreviewSession,
    restoreHoverPreviewBase,
    renderNodeFontToolbar,
    applyNodeFontValue,
    normalizeColorSetPropertyChange,
    applySetProperty,
    projectNamedColorSwatches,
    applyFillModeValue,
    setFillAdvancedOptionsOpen,
    applyFillShadingValue,
    applyFillPatternValue,
    applySingleFillPatternOptionValue,
    manualLineWidthCustomKeys,
    enableManualCustomLineWidth,
    disableManualCustomLineWidth,
    applyDashStyleValue,
    applyLineCapValue,
    applyLineJoinValue,
    applyPathMorphingDecorationValue,
    applyRoundedCornersValue,
    applyArrowTipValue,
    applyShadowPropertyValue,
    applyShadowPresetValue
  } = api;
    const provenance = renderedSinglePropertyProvenance[property.id] ?? implicitDefaultProvenance(property);
    const valueClassName = withValueProvenanceClass(undefined, provenance);
    const propertyClassName = isPathMorphingSuboptionPropertyId(property.id)
      ? `${css.property} ${css.subProperty}`
      : css.property;
    const capability = getInspectorPropertyCapabilityStatus(property);
    const capabilityReadOnlyReason =
      capability.status === "unsupported" ? capability.reason : null;
    const readOnlyReason = (() => {
      if (property.kind === "text") {
        return property.readOnlyReason ?? property.write.reason ?? capabilityReadOnlyReason;
      }
      if (property.kind === "number") {
        return property.readOnlyReason ?? property.write?.reason ?? capabilityReadOnlyReason;
      }
      if (property.kind === "length") {
        return property.readOnlyReason ?? property.write.reason ?? capabilityReadOnlyReason;
      }
      if (property.kind === "optionalLength") {
        return property.readOnlyReason ?? property.write.reason ?? capabilityReadOnlyReason;
      }
      if (property.kind === "nodeFont") {
        return property.write.reason ?? capabilityReadOnlyReason;
      }
      if (property.kind === "slider") {
        return property.readOnlyReason ?? property.write.reason ?? capabilityReadOnlyReason;
      }
      return property.write.reason ?? capabilityReadOnlyReason;
    })();

    if (property.kind === "text") {
      return (
        <div key={property.id} className={propertyClassName}>
          {renderSingleTextField(property, provenance)}
        </div>
      );
    }

    if (property.kind === "enum") {
      const writable = property.write.writable && capability.status !== "unsupported";
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            <CustomDropdown
              ariaLabel={property.label}
              value={property.value}
              options={property.options}
              disabled={!writable}
              onChange={(nextValue) => { applySetProperty(property.write, nextValue); }}
              renderValue={() => <span className={valueClassName}>{property.options.find((option) => option.value === property.value)?.label ?? property.value}</span>}
            />,
            true
          )}
          {renderReadOnlyReasonNote(readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "boolean") {
      const writable = property.write.writable && capability.status !== "unsupported";
      return (
        <div key={property.id} className={propertyClassName}>
          <label className={css.checkboxControl}>
            <input
              className={css.checkboxInput}
              type="checkbox"
              checked={property.value}
              disabled={!writable}
              onChange={(event) => {
                const nextChecked = event.currentTarget.checked;
                applySetProperty(
                  property.write,
                  nextChecked ? (property.trueValue ?? "true") : (property.falseValue ?? "false"),
                  { clearKeys: property.clearKeys }
                );
              }}
            />
            <span className={withValueProvenanceClass(css.checkboxLabel, provenance)}>{property.label}</span>
          </label>
          {renderReadOnlyReasonNote(readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "number") {
      return (
        <div key={property.id} className={propertyClassName}>
          {renderSingleNumberField(property, false, provenance)}
        </div>
      );
    }

    if (property.kind === "slider") {
      const writable = property.write.writable && capability.status !== "unsupported";
      const datalistId = `slider-ticks-${property.id}`;
      const readoutText = property.displayLabel ?? property.value.toFixed(2);
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.sliderHeaderRow}>
            <div className={css.propertyLabel}>{property.label}</div>
            <div className={`${css.sliderReadout} ${valueClassName}`}>{readoutText}</div>
          </div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            <input
              className={css.sliderInput}
              type="range"
              min={property.min}
              max={property.max}
              step={property.step}
              value={property.value}
              disabled={!writable}
              list={property.ticks && property.ticks.length > 0 ? datalistId : undefined}
              onInput={(event) => {
                const next = Number(event.currentTarget.value);
                if (!Number.isFinite(next)) return;
                applySetProperty(property.write, String(next), { recordInHistory: false });
              }}
              onChange={(event) => {
                const next = Number(event.currentTarget.value);
                if (!Number.isFinite(next)) return;
                applySetProperty(property.write, String(next));
              }}
            />,
            true
          )}
          {property.ticks && property.ticks.length > 0 ? (
            <datalist id={datalistId}>
              {property.ticks.map((tick) => (
                <option key={tick.value} value={tick.value} label={tick.label} />
              ))}
            </datalist>
          ) : null}
          {renderReadOnlyReasonNote(readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "length") {
      return (
        <div key={property.id} className={propertyClassName}>
          {renderSingleLengthField(property, false, provenance)}
        </div>
      );
    }

    if (property.kind === "optionalLength") {
      return (
        <div key={property.id} className={propertyClassName}>
          {renderSingleOptionalLengthField(property, true, provenance)}
        </div>
      );
    }

    if (property.kind === "nodeTextAlign") {
      const writable = property.write.writable && capability.status !== "unsupported";
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderNodeTextAlignToolbar(
              {
                value: property.value,
                mixed: false
              },
              writable,
              (nextValue: "unset" | "left" | "center" | "right" | "justify") =>
                { applySetProperty(property.write, nextValue === "unset" ? "" : nextValue, { clearKeys: property.clearKeys }); }
            ),
            true
          )}
          {renderReadOnlyReasonNote(readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "nodeShape") {
      const writable = property.write.writable && capability.status !== "unsupported";
      const previewOwnerKey = `node-shape:${property.write.elementId}:${property.id}`;
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
                  { applyNodeShapeValue(property.write, nextValue); }
                ); },
              undefined,
              valueClassName,
              (nextValue) =>
                { applyHoverPreview(previewOwnerKey, () =>
                  { applyNodeShapeValue(property.write, nextValue, { recordInHistory: false }); }
                ); },
              () => { clearHoverPreviewSession(previewOwnerKey); },
              () => { restoreHoverPreviewBase(previewOwnerKey); }
            ),
            true
          )}
          {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
          {renderReadOnlyReasonNote(readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "nodeFont") {
      const writable = property.write.writable && capability.status !== "unsupported";
      const previewOwnerKey = `node-font-size:${property.write.elementId}:${property.id}`;
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderNodeFontToolbar(
              {
                family: property.family,
                familyMixed: false,
                weight: property.weight,
                weightMixed: false,
                style: property.style,
                styleMixed: false,
                sizePreset: property.sizePreset,
                sizePresetMixed: false,
                customSizePt: property.customSizePt,
                sizeOptions: property.sizeOptions,
                label: property.label
              },
              writable,
              (nextFamily: NodeFontFamilyId) =>
                { applyNodeFontValue(property.write, property.context, {
                  family: nextFamily,
                  weight: property.weight,
                  style: property.style,
                  sizePreset: property.sizePreset,
                  customSizePt: property.customSizePt
                }); },
              () =>
                { applyNodeFontValue(property.write, property.context, {
                  family: property.family,
                  weight: property.weight === "bold" ? "normal" : "bold",
                  style: property.style,
                  sizePreset: property.sizePreset,
                  customSizePt: property.customSizePt
                }); },
              () =>
                { applyNodeFontValue(property.write, property.context, {
                  family: property.family,
                  weight: property.weight,
                  style: property.style === "italic" ? "normal" : "italic",
                  sizePreset: property.sizePreset,
                  customSizePt: property.customSizePt
                }); },
              (nextSizePreset: NodeFontSizePresetId) =>
                { commitAfterHoverPreview(previewOwnerKey, () =>
                  { applyNodeFontValue(property.write, property.context, {
                    family: property.family,
                    weight: property.weight,
                    style: property.style,
                    sizePreset: nextSizePreset,
                    customSizePt: property.customSizePt
                  }); }
                ); },
              valueClassName,
              (nextSizePreset: NodeFontSizePresetId) =>
                { applyHoverPreview(previewOwnerKey, () =>
                  { applyNodeFontValue(
                    property.write,
                    property.context,
                    {
                      family: property.family,
                      weight: property.weight,
                      style: property.style,
                      sizePreset: nextSizePreset,
                      customSizePt: property.customSizePt
                    },
                    { recordInHistory: false }
                  ); }
                ); },
              () => { clearHoverPreviewSession(previewOwnerKey); },
              () => { restoreHoverPreviewBase(previewOwnerKey); }
            ),
            true
          )}
          {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
          {renderReadOnlyReasonNote(readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "color") {
      const writable = property.write.writable && capability.status !== "unsupported";
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            <ColorPickerField
              ariaLabel={property.label}
              value={property.value ?? "none"}
              syntaxValue={property.syntaxValue}
              options={property.options}
              namedColorSwatches={projectNamedColorSwatches}
              disabled={!writable}
              triggerLabelClassName={valueClassName}
              onChange={(nextValue) => {
                if (property.write.shadowContext) {
                  applyShadowPropertyValue(property.write, property.id, nextValue);
                  return;
                }
                const change = normalizeColorSetPropertyChange(property.write, nextValue, property.syntaxValue);
                applySetProperty(property.write, change.value, {
                  clearKeys: change.clearKeys
                });
              }}
            />,
            true
          )}
          {renderReadOnlyReasonNote(readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "fillMode") {
      const writable = property.write.writable && capability.status !== "unsupported";
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
                applyFillModeValue(property.write, nextValue, property.context);
                setFillAdvancedOptionsOpen(nextValue !== "solid");
              },
              undefined,
              valueClassName
            ),
            true
          )}
          {renderReadOnlyReasonNote(readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "fillShading") {
      const writable = property.write.writable && capability.status !== "unsupported";
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
              (nextValue) => { applyFillShadingValue(property.write, nextValue); },
              undefined,
              valueClassName
            ),
            true
          )}
          {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
          {renderReadOnlyReasonNote(readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "fillPattern") {
      const writable = property.write.writable && capability.status !== "unsupported";
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
              (nextValue) => { applyFillPatternValue(property.write, nextValue); },
              undefined,
              valueClassName
            ),
            true
          )}
          {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
          {renderReadOnlyReasonNote(readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "fillPatternOption") {
      const writable = property.write.writable && capability.status !== "unsupported";
      return (
        <div key={property.id} className={propertyClassName}>
          {renderScrubbableNumberLabel(property.label, {
            writable,
            value: property.value,
            step: property.step,
            onPreview: (next: number) => { applySingleFillPatternOptionValue(property, next, { recordInHistory: false }); },
            onCommit: (next: number) => { applySingleFillPatternOptionValue(property, next); }
          })}
          <div className={css.controlRow}>
            {maybeWrapWithProvenanceTooltip(
              provenance,
              <input
                className={withValueProvenanceClass(css.numberInput, provenance)}
                type="number"
                step={property.step}
                value={formatNumber(property.value)}
                disabled={!writable}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (!Number.isFinite(next)) {
                    return;
                  }
                  applySingleFillPatternOptionValue(property, next);
                }}
              />,
              true
            )}
            {property.unit ? <span className={css.unitLabel}>{property.unit}</span> : null}
          </div>
          {renderReadOnlyReasonNote(readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "lineWidth") {
      const writable = property.write.writable && capability.status !== "unsupported";
      const lineWidthKey = `${property.write.elementId}:${property.id}`;
      const previewOwnerKey = `line-width:${lineWidthKey}`;
      const showCustomRange = property.presetLabel == null || manualLineWidthCustomKeys.has(lineWidthKey);
      const dropdownValue: LineWidthDropdownValue = showCustomRange
        ? LINE_WIDTH_CUSTOM_OPTION_VALUE
        : (property.presetLabel ?? LINE_WIDTH_CUSTOM_OPTION_VALUE);
      const dropdownDisplayLabel = lineWidthValueLabel(dropdownValue);
      const dropdownPreviewLineWidth = lineWidthPreviewLineWidth(dropdownValue, property.value);
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
                  applySetProperty(property.write, "true", {
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
                  applySetProperty(property.write, "true", {
                    key: nextValue,
                    propertyId: "line-width",
                    recordInHistory: false
                  });
                });
              }}
              onOptionHoverEnd={() => { clearHoverPreviewSession(previewOwnerKey); }}
              onOptionHoverLeave={() => { restoreHoverPreviewBase(previewOwnerKey); }}
              renderValue={() => (
                <span className={css.lineWidthValue}>
                  <span className={css.lineWidthValuePreview}>
                    <LineWidthPreview lineWidth={dropdownPreviewLineWidth} />
                  </span>
                  <span className={[css.lineWidthValueLabel, valueClassName ?? ""].filter(Boolean).join(" ")}>{dropdownDisplayLabel}</span>
                </span>
              )}
              renderOption={(option, state) => {
                const previewValue = lineWidthPreviewLineWidth(option.value, property.value);
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
            <input
              className={css.rangeInput}
              type="range"
              min={property.min}
              max={property.max}
              step={property.step}
              value={property.value}
              disabled={!writable}
              onChange={(event) => {
                const next = Number(event.currentTarget.value);
                if (!Number.isFinite(next)) return;
                applySetProperty(property.write, `${formatNumber(next)}pt`, {
                  key: "line width",
                  propertyId: "line-width"
                });
              }}
            />
          ) : null}
          {renderReadOnlyReasonNote(readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "dashStyle") {
      const writable = property.write.writable && capability.status !== "unsupported";
      const previewOwnerKey = `dash-style:${property.write.elementId}:${property.id}`;
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
                  { applyDashStyleValue(property.write, nextValue); }
                ); },
              undefined,
              valueClassName,
              (nextValue) =>
                { applyHoverPreview(previewOwnerKey, () =>
                  { applyDashStyleValue(property.write, nextValue, { recordInHistory: false }); }
                ); },
              () => { clearHoverPreviewSession(previewOwnerKey); },
              () => { restoreHoverPreviewBase(previewOwnerKey); }
            ),
            true
          )}
          {renderReadOnlyReasonNote(readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "lineCap") {
      const writable = property.write.writable && capability.status !== "unsupported";
      const previewOwnerKey = `line-cap:${property.write.elementId}:${property.id}`;
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
                  { applyLineCapValue(property.write, nextValue); }
                ); },
              undefined,
              valueClassName,
              (nextValue) =>
                { applyHoverPreview(previewOwnerKey, () =>
                  { applyLineCapValue(property.write, nextValue, { recordInHistory: false }); }
                ); },
              () => { clearHoverPreviewSession(previewOwnerKey); },
              () => { restoreHoverPreviewBase(previewOwnerKey); }
            ),
            true
          )}
          {renderReadOnlyReasonNote(readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "lineJoin") {
      const writable = property.write.writable && capability.status !== "unsupported";
      const previewOwnerKey = `line-join:${property.write.elementId}:${property.id}`;
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
                  { applyLineJoinValue(property.write, nextValue); }
                ); },
              undefined,
              valueClassName,
              (nextValue) =>
                { applyHoverPreview(previewOwnerKey, () =>
                  { applyLineJoinValue(property.write, nextValue, { recordInHistory: false }); }
                ); },
              () => { clearHoverPreviewSession(previewOwnerKey); },
              () => { restoreHoverPreviewBase(previewOwnerKey); }
            ),
            true
          )}
          {renderReadOnlyReasonNote(readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "pathMorphingDecoration") {
      const writable = property.write.writable && capability.status !== "unsupported";
      const previewOwnerKey = `path-morphing:${property.write.elementId}:${property.id}`;
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
                  { applyPathMorphingDecorationValue(property.write, nextValue); }
                ); },
              undefined,
              valueClassName,
              (nextValue) =>
                { applyHoverPreview(previewOwnerKey, () =>
                  { applyPathMorphingDecorationValue(property.write, nextValue, { recordInHistory: false }); }
                ); },
              () => { clearHoverPreviewSession(previewOwnerKey); },
              () => { restoreHoverPreviewBase(previewOwnerKey); }
            ),
            true
          )}
          {renderReadOnlyReasonNote(readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "roundedCorners") {
      const writable = property.write.writable && capability.status !== "unsupported";
      const minRadius = property.min;
      const maxRadius = Math.max(minRadius, property.max);
      const defaultRadius = clampNumber(property.defaultRadius, minRadius, maxRadius);
      const currentRadius = clampNumber(property.radius, minRadius, maxRadius);
      const sliderValue = property.enabled ? currentRadius : defaultRadius;
      return (
        <div key={property.id} className={propertyClassName}>
          <label className={css.checkboxControl}>
            <input
              className={css.checkboxInput}
              type="checkbox"
              checked={property.enabled}
              disabled={!writable}
              onChange={(event) =>
                { applyRoundedCornersValue(
                  property.write,
                  event.currentTarget.checked,
                  event.currentTarget.checked ? sliderValue : defaultRadius,
                  property.disableRequiresSharpCorners
                ); }}
            />
            <span className={withValueProvenanceClass(css.checkboxLabel, provenance)}>{property.label}</span>
          </label>
          {property.enabled ? (
            <div className={css.roundedCornersControl}>
              <input
                className={css.rangeInput}
                type="range"
                min={minRadius}
                max={maxRadius}
                step={property.step}
                value={currentRadius}
                disabled={!writable}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (!Number.isFinite(next)) {
                    return;
                  }
                  applyRoundedCornersValue(property.write, true, clampNumber(next, minRadius, maxRadius));
                }}
              />
              <span className={css.roundedCornersValue}>{`${formatNumber(currentRadius)}pt`}</span>
            </div>
          ) : null}
          {renderReadOnlyReasonNote(readOnlyReason)}
        </div>
      );
    }

    if (property.kind === "shadowPreset") {
      const writable = property.write.writable && capability.status !== "unsupported";
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
              (nextValue) => { applyShadowPresetValue(property.write, property.context, nextValue); },
              undefined,
              valueClassName
            ),
            true
          )}
          {renderReadOnlyReasonNote(readOnlyReason)}
        </div>
      );
    }

    const writable = property.write.writable && capability.status !== "unsupported";
    const previewOwnerKey = `arrow-tip:${property.write.elementId}:${property.id}`;
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
                { applyArrowTipValue(property.write, property.side, nextValue); }
              ); },
            undefined,
            valueClassName,
            (nextValue) =>
              { applyHoverPreview(previewOwnerKey, () =>
                { applyArrowTipValue(property.write, property.side, nextValue, { recordInHistory: false }); }
              ); },
            () => { clearHoverPreviewSession(previewOwnerKey); },
            () => { restoreHoverPreviewBase(previewOwnerKey); }
          ),
          true
        )}
        {renderReadOnlyReasonNote(readOnlyReason)}
      </div>
    );
  }

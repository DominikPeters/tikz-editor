import type { JSX } from "react";
import type { InspectorDescriptor, InspectorProperty } from "tikz-editor/edit/inspector";
import {
  type MultiInspectorProperty,
  type MultiInspectorSection,
  shouldAutoShowFillAdvancedOptions,
  shouldAutoShowFillMoreOptions,
  shouldAutoShowStrokeMoreOptions,
  shouldRenderCompactPair,
  isFillAdvancedPropertyId,
  isFillMoreOptionsPropertyId,
  isStrokeMoreOptionsPropertyId,
  type InspectorPropertyProvenance,
  type InspectorPropertyProvenanceMap
} from "./panel-helpers";
import { SidePanel } from "../SidePanel";
import css from "./InspectorPanel.module.css";

export function InspectorSingleSection(props: {
  section: InspectorDescriptor["sections"][number];
  strokeMoreOptionsOpen: boolean;
  setStrokeMoreOptionsOpen: (updater: (current: boolean) => boolean) => void;
  fillMoreOptionsOpen: boolean;
  setFillMoreOptionsOpen: (updater: (current: boolean) => boolean) => void;
  fillAdvancedOptionsOpen: boolean;
  setFillAdvancedOptionsOpen: (next: boolean) => void;
  renderedSinglePropertyProvenance: InspectorPropertyProvenanceMap;
  renderSingleNumberPair: (
    left: Extract<InspectorProperty, { kind: "number" }>,
    right: Extract<InspectorProperty, { kind: "number" }>,
    leftProvenance: InspectorPropertyProvenance | null,
    rightProvenance: InspectorPropertyProvenance | null
  ) => JSX.Element;
  renderSingleLengthPair: (
    left: Extract<InspectorProperty, { kind: "length" }>,
    right: Extract<InspectorProperty, { kind: "length" }>,
    leftProvenance: InspectorPropertyProvenance | null,
    rightProvenance: InspectorPropertyProvenance | null
  ) => JSX.Element;
  renderProperty: (property: InspectorProperty) => JSX.Element;
  onEnableGradientFillSingle: () => void;
  onEnablePatternFillSingle: () => void;
  fillModeSingleCanWrite: boolean;
}) {
  const {
    section,
    strokeMoreOptionsOpen,
    setStrokeMoreOptionsOpen,
    fillMoreOptionsOpen,
    setFillMoreOptionsOpen,
    fillAdvancedOptionsOpen,
    setFillAdvancedOptionsOpen,
    renderedSinglePropertyProvenance,
    renderSingleNumberPair,
    renderSingleLengthPair,
    renderProperty,
    onEnableGradientFillSingle,
    onEnablePatternFillSingle,
    fillModeSingleCanWrite
  } = props;

  const strokeMoreOptionsProperties =
    section.id === "stroke"
      ? section.properties.filter((property) => isStrokeMoreOptionsPropertyId(property.id))
      : [];
  const forceShowStrokeMoreOptions = strokeMoreOptionsProperties.some((property) =>
    shouldAutoShowStrokeMoreOptions(property)
  );
  const showStrokeMoreOptions = forceShowStrokeMoreOptions || strokeMoreOptionsOpen;
  const fillMoreOptionsProperties =
    section.id === "fill"
      ? section.properties.filter((property) => isFillMoreOptionsPropertyId(property.id))
      : [];
  const forceShowFillMoreOptions = fillMoreOptionsProperties.some((property) =>
    shouldAutoShowFillMoreOptions(property)
  );
  const showFillMoreOptions = forceShowFillMoreOptions || fillMoreOptionsOpen;
  const fillAdvancedProperties =
    section.id === "fill"
      ? section.properties.filter((property) => isFillAdvancedPropertyId(property.id))
      : [];
  const fillModeProperty =
    section.id === "fill"
      ? section.properties.find((property): property is Extract<InspectorProperty, { kind: "fillMode" }> => property.kind === "fillMode")
      : undefined;
  const forceShowFillAdvancedOptions = fillAdvancedProperties.some((property) =>
    shouldAutoShowFillAdvancedOptions(property)
  );
  const showFillAdvancedOptions = forceShowFillAdvancedOptions || fillAdvancedOptionsOpen;
  const visibleProperties =
    section.id === "stroke" && !showStrokeMoreOptions
      ? section.properties.filter((property) => !isStrokeMoreOptionsPropertyId(property.id))
      : section.id === "fill"
        ? section.properties.filter((property) => {
            if (!showFillMoreOptions && isFillMoreOptionsPropertyId(property.id)) return false;
            if (!showFillAdvancedOptions && isFillAdvancedPropertyId(property.id)) return false;
            if (showFillAdvancedOptions && property.id === "fill-color") return false;
            return true;
          })
        : section.properties;

  return (
    <SidePanel.Section key={section.id}>
      <SidePanel.SectionHeader>
        <span>{section.title}</span>
      </SidePanel.SectionHeader>
      <SidePanel.SectionBody>
        {visibleProperties.map((property, index) => {
          if (index > 0 && shouldRenderCompactPair(visibleProperties[index - 1], property)) {
            return null;
          }
          const next = visibleProperties[index + 1];
          if (shouldRenderCompactPair(property, next)) {
            if (property.kind === "number" && next?.kind === "number") {
              const left = property;
              const right = next;
              return renderSingleNumberPair(
                left,
                right,
                renderedSinglePropertyProvenance[left.id] ?? null,
                renderedSinglePropertyProvenance[right.id] ?? null
              );
            }
            if (property.kind === "length" && next?.kind === "length") {
              const left = property;
              const right = next;
              return renderSingleLengthPair(
                left,
                right,
                renderedSinglePropertyProvenance[left.id] ?? null,
                renderedSinglePropertyProvenance[right.id] ?? null
              );
            }
            if (property.kind === "nodeTextAlign" && next?.kind === "optionalLength") {
              return (
                <div key={`${property.id}:${next.id}`} className={css.compactNumberPair}>
                  {renderProperty(property)}
                  {renderProperty(next)}
                </div>
              );
            }
          }
          return renderProperty(property);
        })}
        {section.id === "stroke" &&
        strokeMoreOptionsProperties.length > 0 &&
        !forceShowStrokeMoreOptions ? (
          <button
            type="button"
            className={css.moreOptionsToggle}
            onClick={() => { setStrokeMoreOptionsOpen((current) => !current); }}
          >
            {showStrokeMoreOptions ? "fewer options.." : "more options.."}
          </button>
        ) : null}
        {section.id === "fill" &&
        fillMoreOptionsProperties.length > 0 &&
        !forceShowFillMoreOptions ? (
          <button
            type="button"
            className={css.moreOptionsToggle}
            onClick={() => { setFillMoreOptionsOpen((current) => !current); }}
          >
            {showFillMoreOptions ? "fewer options.." : "more options.."}
          </button>
        ) : null}
        {section.id === "fill" &&
        fillAdvancedProperties.length > 0 &&
        !showFillAdvancedOptions &&
        fillModeProperty ? (
          <div className={css.fillQuickActions}>
            <button
              type="button"
              className={css.moreOptionsToggle}
              disabled={!fillModeSingleCanWrite}
              onClick={() => {
                if (!fillModeSingleCanWrite) {
                  return;
                }
                setFillAdvancedOptionsOpen(true);
                onEnableGradientFillSingle();
              }}
            >
              + gradient
            </button>
            <button
              type="button"
              className={css.moreOptionsToggle}
              disabled={!fillModeSingleCanWrite}
              onClick={() => {
                if (!fillModeSingleCanWrite) {
                  return;
                }
                setFillAdvancedOptionsOpen(true);
                onEnablePatternFillSingle();
              }}
            >
              + pattern
            </button>
          </div>
        ) : null}
      </SidePanel.SectionBody>
    </SidePanel.Section>
  );
}

export function InspectorMultiSection(props: {
  section: MultiInspectorSection;
  strokeMoreOptionsOpen: boolean;
  setStrokeMoreOptionsOpen: (updater: (current: boolean) => boolean) => void;
  fillMoreOptionsOpen: boolean;
  setFillMoreOptionsOpen: (updater: (current: boolean) => boolean) => void;
  fillAdvancedOptionsOpen: boolean;
  setFillAdvancedOptionsOpen: (next: boolean) => void;
  renderedMultiPropertyProvenance: InspectorPropertyProvenanceMap;
  renderMultiNumberPair: (
    left: Extract<MultiInspectorProperty, { kind: "number" }>,
    right: Extract<MultiInspectorProperty, { kind: "number" }>,
    leftProvenance: InspectorPropertyProvenance | null,
    rightProvenance: InspectorPropertyProvenance | null
  ) => JSX.Element;
  renderMultiLengthPair: (
    left: Extract<MultiInspectorProperty, { kind: "length" }>,
    right: Extract<MultiInspectorProperty, { kind: "length" }>,
    leftProvenance: InspectorPropertyProvenance | null,
    rightProvenance: InspectorPropertyProvenance | null
  ) => JSX.Element;
  renderMultiProperty: (property: MultiInspectorProperty) => JSX.Element | null;
  onEnableGradientFillMulti: () => void;
  onEnablePatternFillMulti: () => void;
  fillModeMultiCanWrite: boolean;
}) {
  const {
    section,
    strokeMoreOptionsOpen,
    setStrokeMoreOptionsOpen,
    fillMoreOptionsOpen,
    setFillMoreOptionsOpen,
    fillAdvancedOptionsOpen,
    setFillAdvancedOptionsOpen,
    renderedMultiPropertyProvenance,
    renderMultiNumberPair,
    renderMultiLengthPair,
    renderMultiProperty,
    onEnableGradientFillMulti,
    onEnablePatternFillMulti,
    fillModeMultiCanWrite
  } = props;

  const strokeMoreOptionsProperties =
    section.id === "stroke"
      ? section.properties.filter((property) => isStrokeMoreOptionsPropertyId(property.id))
      : [];
  const forceShowStrokeMoreOptions = strokeMoreOptionsProperties.some((property) =>
    shouldAutoShowStrokeMoreOptions(property)
  );
  const showStrokeMoreOptions = forceShowStrokeMoreOptions || strokeMoreOptionsOpen;
  const fillMoreOptionsProperties =
    section.id === "fill"
      ? section.properties.filter((property) => isFillMoreOptionsPropertyId(property.id))
      : [];
  const forceShowFillMoreOptions = fillMoreOptionsProperties.some((property) =>
    shouldAutoShowFillMoreOptions(property)
  );
  const showFillMoreOptions = forceShowFillMoreOptions || fillMoreOptionsOpen;
  const fillAdvancedProperties =
    section.id === "fill"
      ? section.properties.filter((property) => isFillAdvancedPropertyId(property.id))
      : [];
  const fillModeProperty =
    section.id === "fill"
      ? section.properties.find((property): property is Extract<MultiInspectorProperty, { kind: "fillMode" }> => property.kind === "fillMode")
      : undefined;
  const forceShowFillAdvancedOptions = fillAdvancedProperties.some((property) =>
    shouldAutoShowFillAdvancedOptions(property)
  );
  const showFillAdvancedOptions = forceShowFillAdvancedOptions || fillAdvancedOptionsOpen;
  const visibleProperties =
    section.id === "stroke" && !showStrokeMoreOptions
      ? section.properties.filter((property) => !isStrokeMoreOptionsPropertyId(property.id))
      : section.id === "fill"
        ? section.properties.filter((property) => {
            if (!showFillMoreOptions && isFillMoreOptionsPropertyId(property.id)) return false;
            if (!showFillAdvancedOptions && isFillAdvancedPropertyId(property.id)) return false;
            if (showFillAdvancedOptions && property.id === "fill-color") return false;
            return true;
          })
        : section.properties;

  return (
    <SidePanel.Section key={section.id}>
      <SidePanel.SectionHeader>
        <span>{section.title}</span>
      </SidePanel.SectionHeader>
      <SidePanel.SectionBody>
        {visibleProperties.map((property, index) => {
          if (index > 0 && shouldRenderCompactPair(visibleProperties[index - 1], property)) {
            return null;
          }
          const next = visibleProperties[index + 1];
          if (shouldRenderCompactPair(property, next)) {
            if (property.kind === "number" && next?.kind === "number") {
              const left = property;
              const right = next;
              return renderMultiNumberPair(
                left,
                right,
                renderedMultiPropertyProvenance[left.id] ?? null,
                renderedMultiPropertyProvenance[right.id] ?? null
              );
            }
            if (property.kind === "length" && next?.kind === "length") {
              const left = property;
              const right = next;
              return renderMultiLengthPair(
                left,
                right,
                renderedMultiPropertyProvenance[left.id] ?? null,
                renderedMultiPropertyProvenance[right.id] ?? null
              );
            }
            if (property.kind === "nodeTextAlign" && next?.kind === "optionalLength") {
              return (
                <div key={`${property.id}:${next.id}`} className={css.compactNumberPair}>
                  {renderMultiProperty(property)}
                  {renderMultiProperty(next)}
                </div>
              );
            }
          }
          return renderMultiProperty(property);
        })}
        {section.id === "stroke" &&
        strokeMoreOptionsProperties.length > 0 &&
        !forceShowStrokeMoreOptions ? (
          <button
            type="button"
            className={css.moreOptionsToggle}
            onClick={() => { setStrokeMoreOptionsOpen((current) => !current); }}
          >
            {showStrokeMoreOptions ? "fewer options.." : "more options.."}
          </button>
        ) : null}
        {section.id === "fill" &&
        fillMoreOptionsProperties.length > 0 &&
        !forceShowFillMoreOptions ? (
          <button
            type="button"
            className={css.moreOptionsToggle}
            onClick={() => { setFillMoreOptionsOpen((current) => !current); }}
          >
            {showFillMoreOptions ? "fewer options.." : "more options.."}
          </button>
        ) : null}
        {section.id === "fill" &&
        fillAdvancedProperties.length > 0 &&
        !showFillAdvancedOptions &&
        fillModeProperty ? (
          <div className={css.fillQuickActions}>
            <button
              type="button"
              className={css.moreOptionsToggle}
              disabled={!fillModeMultiCanWrite}
              onClick={() => {
                if (!fillModeMultiCanWrite) {
                  return;
                }
                setFillAdvancedOptionsOpen(true);
                onEnableGradientFillMulti();
              }}
            >
              + gradient
            </button>
            <button
              type="button"
              className={css.moreOptionsToggle}
              disabled={!fillModeMultiCanWrite}
              onClick={() => {
                if (!fillModeMultiCanWrite) {
                  return;
                }
                setFillAdvancedOptionsOpen(true);
                onEnablePatternFillMulti();
              }}
            >
              + pattern
            </button>
          </div>
        ) : null}
      </SidePanel.SectionBody>
    </SidePanel.Section>
  );
}

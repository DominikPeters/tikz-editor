import { Fragment, useEffect, useRef, type JSX, type ReactNode } from "react";
import type { InspectorDescriptor, InspectorPaintToggle, InspectorProperty } from "@tikz-editor/core/edit/inspector";
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
  onTogglePaint: (toggles: readonly InspectorPaintToggle[], enabled: boolean) => void;
}) {
  const {
    section,
    strokeMoreOptionsOpen,
    setStrokeMoreOptionsOpen,
    fillMoreOptionsOpen,
    setFillMoreOptionsOpen,
    fillAdvancedOptionsOpen,
    renderedSinglePropertyProvenance,
    renderSingleNumberPair,
    renderSingleLengthPair,
    renderProperty,
    onTogglePaint
  } = props;
  const toggles = section.toggle ? [section.toggle] : [];

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
            if (!showFillAdvancedOptions && property.kind !== "fillMode" && isFillAdvancedPropertyId(property.id)) return false;
            if (showFillAdvancedOptions && property.id === "fill-color") return false;
            return true;
          })
        : section.properties;
  const orderedProperties = section.id === "fill" ? fillModeFirst(visibleProperties) : visibleProperties;

  return (
    <SidePanel.Section key={section.id} collapseId={`inspector:${section.id}`}>
      <SidePanel.SectionHeader
        leading={toggles.length > 0 ? <PaintToggleCheckbox title={section.title} toggles={toggles} onToggle={onTogglePaint} /> : null}
        accessory={paintOff(toggles) ? null : renderMoreOptionsToggle({
          sectionId: section.id,
          strokeToggleAvailable: strokeMoreOptionsProperties.length > 0 && !forceShowStrokeMoreOptions,
          showStrokeMoreOptions,
          setStrokeMoreOptionsOpen,
          fillToggleAvailable: fillMoreOptionsProperties.length > 0 && !forceShowFillMoreOptions,
          showFillMoreOptions,
          setFillMoreOptionsOpen
        })}
      >
        {section.title}
      </SidePanel.SectionHeader>
      {paintOff(toggles) ? null : <SidePanel.SectionBody>
        {orderedProperties.map((property, index) => {
          if (index > 0 && shouldRenderCompactPair(orderedProperties[index - 1], property)) {
            return null;
          }
          const next = orderedProperties[index + 1];
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
                <Fragment key={`${property.id}:${next.id}`}>
                  {renderProperty(property)}
                  {renderProperty(next)}
                </Fragment>
              );
            }
          }
          return renderProperty(property);
        })}
      </SidePanel.SectionBody>}
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
  onTogglePaint: (toggles: readonly InspectorPaintToggle[], enabled: boolean) => void;
}) {
  const {
    section,
    strokeMoreOptionsOpen,
    setStrokeMoreOptionsOpen,
    fillMoreOptionsOpen,
    setFillMoreOptionsOpen,
    fillAdvancedOptionsOpen,
    renderedMultiPropertyProvenance,
    renderMultiNumberPair,
    renderMultiLengthPair,
    renderMultiProperty,
    onTogglePaint
  } = props;
  const toggles = section.toggles ?? [];

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
            if (!showFillAdvancedOptions && property.kind !== "fillMode" && isFillAdvancedPropertyId(property.id)) return false;
            if (showFillAdvancedOptions && property.id === "fill-color") return false;
            return true;
          })
        : section.properties;
  const orderedProperties = section.id === "fill" ? fillModeFirst(visibleProperties) : visibleProperties;

  return (
    <SidePanel.Section key={section.id} collapseId={`inspector:${section.id}`}>
      <SidePanel.SectionHeader
        leading={toggles.length > 0 ? <PaintToggleCheckbox title={section.title} toggles={toggles} onToggle={onTogglePaint} /> : null}
        accessory={paintOff(toggles) ? null : renderMoreOptionsToggle({
          sectionId: section.id,
          strokeToggleAvailable: strokeMoreOptionsProperties.length > 0 && !forceShowStrokeMoreOptions,
          showStrokeMoreOptions,
          setStrokeMoreOptionsOpen,
          fillToggleAvailable: fillMoreOptionsProperties.length > 0 && !forceShowFillMoreOptions,
          showFillMoreOptions,
          setFillMoreOptionsOpen
        })}
      >
        {section.title}
      </SidePanel.SectionHeader>
      {paintOff(toggles) ? null : <SidePanel.SectionBody>
        {orderedProperties.map((property, index) => {
          if (index > 0 && shouldRenderCompactPair(orderedProperties[index - 1], property)) {
            return null;
          }
          const next = orderedProperties[index + 1];
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
                <Fragment key={`${property.id}:${next.id}`}>
                  {renderMultiProperty(property)}
                  {renderMultiProperty(next)}
                </Fragment>
              );
            }
          }
          return renderMultiProperty(property);
        })}
      </SidePanel.SectionBody>}
    </SidePanel.Section>
  );
}

// With its paint off, a Stroke or Fill section is just its header, as in Keynote.
function paintOff(toggles: readonly InspectorPaintToggle[]): boolean {
  return toggles.length > 0 && toggles.every((toggle) => !toggle.enabled);
}

// Checked when every selected element paints, mixed when only some do.
function PaintToggleCheckbox(props: {
  title: string;
  toggles: readonly InspectorPaintToggle[];
  onToggle: (toggles: readonly InspectorPaintToggle[], enabled: boolean) => void;
}) {
  const { title, toggles, onToggle } = props;
  const ref = useRef<HTMLInputElement>(null);
  const enabledCount = toggles.filter((toggle) => toggle.enabled).length;
  const mixed = enabledCount > 0 && enabledCount < toggles.length;
  const writable = toggles.some((toggle) => toggle.write.writable);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className={css.paintToggle}
      aria-label={title}
      title={writable ? undefined : toggles.find((toggle) => toggle.write.reason)?.write.reason}
      checked={enabledCount === toggles.length}
      disabled={!writable}
      onChange={() => { onToggle(toggles, mixed || enabledCount === 0); }}
    />
  );
}

// Fill mode leads the fill section so Solid / Gradient / Pattern reads as the
// section's first choice.
function fillModeFirst<T extends { kind: string }>(properties: T[]): T[] {
  const mode = properties.filter((property) => property.kind === "fillMode");
  return [...mode, ...properties.filter((property) => property.kind !== "fillMode")];
}

function renderMoreOptionsToggle(options: {
  sectionId: string;
  strokeToggleAvailable: boolean;
  showStrokeMoreOptions: boolean;
  setStrokeMoreOptionsOpen: (updater: (current: boolean) => boolean) => void;
  fillToggleAvailable: boolean;
  showFillMoreOptions: boolean;
  setFillMoreOptionsOpen: (updater: (current: boolean) => boolean) => void;
}): ReactNode {
  const toggle =
    options.sectionId === "stroke" && options.strokeToggleAvailable
      ? { open: options.showStrokeMoreOptions, set: options.setStrokeMoreOptionsOpen }
      : options.sectionId === "fill" && options.fillToggleAvailable
        ? { open: options.showFillMoreOptions, set: options.setFillMoreOptionsOpen }
        : null;
  if (!toggle) return null;
  return (
    <button
      type="button"
      className={css.moreOptionsToggle}
      aria-expanded={toggle.open}
      onClick={() => { toggle.set((current) => !current); }}
    >
      {toggle.open ? "Show Less" : "Show More"}
    </button>
  );
}

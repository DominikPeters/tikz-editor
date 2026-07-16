import { useState } from "react";
import type { AddonInspectorProperty } from "@tikz-editor/addon-api";

import type { AddonInspectorModel } from "../../addons/inspector";
import type { EditorAction } from "../../store/types";
import { SidePanel } from "../SidePanel";
import css from "./InspectorPanel.module.css";

/**
 * Renders add-on-contributed inspector sections for a selected claimed
 * statement. Property writes dispatch addonEdit actions built by the add-on
 * ui entry's buildEdit callbacks.
 */
export function AddonInspectorSections(props: {
  model: AddonInspectorModel;
  dispatch: (action: EditorAction) => void;
}) {
  const { model, dispatch } = props;

  const applyEdit = (edit: unknown) => {
    dispatch({
      type: "APPLY_EDIT_ACTION",
      action: { kind: "addonEdit", addonId: model.addonId, edit }
    });
  };

  return (
    <>
      {model.sections.map((section) => (
        <SidePanel.Section key={section.id}>
          <SidePanel.SectionHeader>
            <span>{section.title}</span>
          </SidePanel.SectionHeader>
          <SidePanel.SectionBody>
            {section.properties.map((property) => (
              <AddonPropertyRow key={property.id} property={property} applyEdit={applyEdit} />
            ))}
          </SidePanel.SectionBody>
        </SidePanel.Section>
      ))}
    </>
  );
}

function AddonPropertyRow(props: {
  property: AddonInspectorProperty;
  applyEdit: (edit: unknown) => void;
}) {
  const { property, applyEdit } = props;

  return (
    <div className={css.controlRow}>
      <span className={css.propertyLabel}>{property.label}</span>
      <AddonPropertyControl property={property} applyEdit={applyEdit} />
    </div>
  );
}

function AddonPropertyControl(props: {
  property: AddonInspectorProperty;
  applyEdit: (edit: unknown) => void;
}) {
  const { property, applyEdit } = props;

  switch (property.kind) {
    case "number":
      return <AddonNumberControl key={`${property.id}:${property.value}`} property={property} applyEdit={applyEdit} />;
    case "text":
      return <AddonTextControl key={`${property.id}:${property.value}`} property={property} applyEdit={applyEdit} />;
    case "dropdown":
      return (
        <select
          className={css.textInput}
          value={property.value}
          onChange={(event) => { applyEdit(property.buildEdit(event.target.value)); }}
        >
          {property.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    case "checkbox":
      return (
        <input
          type="checkbox"
          className={css.checkboxInput}
          checked={property.value}
          onChange={(event) => { applyEdit(property.buildEdit(event.target.checked)); }}
        />
      );
  }
}

function AddonNumberControl(props: {
  property: Extract<AddonInspectorProperty, { kind: "number" }>;
  applyEdit: (edit: unknown) => void;
}) {
  const { property, applyEdit } = props;
  const [draft, setDraft] = useState(String(property.value));

  const commit = () => {
    const parsed = Number.parseFloat(draft);
    if (!Number.isFinite(parsed) || parsed === property.value) {
      setDraft(String(property.value));
      return;
    }
    const clamped = Math.min(
      property.max ?? Number.POSITIVE_INFINITY,
      Math.max(property.min ?? Number.NEGATIVE_INFINITY, parsed)
    );
    applyEdit(property.buildEdit(clamped));
  };

  return (
    <input
      type="number"
      className={css.numberInput}
      value={draft}
      step={property.step}
      min={property.min}
      max={property.max}
      onChange={(event) => { setDraft(event.target.value); }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit();
        }
      }}
    />
  );
}

function AddonTextControl(props: {
  property: Extract<AddonInspectorProperty, { kind: "text" }>;
  applyEdit: (edit: unknown) => void;
}) {
  const { property, applyEdit } = props;
  const [draft, setDraft] = useState(property.value);

  const commit = () => {
    if (draft !== property.value) {
      applyEdit(property.buildEdit(draft));
    }
  };

  return (
    <input
      type="text"
      className={css.textInput}
      value={draft}
      onChange={(event) => { setDraft(event.target.value); }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit();
        }
      }}
    />
  );
}

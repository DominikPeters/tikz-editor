import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { InspectorProperty, SetPropertyWriteTarget } from "tikz-editor/edit/inspector";
import { buildPropertyMutationsFromRequest } from "tikz-editor/edit/property-registry";
import {
  areStylesCascadeModelsIdentical,
  buildSharedStylesCascadeModel,
  buildStylesCascadeModel,
  planStylesRemovePropertyActions,
  planStylesRenamePropertyActions,
  planStylesSetPropertyActions,
  planStylesTogglePropertyActions,
  type StylesCascadeDeclaration,
  type StylesCascadeModel,
  type StylesCascadeSection
} from "tikz-editor/edit/styles-cascade";
import { NON_STYLE_OPTION_FLAGS, NON_STYLE_OPTION_KEYS } from "tikz-editor/semantic/style/constants";
import type { SceneElement } from "tikz-editor/semantic/types";
import { getSharedEditAnalysisView, getSharedEditAnalysisSession } from "../edit-analysis-manager";
import { useProjectNamedColorSwatches } from "../colors/project-named-colors";
import { useSettingsStore } from "../settings/useSettingsStore";
import { useEditorStore } from "../store/store";
import { ColorPickerField } from "./ColorPicker";
import { CustomDropdown, type CustomDropdownItem } from "./CustomDropdown";
import { SidePanel } from "./SidePanel";
import css from "./StylesPanel.module.css";

// ── Key name autocomplete suggestions ────────────────────────────────────────

const COMMON_OPTION_KEYS = [
  "draw", "fill", "text", "line width", "opacity", "fill opacity", "text opacity",
  "rounded corners", "dash pattern", "dashed", "dotted",
  "thick", "thin", "very thick", "very thin", "ultra thick", "ultra thin",
  "line cap", "line join", "font",
  "xshift", "yshift", "shift", "rotate", "scale", "xscale", "yscale",
  "minimum width", "minimum height", "minimum size",
  "inner sep", "outer sep", "shape", "name", "alias", "at",
  "anchor", "align", "above", "below", "left", "right",
  "above left", "above right", "below left", "below right",
  "node distance", "shading", "pattern",
  "<-", "->", "<->",
];

const ALL_KEY_SUGGESTIONS: CustomDropdownItem<string>[] = (() => {
  const seen = new Set<string>();
  const result: CustomDropdownItem<string>[] = [];
  const add = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ value: key, label: key });
  };
  for (const k of COMMON_OPTION_KEYS) add(k);
  for (const k of NON_STYLE_OPTION_KEYS) add(k);
  for (const k of NON_STYLE_OPTION_FLAGS) add(k);
  return result;
})();

// ── Main component ───────────────────────────────────────────────────────────

export function StylesPanel() {
  const selectedIds = useEditorStore((s) => s.selectedElementIds);
  const activeDocumentId = useEditorStore((s) => s.activeDocumentId);
  const activeFigureId = useEditorStore((s) => s.activeFigureId);
  const snapshot = useEditorStore((s) => s.snapshot);
  const source = useEditorStore((s) => s.source);
  const sourceRevision = useEditorStore((s) => s.sourceRevision);
  const dispatch = useEditorStore((s) => s.dispatch);
  const editorIndentSize = useSettingsStore((s) => s.settings.editor.indentSize);
  const [addingInSection, setAddingInSection] = useState<string | null>(null);

  const selectedSourceIds = useMemo(() => [...selectedIds], [selectedIds]);
  const selectedElements = useMemo(() => {
    const bySource = new Map<string, SceneElement>();
    for (const element of snapshot.scene?.elements ?? []) {
      const targetId = element.adornment?.targetId ?? element.sourceRef.sourceId;
      if (!selectedIds.has(targetId) || bySource.has(targetId)) {
        continue;
      }
      bySource.set(targetId, element);
    }
    return selectedSourceIds
      .map((sourceId) => bySource.get(sourceId))
      .filter((element): element is SceneElement => element != null);
  }, [selectedIds, selectedSourceIds, snapshot.scene]);
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
      analysisSession: getSharedEditAnalysisSession()
    }),
    [activeFigureId, editAnalysisView]
  );

  const models = useMemo(
    () =>
      selectedElements.map((element) =>
        buildStylesCascadeModel(element, {
          source: snapshot.source,
          editHandles: snapshot.editHandles,
          parseOptions
        })
      ),
    [parseOptions, selectedElements, snapshot.editHandles, snapshot.source]
  );
  const model = useMemo<StylesCascadeModel | null>(() => {
    if (models.length === 0) {
      return null;
    }
    if (models.length === 1) {
      return models[0] ?? null;
    }
    return buildSharedStylesCascadeModel(models);
  }, [models]);
  const projectNamedColorSwatches = useProjectNamedColorSwatches();

  const dispatchActions = useCallback(
    (actions: ReturnType<typeof planStylesSetPropertyActions>) => {
      const mergeKey = `styles:${Date.now().toString(36)}`;
      for (const action of actions) {
        dispatch({
          type: "APPLY_EDIT_ACTION",
          historyMergeKey: mergeKey,
          parseOptions: { indentSize: editorIndentSize, propertyWriteMode: "commit" },
          action
        });
      }
    },
    [dispatch, editorIndentSize]
  );

  const applySimpleMutation = useCallback(
    (writeTargets: readonly SetPropertyWriteTarget[], key: string, value: string, clearKeys?: string[]) => {
      dispatchActions(planStylesSetPropertyActions(writeTargets, { key, value, clearKeys }));
    },
    [dispatchActions]
  );

  const applyRegistryMutations = useCallback(
    (
      writeTargets: readonly SetPropertyWriteTarget[],
      mutations: ReturnType<typeof buildPropertyMutationsFromRequest>
    ) => {
      for (const mutation of mutations) {
        dispatchActions(planStylesSetPropertyActions(writeTargets, mutation));
      }
    },
    [dispatchActions]
  );

  const applyPropertyChange = useCallback(
    (declaration: StylesCascadeDeclaration, property: InspectorProperty, nextValue: string | number | boolean) => {
      const writeTargets = declaration.writeTargets;
      if (writeTargets.length === 0) {
        return;
      }

      switch (property.kind) {
        case "color":
          applySimpleMutation(writeTargets, property.write.key, String(nextValue));
          return;
        case "number": {
          const writes = property.write ? writeTargets.map((target) => ({ ...target, key: property.write!.key, transformContext: property.write!.transformContext })) : [];
          if (property.write?.transformContext) {
            applyRegistryMutations(writes, buildPropertyMutationsFromRequest({
              kind: "transform",
              current: property.write.transformContext,
              key: property.write.transformContext.key,
              value: Number(nextValue)
            }));
            return;
          }
          const key = property.write?.key ?? "";
          if (key.length > 0) {
            applySimpleMutation(writeTargets, key, String(nextValue), property.clearKeys);
          }
          return;
        }
        case "length":
          if (property.id === "node-inner-sep") {
            applyRegistryMutations(writeTargets, buildPropertyMutationsFromRequest({ kind: "node-inner-sep", value: Number(nextValue) }));
            return;
          }
          applySimpleMutation(writeTargets, property.write.key, `${nextValue}${property.unit}`);
          return;
        case "lineWidth":
          applyRegistryMutations(writeTargets, buildPropertyMutationsFromRequest({ kind: "line-width-value", value: `${nextValue}pt` }));
          return;
        case "dashStyle": {
          applyRegistryMutations(writeTargets, buildPropertyMutationsFromRequest({ kind: "dash-style", value: String(nextValue) as Exclude<typeof property.value, "custom"> }));
          return;
        }
        case "lineCap": {
          applyRegistryMutations(writeTargets, buildPropertyMutationsFromRequest({ kind: "line-cap", value: String(nextValue) as Exclude<typeof property.value, "custom"> }));
          return;
        }
        case "lineJoin": {
          applyRegistryMutations(writeTargets, buildPropertyMutationsFromRequest({ kind: "line-join", value: String(nextValue) as Exclude<typeof property.value, "custom"> }));
          return;
        }
        case "fillMode": {
          applyRegistryMutations(writeTargets, buildPropertyMutationsFromRequest({ kind: "fill-mode", value: String(nextValue) as Exclude<typeof property.value, "custom">, context: property.context }));
          return;
        }
        case "fillShading": {
          applyRegistryMutations(writeTargets, buildPropertyMutationsFromRequest({ kind: "fill-shading", value: String(nextValue) as Exclude<typeof property.value, "custom"> }));
          return;
        }
        case "fillPattern": {
          applyRegistryMutations(writeTargets, buildPropertyMutationsFromRequest({ kind: "fill-pattern", value: String(nextValue) as Exclude<typeof property.value, "custom"> }));
          return;
        }
        case "roundedCorners": {
          applyRegistryMutations(writeTargets, buildPropertyMutationsFromRequest({
            kind: "rounded-corners",
            enabled: Boolean(nextValue),
            radius: property.radius,
            disableRequiresSharpCorners: property.disableRequiresSharpCorners
          }));
          return;
        }
        case "nodeShape": {
          applyRegistryMutations(writeTargets, buildPropertyMutationsFromRequest({ kind: "node-shape", value: String(nextValue) as Exclude<typeof property.value, "custom"> }));
          return;
        }
        case "arrowTip":
        case "boolean":
        case "enum":
        case "fillPatternOption":
        case "nodeFont":
        case "nodeTextAlign":
        case "optionalLength":
        case "pathMorphingDecoration":
        case "shadowPreset":
        case "slider":
        case "text":
        default:
          return;
      }
    },
    [applyRegistryMutations, applySimpleMutation]
  );

  const handleDeleteProperty = useCallback(
    (declaration: StylesCascadeDeclaration) => {
      const key = toPropertyKey(declaration);
      if (key.length === 0 || !declaration.writeTargets.some((target) => target.writable)) return;
      dispatchActions(planStylesRemovePropertyActions(declaration.writeTargets, key));
    },
    [dispatchActions]
  );

  const handleRenameKey = useCallback(
    (declaration: StylesCascadeDeclaration, newKey: string) => {
      const oldKey = toPropertyKey(declaration);
      if (
        oldKey.length === 0
        || newKey.length === 0
        || oldKey === newKey
        || !declaration.writeTargets.some((target) => target.writable)
      ) {
        return;
      }
      const currentValue = toPropertyRawValue(declaration);
      dispatchActions(planStylesRenamePropertyActions(declaration.writeTargets, oldKey, newKey, currentValue));
    },
    [dispatchActions]
  );

  const handleRawValueCommit = useCallback(
    (declaration: StylesCascadeDeclaration, rawValue: string) => {
      const key = toPropertyKey(declaration);
      if (key.length === 0 || rawValue.length === 0 || !declaration.writeTargets.some((target) => target.writable)) return;
      // Skip if value hasn't changed
      const currentValue = toPropertyRawValue(declaration);
      if (rawValue === currentValue) return;
      applySimpleMutation(declaration.writeTargets, key, rawValue);
    },
    [applySimpleMutation]
  );

  const handleAddProperty = useCallback(
    (section: StylesCascadeSection, keyName: string) => {
      if (keyName.length === 0 || !section.writeTargets.some((target) => target.writable)) return;
      // Check if this matches a known addable property template
      const templateId = keyName.startsWith("template:") ? keyName.slice("template:".length) : null;
      const template = templateId
        ? section.addPropertyTemplates[templateId] ?? null
        : Object.values(section.addPropertyTemplates).find(
            (t) => {
              if ("write" in t && t.write?.key === keyName) return true;
              return t.label.toLowerCase() === keyName.toLowerCase();
            }
          ) ?? null;
      if (template) {
        // Add the property with a sensible default value via raw key=value
        const writeKey = ("write" in template && template.write) ? template.write.key : keyName;
        let defaultValue: string;
        switch (template.kind) {
          case "color":
            defaultValue = template.syntaxValue ?? template.value ?? "black";
            break;
          case "number":
            defaultValue = String(template.value || 0);
            break;
          case "length":
            defaultValue = `${template.value || 0}${template.unit}`;
            break;
          case "lineWidth":
            defaultValue = `${template.value || 0.4}pt`;
            break;
          case "dashStyle":
          case "lineCap":
          case "lineJoin":
          case "fillMode":
          case "fillShading":
          case "fillPattern":
          case "nodeShape":
            defaultValue = String(template.value);
            break;
          case "roundedCorners":
            defaultValue = template.enabled ? `${template.radius}pt` : "4pt";
            break;
          case "arrowTip":
          case "boolean":
          case "enum":
          case "fillPatternOption":
          case "nodeFont":
          case "nodeTextAlign":
          case "optionalLength":
          case "pathMorphingDecoration":
          case "shadowPreset":
          case "slider":
          case "text":
          default:
            defaultValue = "true";
            break;
        }
        dispatchActions(planStylesSetPropertyActions(section.writeTargets, { key: writeKey, value: defaultValue }));
      } else {
        // Unknown key: add as flag (value "true" serializes as just the key name)
        dispatchActions(planStylesSetPropertyActions(section.writeTargets, { key: keyName, value: "true" }));
      }
      setAddingInSection(null);
    },
    [dispatchActions]
  );

  const handleToggleProperty = useCallback(
    (declaration: StylesCascadeDeclaration, enabled: boolean) => {
      if (!declaration.writeTargets.some((target) => target.writable)) {
        return;
      }
      const currentlyEnabled = declaration.status !== "disabled";
      if (currentlyEnabled === enabled) {
        return;
      }

      const key = toPropertyKey(declaration);
      if (key.length === 0) {
        return;
      }
      dispatchActions(
        planStylesTogglePropertyActions(declaration.writeTargets, {
          key,
          mode: enabled ? "enable" : "disable",
          sourceText: declaration.sourceText
        })
      );
    },
    [dispatchActions]
  );

  if (selectedSourceIds.length === 0) {
    return (
      <SidePanel className={css.panel}>
        <SidePanel.Content>
          <p className={css.hint}>Select an element to inspect its style cascade.</p>
        </SidePanel.Content>
      </SidePanel>
    );
  }

  if (selectedSourceIds.length > 1 && !areStylesCascadeModelsIdentical(models)) {
    return (
      <SidePanel className={css.panel}>
        <SidePanel.Content>
          <p className={css.hint}>Styles are available for a single element, or for multiple selected elements with identical cascades.</p>
        </SidePanel.Content>
      </SidePanel>
    );
  }

  if (!model) {
    return (
      <SidePanel className={css.panel}>
        <SidePanel.Content>
          <p className={css.hint}>Styles data is unavailable for the current selection.</p>
        </SidePanel.Content>
      </SidePanel>
    );
  }

  return (
    <SidePanel className={css.panel}>
      <SidePanel.Header>
        {model.elementIds.length > 1 ? `${model.elementIds.length} selected (matching styles)` : model.elementKind}
      </SidePanel.Header>
      <SidePanel.Content className={css.content}>
        {model.sections.map((section) => (
          <SidePanel.Section key={section.id}>
            <SidePanel.SectionHeader>
              <div className={css.sectionTitleWrap}>
                <div className={css.sectionTitle}>{section.title}</div>
                {section.subtitle ? <div className={css.sectionMeta}>{section.subtitle}</div> : null}
              </div>
              {section.sourceLocation ? <div className={css.sectionLocation}>{section.sourceLocation}</div> : null}
            </SidePanel.SectionHeader>
            <SidePanel.SectionBody className={css.ruleBody}>
              {section.declarations.map((declaration) => (
                <DeclarationRow
                  key={declaration.id}
                  declaration={declaration}
                  namedColorSwatches={projectNamedColorSwatches}
                  onPropertyChange={applyPropertyChange}
                  onDelete={handleDeleteProperty}
                  onToggle={handleToggleProperty}
                  onRenameKey={handleRenameKey}
                  onRawValueCommit={handleRawValueCommit}
                />
              ))}
              {section.writable ? (
                addingInSection === section.id ? (
                  <AddPropertyRow
                    section={section}
                    onAdd={handleAddProperty}
                    onCancel={() => { setAddingInSection(null); }}
                  />
                ) : (
                  <button
                    type="button"
                    className={css.addButton}
                    onClick={() => { setAddingInSection(section.id); }}
                  >
                    +
                  </button>
                )
              ) : null}
            </SidePanel.SectionBody>
          </SidePanel.Section>
        ))}
      </SidePanel.Content>
    </SidePanel>
  );
}

// ── Declaration row ──────────────────────────────────────────────────────────

function DeclarationRow({
  declaration,
  namedColorSwatches,
  onPropertyChange,
  onDelete,
  onToggle,
  onRenameKey,
  onRawValueCommit
}: {
  declaration: StylesCascadeDeclaration;
  namedColorSwatches: ReturnType<typeof useProjectNamedColorSwatches>;
  onPropertyChange: (declaration: StylesCascadeDeclaration, property: InspectorProperty, nextValue: string | number | boolean) => void;
  onDelete: (declaration: StylesCascadeDeclaration) => void;
  onToggle: (declaration: StylesCascadeDeclaration, enabled: boolean) => void;
  onRenameKey: (declaration: StylesCascadeDeclaration, newKey: string) => void;
  onRawValueCommit: (declaration: StylesCascadeDeclaration, rawValue: string) => void;
}): JSX.Element {
  const property = declaration.property;
  const toggleWritable = declaration.writeTargets.some((target) => target.writable);
  const enabled = declaration.status !== "disabled";
  const writable = toggleWritable && enabled;
  const className = [
    css.declaration,
    declaration.status === "disabled" ? css.declarationDisabled : "",
    declaration.status === "overridden" ? css.declarationOverridden : "",
    declaration.status === "inactive-default" ? css.declarationInactive : "",
    declaration.status === "unsupported" ? css.declarationUnsupported : ""
  ].filter(Boolean).join(" ");

  const keySlug = toPropertyKey(declaration);

  return (
    <div className={className}>
      <div className={css.checkboxCell}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={!toggleWritable}
          aria-label={`Toggle ${keySlug}`}
          onChange={(event) => { onToggle(declaration, event.currentTarget.checked); }}
        />
      </div>
      <div className={css.keyCell}>
        {writable ? (
          <CustomDropdown
            editable
            ariaLabel="Property name"
            value={keySlug}
            options={ALL_KEY_SUGGESTIONS}
            onChange={(newKey) => { onRenameKey(declaration, newKey); }}
            onCommit={(newKey) => { onRenameKey(declaration, newKey); }}
            triggerClassName={css.keyInput}
          />
        ) : (
          <span className={css.propertyName}>{keySlug}</span>
        )}
      </div>
      <div className={css.valueCell}>
        {renderValueEditor(declaration, property, writable, namedColorSwatches, onPropertyChange, onRawValueCommit)}
      </div>
      {writable ? (
        <button
          type="button"
          className={css.deleteButton}
          aria-label={`Delete ${keySlug}`}
          onClick={() => { onDelete(declaration); }}
        >
          ×
        </button>
      ) : (
        <div className={css.deleteButtonPlaceholder} />
      )}
    </div>
  );
}

// ── Value editor ─────────────────────────────────────────────────────────────

function renderValueEditor(
  declaration: StylesCascadeDeclaration,
  property: InspectorProperty | null,
  writable: boolean,
  namedColorSwatches: ReturnType<typeof useProjectNamedColorSwatches>,
  onPropertyChange: (declaration: StylesCascadeDeclaration, property: InspectorProperty, nextValue: string | number | boolean) => void,
  onRawValueCommit: (declaration: StylesCascadeDeclaration, rawValue: string) => void
): JSX.Element {
  if (!property) {
    // Unsupported/unknown property: raw text editor
    return (
      <RawValueInput
        value={toPropertyRawValue(declaration)}
        disabled={!writable}
        onCommit={(val) => { onRawValueCommit(declaration, val); }}
      />
    );
  }

  switch (property.kind) {
    case "color":
      return (
        <ColorPickerField
          ariaLabel={property.label}
          value={property.value}
          syntaxValue={property.syntaxValue}
          options={property.options}
          namedColorSwatches={namedColorSwatches}
          disabled={!writable}
          onChange={(value) => { onPropertyChange(declaration, property, value); }}
        />
      );
    case "number":
    case "length":
    case "lineWidth":
      return (
        <RawValueInput
          value={toPropertyRawValue(declaration)}
          disabled={!writable}
          onCommit={(val) => {
            const num = Number.parseFloat(val);
            if (!Number.isNaN(num)) {
              onPropertyChange(declaration, property, num);
            } else {
              // Raw text commit for non-numeric values like "thick"
              onRawValueCommit(declaration, val);
            }
          }}
        />
      );
    case "dashStyle":
    case "lineCap":
    case "lineJoin":
    case "fillMode":
    case "fillShading":
    case "fillPattern":
    case "nodeShape": {
      const options: CustomDropdownItem<string>[] = property.options.map((option) => ({ value: option.value, label: option.label }));
      return (
        <CustomDropdown
          editable
          ariaLabel={property.label}
          value={String(property.value)}
          disabled={!writable}
          options={options}
          onChange={(value) => { onPropertyChange(declaration, property, value); }}
          onCommit={(rawText) => { onRawValueCommit(declaration, rawText); }}
          triggerClassName={css.valueInput}
        />
      );
    }
    case "roundedCorners":
      return (
        <label className={css.checkboxLabel}>
          <input
            type="checkbox"
            checked={property.enabled}
            disabled={!writable}
            onChange={(event) => { onPropertyChange(declaration, property, event.target.checked); }}
          />
          <span>{property.enabled ? `${property.radius.toFixed(1)}pt` : "off"}</span>
        </label>
      );
    case "arrowTip":
    case "boolean":
    case "enum":
    case "fillPatternOption":
    case "nodeFont":
    case "nodeTextAlign":
    case "optionalLength":
    case "pathMorphingDecoration":
    case "shadowPreset":
    case "slider":
    case "text":
    default:
      return (
        <RawValueInput
          value={toPropertyRawValue(declaration)}
          disabled={!writable}
          onCommit={(val) => { onRawValueCommit(declaration, val); }}
        />
      );
  }
}

// ── Raw value text input ─────────────────────────────────────────────────────

function RawValueInput({
  value,
  disabled,
  onCommit
}: {
  value: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(value);
  const prevValueRef = useRef(value);

  useEffect(() => {
    if (prevValueRef.current === value) return;
    prevValueRef.current = value;
    if (!editing) {
      setEditText(value);
    }
  }, [editing, value]);

  return editing ? (
    <input
      className={css.rawInput}
      type="text"
      value={editText}
      onChange={(e) => { setEditText(e.target.value); }}
      onBlur={() => {
        setEditing(false);
        const trimmed = editText.trim();
        if (trimmed !== value) {
          onCommit(trimmed);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          setEditText(value);
          setEditing(false);
        }
      }}
      autoFocus
    />
  ) : (
    <button
      type="button"
      className={css.rawValueButton}
      disabled={disabled}
      onClick={() => {
        setEditText(value);
        setEditing(true);
      }}
    >
      {value || <span className={css.rawValueEmpty}>(empty)</span>}
    </button>
  );
}

// ── Add property row ─────────────────────────────────────────────────────────

function AddPropertyRow({
  section,
  onAdd,
  onCancel
}: {
  section: StylesCascadeSection;
  onAdd: (section: StylesCascadeSection, keyName: string) => void;
  onCancel: () => void;
}) {
  const addableOptions: CustomDropdownItem<string>[] = [
    ...section.addableProperties.map((p) => ({ value: `template:${p.propertyId}`, label: p.label })),
    ...ALL_KEY_SUGGESTIONS
  ];
  // Deduplicate by label
  const seen = new Set<string>();
  const deduped = addableOptions.filter((opt) => {
    if ("kind" in opt) return true;
    const key = opt.label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <div
      className={css.addRow}
      onBlur={(e) => {
        // Cancel if focus leaves the add row entirely
        if (!e.currentTarget.contains(e.relatedTarget)) {
          onCancel();
        }
      }}
    >
      <CustomDropdown
        editable
        autoFocus
        ariaLabel="New property name"
        value=""
        options={deduped}
        placeholder="Property name..."
        onCommit={(keyName) => {
          if (keyName.trim().length > 0) {
            onAdd(section, keyName.trim());
          } else {
            onCancel();
          }
        }}
        onChange={(value) => {
          if (value.length > 0) {
            onAdd(section, value);
          }
        }}
        triggerClassName={css.keyInput}
      />
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toPropertyKey(declaration: StylesCascadeDeclaration): string {
  if (
    declaration.property
    && "write" in declaration.property
    && declaration.property.write
    && declaration.property.write.key.length > 0
  ) {
    return declaration.property.write.key;
  }
  const raw = declaration.sourceText.trim();
  const eqIndex = raw.indexOf("=");
  if (eqIndex > 0) {
    return raw.slice(0, eqIndex).trim();
  }
  const colonIndex = raw.indexOf(":");
  if (colonIndex > 0) {
    return raw.slice(0, colonIndex).trim().toLowerCase().replace(/\s+/g, " ");
  }
  return declaration.label.trim().toLowerCase().replace(/\s+/g, " ");
}

function toPropertyRawValue(declaration: StylesCascadeDeclaration): string {
  if (declaration.property) {
    const p = declaration.property;
    switch (p.kind) {
      case "color":
        return p.syntaxValue ?? p.value ?? "";
      case "number":
        return String(p.value);
      case "length":
        return `${p.value}${p.unit}`;
      case "lineWidth":
        return `${p.value}pt`;
      case "dashStyle":
      case "lineCap":
      case "lineJoin":
      case "fillMode":
      case "fillShading":
      case "fillPattern":
      case "nodeShape":
        return String(p.value);
      case "roundedCorners":
        return p.enabled ? `${p.radius}pt` : "";
      case "arrowTip":
      case "boolean":
      case "enum":
      case "fillPatternOption":
      case "nodeFont":
      case "nodeTextAlign":
      case "optionalLength":
      case "pathMorphingDecoration":
      case "shadowPreset":
      case "slider":
      case "text":
      default:
        break;
    }
  }
  // Fall back to cssValue or raw source text
  if (declaration.cssValue.length > 0) return declaration.cssValue;
  const raw = declaration.sourceText.trim();
  const eqIndex = raw.indexOf("=");
  if (eqIndex > 0) return raw.slice(eqIndex + 1).trim();
  return "";
}

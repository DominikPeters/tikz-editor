import { deckPageDerived } from "../../deck-page-derived-cache";
import { rootKey } from "../../root-key";
import { useCallback, useMemo, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from "react";
import {
  applyDeckEditAction,
  buildBeamerObjectIndex,
  buildDeckFrameInspector,
  buildDeckObjectInspector,
  type BeamerFrameLayout,
  type DeckEditAction,
  type DeckInspectorField,
  type DeckInspectorModel,
  type DeckInspectorWrite,
} from "@tikz-editor/core/beamer/index";
import { useEditorStore } from "../../store/store";
import { SidePanel } from "../SidePanel";
import { CustomDropdown } from "../CustomDropdown";
import { useInspectorPreviewScrub } from "./useInspectorPreviewScrub";
import css from "./InspectorPanel.module.css";

/**
 * Deck-mode inspector (Stage 3b): renders `DeckInspectorModel` fields for
 * the selected deck object, or the frame options when nothing is selected.
 * Reuses the tikz inspector's styling and scrub machinery; writes dispatch
 * `DeckEditAction`s through the shared `APPLY_EDIT_ACTION` bookkeeping.
 *
 * Text and number inputs hold a local draft while focused and commit on
 * Enter/blur — deck commits resolve against the rendered frame layout, so
 * per-keystroke commits would race the re-render. Label scrubs freeze the
 * scrub-start source and layout, preview via `SET_SOURCE_TRANSIENT`, and
 * commit one recorded action computed against that frozen base.
 */
export function DeckInspectorPanel(): JSX.Element {
  const dispatch = useEditorStore((s) => s.dispatch);
  const source = useEditorStore((s) => s.source);
  const snapshot = useEditorStore((s) => s.snapshot);
  const deckObjectSelection = useEditorStore((s) => s.deckObjectSelection);
  const activeDocumentId = useEditorStore((s) => s.activeDocumentId);

  const activeFrame = snapshot.deck?.activeFrame ?? null;
  const activeRootId = useEditorStore(s => s.activeRootId);
  const activeStep = useEditorStore(s => s.deckStepByRootKey[rootKey(s.activeDocumentId, s.activeRootId)] ?? 1);
  const fresh = activeFrame != null && snapshot.source === source && activeFrame.frameId === activeRootId &&
    activeFrame.step === Math.min(activeStep, Math.max(1, activeFrame.stepCount));

  const selectedNode = useMemo(() => {
    if (!fresh || !activeFrame || deckObjectSelection == null) {
      return null;
    }
    if (
      deckObjectSelection.documentId !== activeDocumentId ||
      deckObjectSelection.frameId !== activeFrame.frameId
    ) {
      return null;
    }
    const index = deckPageDerived(activeFrame, source, "object-index", () => buildBeamerObjectIndex({
      items: activeFrame.layout.items,
      paragraphs: activeFrame.layout.paragraphs,
      source,
    }));
    return index.byId.get(deckObjectSelection.objectId) ?? null;
  }, [activeDocumentId, activeFrame, deckObjectSelection, fresh, source]);

  const model = useMemo<DeckInspectorModel | null>(() => {
    if (!fresh || !activeFrame) {
      return null;
    }
    if (selectedNode) {
      return buildDeckObjectInspector(source, selectedNode);
    }
    return buildDeckFrameInspector(source, activeFrame.frameId);
  }, [activeFrame, fresh, selectedNode, source]);

  // Keep showing the last model while a re-render is in flight so the panel
  // does not flicker to empty between an edit and its reconciled snapshot.
  const lastModelRef = useRef<DeckInspectorModel | null>(null);
  if (model) {
    lastModelRef.current = model;
  }
  const rendered = model ?? lastModelRef.current;

  const frameId = activeFrame?.frameId ?? null;
  const objectId = selectedNode?.id ?? deckObjectSelection?.objectId ?? null;

  const actionFor = useCallback(
    (
      write: DeckInspectorWrite,
      value: string | number | boolean | null
    ): DeckEditAction | null => {
      if (frameId == null || !fresh) {
        return null;
      }
      return deckActionForWrite(write, frameId, objectId, value);
    },
    [frameId, fresh, objectId]
  );

  const commit = useCallback(
    (write: DeckInspectorWrite, value: string | number | boolean | null): void => {
      const action = actionFor(write, value);
      if (action) {
        dispatch({ type: "APPLY_EDIT_ACTION", action });
      }
    },
    [actionFor, dispatch]
  );

  const selectionIds = useMemo(
    () => (objectId != null ? [objectId] : []),
    [objectId]
  );
  const { beginNumberLabelScrub } = useInspectorPreviewScrub({
    dispatch,
    selectedSourceIds: selectionIds,
    descriptor: null,
    multiModel: null,
    singlePropertyProvenance: {},
    multiPropertyProvenance: {},
    setFrozenInspectorView: () => {},
  });

  const scrubBaseRef = useRef<{
    source: string;
    layout: BeamerFrameLayout;
  } | null>(null);

  const beginDeckScrub = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      field: Extract<DeckInspectorField, { kind: "number" }>
    ): void => {
      if (!fresh || !activeFrame || field.value == null) {
        return;
      }
      const base = { source, layout: activeFrame.layout };
      scrubBaseRef.current = base;
      const buildResult = (next: number) => {
        const action = actionFor(field.write, next);
        if (!action) {
          return null;
        }
        const result = applyDeckEditAction(base.source, base.layout, action);
        return result.kind === "success" || result.kind === "partial"
          ? { action, result }
          : null;
      };
      beginNumberLabelScrub(event, {
        writable: true,
        value: field.value,
        step: field.step,
        min: field.min,
        max: field.max,
        onPreview: (next) => {
          const built = buildResult(next);
          if (built) {
            dispatch({
              type: "SET_SOURCE_TRANSIENT",
              source: built.result.newSource,
              changedSourceIds: [],
            });
          }
        },
        onCommit: (next) => {
          // The scrub helper restored the base source before this call, so
          // the precomputed result applies against the current document.
          const built = buildResult(next);
          if (built) {
            dispatch({
              type: "APPLY_EDIT_ACTION",
              action: built.action,
              precomputedSource: base.source,
              precomputedResult: built.result,
            });
          }
          scrubBaseRef.current = null;
        },
      });
    },
    [actionFor, activeFrame, beginNumberLabelScrub, dispatch, fresh, source]
  );

  if (!rendered) {
    return (
      <SidePanel className={css.panel}>
        <SidePanel.Content>
          <p className={css.hint}>Select a slide object to inspect it.</p>
        </SidePanel.Content>
      </SidePanel>
    );
  }

  return (
    <SidePanel className={css.panel}>
      <SidePanel.Header>{rendered.title}</SidePanel.Header>
      <SidePanel.Content className={css.content}>
        <SidePanel.SectionBody>
          <fieldset disabled={activeFrame?.frameId !== activeRootId || activeFrame?.step !== Math.min(activeStep, Math.max(1, activeFrame?.stepCount ?? 1))}
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          {rendered.fields.length === 0 ? (
            <p className={css.hint}>This object has no editable properties yet.</p>
          ) : (
            rendered.fields.map((field) => (
              <DeckField
                key={field.id}
                field={field}
                onCommit={commit}
                onBeginScrub={beginDeckScrub}
              />
            ))
          )}
          </fieldset>
        </SidePanel.SectionBody>
      </SidePanel.Content>
    </SidePanel>
  );
}

function formatDeckNumber(value: number): string {
  return String(Number(value.toFixed(4)));
}

function deckActionForWrite(
  write: DeckInspectorWrite,
  frameId: string,
  objectId: string | null,
  value: string | number | boolean | null
): DeckEditAction | null {
  const dimension = (suffix: string): string | null => {
    if (value == null) {
      return null;
    }
    return typeof value === "number"
      ? `${formatDeckNumber(value)}${suffix}`
      : String(value);
  };
  switch (write.kind) {
    case "renameEnvironment":
      return objectId == null
        ? null
        : { kind: "deckRenameEnvironment", frameId, objectId, name: String(value) };
    case "setEnvironmentTitle":
      return objectId == null
        ? null
        : { kind: "deckSetEnvironmentTitle", frameId, objectId, title: String(value ?? "") };
    case "setOverlaySpec": {
      if (objectId == null) {
        return null;
      }
      const spec = String(value ?? "").trim();
      return {
        kind: "deckSetOverlaySpec",
        frameId,
        objectId,
        spec: spec.length > 0 ? spec : null,
      };
    }
    case "setGraphicsOption":
      return objectId == null
        ? null
        : {
            kind: "deckSetGraphicsOption",
            frameId,
            objectId,
            key: write.key,
            value: dimension(write.suffix),
          };
    case "setEnvironmentOption":
      return objectId == null
        ? null
        : {
            kind: "deckSetEnvironmentOption",
            frameId,
            objectId,
            key: write.key,
            value: dimension(write.suffix),
          };
    case "setColumnWidth": {
      if (objectId == null) {
        return null;
      }
      const width = dimension(write.suffix);
      return width == null
        ? null
        : { kind: "deckSetColumnWidth", frameId, objectId, width };
    }
    case "setFrameOption": {
      if (typeof value === "boolean") {
        return { kind: "deckSetFrameOption", frameId, key: write.key, value: value ? true : null };
      }
      const text = String(value ?? "").trim();
      return {
        kind: "deckSetFrameOption",
        frameId,
        key: write.key,
        value: text.length > 0 ? text : null,
      };
    }
    case "setFrameAlignment":
      return { kind: "deckSetFrameOption", frameId, key: String(value), value: true };
  }
}

function DeckField(props: {
  field: DeckInspectorField;
  onCommit: (write: DeckInspectorWrite, value: string | number | boolean | null) => void;
  onBeginScrub: (
    event: ReactPointerEvent<HTMLElement>,
    field: Extract<DeckInspectorField, { kind: "number" }>
  ) => void;
}): JSX.Element {
  const { field, onCommit, onBeginScrub } = props;
  switch (field.kind) {
    case "enum":
      return (
        <div className={css.property}>
          <div className={css.propertyLabel}>{field.label}</div>
          <CustomDropdown
            ariaLabel={field.label}
            value={field.value}
            options={[...field.options]}
            onChange={(next) => { onCommit(field.write, next); }}
          />
        </div>
      );
    case "boolean":
      return (
        <div className={css.property}>
          <label className={css.checkboxControl}>
            <input
              className={css.checkboxInput}
              type="checkbox"
              checked={field.value}
              onChange={(event) => { onCommit(field.write, event.currentTarget.checked); }}
            />
            <span className={css.checkboxLabel}>{field.label}</span>
          </label>
        </div>
      );
    case "text":
      return <DeckTextField field={field} onCommit={onCommit} />;
    case "number":
      return <DeckNumberField field={field} onCommit={onCommit} onBeginScrub={onBeginScrub} />;
  }
}

function DeckTextField(props: {
  field: Extract<DeckInspectorField, { kind: "text" }>;
  onCommit: (write: DeckInspectorWrite, value: string) => void;
}): JSX.Element {
  const { field, onCommit } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const commitDraft = (value: string): void => {
    setDraft(null);
    if (value !== field.value) {
      onCommit(field.write, value);
    }
  };
  return (
    <div className={css.property}>
      <div className={css.propertyLabel}>{field.label}</div>
      <div className={css.controlRow}>
        <input
          className={css.textInput}
          type="text"
          aria-label={field.label}
          value={draft ?? field.value}
          placeholder={field.placeholder}
          onChange={(event) => { setDraft(event.currentTarget.value); }}
          onBlur={(event) => {
            if (draft != null) {
              commitDraft(event.currentTarget.value);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDraft(event.currentTarget.value);
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setDraft(null);
              event.currentTarget.blur();
            }
          }}
        />
      </div>
    </div>
  );
}

function DeckNumberField(props: {
  field: Extract<DeckInspectorField, { kind: "number" }>;
  onCommit: (write: DeckInspectorWrite, value: number | null) => void;
  onBeginScrub: (
    event: ReactPointerEvent<HTMLElement>,
    field: Extract<DeckInspectorField, { kind: "number" }>
  ) => void;
}): JSX.Element {
  const { field, onCommit, onBeginScrub } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const scrubbable = field.value != null;
  const commitDraft = (raw: string): void => {
    setDraft(null);
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      if (field.value != null) {
        onCommit(field.write, null);
      }
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed === field.value) {
      return;
    }
    onCommit(field.write, parsed);
  };
  return (
    <div className={css.property}>
      <div
        className={
          scrubbable
            ? `${css.propertyLabel} ${css.propertyLabelScrubbable}`
            : css.propertyLabel
        }
        onPointerDown={(event) => { onBeginScrub(event, field); }}
      >
        {field.label}
      </div>
      <div className={css.controlRow}>
        <input
          className={css.numberInput}
          type="number"
          aria-label={field.label}
          step={field.step}
          min={field.min}
          max={field.max}
          value={draft ?? (field.value != null ? String(field.value) : "")}
          placeholder={field.value == null ? "Unset" : undefined}
          onChange={(event) => { setDraft(event.currentTarget.value); }}
          onBlur={(event) => {
            if (draft != null) {
              commitDraft(event.currentTarget.value);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDraft(event.currentTarget.value);
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setDraft(null);
              event.currentTarget.blur();
            }
          }}
        />
        {field.unit ? <span className={css.unitLabel}>{field.unit}</span> : null}
      </div>
    </div>
  );
}

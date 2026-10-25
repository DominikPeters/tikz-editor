import { deckPageDerived, deckObjectIndexKey } from "../../deck-page-derived-cache";
import { deckStepRootKey } from "../../root-key";
import { useCallback, useMemo, useRef, type JSX, type PointerEvent as ReactPointerEvent } from "react";
import {
  applyDeckEditAction,
  buildBeamerObjectIndex,
  buildDeckDocumentInspector,
  buildDeckFrameInspector,
  buildDeckObjectInspector,
  buildDeckSlideContext,
  type BeamerFrameLayout,
  type DeckDocumentInspectorModel,
  type DeckEditAction,
  type DeckInspectorField,
  type DeckInspectorModel,
  type DeckInspectorWrite,
  type DeckSlideContext,
} from "@tikz-editor/core/beamer/index";
import { useEditorStore } from "../../store/store";
import { SidePanel } from "../SidePanel";
import { DeckField } from "./deck-fields";
import { DeckDocumentSections, DeckScopeHeader, DeckSlideInfoSection } from "./DeckDocumentSections";
import { useInspectorPreviewScrub } from "./useInspectorPreviewScrub";
import css from "./InspectorPanel.module.css";

/**
 * Deck-mode inspector (Stage 3b): renders `DeckInspectorModel` fields for
 * the selected deck object. With nothing selected it shows two scopes: the
 * slide's options and context, then the presentation's theme, colors, page
 * and title info (design/beamer-document-inspector.md).
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
  const deckDocument = snapshot.deck?.document;
  const activeRootId = useEditorStore(s => s.activeRootId);
  const activeStep = useEditorStore(s => s.deckStepByRootKey[deckStepRootKey(s.activeDocumentId, s.activeRootId)] ?? 1);
  const fresh = activeFrame != null && snapshot.source === source && activeFrame.frameId === activeRootId &&
    activeFrame.step === Math.min(activeStep, Math.max(1, activeFrame.stepCount));

  const selectedNode = useMemo(() => {
    if (!fresh || deckObjectSelection == null) {
      return null;
    }
    if (
      deckObjectSelection.documentId !== activeDocumentId ||
      deckObjectSelection.frameId !== activeFrame.frameId
    ) {
      return null;
    }
    const index = deckPageDerived(activeFrame, source, deckObjectIndexKey, () => buildBeamerObjectIndex({
      items: activeFrame.layout.items,
      paragraphs: activeFrame.layout.paragraphs,
      source,
    }));
    return index.byId.get(deckObjectSelection.objectId) ?? null;
  }, [activeDocumentId, activeFrame, deckObjectSelection, fresh, source]);

  const model = useMemo<DeckInspectorModel | null>(() => {
    if (!fresh) {
      return null;
    }
    if (selectedNode) {
      return buildDeckObjectInspector(source, selectedNode);
    }
    // The render's scan of the deck, rather than scanning it again here.
    return buildDeckFrameInspector(source, activeFrame.frameId, deckDocument);
  }, [activeFrame, deckDocument, fresh, selectedNode, source]);

  // Keep showing the last model while a re-render is in flight so the panel
  // does not flicker to empty between an edit and its reconciled snapshot.
  const lastModelRef = useRef<DeckInspectorModel | null>(null);
  if (model) {
    lastModelRef.current = model;
  }
  const rendered = model ?? lastModelRef.current;

  // Presentation-wide values depend only on the scanned deck, so they show
  // the last render's document even while a newer one is in flight.
  const documentModel = useMemo<DeckDocumentInspectorModel | null>(
    () => (deckDocument ? buildDeckDocumentInspector(deckDocument) : null),
    [deckDocument]
  );
  const frameSummary = snapshot.deck?.frames.find((frame) => frame.id === activeRootId) ?? null;
  const slideContext = useMemo<DeckSlideContext | null>(
    () => deckDocument && activeRootId
      ? buildDeckSlideContext(deckDocument, activeRootId, activeFrame?.frameId === activeRootId ? activeFrame.layout : undefined)
      : null,
    [activeFrame, activeRootId, deckDocument]
  );

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
      const write = field.write;
      if (!fresh || field.value == null || write == null) {
        return;
      }
      const base = { source, layout: activeFrame.layout };
      scrubBaseRef.current = base;
      const buildResult = (next: number) => {
        const action = actionFor(write, next);
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
        ...(field.min === undefined ? {} : { min: field.min }),
        ...(field.max === undefined ? {} : { max: field.max }),
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
      <SidePanel className={css.panel ?? ""}>
        <SidePanel.Content>
          <p className={css.hint}>Select a slide object to inspect it.</p>
        </SidePanel.Content>
      </SidePanel>
    );
  }

  const frameFieldsDisabled = activeFrame?.frameId !== activeRootId ||
    activeFrame.step !== Math.min(activeStep, Math.max(1, activeFrame.stepCount));
  const fieldList = (
    <fieldset disabled={frameFieldsDisabled} className={css.deckFields}>
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
  );

  if (rendered.target === "object") {
    return (
      <SidePanel className={css.panel ?? ""}>
        <SidePanel.Header>{rendered.title}</SidePanel.Header>
        <SidePanel.Content className={css.content ?? ""}>
          <SidePanel.Section>
            <SidePanel.SectionBody>{fieldList}</SidePanel.SectionBody>
          </SidePanel.Section>
        </SidePanel.Content>
      </SidePanel>
    );
  }

  return (
    <SidePanel className={css.panel ?? ""}>
      <SidePanel.Content className={css.content ?? ""}>
        <div className={css.deckScope}>
          <DeckScopeHeader
            title={frameSummary ? `Slide ${frameSummary.frameIndex + 1}` : "Slide"}
            detail={frameSummary?.title ?? null}
          />
          <SidePanel.Section>
            <SidePanel.SectionBody>{fieldList}</SidePanel.SectionBody>
          </SidePanel.Section>
          {slideContext ? (
            <DeckSlideInfoSection context={slideContext} stepCount={frameSummary?.stepCount ?? 1} />
          ) : null}
        </div>
        {documentModel ? (
          <div className={css.deckScope}>
            <DeckScopeHeader title="Presentation" />
            <DeckDocumentSections model={documentModel} onCommit={commit} />
          </div>
        ) : null}
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

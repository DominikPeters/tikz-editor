import { deckPageDerived, deckObjectIndexKey } from "../../deck-page-derived-cache";
import { deckStepRootKey } from "../../root-key";
import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from "react";
import {
  applyDeckEditAction,
  buildBeamerObjectIndex,
  buildDeckDocumentInspector,
  buildDeckFrameInspector,
  buildDeckObjectInspector,
  buildDeckSlideContext,
  scanBeamerDocument,
  type DeckDocumentEditAction,
  type BeamerFrameLayout,
  type BeamerObjectNode,
  type BeamerThemeCatalogEntry,
  type DeckDocumentInspectorModel,
  type DeckEditAction,
  type DeckInspectorCommand,
  type DeckInspectorField,
  type DeckInspectorModel,
  type DeckInspectorWrite,
  type DeckSlideContext,
} from "@tikz-editor/core/beamer/index";
import { Actions } from "flexlayout-react";
import { useEditorStore } from "../../store/store";
import { getDockLayoutHandle } from "../DockLayout";
import { SidePanel } from "../SidePanel";
import { DeckField } from "./deck-fields";
import { DeckDocumentSections, DeckScopeHeader, DeckSlideInfoSection } from "./DeckDocumentSections";
import { useInspectorPreviewScrub } from "./useInspectorPreviewScrub";
import css from "./InspectorPanel.module.css";
import { replaceSelectedDeckGraphics } from "../deck-graphics-replacement";

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
  const [replacementError, setReplacementError] = useState<{ documentId: string; objectId: string | null; message: string } | null>(null);
  const replacing = useRef(false);
  const dispatch = useEditorStore((s) => s.dispatch);
  const source = useEditorStore((s) => s.source);
  const snapshot = useEditorStore((s) => s.snapshot);
  const deckObjectSelection = useEditorStore((s) => s.deckObjectSelection);
  const activeDocumentId = useEditorStore((s) => s.activeDocumentId);
  const sourceRevision = useEditorStore((s) => s.sourceRevision);

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
      // An unsupported object's layout item says why the preview cannot draw it.
      const message = activeFrame.layout.items.find((item) => item.id === selectedNode.id)?.message;
      return buildDeckObjectInspector(source, selectedNode, message === undefined ? {} : { message });
    }
    // The render's scan of the deck, rather than scanning it again here.
    return buildDeckFrameInspector(source, activeFrame.frameId, deckDocument);
  }, [activeFrame, deckDocument, fresh, selectedNode, source]);

  // Keep showing the last model while a re-render is in flight so the panel
  // does not flicker to empty between an edit and its reconciled snapshot.
  const lastModelRef = useRef<{ documentId: string; rootId: string | null; model: DeckInspectorModel } | null>(null);
  if (model) {
    lastModelRef.current = { documentId: activeDocumentId, rootId: activeRootId, model };
  }
  const currentDocument = useMemo(() => deckDocument && snapshot.source === source
    ? deckDocument : scanBeamerDocument(source), [deckDocument, snapshot.source, source]);
  const previous = lastModelRef.current;
  const rendered = currentDocument.frames.length === 0 ? null : model ??
    (previous?.documentId === activeDocumentId && previous.rootId === activeRootId ? previous.model : null);

  // Presentation edits resolve against current source even while rendering
  // lags behind, and do not require the deck to have any frames.
  const documentModel = useMemo<DeckDocumentInspectorModel | null>(
    () => buildDeckDocumentInspector(currentDocument),
    [currentDocument]
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
      const documentAction = deckDocumentActionForWrite(write, value);
      if (documentAction) return documentAction;
      if (frameId == null || !fresh) {
        return null;
      }
      return deckActionForWrite(write, frameId, objectId, value);
    },
    [frameId, fresh, objectId]
  );

  // Some object ids carry source offsets (an image's ends in its text
  // range), so an edit that changes the object's length renames it. Object
  // edits never move its start: remember kind and start, and reselect the
  // object found there once the edited frame has rendered.
  const reselectRef = useRef<{
    documentId: string;
    frameId: string;
    kind: BeamerObjectNode["kind"];
    from: number;
    /** The pre-edit source, whose render must not settle the reselect. */
    sourceBefore: string;
  } | null>(null);
  const rememberSelection = useCallback((): void => {
    reselectRef.current = selectedNode && frameId != null
      ? { documentId: activeDocumentId, frameId, kind: selectedNode.kind, from: selectedNode.sourceSpan.from, sourceBefore: source }
      : null;
  }, [activeDocumentId, frameId, selectedNode, source]);
  useEffect(() => {
    const pending = reselectRef.current;
    if (!pending || !fresh || source === pending.sourceBefore) {
      return;
    }
    reselectRef.current = null;
    if (selectedNode || pending.documentId !== activeDocumentId || pending.frameId !== activeFrame.frameId) {
      return;
    }
    const index = deckPageDerived(activeFrame, source, deckObjectIndexKey, () => buildBeamerObjectIndex({
      items: activeFrame.layout.items,
      paragraphs: activeFrame.layout.paragraphs,
      source,
    }));
    const node = index.nodes.find((candidate) => candidate.kind === pending.kind && candidate.sourceSpan.from === pending.from);
    if (node) {
      dispatch({ type: "SET_DECK_OBJECT_SELECTION", frameId: pending.frameId, objectId: node.id });
    }
  }, [activeDocumentId, activeFrame, dispatch, fresh, selectedNode, source]);

  const commit = useCallback(
    (write: DeckInspectorWrite, value: string | number | boolean | null): void => {
      const action = actionFor(write, value);
      if (action) {
        rememberSelection();
        dispatch({ type: "APPLY_EDIT_ACTION", action });
      }
    },
    [actionFor, dispatch, rememberSelection]
  );

  const selectionIds = useMemo(
    () => (objectId != null ? [objectId] : []),
    [objectId]
  );
  const setFrozenInspectorView = useCallback(() => {}, []);
  const { beginNumberLabelScrub } = useInspectorPreviewScrub({
    dispatch,
    selectedSourceIds: selectionIds,
    descriptor: null,
    multiModel: null,
    singlePropertyProvenance: {},
    multiPropertyProvenance: {},
    setFrozenInspectorView,
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
            rememberSelection();
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
    [actionFor, activeFrame, beginNumberLabelScrub, dispatch, fresh, rememberSelection, source]
  );

  if (!rendered && !documentModel) {
    return (
      <SidePanel className={css.panel ?? ""}>
        <SidePanel.Content>
          <p className={css.hint}>Select a slide object to inspect it.</p>
        </SidePanel.Content>
      </SidePanel>
    );
  }

  const runCommand = (command: DeckInspectorCommand): void => {
    if (command.kind === "replaceGraphics") {
      if (replacing.current) return;
      replacing.current = true;
      setReplacementError(null);
      void replaceSelectedDeckGraphics({ getState: useEditorStore.getState, dispatch, rememberSelection }).then(result => {
        replacing.current = false;
        if (result.status === "failed") setReplacementError({ documentId: activeDocumentId, objectId, message: result.reason });
      });
      return;
    }
    if (command.kind === "enterDrawing") {
      if (frameId != null) dispatch({ type: "SET_DECK_OBJECT_SELECTION", frameId, objectId: null });
      dispatch({ type: "SET_ACTIVE_ROOT", rootId: command.rootId });
      return;
    }
    const dock = getDockLayoutHandle();
    if (dock && !dock.getModel().getNodeById("source")) dock.togglePanel("source");
    dock?.getModel().doAction(Actions.selectTab("source"));
    dispatch({ type: "REVEAL_SOURCE", documentId: activeDocumentId, sourceRevision, span: command.span });
  };
  const applyTheme = (entry: BeamerThemeCatalogEntry): void => {
    dispatch({ type: "APPLY_EDIT_ACTION", action: { kind: "deckSetPresentationTheme", name: entry.name } });
  };
  const frameFieldsDisabled = !fresh;
  const fieldList = (
    <fieldset disabled={frameFieldsDisabled} className={css.deckFields}>
      {rendered == null || rendered.fields.length === 0 ? (
        <p className={css.hint}>This object has no editable properties yet.</p>
      ) : (
        rendered.fields.map((field) => (
          <DeckField
            key={`${activeDocumentId}:${objectId ?? frameId}:${field.id}`}
            field={field}
            onCommit={commit}
            onBeginScrub={beginDeckScrub}
            onCommand={runCommand}
          />
        ))
      )}
    </fieldset>
  );

  if (rendered?.target === "object") {
    return (
      <SidePanel className={css.panel ?? ""}>
        <SidePanel.Header>{rendered.title}</SidePanel.Header>
        <SidePanel.Content className={css.content ?? ""}>
          <SidePanel.Section>
            <SidePanel.SectionBody>{fieldList}{replacementError?.documentId === activeDocumentId && replacementError.objectId === objectId ? <p role="alert" className={css.deckReadOnlyReason}>{replacementError.message}</p> : null}</SidePanel.SectionBody>
          </SidePanel.Section>
        </SidePanel.Content>
      </SidePanel>
    );
  }

  return (
    <SidePanel className={css.panel ?? ""}>
      <SidePanel.Content className={css.content ?? ""}>
        {rendered ? <div className={css.deckScope}>
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
        </div> : null}
        {documentModel ? (
          <div className={css.deckScope} data-inspector-panel>
            <DeckScopeHeader title="Presentation" />
            <DeckDocumentSections model={documentModel} onCommit={commit} onApplyTheme={applyTheme} onCommand={runCommand} />
          </div>
        ) : null}
      </SidePanel.Content>
    </SidePanel>
  );
}

function formatDeckNumber(value: number): string {
  return String(Number(value.toFixed(4)));
}

function deckDocumentActionForWrite(write: DeckInspectorWrite, value: string | number | boolean | null): DeckDocumentEditAction | null {
  if (write.kind === "setColor") return { kind: "deckSetColor", role: write.role, side: write.side, value: value === null ? null : String(value) };
  // An empty choice or a cleared field returns to the default.
  if (write.kind === "setClassOption") return { kind: "deckSetClassOption", key: write.key, value: value == null || value === "" ? null : String(value) };
  if (write.kind === "setNavigationSymbols") return { kind: "deckSetNavigationSymbols", visible: value == null || value === "" ? null : value === "shown" };
  if (write.kind === "setMetadataShort") return { kind: "deckSetMetadataShort", field: write.field, value: value == null || value === "" ? null : String(value) };
  if (write.kind === "setTheme") return { kind: "deckSetTheme", themeKind: write.themeKind, name: typeof value === "string" && value.length > 0 ? value : null };
  if (write.kind === "setThemeOption") return { kind: "deckSetThemeOption", key: write.key, value: value === true ? true : typeof value === "string" && value.trim().length > 0 ? value.trim() : null };
  if (write.kind === "setThemeFlagChoice") {
    const key = typeof value === "string" && write.keys.includes(value) ? value : null;
    return { kind: "deckSetThemeOption", key: key ?? write.keys[0] ?? "", value: key ? true : null };
  }
  return null;
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
    case "setListDefaultOverlay":
      return objectId == null ? null : { kind: "deckSetListDefaultOverlay", frameId, objectId, spec: typeof value === "string" && value.length > 0 ? value : null };
    case "setListLabelTemplate":
      return objectId == null ? null : { kind: "deckSetListLabelTemplate", frameId, objectId, template: typeof value === "string" && value.length > 0 ? value : null };
    case "setColor":
    case "setClassOption":
    case "setNavigationSymbols":
    case "setMetadataShort":
    case "setTheme":
    case "setThemeOption":
    case "setThemeFlagChoice": return deckDocumentActionForWrite(write, value);
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
    case "setGraphicsFlag":
      return objectId == null
        ? null
        : { kind: "deckSetGraphicsOption", frameId, objectId, key: write.key, value: value === true ? true : null };
    case "setEnvironmentFlag":
      return objectId == null
        ? null
        : { kind: "deckSetEnvironmentOption", frameId, objectId, key: write.key, value: value === true ? true : null };
    case "setEnvironmentFlagChoice": {
      if (objectId == null) {
        return null;
      }
      // "" clears every flag of the choice; a flag replaces the others.
      const flag = typeof value === "string" ? value : "";
      return flag.length > 0
        ? { kind: "deckSetEnvironmentOption", frameId, objectId, key: flag, value: true, exclusive: write.keys }
        : { kind: "deckSetEnvironmentOption", frameId, objectId, key: write.keys[0] ?? "", value: null, exclusive: write.keys };
    }
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

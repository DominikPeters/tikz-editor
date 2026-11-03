import { applyEditAction, type EditAction, type EditActionResult } from "@tikz-editor/core/edit/actions";
import { applyDeckEditAction, applyDeckDocumentEditAction, beamerOverlayPicturesIn, isDeckDocumentEditAction, isDeckEditAction, scanBeamerDocument, type DeckEditAction } from "@tikz-editor/core/beamer/index";
import { createBeamerSyntaxContext } from "@tikz-editor/core/beamer/syntax";
import { createEditGeometrySession, type EditGeometrySession } from "@tikz-editor/core/edit/geometry-session";
import type { EditParseOptions } from "@tikz-editor/core/edit/parse-options";
import type { EvaluateOptions } from "@tikz-editor/core/semantic/types";
import type { Span, Statement } from "@tikz-editor/core/ast/types";
import { maskSourceOutsideSpan, maskTikzPictureSource } from "@tikz-editor/core/document/masking";
import { parseDocumentRootId } from "@tikz-editor/core/document/root-id";
import { applySourcePatches, composeSourcePatches } from "@tikz-editor/core/edit/source-patches";
import type { SourcePatch } from "@tikz-editor/core/edit/types";
import { editedSlice, EMPTY_FRAGMENT } from "@tikz-editor/core/edit/fragment";
import { drawingLayerOffset, insertDrawingLayer } from "./drawing-layer";
import { buildEditParseOptions } from "./edit-parse-options";
import { documentKindForSource } from "./store/workspace-state";
import { parseTikz } from "@tikz-editor/core/parser/index";
import { beamerDrawingLayerRemovalSpan } from "@tikz-editor/core/beamer/overlay-pictures";
import type { SessionSnapshot } from "./compute";

export type EditExecutionContext = {
  documentId: string;
  source: string;
  sourceRevision: number;
  activeRootId: string | null;
  drawingLayerRootId?: string | null;
  snapshot: SessionSnapshot;
};

/** Shared preparation for canvas gestures, inspector edits, and commands. */
export function executeDocumentEdit(
  context: EditExecutionContext,
  action: EditAction | DeckEditAction,
  options: {
    geometry?: EditGeometrySession;
    parseOptions?: EditParseOptions;
    evaluateOptions?: EvaluateOptions;
    nestedFigureSpan?: Span | null;
  } = {}
): EditActionResult {
  const { source, snapshot, activeRootId } = context;
  const ref = parseDocumentRootId(activeRootId ?? "");
  const slideOverlay = ref?.kind === "beamer-frame" && snapshot.overlayLayer?.pageCoordinates === true && snapshot.overlayLayer.frameIndex === ref.index;
  const nested = documentKindForSource(source) === "beamer" && (ref?.kind === "beamer-frame-tikz" || slideOverlay);
  const deck = documentKindForSource(source) === "beamer" && ref?.kind !== "beamer-frame-tikz";
  if (isDeckEditAction(action)) {
    if (deck && isDeckDocumentEditAction(action)) return applyDeckDocumentEditAction(source, action);
    const frame = snapshot.deck?.activeFrame;
    return deck && frame && snapshot.source === source
      ? applyDeckEditAction(source, frame.layout, action)
      : { kind: "unsupported", reason: "The slide layout is still catching up." };
  }
  if (deck && !slideOverlay) return { kind: "unsupported", reason: "The slide's drawing geometry is still catching up." };
  // Element ids and handles name things in the picture the snapshot shows. Right
  // after switching pictures they would resolve against the new one instead.
  if (!nested && activeRootId != null && snapshot.activeRootId != null && snapshot.activeRootId !== activeRootId) {
    return { kind: "unsupported", reason: "The figure is still catching up." };
  }
  if ((ref?.kind === "beamer-frame-tikz" && ref.layer && snapshot.overlayLayer?.rootId !== activeRootId) ||
    (slideOverlay && context.drawingLayerRootId && context.drawingLayerRootId !== snapshot.overlayLayer?.rootId)) {
    return { kind: "unsupported", reason: "The figure is still catching up." };
  }
  const span = options.nestedFigureSpan ?? (nested ? resolveNestedEditSpan(context) : null);
  const propertyEdit = action.kind === "setProperty" || action.kind === "setProperties";
  if (nested && (!span || (!propertyEdit && !options.geometry && snapshot.source !== source))) {
    return { kind: "unsupported", reason: "The figure is still catching up." };
  }
  // A drawing layer the frame does not have yet is edited in the source with it inserted.
  const layer = nested ? snapshot.overlayLayer ?? null : null;
  const insertion = layer?.insertion ?? null;
  if (insertion && snapshot.source !== source) {
    return { kind: "unsupported", reason: "The figure is still catching up." };
  }
  const working = insertion ? insertDrawingLayer(source, insertion) : source;
  const editSource = span ? maskTikzPictureSource(working, span) : source;
  const parseRootId = span ? snapshot.parseResult?.activeFigureId : activeRootId;
  const parseContext: Omit<EditExecutionContext, "activeRootId"> & { activeRootId?: string | null } = { ...context };
  if (parseRootId === undefined) delete parseContext.activeRootId;
  else parseContext.activeRootId = parseRootId;
  const parseOptions = buildEditParseOptions({ ...parseContext, source: editSource, analysis: "none", ...((options.parseOptions) === undefined ? {} : { overrides: options.parseOptions }) });
  const evaluateOptions = { ...options.evaluateOptions, ...layer?.evaluate };
  if (parseOptions.sourceFingerprint === undefined) delete evaluateOptions.sourceFingerprint;
  else evaluateOptions.sourceFingerprint = parseOptions.sourceFingerprint;
  const snapshotMatchesRoot = parseOptions.activeFigureId === undefined || snapshot.parseResult?.activeFigureId === parseOptions.activeFigureId;
  const geometry = options.geometry ?? (snapshotMatchesRoot && snapshot.source === source && snapshot.parseResult && snapshot.semanticResult
    ? createEditGeometrySession({ source: editSource, parsed: snapshot.parseResult, semantic: snapshot.semanticResult }, evaluateOptions, parseOptions)
    : undefined);
  const result = applyEditAction(editSource, snapshot.editHandles, action, { ...((geometry) === undefined ? {} : { geometry: geometry }), parseOptions, evaluateOptions });
  if (!span || (result.kind !== "success" && result.kind !== "partial")) return result;
  const replay = applySourcePatches(working, result.patches);
  if (replay.kind !== "success") return { kind: "error", message: "The figure edit did not apply cleanly." };
  if (!insertion) {
    if (layer && (action.kind === "deleteElement" || action.kind === "deleteElements")) {
      const editedSpan = { from: span.from, to: span.to + replay.source.length - working.length };
      const parsed = parseTikz(maskSourceOutsideSpan(replay.source, editedSpan), { recover: true });
      if (onlyEmptyScopes(parsed.figure.body) && !parsed.diagnostics.some(diagnostic => diagnostic.severity === "error")) {
        const removal = beamerDrawingLayerRemovalSpan(replay.source, editedSpan);
        const removalPatch = { oldSpan: removal, newSpan: { from: removal.from, to: removal.from }, replacement: EMPTY_FRAGMENT };
        const removed = applySourcePatches(replay.source, [removalPatch]);
        if (removed.kind === "success") {
          const removedResult = { ...result, newSource: removed.source,
            patches: composeSourcePatches(source, [result.patches, [removalPatch]]) };
          delete removedResult.changedSourceIds;
          return removedResult;
        }
      }
    }
    return { ...result, newSource: replay.source };
  }
  // The first drawing inserts the layer (and what the preamble needs for
  // it): one edit, the layer as drawn on.
  const layerAt = drawingLayerOffset(insertion);
  const end = layerAt + insertion.text.length;
  if (result.patches.some((patch) => patch.oldSpan.from < layerAt || patch.oldSpan.to > end)) {
    return { kind: "error", message: "The figure edit did not apply cleanly." };
  }
  const replacement = editedSlice(replay.source, layerAt, end + replay.source.length - working.length);
  let patches: SourcePatch[] = [{ oldSpan: { from: insertion.at, to: insertion.at }, newSpan: { from: insertion.at, to: insertion.at + replacement.length }, replacement }];
  const preamble = insertion.preamble;
  if (preamble) {
    const preamblePatch = {
      oldSpan: { from: preamble.at, to: preamble.at },
      newSpan: { from: preamble.at, to: preamble.at + preamble.text.length },
      replacement: preamble.text
    };
    patches = composeSourcePatches(source, [patches, [preamblePatch]]);
  }
  const committed = applySourcePatches(source, patches);
  if (committed.kind !== "success") return { kind: "error", message: "The figure edit did not apply cleanly." };
  const committedResult = { ...result, newSource: committed.source, patches };
  delete committedResult.changedSourceIds;
  return committedResult;
}

function onlyEmptyScopes(statements: readonly Statement[]): boolean {
  return statements.every(statement => statement.kind === "Scope" && onlyEmptyScopes(statement.body));
}

/**
 * The source a nested picture's edits apply to: the document's, or for a
 * drawing layer still to come, the document's with the layer inserted.
 */
export function nestedEditBaseSource(source: string, snapshot: SessionSnapshot): string {
  const insertion = snapshot.overlayLayer?.insertion;
  return insertion && snapshot.source === source ? insertDrawingLayer(source, insertion) : source;
}

/** Property previews can outpace rendering; resolve their current picture span. */
export function resolveNestedEditSpan(context: EditExecutionContext): Span | null {
  const active = parseDocumentRootId(context.activeRootId ?? "");
  const ref = active?.kind === "beamer-frame" && context.snapshot.overlayLayer?.pageCoordinates
    ? parseDocumentRootId(context.snapshot.overlayLayer.rootId) : active;
  if (ref?.kind !== "beamer-frame-tikz") return null;
  const { snapshot, source } = context;
  if (snapshot.source === source) {
    const span = snapshot.parseResult?.figure.span;
    if (ref.layer) {
      const layerId = snapshot.overlayLayer?.rootId;
      if (!layerId) return null;
      return layerId === (active?.kind === "beamer-frame" ? context.drawingLayerRootId ?? layerId : context.activeRootId) ? span ?? null : null;
    }
    const expected = scanBeamerDocument(source).frames[ref.frameIndex]?.children[ref.index]?.span;
    if (!span || !expected) return null;
    return span.from === expected.from && span.to === expected.to ? span : null;
  }
  const frame = scanBeamerDocument(source).frames[ref.frameIndex];
  if (!frame) return null;
  return ref.layer
    ? beamerOverlayPicturesIn(createBeamerSyntaxContext(source), frame.bodySpan)[ref.index]?.span ?? null
    : frame.children[ref.index]?.span ?? null;
}

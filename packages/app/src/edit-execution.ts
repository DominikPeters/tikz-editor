import { applyEditAction, type EditAction, type EditActionResult } from "@tikz-editor/core/edit/actions";
import { applyDeckEditAction, beamerOverlayPicturesIn, isDeckEditAction, scanBeamerDocument, type DeckEditAction } from "@tikz-editor/core/beamer/index";
import { createBeamerSyntaxContext } from "@tikz-editor/core/beamer/syntax";
import { createEditGeometrySession, type EditGeometrySession } from "@tikz-editor/core/edit/geometry-session";
import type { EditParseOptions } from "@tikz-editor/core/edit/parse-options";
import type { EvaluateOptions } from "@tikz-editor/core/semantic/types";
import type { Span } from "@tikz-editor/core/ast/types";
import { maskSourceOutsideSpan } from "@tikz-editor/core/document/masking";
import { parseDocumentRootId } from "@tikz-editor/core/document/root-id";
import { applySourcePatches } from "@tikz-editor/core/edit/source-patches";
import { buildEditParseOptions } from "./edit-parse-options";
import { documentKindForSource } from "./store/workspace-state";
import type { SessionSnapshot } from "./compute";

export type EditExecutionContext = {
  documentId: string;
  source: string;
  sourceRevision: number;
  activeRootId: string | null;
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
  const nested = documentKindForSource(source) === "beamer" && parseDocumentRootId(activeRootId ?? "")?.kind === "beamer-frame-tikz";
  const deck = documentKindForSource(source) === "beamer" && !nested;
  if (deck !== isDeckEditAction(action)) {
    return { kind: "unsupported", reason: "The edit does not apply to the active document view." };
  }
  if (isDeckEditAction(action)) {
    const frame = snapshot.deck?.activeFrame;
    return frame && snapshot.source === source
      ? applyDeckEditAction(source, frame.layout, action)
      : { kind: "unsupported", reason: "The slide layout is still catching up." };
  }
  // Element ids and handles name things in the picture the snapshot shows. Right
  // after switching pictures they would resolve against the new one instead.
  if (!nested && activeRootId != null && snapshot.activeRootId != null && snapshot.activeRootId !== activeRootId) {
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
  const working = insertion ? insertLayer(source, insertion) : source;
  const editSource = span ? maskSourceOutsideSpan(working, span) : source;
  const parseOptions = buildEditParseOptions({ ...context, source: editSource, activeRootId: span ? snapshot.activeRootId : activeRootId, analysis: "none", overrides: options.parseOptions });
  const evaluateOptions = { ...options.evaluateOptions, ...layer?.evaluate, sourceFingerprint: parseOptions.sourceFingerprint };
  const snapshotMatchesRoot = parseOptions.activeFigureId === undefined || snapshot.activeRootId === parseOptions.activeFigureId;
  const geometry = options.geometry ?? (snapshotMatchesRoot && snapshot.source === source && snapshot.parseResult && snapshot.semanticResult
    ? createEditGeometrySession({ source: editSource, parsed: snapshot.parseResult, semantic: snapshot.semanticResult }, evaluateOptions, parseOptions)
    : undefined);
  const result = applyEditAction(editSource, snapshot.editHandles, action, { geometry, parseOptions, evaluateOptions });
  if (!span || (result.kind !== "success" && result.kind !== "partial")) return result;
  const replay = applySourcePatches(working, result.patches);
  if (replay.kind !== "success") return { kind: "error", message: "The figure edit did not apply cleanly." };
  if (!insertion) return { ...result, newSource: replay.source };
  // The first drawing inserts the layer: one patch, the layer as drawn on.
  const end = insertion.at + insertion.text.length;
  if (result.patches.some((patch) => patch.oldSpan.from < insertion.at || patch.oldSpan.to > end)) {
    return { kind: "error", message: "The figure edit did not apply cleanly." };
  }
  const replacement = replay.source.slice(insertion.at, end + replay.source.length - working.length);
  return {
    ...result,
    newSource: replay.source,
    patches: [{ oldSpan: { from: insertion.at, to: insertion.at }, newSpan: { from: insertion.at, to: insertion.at + replacement.length }, replacement }],
    changedSourceIds: undefined
  };
}

/**
 * The source a nested picture's edits apply to: the document's, or for a
 * drawing layer still to come, the document's with the layer inserted.
 */
export function nestedEditBaseSource(source: string, snapshot: SessionSnapshot): string {
  const insertion = snapshot.overlayLayer?.insertion;
  return insertion && snapshot.source === source ? insertLayer(source, insertion) : source;
}

function insertLayer(source: string, insertion: { at: number; text: string }): string {
  return source.slice(0, insertion.at) + insertion.text + source.slice(insertion.at);
}

/** Property previews can outpace rendering; resolve their current picture span. */
export function resolveNestedEditSpan(context: EditExecutionContext): Span | null {
  const ref = parseDocumentRootId(context.activeRootId ?? "");
  if (ref?.kind !== "beamer-frame-tikz") return null;
  const { snapshot, source } = context;
  if (snapshot.source === source) {
    return snapshot.figures.find(figure => figure.id === snapshot.activeRootId)?.span ?? null;
  }
  const frame = scanBeamerDocument(source).frames[ref.frameIndex];
  if (!frame) return null;
  return ref.layer
    ? beamerOverlayPicturesIn(createBeamerSyntaxContext(source), frame.bodySpan)[ref.index]?.span ?? null
    : frame.children[ref.index]?.span ?? null;
}

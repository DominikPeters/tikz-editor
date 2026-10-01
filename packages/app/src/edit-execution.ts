import { applyEditAction, type EditAction, type EditActionResult } from "@tikz-editor/core/edit/actions";
import { applyDeckEditAction, isDeckEditAction, scanBeamerDocument, type DeckEditAction } from "@tikz-editor/core/beamer/index";
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
  const span = options.nestedFigureSpan ?? (nested ? resolveNestedEditSpan(context) : null);
  const propertyEdit = action.kind === "setProperty" || action.kind === "setProperties";
  if (nested && (!span || (!propertyEdit && !options.geometry && snapshot.source !== source))) {
    return { kind: "unsupported", reason: "The figure is still catching up." };
  }
  const editSource = span ? maskSourceOutsideSpan(source, span) : source;
  const parseOptions = buildEditParseOptions({ ...context, source: editSource, activeRootId: span ? snapshot.activeRootId : activeRootId, analysis: "none", overrides: options.parseOptions });
  // Source cleanup is certified asynchronously after the edit. Core callers
  // outside the app can still request synchronous commit certification.
  if ((action.kind === "setProperty" || action.kind === "setProperties") &&
      (parseOptions.propertyWriteMode == null || parseOptions.propertyWriteMode === "commit")) {
    parseOptions.propertyWriteMode = "drag-frame";
  }
  const evaluateOptions = { ...options.evaluateOptions, sourceFingerprint: parseOptions.sourceFingerprint };
  const snapshotMatchesRoot = parseOptions.activeFigureId === undefined || snapshot.activeRootId === parseOptions.activeFigureId;
  const geometry = options.geometry ?? (snapshotMatchesRoot && snapshot.source === source && snapshot.parseResult && snapshot.semanticResult
    ? createEditGeometrySession({ source: editSource, parsed: snapshot.parseResult, semantic: snapshot.semanticResult }, evaluateOptions, parseOptions)
    : undefined);
  const result = applyEditAction(editSource, snapshot.editHandles, action, { geometry, parseOptions, evaluateOptions });
  if (!span || (result.kind !== "success" && result.kind !== "partial")) return result;
  const replay = applySourcePatches(source, result.patches);
  return replay.kind === "success" ? { ...result, newSource: replay.source }
    : { kind: "error", message: "The figure edit did not apply cleanly." };
}

/** Property previews can outpace rendering; resolve their current picture span. */
export function resolveNestedEditSpan(context: EditExecutionContext): Span | null {
  const ref = parseDocumentRootId(context.activeRootId ?? "");
  if (ref?.kind !== "beamer-frame-tikz") return null;
  const { snapshot, source } = context;
  if (snapshot.source === source) {
    return snapshot.figures.find(figure => figure.id === snapshot.activeRootId)?.span ?? null;
  }
  return scanBeamerDocument(source).frames[ref.frameIndex]?.children[ref.index]?.span ?? null;
}

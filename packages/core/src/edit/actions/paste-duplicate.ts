import { legacyText, unchangedSource, type EditedSource } from "../fragment.js";
import { requireArrayValue } from "../../utils/collections.js";
import type { EditActionResultLike } from "../result-types.js";
import { worldPoint } from "../../coords/points.js";
import type { WorldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { EditHandle } from "../../semantic/types.js";
import type { Span } from "../../ast/types.js";
import { evaluateTikzFigure } from "../../semantic/evaluate.js";
import { isCoordinateEditHandle, type EvaluateOptions } from "../../semantic/types.js";
import {
  applyTextReplacements,
  formatSnippetsForInsertion,
  groupStatementRefsByParent,
  lineIndentAtOffset,
  mapSpansThroughPatches,
  parseStatementSnapshot,
  resolveRootInsertionPoint,
  resolveStatementRefs,
  statementSnippet,
  type StatementRef,
  type StatementSnapshot
} from "../statement-ops.js";
import { renameSnippetDeclaredNames } from "../name-conflicts.js";
import { computeMinimalReplacementPatch } from "../patch.js";
import { composeSourcePatches, patchesMatchSourceTransition } from "../source-patches.js";
import type { SourcePatch } from "../types.js";
import { parseTikzForEdit, type EditParseOptions } from "../parse-options.js";

export type PasteStatementsAction = {
  snippets: string[];
  anchorElementId?: string;
  delta?: WorldPoint;
};

export type DuplicateElementsAction = {
  elementIds: string[];
  delta?: WorldPoint;
};


type PasteDuplicateDeps = {
  applyMoveElements: (
    source: string,
    editHandles: readonly EditHandle[],
    elementIds: readonly string[],
    delta: WorldPoint,
    parseOptions?: EditParseOptions
  ) => EditActionResultLike;
  normalizeElementIds: (elementIds: readonly string[]) => string[];
  uniqueStrings: (values: readonly string[]) => string[];
  defaultDuplicateOffsetPt: number;
};

type OffsetInsertedResult = {
  source: EditedSource;
  patches: SourcePatch[];
  partialReason?: string;
  skippedHandles: string[];
};

type PasteDuplicateCaches = {
  snapshots: Map<string, StatementSnapshot>;
};

export function applyPasteStatementsAction(
  source: string,
  action: PasteStatementsAction,
  deps: PasteDuplicateDeps,
  parseOptions: EditParseOptions = {},
  evaluateOptions: EvaluateOptions = {}
): EditActionResultLike {
  const caches = createPasteDuplicateCaches();
  const snippets = action.snippets
    .map((snippet) => snippet.replace(/\r\n?/g, "\n").trimEnd())
    .filter((snippet) => snippet.trim().length > 0);
  if (snippets.length === 0) {
    return { kind: "unsupported", reason: "No snippets were provided for pasteStatements." };
  }

  const delta = normalizeDuplicateDelta(action.delta, deps.defaultDuplicateOffsetPt);
  const renamedSnippets = renameSnippetDeclaredNames(source, snippets, parseOptions);

  const snapshot = getStatementSnapshot(source, parseOptions, caches);
  const anchorId = action.anchorElementId?.trim();
  const anchorRef = anchorId ? snapshot.byId.get(anchorId) : undefined;
  const parsed = anchorRef ? null : parseTikzForEdit(source, parseOptions);
  const activeFigure = parsed?.figures.find(figure => figure.id === parsed.activeFigureId);

  const insertionWorldPoint = anchorRef
    ? {
        offset: anchorRef.span.to,
        indent: lineIndentAtOffset(source, anchorRef.span.from)
      }
    : resolveRootInsertionPoint(source, activeFigure);

  const insertion = formatSnippetsForInsertion(renamedSnippets, insertionWorldPoint.indent, {
    trailingNewline: !anchorRef,
    newline: detectPreferredNewline(source, insertionWorldPoint.offset)
  });

  const applied = applyTextReplacements(source, [
    {
      span: { from: insertionWorldPoint.offset, to: insertionWorldPoint.offset },
      text: legacyText(insertion.text)
    }
  ]);
  const appliedInsertion = requireArrayValue(applied.applied, 0);

  const insertedSpans = insertion.snippetSpans.map((span) => ({
    from: appliedInsertion.newSpan.from + span.from,
    to: appliedInsertion.newSpan.from + span.to
  }));
  // The copy is offset where it now stands, so its coordinates are read in the frame it lands in.
  const shifted = offsetInsertedStatements(applied.source, insertedSpans, delta, deps, parseOptions, evaluateOptions, caches);
  const patches = composeSourcePatches(source, [applied.patches, shifted.patches]);
  const selectedSourceIds = mapSpansToStatementIdsWithSnapshot(
    getStatementSnapshot(shifted.source, parseOptions, caches),
    mapSpansThroughPatches(insertedSpans, shifted.patches)
  );
  const changedSourceIds = selectedSourceIds.length > 0 ? selectedSourceIds : undefined;

  if (shifted.partialReason) {
    return {
      kind: "partial",
      newSource: shifted.source,
      patches,
      skippedHandles: shifted.skippedHandles,
      reason: shifted.partialReason,
      ...(changedSourceIds === undefined ? {} : { selectedSourceIds: changedSourceIds }),
      ...(changedSourceIds === undefined ? {} : { changedSourceIds })
    };
  }

  return {
    kind: "success",
    newSource: shifted.source,
    patches,
    ...(changedSourceIds === undefined ? {} : { selectedSourceIds: changedSourceIds }),
    ...(changedSourceIds === undefined ? {} : { changedSourceIds })
  };
}

export function applyDuplicateElementsAction(
  source: string,
  action: DuplicateElementsAction,
  deps: PasteDuplicateDeps,
  parseOptions: EditParseOptions = {},
  evaluateOptions: EvaluateOptions = {}
): EditActionResultLike {
  const caches = createPasteDuplicateCaches();
  const normalizedIds = deps.normalizeElementIds(action.elementIds);
  if (normalizedIds.length === 0) {
    return { kind: "unsupported", reason: "No element ids were provided for duplicateElements." };
  }

  const initialSnapshot = getStatementSnapshot(source, parseOptions, caches);
  const initialRefs = resolveStatementRefs(initialSnapshot, normalizedIds);
  if (initialRefs.length === 0) {
    return { kind: "unsupported", reason: "No duplicable statements were found for the selected element ids." };
  }

  // Ids count statements from the top, so a copy only shifts the ids after it: work from the end.
  const groups = groupStatementRefsByParent(initialRefs)
    .flatMap((group) => adjacentRuns(source, group.refs).map((refs) => ({ ...group, refs })))
    .sort((left, right) => Math.max(...right.refs.map((ref) => ref.span.to)) - Math.max(...left.refs.map((ref) => ref.span.to)));
  let currentSource = unchangedSource(source);
  const steps: SourcePatch[][] = [];
  let insertedSpans: Span[] = [];
  const partialReasons: string[] = [];
  const partialSkippedHandles: string[] = [];
  const delta = normalizeDuplicateDelta(action.delta, deps.defaultDuplicateOffsetPt);

  for (const group of groups) {
    const snapshot = getStatementSnapshot(currentSource, parseOptions, caches);
    const currentRefs = resolveStatementRefs(
      snapshot,
      group.refs.map((ref) => ref.id)
    );

    const resolvedGroups = groupStatementRefsByParent(currentRefs);
    for (const resolvedGroup of resolvedGroups) {
      const orderedRefs = [...resolvedGroup.refs].sort((left, right) => left.index - right.index);
      const snippets = orderedRefs
        .map((ref) => statementSnippet(currentSource, ref).replace(/\r\n?/g, "\n").trimEnd())
        .filter((snippet) => snippet.trim().length > 0);
      const renamedSnippets = renameSnippetDeclaredNames(currentSource, snippets, parseOptions);

      const anchor = requireArrayValue(orderedRefs, orderedRefs.length - 1);

      const insertion = formatSnippetsForInsertion(
        renamedSnippets,
        lineIndentAtOffset(currentSource, anchor.span.from)
      );

      const applied = applyTextReplacements(currentSource, [
        {
          span: { from: anchor.span.to, to: anchor.span.to },
          text: legacyText(insertion.text)
        }
      ]);
      const appliedInsertion = requireArrayValue(applied.applied, 0);
      const groupSpans = insertion.snippetSpans.map((span) => ({
        from: appliedInsertion.newSpan.from + span.from,
        to: appliedInsertion.newSpan.from + span.to
      }));
      const shifted = offsetInsertedStatements(applied.source, groupSpans, delta, deps, parseOptions, evaluateOptions, caches);
      if (shifted.partialReason) {
        partialReasons.push(shifted.partialReason);
        partialSkippedHandles.push(...shifted.skippedHandles);
      }

      steps.push(applied.patches, shifted.patches);
      currentSource = shifted.source;
      insertedSpans = [
        ...mapSpansThroughPatches(mapSpansThroughPatches(insertedSpans, applied.patches), shifted.patches),
        ...mapSpansThroughPatches(groupSpans, shifted.patches)
      ];
    }
  }

  const patches = composeSourcePatches(source, steps);
  const selectedSourceIds = mapSpansToStatementIdsWithSnapshot(
    getStatementSnapshot(currentSource, parseOptions, caches),
    insertedSpans
  );
  const changedSourceIds = selectedSourceIds.length > 0 ? selectedSourceIds : undefined;
  if (partialReasons.length > 0) {
    return {
      kind: "partial",
      newSource: currentSource,
      patches,
      skippedHandles: deps.uniqueStrings(partialSkippedHandles),
      reason: deps.uniqueStrings(partialReasons).join(" "),
      ...(changedSourceIds === undefined ? {} : { selectedSourceIds: changedSourceIds }),
      ...(changedSourceIds === undefined ? {} : { changedSourceIds })
    };
  }

  return {
    kind: "success",
    newSource: currentSource,
    patches,
    ...(changedSourceIds === undefined ? {} : { selectedSourceIds: changedSourceIds }),
    ...(changedSourceIds === undefined ? {} : { changedSourceIds })
  };
}

/**
 * Moves the statements just inserted at `spans` by `delta`, in the document
 * they were inserted into: each coordinate is rewritten in the frame it is
 * read in there (scopes, axis vectors and styles around the copy included),
 * by the same code as dragging them. The copy that cannot be offset stays
 * where it was inserted.
 */
function offsetInsertedStatements(
  inserted: EditedSource,
  spans: readonly Span[],
  delta: WorldPoint,
  deps: PasteDuplicateDeps,
  parseOptions: EditParseOptions,
  evaluateOptions: EvaluateOptions,
  caches: PasteDuplicateCaches
): OffsetInsertedResult {
  const unmoved: OffsetInsertedResult = { source: inserted, patches: [], skippedHandles: [] };
  if (Math.abs(delta.x) <= 1e-9 && Math.abs(delta.y) <= 1e-9) {
    return unmoved;
  }
  const ids = mapSpansToStatementIdsWithSnapshot(getStatementSnapshot(inserted, parseOptions, caches), spans);
  if (ids.length === 0) {
    return unmoved;
  }

  // The handles belong to the edited document; whatever the caller prepared is for the one before.
  const { preparedParse, sourceFingerprint, analysisView, analysisSession, ...current } = parseOptions;
  void preparedParse;
  void sourceFingerprint;
  void analysisView;
  void analysisSession;
  const parsed = parseTikzForEdit(inserted, current);
  const { sourceFingerprint: _previousFingerprint, ...evaluating } = evaluateOptions;
  const semantic = evaluateTikzFigure(parsed.figure, inserted, evaluating);
  // The offset is exact, not a drag: a positioned copy is not snapped to a direction.
  const moved = deps.applyMoveElements(inserted, semantic.editHandles, ids, delta, { ...current, bypassSnapping: true });

  if (moved.kind !== "success" && moved.kind !== "partial") {
    return {
      ...unmoved,
      partialReason:
        moved.kind === "unsupported"
          ? `Could not offset all pasted/duplicated statements: ${moved.reason}`
          : `Could not offset all pasted/duplicated statements: ${moved.message}`
    };
  }

  const patches = patchesMatchSourceTransition(inserted, moved.newSource, moved.patches)
    ? moved.patches
    : [computeMinimalReplacementPatch(inserted, moved.newSource)];
  if (moved.kind === "partial") {
    // A copy that ends at a named node still ends there: that endpoint is not a place to move.
    const unmoved = moved.skippedHandles.filter((id) => {
      const handle = semantic.editHandles.find((candidate) => candidate.id === id);
      return !(handle && isCoordinateEditHandle(handle) && handle.coordinateForm === "named");
    });
    if (unmoved.length > 0) {
      return {
        source: moved.newSource,
        patches,
        partialReason: `Some pasted/duplicated coordinates could not be offset: ${moved.reason}`,
        skippedHandles: unmoved
      };
    }
  }
  return { source: moved.newSource, patches, skippedHandles: [] };
}

/**
 * Siblings split where anything but layout lies between them. The copies of
 * a run go after it, so nothing between an original and its copy (a
 * `\tikzset`, a node redefining a name) changes how the copy reads.
 */
function adjacentRuns(source: string, refs: readonly StatementRef[]): StatementRef[][] {
  const runs: StatementRef[][] = [];
  for (const ref of [...refs].sort((left, right) => left.index - right.index)) {
    const run = runs.at(-1);
    const previous = run?.at(-1);
    if (run && previous && isLayoutOnly(source.slice(previous.span.to, ref.span.from))) run.push(ref);
    else runs.push([ref]);
  }
  return runs;
}

function isLayoutOnly(text: string): boolean {
  return text.replace(/(?<!\\)%.*$/gmu, "").trim().length === 0;
}

function createPasteDuplicateCaches(): PasteDuplicateCaches {
  return {
    snapshots: new Map<string, StatementSnapshot>()
  };
}

function getStatementSnapshot(
  source: string,
  parseOptions: EditParseOptions,
  caches: PasteDuplicateCaches
): StatementSnapshot {
  const cached = caches.snapshots.get(source);
  if (cached) {
    return cached;
  }
  const snapshot = parseStatementSnapshot(source, parseOptions);
  caches.snapshots.set(source, snapshot);
  return snapshot;
}

function mapSpansToStatementIdsWithSnapshot(snapshot: StatementSnapshot, spans: readonly Span[]): string[] {
  if (spans.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const ids: string[] = [];

  for (const span of spans.map((raw) => trimmedToContent(snapshot.source, raw))) {
    // The statement the span is: most overlap, and the innermost where an enclosing scope overlaps as much.
    let bestOverlap: { id: string; overlap: number; length: number } | null = null;
    for (const ref of snapshot.all) {
      const overlap = Math.max(0, Math.min(span.to, ref.span.to) - Math.max(span.from, ref.span.from));
      if (overlap <= 0) {
        continue;
      }
      const length = ref.span.to - ref.span.from;
      if (!bestOverlap || overlap > bestOverlap.overlap || (overlap === bestOverlap.overlap && length < bestOverlap.length)) {
        bestOverlap = { id: ref.id, overlap, length };
      }
    }
    if (bestOverlap && !seen.has(bestOverlap.id)) {
      seen.add(bestOverlap.id);
      ids.push(bestOverlap.id);
    }
  }

  return ids;
}

/** Inserted spans carry the line break and indentation before a statement; the statement is what follows. */
function trimmedToContent(source: string, span: Span): Span {
  let { from, to } = span;
  while (from < to && /\s/u.test(source.charAt(from))) from += 1;
  while (to > from && /\s/u.test(source.charAt(to - 1))) to -= 1;
  return { from, to };
}

function normalizeDuplicateDelta(delta: WorldPoint | undefined, defaultDuplicateOffsetPt: number): WorldPoint {
  if (!delta) {
    return worldPoint(pt(defaultDuplicateOffsetPt), pt(-defaultDuplicateOffsetPt));
  }

  return worldPoint(
    pt(Number.isFinite(delta.x) ? delta.x : defaultDuplicateOffsetPt),
    pt(Number.isFinite(delta.y) ? delta.y : -defaultDuplicateOffsetPt)
  );
}

function detectPreferredNewline(source: string, aroundOffset: number): string {
  const windowStart = Math.max(0, aroundOffset - 256);
  const windowEnd = Math.min(source.length, aroundOffset + 256);
  const window = source.slice(windowStart, windowEnd);
  if (window.includes("\r\n")) {
    return "\r\n";
  }
  return "\n";
}

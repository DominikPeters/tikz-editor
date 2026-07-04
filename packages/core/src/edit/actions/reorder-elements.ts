import type { EditActionResultLike } from "../result-types.js";
import type { Span } from "../../ast/types.js";
import type { SourcePatch } from "../types.js";
import {
  applyTextReplacements,
  groupStatementRefsByParent,
  lineIndentAtOffset,
  mapSpansToStatementIds,
  parseStatementSnapshot,
  resolveStatementRefs,
  shiftSpansAfterReplacement,
  type StatementRef
} from "../statement-ops.js";
import type { EditParseOptions } from "../parse-options.js";
import { normalizeElementIds } from "../statement-find.js";

export type ReorderDirection = "sendToBack" | "sendBackward" | "bringForward" | "bringToFront";


export type ReorderReplacement = {
  span: Span;
  text: string;
  newSpansById: Map<string, Span>;
};

export function applyReorderElementsAction(
  source: string,
  elementIds: readonly string[],
  direction: ReorderDirection,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const normalizedIds = normalizeElementIds(elementIds);
  if (normalizedIds.length === 0) {
    return { kind: "unsupported", reason: "No element ids were provided for reorderElements." };
  }

  const initialSnapshot = parseStatementSnapshot(source, parseOptions);
  const initialRefs = resolveStatementRefs(initialSnapshot, normalizedIds);
  if (initialRefs.length === 0) {
    return { kind: "unsupported", reason: "No reorderable statements were found for the selected element ids." };
  }

  const groups = groupStatementRefsByParent(initialRefs);
  const trackedSpansById = new Map<string, Span>();
  for (const ref of initialRefs) {
    trackedSpansById.set(ref.id, { ...ref.span });
  }

  let currentSource = source;
  const patches: SourcePatch[] = [];

  for (const group of groups) {
    const snapshot = parseStatementSnapshot(currentSource, parseOptions);
    const currentRefs = resolveStatementRefs(
      snapshot,
      group.refs.map((ref) => ref.id)
    );
    if (currentRefs.length === 0) {
      continue;
    }

    const resolvedGroups = groupStatementRefsByParent(currentRefs);
    for (const resolvedGroup of resolvedGroups) {
      const parentRefs = snapshot.byParentKey.get(resolvedGroup.parentKey) ?? [];
      if (parentRefs.length <= 1) {
        continue;
      }

      const selectedIdSet = new Set(resolvedGroup.refs.map((ref) => ref.id));
      const currentOrder = parentRefs.map((ref) => ref.id);
      const nextOrder = reorderStatementIds(currentOrder, selectedIdSet, direction);
      if (arraysEqual(currentOrder, nextOrder)) {
        continue;
      }

      const replacement = buildParentReorderReplacement(snapshot.source, parentRefs, nextOrder);
      if (!replacement) {
        continue;
      }

      const applied = applyTextReplacements(currentSource, [
        {
          span: replacement.span,
          text: replacement.text
        }
      ]);
      const appliedReplacement = applied.applied[0];
      if (!appliedReplacement) {
        continue;
      }

      patches.push(...applied.patches);
      currentSource = applied.source;

      for (const [id, span] of trackedSpansById.entries()) {
        const [shifted] = shiftSpansAfterReplacement([span], appliedReplacement.oldSpan, appliedReplacement.newSpan);
        if (shifted) {
          trackedSpansById.set(id, shifted);
        }
      }

      for (const [id, span] of replacement.newSpansById.entries()) {
        if (!trackedSpansById.has(id)) {
          continue;
        }
        trackedSpansById.set(id, {
          from: appliedReplacement.newSpan.from + (span.from - replacement.span.from),
          to: appliedReplacement.newSpan.from + (span.to - replacement.span.from)
        });
      }
    }
  }

  const finalTrackedSpans = normalizedIds
    .map((id) => trackedSpansById.get(id))
    .filter((span): span is Span => span != null);
  const selectedSourceIds = mapSpansToStatementIds(currentSource, finalTrackedSpans);

  return {
    kind: "success",
    newSource: currentSource,
    patches,
    selectedSourceIds: selectedSourceIds.length > 0 ? selectedSourceIds : undefined,
    changedSourceIds: selectedSourceIds.length > 0 ? selectedSourceIds : normalizedIds
  };
}

export function buildParentReorderReplacement(
  source: string,
  parentRefs: readonly StatementRef[],
  orderedIds: readonly string[]
): ReorderReplacement | null {
  if (parentRefs.length === 0) {
    return null;
  }

  const sortedRefs = [...parentRefs].sort((left, right) => left.index - right.index);
  const refsById = new Map(sortedRefs.map((ref) => [ref.id, ref] as const));

  const replacementSpan: Span = {
    from: sortedRefs[0].span.from,
    to: sortedRefs[sortedRefs.length - 1].span.to
  };

  const indent = lineIndentAtOffset(source, sortedRefs[0].span.from);
  const separator = resolveReorderStatementSeparator(source, sortedRefs, indent);

  let text = "";
  let cursor = replacementSpan.from;
  const newSpansById = new Map<string, Span>();
  for (let index = 0; index < orderedIds.length; index += 1) {
    const id = orderedIds[index];
    const ref = refsById.get(id);
    if (!ref) {
      continue;
    }

    const statementText = source.slice(ref.span.from, ref.span.to);
    newSpansById.set(id, {
      from: cursor,
      to: cursor + statementText.length
    });

    text += statementText;
    cursor += statementText.length;

    if (index < orderedIds.length - 1) {
      text += separator;
      cursor += separator.length;
    }
  }

  return {
    span: replacementSpan,
    text,
    newSpansById
  };
}

function resolveReorderStatementSeparator(
  source: string,
  sortedRefs: readonly StatementRef[],
  indent: string
): string {
  const newline = detectPreferredNewline(source, sortedRefs[0]?.span.from ?? 0);
  for (let index = 0; index < sortedRefs.length - 1; index += 1) {
    const left = sortedRefs[index];
    const right = sortedRefs[index + 1];
    const gap = source.slice(left.span.to, right.span.from);
    if (gap.includes("\n")) {
      return `${gap.includes("\r\n") ? "\r\n" : "\n"}${indent}`;
    }
  }

  return `${newline}${indent}`;
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

function reorderStatementIds(
  ids: readonly string[],
  selected: ReadonlySet<string>,
  direction: ReorderDirection
): string[] {
  if (ids.length <= 1 || selected.size === 0) {
    return [...ids];
  }

  if (direction === "sendToBack") {
    const selectedIds = ids.filter((id) => selected.has(id));
    const unselectedIds = ids.filter((id) => !selected.has(id));
    return [...selectedIds, ...unselectedIds];
  }

  if (direction === "bringToFront") {
    const selectedIds = ids.filter((id) => selected.has(id));
    const unselectedIds = ids.filter((id) => !selected.has(id));
    return [...unselectedIds, ...selectedIds];
  }

  const reordered = [...ids];
  if (direction === "sendBackward") {
    for (let index = 1; index < reordered.length; index += 1) {
      if (!selected.has(reordered[index]) || selected.has(reordered[index - 1])) {
        continue;
      }
      [reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]];
    }
    return reordered;
  }

  for (let index = reordered.length - 2; index >= 0; index -= 1) {
    if (!selected.has(reordered[index]) || selected.has(reordered[index + 1])) {
      continue;
    }
    [reordered[index], reordered[index + 1]] = [reordered[index + 1], reordered[index]];
  }
  return reordered;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

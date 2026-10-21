import type { Span } from "../ast/types.js";
import type { SourcePatch } from "./types.js";
import { applyFragments, editedSlice, sourceSlice, unchangedSource, type EditedSource, type TikzFragment } from "./fragment.js";

export function replaceSpan(source: string, span: Span, replacement: TikzFragment): { source: EditedSource; changedSpan: Span } {
  const next = applyFragments(source, [{ span, fragment: replacement }]);

  return {
    source: next,
    changedSpan: {
      from: span.from,
      to: span.from + replacement.length
    }
  };
}

/** The patch between two revisions of the document: what changed is copied verbatim from the newer one. */
export function documentDiffPatch(previous: string, next: string): SourcePatch {
  const patch = computeMinimalReplacementPatch(previous, unchangedSource(next));
  return { ...patch, replacement: sourceSlice(next, patch.newSpan) };
}

export function computeMinimalReplacementPatch(oldSource: string, newSource: EditedSource | TikzFragment): SourcePatch {
  const oldLen = oldSource.length;
  const newLen = newSource.length;
  const minLen = Math.min(oldLen, newLen);

  let prefix = 0;
  while (prefix < minLen && oldSource.charCodeAt(prefix) === newSource.charCodeAt(prefix)) {
    prefix += 1;
  }

  let oldSuffix = oldLen;
  let newSuffix = newLen;
  while (
    oldSuffix > prefix &&
    newSuffix > prefix &&
    oldSource.charCodeAt(oldSuffix - 1) === newSource.charCodeAt(newSuffix - 1)
  ) {
    oldSuffix -= 1;
    newSuffix -= 1;
  }

  return {
    oldSpan: { from: prefix, to: oldSuffix },
    newSpan: { from: prefix, to: newSuffix },
    replacement: editedSlice(newSource, prefix, newSuffix)
  };
}

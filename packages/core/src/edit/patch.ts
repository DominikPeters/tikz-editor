import type { Span } from "../ast/types.js";
import type { SourcePatch } from "./types.js";

export function replaceSpan(source: string, span: Span, replacement: string): { source: string; changedSpan: Span } {
  const next = `${source.slice(0, span.from)}${replacement}${source.slice(span.to)}`;

  return {
    source: next,
    changedSpan: {
      from: span.from,
      to: span.from + replacement.length
    }
  };
}

export function computeMinimalReplacementPatch(oldSource: string, newSource: string): SourcePatch {
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
    replacement: newSource.slice(prefix, newSuffix)
  };
}

import type { SourcePatch } from "@tikz-editor/core/edit/types";

export function deriveSingleSourcePatch(previous: string, next: string): SourcePatch[] | null {
  if (previous === next) {
    return [];
  }

  let prefix = 0;
  const prefixLimit = Math.min(previous.length, next.length);
  while (prefix < prefixLimit && previous.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix += 1;
  }

  let previousSuffix = previous.length;
  let nextSuffix = next.length;
  while (
    previousSuffix > prefix &&
    nextSuffix > prefix &&
    previous.charCodeAt(previousSuffix - 1) === next.charCodeAt(nextSuffix - 1)
  ) {
    previousSuffix -= 1;
    nextSuffix -= 1;
  }

  const previousMiddle = previous.slice(prefix, previousSuffix);
  const nextMiddle = next.slice(prefix, nextSuffix);
  if (hasSharedInteriorRun(previousMiddle, nextMiddle)) {
    return null;
  }

  return [
    {
      oldSpan: { from: prefix, to: previousSuffix },
      newSpan: { from: prefix, to: nextSuffix },
      replacement: next.slice(prefix, nextSuffix)
    }
  ];
}

function hasSharedInteriorRun(previousMiddle: string, nextMiddle: string): boolean {
  const minRunLength = 2;
  if (previousMiddle.length < minRunLength || nextMiddle.length < minRunLength) {
    return false;
  }

  const shorter = previousMiddle.length <= nextMiddle.length ? previousMiddle : nextMiddle;
  const longer = shorter === previousMiddle ? nextMiddle : previousMiddle;
  const runs = new Set<string>();
  for (let index = 0; index <= shorter.length - minRunLength; index += 1) {
    runs.add(shorter.slice(index, index + minRunLength));
  }
  for (const run of runs) {
    if (longer.includes(run)) {
      return true;
    }
  }
  return false;
}

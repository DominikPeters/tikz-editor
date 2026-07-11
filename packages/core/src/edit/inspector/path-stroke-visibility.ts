import type { ScenePathCommand } from "../../semantic/types.js";

export function computePathStrokeControlVisibility(
  commands: ScenePathCommand[],
  dashArray: number[] | null
): { showLineCap: boolean; showLineJoin: boolean } {
  const hasDash = !!dashArray && dashArray.length > 0;
  let openSubpathHasSegments = false;
  let hasJoin = false;
  let segmentCountInSubpath = 0;

  for (const command of commands) {
    if (command.kind === "M") {
      if (segmentCountInSubpath >= 1) openSubpathHasSegments = true;
      if (segmentCountInSubpath >= 2) hasJoin = true;
      segmentCountInSubpath = 0;
    } else if (command.kind === "L" || command.kind === "C" || command.kind === "A") {
      segmentCountInSubpath += 1;
      if (segmentCountInSubpath >= 2) hasJoin = true;
    } else if (command.kind === "Z") {
      if (segmentCountInSubpath >= 1) hasJoin = true;
      segmentCountInSubpath = 0;
    }
  }

  if (segmentCountInSubpath >= 1) openSubpathHasSegments = true;
  if (segmentCountInSubpath >= 2) hasJoin = true;
  return { showLineCap: hasDash || openSubpathHasSegments, showLineJoin: hasJoin };
}

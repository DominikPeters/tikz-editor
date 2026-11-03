import { layout, tikz, type TikzFragment } from "./fragment.js";
import { isCoordinateEditHandle, type EditHandle } from "../semantic/types.js";
import type { SiteContext } from "../semantic/site-context.js";
import type { WorldPoint } from "../coords/points.js";
import { createCoordinateWriter, type PointWriteOptions } from "./writer/index.js";

/**
 * The text that moves a handle's coordinate to `newWorld`, or null when it
 * cannot be rewritten: through the writer, calc offsets and positioning
 * included.
 * `context` replaces the handle's site context when the edit changes the
 * options the coordinate is read under.
 */
export function rewriteCoordinate(
  newWorld: WorldPoint,
  handle: EditHandle,
  source: string,
  bypassSnapping = false,
  context?: SiteContext,
  options?: PointWriteOptions
): TikzFragment | null {
  if (handle.rewriteMode === "positioning") {
    if (handle.handleType !== "node-positioning") return null;
    const written = createCoordinateWriter(source).positioning(handle.positioningContext, newWorld, { bypassSnapping });
    return written.kind === "ok" ? written.fragment : null;
  }
  if (!isCoordinateEditHandle(handle)) return null;
  const written = createCoordinateWriter(source).point({ kind: "coordinate", handle, ...(context && { context }) }, newWorld, options);
  if (written.kind !== "ok") return null;
  if (!handle.insertion) return written.fragment;
  // A node placed implicitly gets an `at` of its own.
  const offset = handle.sourceRef.sourceSpan.from;
  const previousChar = source.charAt(offset - 1);
  const nextChar = source.charAt(offset);
  const leading = previousChar.length > 0 && !/\s/.test(previousChar) ? " " : "";
  const trailing = nextChar.length > 0 && !/\s/.test(nextChar) && nextChar !== ";" ? " " : "";
  return tikz`${layout(leading)}at ${written.fragment}${layout(trailing)}`;
}

export function supportsUnsupportedCoordinateDetach(handle: EditHandle): boolean {
  return handle.kind === "path-point" && handle.coordinateForm === "named";
}

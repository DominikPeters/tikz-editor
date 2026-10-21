import { pt, worldPoint, worldVector } from "@tikz-editor/core/coords/index";
import type { WorldPoint, WorldVector } from "../coords/types";
import type { DragState } from "./types";
import { resolveFrameBasis } from "./interaction-helpers";

/** Project the pointer onto the degrees of freedom exposed by the resize handle. */
export function projectResizePointer(
  drag: Pick<Extract<DragState, { kind: "resize" }>, "initialFrame" | "movingCornerRole" | "role" | "measurementMode" | "preserveAspectDuringResize">,
  pointer: WorldPoint,
  shiftKey: boolean
): { point: WorldPoint; direction: WorldVector | null } {
  if (drag.movingCornerRole) {
    // Diamond vertices appear in the corner overlay but edit one node dimension.
    const center = drag.initialFrame.centerWorld;
    const vertex = drag.initialFrame.cornersByRole[drag.movingCornerRole].world;
    const dx = vertex.x - center.x;
    const dy = vertex.y - center.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared > 1e-9) {
      const scale = ((pointer.x - center.x) * dx + (pointer.y - center.y) * dy) / lengthSquared;
      return { point: worldPoint(pt(center.x + scale * dx), pt(center.y + scale * dy)), direction: worldVector(pt(dx), pt(dy)) };
    }
  }
  const { widthUnit: u, heightUnit: v, width, height } = resolveFrameBasis(drag.initialFrame);
  const xSign = drag.role.includes("left") ? -1 : 1;
  const ySign = drag.role.includes("bottom") ? -1 : 1;
  const affectsX = drag.role.includes("left") || drag.role.includes("right");
  const affectsY = drag.role.includes("top") || drag.role.includes("bottom");
  const center = drag.initialFrame.centerWorld;
  const opposite = drag.measurementMode === "opposite-corner";
  const anchor = worldPoint(
    pt(center.x - (opposite && affectsX ? xSign * width * u.x / 2 : 0) - (opposite && affectsY ? ySign * height * v.x / 2 : 0)),
    pt(center.y - (opposite && affectsX ? xSign * width * u.y / 2 : 0) - (opposite && affectsY ? ySign * height * v.y / 2 : 0))
  );
  const dx = pointer.x - anchor.x;
  const dy = pointer.y - anchor.y;
  const det = u.x * v.y - u.y * v.x;
  if (Math.abs(det) < 1e-9) return { point: pointer, direction: null };
  // Invert the basis, rather than using dot products: TikZ permits skewed axes.
  let x = affectsX ? (dx * v.y - dy * v.x) / det : 0;
  let y = affectsY ? (dy * u.x - dx * u.y) / det : 0;
  let direction: WorldVector | null = affectsX && !affectsY ? u : affectsY && !affectsX ? v : null;
  if ((shiftKey || drag.preserveAspectDuringResize) && affectsX && affectsY && width > 1e-9 && height > 1e-9) {
    const scale = Math.max(Math.abs(x) / width, Math.abs(y) / height);
    const sx = Math.sign(x) || xSign;
    const sy = Math.sign(y) || ySign;
    x = sx * width * scale;
    y = sy * height * scale;
    direction = worldVector(pt(sx * width * u.x + sy * height * v.x), pt(sx * width * u.y + sy * height * v.y));
  }
  return {
    point: worldPoint(pt(anchor.x + x * u.x + y * v.x), pt(anchor.y + x * u.y + y * v.y)),
    direction
  };
}

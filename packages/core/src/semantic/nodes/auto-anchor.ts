import type { WorldPoint, WorldVector } from "../../coords/points.js";

/**
 * PGF's `\tikz@auto@anchor` (tikz.code.tex): the anchor of an `auto` placed node, chosen from the
 * normalised tangent vector with a +-0.05 dead zone on each axis.
 */
export function autoAnchorFromVector(vector: Pick<WorldPoint | WorldVector, "x" | "y">): string {
  if (vector.x > 0.05) {
    if (vector.y > 0.05) {
      return "south east";
    }
    if (vector.y < -0.05) {
      return "south west";
    }
    return "south";
  }
  if (vector.x < -0.05) {
    if (vector.y > 0.05) {
      return "north east";
    }
    if (vector.y < -0.05) {
      return "north west";
    }
    return "north";
  }
  return vector.y > 0 ? "east" : "west";
}

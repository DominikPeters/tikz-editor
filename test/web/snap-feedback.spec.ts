import { expect, it } from "vitest";
import { primarySnapLines, placeSnapLabel } from "../../packages/app/src/ui/canvas-panel/snap-feedback.js";
import { wp } from "../coords-helpers.js";
import type { SnapLine } from "../../packages/core/src/edit/snapping/types.js";
it("limits dense feedback to the nearest explanation on each axis", () => {
  const lines: SnapLine[] = Array.from({ length: 100 }, (_, i) => ({ type: "points", axis: i % 2 ? "x" : "y", points: [wp(0, 0), wp(0, i + 1)] }));
  expect(primarySnapLines(lines)).toEqual(lines.slice(0, 2));
  expect(lines).toHaveLength(100);
});
it("moves colliding labels and suppresses labels when no readable space remains", () => {
  const viewport = { x: 0, y: 0, width: 200, height: 150 }, anchor = { x: 100, y: 75 };
  const first = placeSnapLabel(anchor, "Left edge", 1, viewport, []);
  expect(first).not.toBeNull();
  const second = placeSnapLabel(anchor, "Top edge", 1, viewport, [first!]);
  expect(second).not.toBeNull(); expect(second).not.toEqual(first);
  expect(placeSnapLabel(anchor, "Left edge", 1, viewport, [viewport])).toBeNull();
  expect(placeSnapLabel(anchor, "A very long object name that must stay inside the canvas", 1, viewport, [])).toBeNull();
});

import type { SnapLine } from "@tikz-editor/core/edit/snapping";

/** Drawing budgets affect explanation only; the solver retains all candidates. */
export function primarySnapLines(lines: readonly SnapLine[]): SnapLine[] {
  const byAxis = new Map<"x" | "y", { line: SnapLine; length: number }>();
  for (const line of lines) {
    const axis = line.type === "gap" ? line.direction === "horizontal" ? "x" : "y" : line.axis;
    const segments = line.type === "gap" ? line.segments : line.type === "pointer" ? [[line.from, line.to]]
      : line.primary ? [[line.primary.from, line.primary.to]] : [[line.points[0], line.points.at(-1)]];
    const length = segments.reduce((sum, [a, b]) => sum + (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity), 0);
    const previous = byAxis.get(axis);
    if (!previous || length < previous.length) byAxis.set(axis, { line, length });
  }
  return [...byAxis.values()].map(({ line }) => line);
}

export type LabelRect = { x: number; y: number; width: number; height: number };
export function placeSnapLabel(anchor: { x: number; y: number }, text: string, unit: number, viewport: LabelRect, occupied: readonly LabelRect[]): LabelRect | null {
  const width = (Math.min(40, text.length) * 5.8 + 10) * unit, height = 17 * unit, gap = 9 * unit;
  const candidates = [
    { x: anchor.x + gap, y: anchor.y - height - gap },
    { x: anchor.x - width - gap, y: anchor.y - height - gap },
    { x: anchor.x + gap, y: anchor.y + gap },
    { x: anchor.x - width - gap, y: anchor.y + gap }
  ];
  return candidates.map(position => ({ ...position, width, height })).find(rect =>
    rect.x >= viewport.x && rect.y >= viewport.y && rect.x + width <= viewport.x + viewport.width && rect.y + height <= viewport.y + viewport.height &&
    occupied.every(other => rect.x + width + 3 * unit <= other.x || other.x + other.width + 3 * unit <= rect.x || rect.y + height + 3 * unit <= other.y || other.y + other.height + 3 * unit <= rect.y)
  ) ?? null;
}

/** One cell of the canvas step strip: a step's button, or a gap between runs of steps. */
export type DeckStepStripItem = { readonly kind: "step"; readonly step: number } | { readonly kind: "gap"; readonly key: string };

const ALL_UP_TO = 9;
const AROUND = 2;

/**
 * The steps the strip shows for a slide of `count` steps on step `current`:
 * all of them for a short build; for a long one the first, the last and
 * those around the current step, with gaps between.
 */
export function deckStepStripItems(current: number, count: number): DeckStepStripItem[] {
  const steps = new Set<number>();
  if (count <= ALL_UP_TO) for (let step = 1; step <= count; step++) steps.add(step);
  else {
    // A window of fixed size, so the strip keeps its width while stepping.
    const from = Math.min(Math.max(1, current - AROUND), count - 2 * AROUND);
    for (let step = from; step <= from + 2 * AROUND; step++) steps.add(step);
    steps.add(1); steps.add(count);
  }
  const items: DeckStepStripItem[] = [];
  let previous = 0;
  for (const step of [...steps].sort((a, b) => a - b)) {
    // A gap of one step shows that step: a gap marker would take the same room.
    if (step - previous === 2) items.push({ kind: "step", step: step - 1 });
    else if (step - previous > 2) items.push({ kind: "gap", key: `gap-${previous}` });
    items.push({ kind: "step", step });
    previous = step;
  }
  return items;
}

import { worldBounds } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { WorldBounds, WorldPoint } from "../../coords/points.js";

/** Axis ranges preserve long-distance alignments that a circular query misses. */
export function createPointIndex<T extends WorldPoint>(points: readonly T[]) {
  const axes = { x: [...points].sort((a, b) => a.x - b.x), y: [...points].sort((a, b) => a.y - b.y) };
  const order = new Map(points.map((point, index) => [point, index]));
  return (point: WorldPoint, xRadius: number, yRadius: number): T[] => {
    const found = new Set<T>();
    for (const axis of ["x", "y"] as const) {
      const radius = axis === "x" ? xRadius : yRadius;
      if (radius < 0) continue;
      const sorted = axes[axis];
      let lo = 0, hi = sorted.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (sorted[mid][axis] < point[axis] - radius) lo = mid + 1; else hi = mid; }
      for (let i = lo; i < sorted.length && sorted[i][axis] <= point[axis] + radius; i++) found.add(sorted[i]);
    }
    // Keep deterministic tie-breaking identical to the exhaustive search.
    return [...found].sort((a, b) => order.get(a)! - order.get(b)!);
  };
}

type Branch<T> = { bounds: WorldBounds; left?: Branch<T>; right?: Branch<T>; entries?: T[] };
/** Static bounds tree for blocker and overlap queries. Built once per gesture. */
export function createBoundsIndex<T extends WorldBounds>(entries: readonly T[]): (bounds: WorldBounds) => T[] {
  const build = (items: T[], depth: number): Branch<T> | undefined => {
    if (!items.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const item of items) { minX = Math.min(minX, item.minX); minY = Math.min(minY, item.minY); maxX = Math.max(maxX, item.maxX); maxY = Math.max(maxY, item.maxY); }
    const bounds = worldBounds(pt(minX), pt(minY), pt(maxX), pt(maxY));
    if (items.length <= 8) return { bounds, entries: items };
    const axis = depth % 2 === 0 ? "minX" : "minY";
    items.sort((a, b) => a[axis] - b[axis]);
    const mid = items.length >>> 1;
    return { bounds, left: build(items.slice(0, mid), depth + 1), right: build(items.slice(mid), depth + 1) };
  };
  const root = build([...entries], 0);
  return bounds => {
    const found: T[] = [];
    const intersects = (a: WorldBounds) => a.minX <= bounds.maxX && a.maxX >= bounds.minX && a.minY <= bounds.maxY && a.maxY >= bounds.minY;
    const visit = (branch: Branch<T> | undefined) => {
      if (!branch || !intersects(branch.bounds)) return;
      if (branch.entries) { for (const entry of branch.entries) if (intersects(entry)) found.push(entry); }
      else { visit(branch.left); visit(branch.right); }
    };
    visit(root); return found;
  };
}

/** A bounded grid for the changing envelopes used during overlap merging. */
export function createMutableBoundsIndex<T extends WorldBounds>(cellSize: number) {
  const cells = new Map<string, Set<T>>();
  const memberships = new Map<T, string[]>();
  const large = new Set<T>();
  const keys = (bounds: WorldBounds): string[] | null => {
    const x0 = Math.floor(bounds.minX / cellSize), x1 = Math.floor(bounds.maxX / cellSize);
    const y0 = Math.floor(bounds.minY / cellSize), y1 = Math.floor(bounds.maxY / cellSize);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 256) return null;
    const result: string[] = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) result.push(`${x}:${y}`);
    return result;
  };
  return {
    add(entry: T) {
      const entryKeys = keys(entry);
      memberships.set(entry, entryKeys ?? []);
      if (!entryKeys) { large.add(entry); return; }
      for (const key of entryKeys) { const cell = cells.get(key) ?? new Set<T>(); cell.add(entry); cells.set(key, cell); }
    },
    delete(entry: T) {
      for (const key of memberships.get(entry) ?? []) { const cell = cells.get(key)!; cell.delete(entry); if (!cell.size) cells.delete(key); }
      memberships.delete(entry); large.delete(entry);
    },
    query(bounds: WorldBounds): T[] {
      const queryKeys = keys(bounds);
      if (!queryKeys) return [...memberships.keys()];
      const found = new Set(large);
      for (const key of queryKeys) for (const entry of cells.get(key) ?? []) found.add(entry);
      return [...found];
    }
  };
}

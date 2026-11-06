import { relative, resolve } from "node:path";
export const BEAMER_COVERAGE_SCOPE = [
  "packages/core/src/beamer/**/*.ts", "packages/core/src/parser/**/*.ts", "packages/core/src/semantic/**/*.ts",
  "packages/core/src/svg/**/*.ts", "packages/core/src/render/**/*.ts", "packages/core/src/text/tex/vlist/**/*.ts",
  "packages/core/src/text/tex/ir.ts", "packages/core/src/text/tex/layout-state.ts", "packages/core/src/text/tex/paragraph-*.ts",
  "packages/app/src/compute.ts", "packages/app/src/beamer-overlay-page.ts", "packages/app/src/bounded-lru.ts", "packages/app/src/source-identity.ts",
];
function targeted(file) {
  return /^packages\/core\/src\/(?:beamer|parser|semantic|svg|render|text\/tex\/vlist)\//u.test(file)
    || /^packages\/core\/src\/text\/tex\/(?:ir|layout-state|paragraph-[^/]+)\.ts$/u.test(file)
    || /^packages\/app\/src\/(?:compute|beamer-overlay-page|bounded-lru|source-identity)\.ts$/u.test(file);
}
/** Actual Istanbul/V8 source branches, functions and statements, not reach counters. */
export function readFuzzCoverage(data, root) {
  const hit = new Set(), all = new Set(), files = new Set();
  const loc = location => {
    if (!location?.start || !location.end || !Number.isSafeInteger(location.start.line) || !Number.isSafeInteger(location.start.column)
      || !Number.isSafeInteger(location.end.line) || !Number.isSafeInteger(location.end.column)) throw new Error("Invalid coverage source location");
    return `${location.start.line}:${location.start.column}-${location.end.line}:${location.end.column}`;
  };
  const add = (key, count) => {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid coverage hit count");
    all.add(key); if (count > 0) hit.add(key);
  };
  for (const [path, value] of Object.entries(data)) {
    const file = relative(resolve(root), resolve(path)).replaceAll("\\", "/");
    if (!targeted(file) || file.endsWith(".d.ts")) continue;
    files.add(file);
    for (const [id, counts] of Object.entries(value.b ?? {})) {
      const branch = value.branchMap?.[id];
      if (!branch || !Array.isArray(counts)) throw new Error("Missing branch map");
      for (const [arm, count] of counts.entries()) add(`b:${file}:${loc(branch.locations?.[arm] ?? branch.loc)}:${arm}`, count);
    }
    for (const [id, count] of Object.entries(value.f ?? {})) add(`f:${file}:${loc(value.fnMap?.[id]?.decl ?? value.fnMap?.[id]?.loc)}`, count);
    for (const [id, count] of Object.entries(value.s ?? {})) add(`s:${file}:${loc(value.statementMap?.[id])}`, count);
  }
  if (!all.size || !files.size) throw new Error("No target coverage was collected");
  return { kind: "vitest-v8-source-coverage", files: [...files].sort(), hit: [...hit].sort(), all: [...all].sort() };
}
export function summarizeFuzzCoverage(hit, all) {
  return Object.fromEntries([["branches", "b:"], ["functions", "f:"], ["statements", "s:"]].map(([name, prefix]) => {
    const total = [...all].filter(key => key.startsWith(prefix)).length;
    const covered = [...hit].filter(key => key.startsWith(prefix) && all.has(key)).length;
    return [name, { covered, total, percent: total ? 100 * covered / total : null }];
  }));
}
/** Greedy corpus distillation preserves the complete observed feature union.
 * It is not a globally minimal set cover. Failures are always retained. */
export function distillFuzzCorpus(entries) {
  const remaining = new Set(entries.flatMap(entry => entry.features)), selected = [], candidates = [...entries];
  const take = entry => { selected.push(entry); for (const feature of entry.features) remaining.delete(feature); candidates.splice(candidates.indexOf(entry), 1); };
  for (const entry of [...candidates]) if (entry.status !== "passed") take(entry);
  while (remaining.size) {
    let best, score = 0;
    for (const entry of candidates) {
      const gain = entry.features.reduce((n, key) => n + Number(remaining.has(key)), 0);
      const value = gain / Math.max(1, entry.size);
      if (value > score || (value === score && best && entry.id < best.id)) { best = entry; score = value; }
    }
    if (!best || !score) throw new Error("Corpus feature union cannot be covered");
    take(best);
  }
  return selected;
}

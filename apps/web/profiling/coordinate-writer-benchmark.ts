/**
 * Core-only cost measurement, without React, painting or worker transport.
 * Run from the repo root with node --expose-gc --import tsx <this file>.
 * The profiling spec runs this in its own process so GC and warm caches are
 * repeatable. Timings are observations, not CI thresholds.
 */
import { performance } from "node:perf_hooks";
import { cpus } from "node:os";
import { serialize } from "node:v8";
import { parseTikz } from "../../../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../../../packages/core/src/semantic/evaluate.js";
import { captureSiteContext } from "../../../packages/core/src/semantic/site-context.js";
import { worldTransform } from "../../../packages/core/src/coords/transforms.js";
import { defaultAxisBasis } from "../../../packages/core/src/semantic/coords/axis-basis.js";
import { worldPoint, pt } from "../../../packages/core/src/coords/index.js";
import { applyEditAction, type EditAction, type EditActionApplyOptions } from "../../../packages/core/src/edit/actions.js";
import { createEditAnalysisSession } from "../../../packages/core/src/edit/analysis.js";
import { createEditGeometrySession } from "../../../packages/core/src/edit/geometry-session.js";

if (!global.gc) throw new Error("Run this benchmark with --expose-gc");
// A module root keeps measured values reachable across forced GC.
let _retained: unknown;
const heap = () => { for (let i = 0; i < 3; i++) global.gc?.(); return process.memoryUsage().heapUsed; };
const wp = (x: number, y: number) => worldPoint(pt(x), pt(y));
const round = (n: number) => Math.round(n * 100) / 100;
const samples = Number(process.env.COORD_PROFILE_SAMPLES ?? 12);
const sizes = (process.env.COORD_PROFILE_SIZES ?? "100,1000,5000").split(",").map(Number);

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: sorted.length, p50Ms: round(sorted[Math.floor((sorted.length - 1) * .5)]),
    p95Ms: round(sorted[Math.ceil((sorted.length - 1) * .95)]), maxMs: round(sorted[sorted.length - 1]) };
}

function picture(count: number, varied: boolean) {
  return `\\begin{tikzpicture}[x=2cm,y=1.6cm]\n${Array.from({ length: count }, (_, i) => {
    // Keep the edited middle line untransformed: topology insertion explicitly
    // refuses some transformed paths. The surrounding document still varies.
    const options = varied && i !== Math.floor(count / 2) + 1 ? `[rotate=${i % 17},xshift=${i % 11}pt]` : "";
    return i % 5 === 0 ? `\\node${options} at (${i % 30},${Math.floor(i / 30)}) {N};`
      : `\\draw${options} (${i % 30},${Math.floor(i / 30)}) -- ++(1,.5);`;
  }).join("\n")}\n\\end{tikzpicture}`;
}

function snapshot(source: string) {
  const parsed = parseTikz(source, { recover: true, includeContextDefinitions: true });
  return { source, parsed, semantic: evaluateTikzFigure(parsed.figure, source) };
}

function captureMemory(count: number, shared: boolean) {
  const axisBasis = defaultAxisBasis();
  const first = { transform: worldTransform(1, 0, 0, 1, 0, 0), axisBasis };
  const frames = Array.from({ length: count }, (_, i) => shared ? first : { transform: worldTransform(1, 0, 0, 1, i, 0), axisBasis });
  _retained = frames;
  const before = heap();
  const contexts = frames.map(captureSiteContext);
  _retained = { frames, contexts };
  const bytes = heap() - before;
  const unique = new Set(contexts).size;
  _retained = undefined;
  heap();
  return { frames: count, uniqueCaptures: unique, retainedBytes: bytes, bytesPerFrame: round(bytes / count) };
}

function captureMemoryMedian(count: number, shared: boolean) {
  const trials = Array.from({ length: 5 }, () => captureMemory(count, shared));
  const sorted = trials.map(trial => trial.retainedBytes).sort((a, b) => a - b);
  const retainedBytes = sorted[2];
  return { ...trials[0], retainedBytes, bytesPerFrame: round(retainedBytes / count), trialBytes: trials.map(trial => trial.retainedBytes) };
}

function entryMemory(count: number) {
  const trials = Array.from({ length: 5 }, () => {
    const ids = Array.from({ length: count }, (_, i) => `path:${i}`);
    const context = captureSiteContext({ transform: worldTransform(1, 0, 0, 1, 0, 0), axisBasis: defaultAxisBasis() });
    _retained = { ids, context };
    const before = heap();
    // The same row shape and shared strings as evaluateSemanticStatementByIndex.
    const entries = ids.map(id => ({ statementId: id, sourceId: id, context }));
    _retained = { ids, context, entries };
    return heap() - before;
  });
  _retained = undefined;
  heap();
  const bytes = [...trials].sort((a, b) => a - b)[2];
  return { rows: count, retainedBytes: bytes, bytesPerRow: round(bytes / count), trialBytes: trials };
}

function measure(count: number, varied: boolean) {
  process.stderr.write(`[coordinate-writer] ${count} statements, ${varied ? "varied" : "shared"} frames\n`);
  _retained = undefined;
  const source = picture(count, varied);
  const before = heap();
  const base = snapshot(source);
  _retained = base;
  const retainedBytes = heap() - before;
  const contexts = new Set([base.semantic.siteContexts.figureEnd,
    ...base.semantic.siteContexts.statementEntries.map(entry => entry.context),
    ...base.semantic.editHandles.flatMap(handle => "siteContext" in handle ? [handle.siteContext] : [])]);
  const contextPayloadBytes = serialize([...contexts]).byteLength;
  const entriesPayloadBytes = serialize(base.semantic.siteContexts.statementEntries).byteLength;
  const points = base.semantic.editHandles.filter(handle => handle.kind === "path-point");
  const first = points.find(handle => handle.sourceRef.sourceId === `path:${Math.floor(count / 2) + 1}`)!;
  const second = points.find(handle => handle.sourceRef.sourceId === first.sourceRef.sourceId && handle.id !== first.id)!;
  const id = first.sourceRef.sourceId;
  const middle = wp((first.world.x + second.world.x) / 2, (first.world.y + second.world.y) / 2);
  const actions: Array<{ name: string; action: EditAction }> = [
    { name: "insertion", action: { kind: "addElement", at: wp(25, 30), template: { kind: "line", to: wp(50, 45) } } },
    { name: "path-point-insertion", action: { kind: "insertPathPoint", elementId: id, segmentIndex: 0, point: middle } },
    { name: "paste", action: { kind: "pasteStatements", anchorElementId: id, snippets: [String.raw`\draw (0,0) -- (1,.5);`], delta: wp(10, -10) } },
    { name: "repeat", action: { kind: "repeatElements", elementIds: [id], columns: 2, rows: 2, horizontalStep: 30, verticalStep: 30 } }
  ];
  const results = actions.map(({ name, action }) => {
    const session = createEditAnalysisSession();
    const analysisView = session.primeFromParse(base.parsed, source);
    const geometry = createEditGeometrySession(base);
    const options: EditActionApplyOptions = { geometry, parseOptions: { analysisView } };
    const run = (warm: boolean) => {
      const input = warm ? base : snapshot(source);
      const result = applyEditAction(source, input.semantic.editHandles, action, warm ? options : {});
      if (result.kind !== "success") throw new Error(`${count}/${varied}/${name}: ${result.kind}: ${"reason" in result ? result.reason : ""}`);
      if (result.newSource === source) throw new Error(`${name} did not edit the source`);
    };
    const started = performance.now(); run(true);
    const firstPreparedMs = performance.now() - started;
    const warm: number[] = [], cold: number[] = [];
    for (let i = 0; i < samples; i++) {
      let t = performance.now(); run(false); cold.push(performance.now() - t);
      t = performance.now(); run(true); warm.push(performance.now() - t);
    }
    return { name, firstPreparedMs: round(firstPreparedMs), cold: stats(cold), prepared: stats(warm) };
  });
  const geometry = createEditGeometrySession(base);
  let start = performance.now(); geometry.prepare(id);
  const coldCheckpointMs = performance.now() - start;
  start = performance.now(); geometry.prepare(id);
  const warmCheckpointMs = performance.now() - start;
  // Keep the same number of live snapshots on both sides of the comparison.
  // Preparation caches and the baseline stay fixed; only this output is replaced.
  _retained = snapshot(source);
  const steadyBefore = heap();
  for (let i = 0; i < 20; i++) _retained = snapshot(source);
  const afterRepeatedBytes = heap() - steadyBefore;
  return { statements: count, varied, sourceBytes: Buffer.byteLength(source), retainedSnapshotBytes: retainedBytes,
    statementEntries: base.semantic.siteContexts.statementEntries.length, uniqueContexts: contexts.size,
    serializedContextPayloadBytes: contextPayloadBytes, serializedEntryGraphBytes: entriesPayloadBytes,
    retainedDeltaAfter20EvaluationsBytes: afterRepeatedBytes,
    checkpoint: { coldMs: round(coldCheckpointMs), warmMs: round(warmCheckpointMs) }, actions: results };
}

// Warm modules and JIT paths before collecting the measured documents.
for (let i = 0; i < 4; i++) snapshot(picture(50, true));
const captures = [captureMemoryMedian(10000, true), captureMemoryMedian(10000, false)];
const entries = entryMemory(100000);
const cases = process.env.COORD_PROFILE_MEMORY_ONLY ? [] : sizes.flatMap(count => [false, true].map(varied => measure(count, varied)));
const report = { version: 1, runtime: process.version, cpu: cpus()[0]?.model, platform: process.platform, arch: process.arch,
  scope: "Core parse/evaluate/edit only; excludes browser painting, worker transport and undo history.",
  memory: "GC-retained bytes are V8 heap measurements. Serialized payload sizes describe graph size, not heap overhead. Capture microbench includes weak-cache bookkeeping and the result-reference array.",
  cold: "Fresh parse + evaluation + action each sample.", prepared: "Reused immutable snapshot, analysis view and geometry session; first prepared call reported separately.", captures, entries, cases };
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

/**
 * Core cache-retention probes. Run each revision in a fresh Node process:
 *   node --expose-gc --import tsx scripts/benchmark-core-memory.mts
 *   node --expose-gc --import tsx scripts/benchmark-core-memory.mts --module-root /path/to/baseline
 * Optional: --only hyphenation|foreach|beamer-resolvers|syntax-history|persistent-map|incremental-parse --json /tmp/core-memory.json
 * Retained heap is measured after explicit GC; timings are diagnostic, not CI thresholds.
 */
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";

const args = process.argv.slice(2);
function option(name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
  return value;
}
const moduleRoot = resolve(option("--module-root", fileURLToPath(new URL("..", import.meta.url)))!);
const only = option("--only");
const jsonPath = option("--json");
const gc = globalThis.gc;
if (!gc) throw new Error("Run Node with --expose-gc to measure retained memory.");
async function collect(): Promise<void> {
  for (let index = 0; index < 3; index++) {
    await setImmediate();
    gc!();
  }
}
async function importCore<T>(relative: string): Promise<T> {
  return import(pathToFileURL(join(moduleRoot, "packages/core/src", relative)).href) as Promise<T>;
}
function suffix(value: number): string {
  let word = "";
  do {
    word += String.fromCharCode(97 + value % 26);
    value = Math.floor(value / 26);
  } while (value > 0);
  return word;
}

async function hyphenation() {
  const { createEnglishHyphenator } = await importCore<typeof import("../packages/core/src/text/knuth-plass/paragraph/hyphenate.js")>("text/knuth-plass/paragraph/hyphenate.ts");
  const hyphenator = createEnglishHyphenator();
  const hotWords = ["hyphenation", "memory", "performance", "improvement", "retention", "paragraph", "representation", "computer"];
  for (let index = 0; index < 20000; index++) hyphenator.hyphenate(hotWords[index % hotWords.length]);
  await collect();
  const before = process.memoryUsage().heapUsed;
  let started = performance.now();
  for (let index = 0; index < 1000000; index++) hyphenator.hyphenate(hotWords[index % hotWords.length]);
  const hotLookupMs = performance.now() - started;
  started = performance.now();
  for (let index = 0; index < 100000; index++) hyphenator.hyphenate(`retention${suffix(index)}`);
  const uniqueWordMs = performance.now() - started;
  await collect();
  return { workload: { uniqueWords: 100000, hotLookups: 1000000 }, retainedHeapBytes: process.memoryUsage().heapUsed - before, hotLookupMs, uniqueWordMs };
}

async function foreach() {
  const { parseTikz } = await importCore<typeof import("../packages/core/src/parser/index.js")>("parser/index.ts");
  const { expandForeachFigure } = await importCore<typeof import("../packages/core/src/foreach/expand.js")>("foreach/expand.ts");
  function expand(revision: number) {
    const source = `\\begin{tikzpicture}\n\\foreach \\x in {1,2} {%${"comment".repeat(3000)}\n\\draw (\\x,${revision}) -- (2,2);\n}\n\\end{tikzpicture}`;
    return expandForeachFigure(parseTikz(source, { recover: true }).figure, source);
  }
  for (let index = 0; index < 10; index++) expand(index);
  await collect();
  const before = process.memoryUsage().heapUsed;
  let started = performance.now();
  for (let index = 10; index < 310; index++) expand(index);
  const revisionMs = performance.now() - started;
  await collect();
  const retainedHeapBytes = process.memoryUsage().heapUsed - before;
  started = performance.now();
  for (let index = 0; index < 500; index++) expand(309);
  return { workload: { revisions: 300, loopPaddingCharacters: 21000, hotRenders: 500 }, retainedHeapBytes, revisionMs, hotRenderMs: performance.now() - started };
}

async function beamerResolvers() {
  const { prepareBeamerDocument } = await importCore<typeof import("../packages/core/src/beamer/render.js")>("beamer/render.ts");
  const prepared = prepareBeamerDocument(String.raw`\documentclass{beamer}
    \begin{document}\begin{frame}body\end{frame}\end{document}`);
  await prepared.renderFrame();
  const references: WeakRef<object>[] = [];
  async function renderRevision(index: number) {
    const resolver = { cacheKey: `revision:${index}`, resolve: () => ({ status: "missing" as const }), assetBytes: new Uint8Array(4 * 1024 * 1024) };
    await prepared.renderFrame({ graphicsResolver: resolver });
    return new WeakRef(resolver);
  }
  for (let index = 0; index < 10; index++) references.push(await renderRevision(index));
  await collect();
  const retainedResolvers = references.filter(reference => reference.deref()).length;
  return { workload: { resolverRevisions: 10, assetBytesPerResolver: 4 * 1024 * 1024 }, retainedResolvers, retainedAssetBytes: retainedResolvers * 4 * 1024 * 1024, frameCount: prepared.document.frames.length };
}

async function syntaxHistory() {
  const { getTexSyntaxIndex } = await importCore<typeof import("../packages/core/src/text/tex/syntax-index.js")>("text/tex/syntax-index.ts");
  const { beamerDocumentParser } = await import(pathToFileURL(join(moduleRoot, "packages/lezer-tex/src/index.ts")).href) as typeof import("../packages/lezer-tex/src/index.js");
  const parser = beamerDocumentParser.configure({});
  const references: WeakRef<object>[] = [];
  for (let index = 0; index < 8; index++) {
    references.push(new WeakRef(getTexSyntaxIndex(String.fromCharCode(97 + index).repeat(600000), parser)));
  }
  await collect();
  return { workload: { documents: 8, sourceCharactersPerDocument: 600000 }, retainedIndexes: references.filter(reference => reference.deref()).length, parserTopNode: parser.topNode.name };
}

async function persistentMap() {
  const { PersistentMap } = await importCore<typeof import("../packages/core/src/semantic/persistent-map.js")>("semantic/persistent-map.ts");
  const map = new PersistentMap<string, { payload: Uint8Array }>();
  const references: WeakRef<object>[] = [];
  const revisions = 1000;
  const payloadBytes = 64 * 1024;
  function update() {
    const value = { payload: new Uint8Array(payloadBytes) };
    references.push(new WeakRef(value));
    map.set("node", value);
    map.snapshot();
    // Semantic finalization reads flat maps after capturing checkpoints. Only
    // the latest version is intentionally kept by this probe.
    void map.size;
  }
  await collect();
  const before = process.memoryUsage().heapUsed;
  const started = performance.now();
  for (let revision = 0; revision < revisions; revision++) update();
  const updateMs = performance.now() - started;
  await collect();
  const retainedPayloads = references.filter(reference => reference.deref()).length;
  return { workload: { revisions, payloadBytesPerRevision: payloadBytes }, retainedPayloads,
    retainedPayloadBytes: retainedPayloads * payloadBytes, currentMapSize: map.size,
    retainedHeapBytes: process.memoryUsage().heapUsed - before, updateMs };
}

async function incrementalParse() {
  const { createIncrementalParseSession, parseTikz } = await importCore<typeof import("../packages/core/src/parser/index.js")>("parser/index.ts");
  const sourceFor = (revision: number) => `\\begin{tikzpicture}\n\\draw (${(revision / 1000).toFixed(3)},0) -- (4,0);\n` +
    Array.from({ length: 500 }, (_, index) => `\\draw (${index % 20},${-1 - Math.floor(index / 20)}) rectangle ++(.7,.6);`).join("\n") + "\n\\end{tikzpicture}";
  const session = createIncrementalParseSession();
  session.prime(parseTikz(sourceFor(0), { recover: true }), { sourceRevision: 0 });
  const references: WeakRef<object>[] = [];
  const samples: Array<{ frames: number; retainedInventories: number; heapBytes: number }> = [];
  const started = performance.now();
  for (let revision = 1; revision <= 300; revision++) {
    const result = session.evaluate({ source: sourceFor(revision), sourceRevision: revision,
      activeFigureId: "figure:0", inferChanges: true, trigger: "drag-handle" });
    if (result.stats.strategy !== "incremental") throw new Error(`Expected incremental frame ${revision}`);
    references.push(new WeakRef(result.parse.figures));
    if (revision % 50 === 0) {
      await collect();
      samples.push({ frames: revision, retainedInventories: references.filter(reference => reference.deref()).length,
        heapBytes: process.memoryUsage().heapUsed });
    }
  }
  const current = session.evaluate({ source: sourceFor(300), sourceRevision: 300, activeFigureId: "figure:0" }).parse;
  return { workload: { frames: 300, statements: 501 }, samples,
    // Exercise the syntax tree only at the end, as most drag consumers do.
    currentTreeLength: current.tree.length, elapsedMsIncludingGc: performance.now() - started };
}

const probes = { hyphenation, foreach, "beamer-resolvers": beamerResolvers, "syntax-history": syntaxHistory,
  "persistent-map": persistentMap, "incremental-parse": incrementalParse };
if (only && !(only in probes)) throw new Error(`Unknown probe ${only}; use ${Object.keys(probes).join(", ")}`);
const results: Record<string, unknown> = {};
for (const [name, probe] of Object.entries(probes)) {
  if (only && only !== name) continue;
  results[name] = await probe();
}
const report = { schemaVersion: 1, measuredAt: new Date().toISOString(), moduleRoot, node: process.version, platform: process.platform, arch: process.arch, results };
const json = JSON.stringify(report, null, 2);
if (jsonPath) writeFileSync(resolve(jsonPath), `${json}\n`);
console.log(json);

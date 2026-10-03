#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureDistBuildFresh } from "./ensure-dist-build.mjs";
import { compareBeamerFrame, structuralContractFailures } from "./compare-beamer-frame.mjs";
import { corpusEntries, corpusGallery, corpusGraphicsResolver, entryId, loadCorpusSource, sampleIndices, sha256, summarizeCorpus, writeJson } from "./lib/beamer-corpus.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const scriptPath = fileURLToPath(import.meta.url);
const activeWorkers = new Set();

function stopWorker(child) {
  try {
    if (process.platform === "win32") child.kill("SIGKILL");
    else process.kill(-child.pid, "SIGKILL");
  } catch { /* already exited */ }
}
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.once(signal, () => {
    for (const child of activeWorkers) stopWorker(child);
    process.exit(code);
  });
}

function usage() {
  return `Usage: npm run compare:beamer-corpus -- [options]

  --index <file>      Default: artifacts/beamer-sources/deck-index.json.
  --input <file>      Check one file instead of the index (repeatable).
  --mode <mode>      native (default), or compare (LuaLaTeX + SVG/PDF).
  --repository <s>   Filter repository names by substring.
  --deck <s>         Filter entry-point paths by substring.
  --max-decks-per-repository <n>  Sample decks evenly in each repository.
  --frames <n|all>   Sample source frames evenly. Default: 3.
  --steps <policy>   last (default), first,last, or all.
  --expand-inputs    Inline top-level literal \\input files for both renderers.
  --structural-only  Compare geometry without raster conversion tools.
  --vector-oracle    Also convert the oracle PDF to SVG (requires working dvisvgm).
  --width <pixels>  Raster comparison width. Default: 1200.
  --jobs <n>        Concurrent isolated deck workers. Default: 2.
  --timeout-seconds <n>  Total time per deck. Default: 60 native / 180 compare.
  --out-dir <dir>   Default: artifacts/beamer-corpus-renderer/<mode>.
  --resume          Reuse complete results with matching sources/tools/renderer/options.
  --strict          Exit nonzero for errors, no frames, or structural mismatches.
  --max-rmse <0..1> Also fail --strict when raster RMSE exceeds this value.
  --help            Show help.

Reports: report.json, summary.md, index.html, and per-deck SVGs/logs/comparisons.
Native rendering success and diagnostic counts are coverage evidence, not fidelity scores.`;
}

function parseArgs(argv) {
  const options = {
    index: join(repoRoot, "artifacts/beamer-sources/deck-index.json"), inputs: [],
    mode: "native", repository: "", deck: "", maxDecks: null, frames: 3, steps: "last",
    expandInputs: false, structuralOnly: false, vectorOracle: false, width: 1200, jobs: 2, timeoutSeconds: null,
    outDir: null, resume: false, strict: false, maxRmse: null,
  };
  const flags = { "--expand-inputs": "expandInputs", "--structural-only": "structuralOnly", "--vector-oracle": "vectorOracle", "--resume": "resume", "--strict": "strict" };
  const strings = { "--index": "index", "--mode": "mode", "--repository": "repository", "--deck": "deck", "--steps": "steps", "--out-dir": "outDir" };
  const numbers = { "--width": "width", "--jobs": "jobs", "--timeout-seconds": "timeoutSeconds", "--max-decks-per-repository": "maxDecks", "--max-rmse": "maxRmse" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (flags[arg]) options[flags[arg]] = true;
    else if ((strings[arg] || numbers[arg] || arg === "--frames" || arg === "--input") && argv[i + 1] && !argv[i + 1].startsWith("--")) {
      const value = argv[++i];
      if (arg === "--input") options.inputs.push(resolve(value));
      else if (arg === "--frames") options.frames = value === "all" ? value : Number(value);
      else if (numbers[arg]) options[numbers[arg]] = Number(value);
      else options[strings[arg]] = value;
    } else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  if (!["native", "compare"].includes(options.mode)) throw new Error("--mode must be native or compare.");
  if (!["last", "first,last", "all"].includes(options.steps)) throw new Error("Invalid --steps policy.");
  for (const key of ["frames", "width", "jobs", "timeoutSeconds", "maxDecks"]) {
    if (options[key] != null && options[key] !== "all" && (!Number.isInteger(options[key]) || options[key] < 1)) throw new Error(`${key} must be a positive integer.`);
  }
  if (options.maxRmse != null && (!Number.isFinite(options.maxRmse) || options.maxRmse < 0 || options.maxRmse > 1)) throw new Error("--max-rmse must be between 0 and 1.");
  if (options.maxRmse != null && (options.mode !== "compare" || options.structuralOnly)) throw new Error("--max-rmse requires raster comparison (--mode compare without --structural-only).");
  options.index = resolve(options.index);
  options.outDir = resolve(options.outDir ?? join(repoRoot, "artifacts/beamer-corpus-renderer", options.mode));
  options.timeoutSeconds ??= options.mode === "native" ? 60 : 180;
  return options;
}

function snapshotStamp(root, content = false) {
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (!content || path.endsWith(".js")) {
        const stat = statSync(path);
        files.push([relative(root, path), content ? sha256(readFileSync(path)) : `${stat.size}:${stat.mtimeMs}`]);
      }
    }
  }
  visit(root);
  return sha256(JSON.stringify(files));
}

function toolVersions() {
  return Object.fromEntries(["lualatex", "kpsewhich", "pdfinfo", "dvisvgm", "rsvg-convert", "magick", "pdftoppm"].map((tool) => {
    const result = spawnSync(tool, [tool === "pdfinfo" || tool === "pdftoppm" ? "-v" : "--version"], { encoding: "utf8", timeout: 10_000 });
    return [tool, result.error || result.status !== 0 ? null : `${result.stdout}${result.stderr}`.trim().split("\n")[0]];
  }));
}

async function runWorker(request, directory) {
  mkdirSync(directory, { recursive: true });
  const requestPath = join(directory, "request.json");
  const resultPath = join(directory, "result.json");
  rmSync(resultPath, { force: true });
  writeJson(requestPath, request);
  const log = openSync(join(directory, "worker.log"), "w");
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, ["--max-old-space-size=2048", scriptPath, "--worker", requestPath], {
      cwd: repoRoot, detached: process.platform !== "win32", stdio: ["ignore", log, log],
    });
    activeWorkers.add(child);
    closeSync(log);
    let timedOut = false;
    let finished = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // Kill the entire worker group, including synchronous TeX/raster children.
      stopWorker(child);
    }, request.options.timeoutSeconds * 1000);
    function finish(error) {
      if (finished) return;
      finished = true;
      activeWorkers.delete(child);
      clearTimeout(timer);
      let result;
      try { result = JSON.parse(readFileSync(resultPath, "utf8")); } catch { /* may fail before first checkpoint */ }
      // Never mistake stale results from an earlier run for this worker's output.
      if (result?.fingerprint !== request.fingerprint) result = null;
      result ??= { entry: request.entry, fingerprint: request.fingerprint, pages: [] };
      if (timedOut) { result.status = "timeout"; result.error = `Deck exceeded ${request.options.timeoutSeconds}s; partial page results retained.`; }
      else if (error) { result.status = "worker-error"; result.error = error; }
      writeJson(resultPath, result);
      resolvePromise(result);
    }
    child.once("error", (error) => finish(error.message));
    child.once("exit", (code, signal) => finish(code === 0 ? null : `Worker exited ${signal ?? code}; see worker.log.`));
  });
}

function shortError(error) {
  return (error instanceof Error ? error.message : String(error)).slice(-2500);
}

async function worker(requestPath) {
  const request = JSON.parse(readFileSync(requestPath, "utf8"));
  const { entry, options } = request;
  const directory = dirname(requestPath);
  const result = { entry, fingerprint: request.fingerprint, status: "running", pages: [] };
  function checkpoint() {
    result.elapsedMs = Math.round(performance.now() - start);
    writeJson(join(directory, "result.tmp.json"), result);
    renameSync(join(directory, "result.tmp.json"), join(directory, "result.json"));
  }
  const start = performance.now();
  checkpoint();
  try {
    const loaded = loadCorpusSource(entry.inputPath, options.expandInputs);
    result.inputs = loaded.inputs;
    result.dependencies = loaded.dependencies;
    result.sourceSha256 = sha256(loaded.source);
    writeFileSync(join(directory, "input.tex"), loaded.source);
    const [beamer, core] = await Promise.all([
      import(pathToFileURL(join(repoRoot, "packages/core/dist/beamer/index.js")).href),
      import(pathToFileURL(join(repoRoot, "packages/core/dist/index.js")).href),
    ]);
    const prepared = beamer.prepareBeamerDocument(loaded.source);
    result.frameCount = prepared.document.frames.length;
    result.scannerDiagnostics = prepared.document.diagnostics;
    result.theme = prepared.theme.id;
    result.selectedFrames = sampleIndices(result.frameCount, options.frames).map((index) => index + 1);
    const assetDir = join(directory, "assets");
    mkdirSync(assetDir, { recursive: true });
    const graphics = corpusGraphicsResolver(loaded.source, entry.inputPath, assetDir);
    for (const frame of result.selectedFrames) {
      const stepCount = prepared.frameStepCount(frame - 1);
      const steps = options.steps === "last" ? [stepCount] : sampleIndices(stepCount, options.steps === "all" ? "all" : 2).map((step) => step + 1);
      for (const step of steps) {
        const pageStart = performance.now();
        const name = `frame-${String(frame).padStart(4, "0")}-step-${String(step).padStart(3, "0")}`;
        const page = { frame, step, stepCount, title: prepared.document.frames[frame - 1].title?.value ?? "", status: "renderer-error" };
        result.pages.push(page);
        try {
          const render = await prepared.renderFrame({ frameIndex: frame - 1, step, graphicsResolver: graphics.resolver });
          const svgPath = join(directory, `${name}.svg`);
          writeFileSync(svgPath, render.svg.svg);
          page.svg = relative(options.outDir, svgPath);
          page.renderer = {
            diagnostics: render.diagnostics, itemKinds: render.layout.items.map((item) => item.kind),
            paragraphCount: render.layout.paragraphs.length, svgBytes: Buffer.byteLength(render.svg.svg),
            width: render.svg.viewBox.width, height: render.svg.viewBox.height,
            renderMs: Math.round(performance.now() - pageStart),
          };
          page.status = "rendered";
          checkpoint();
          if (options.mode === "compare") {
            page.status = "oracle-running";
            checkpoint();
            try {
              const comparison = await compareBeamerFrame({
                inputPath: entry.inputPath, sourceDir: dirname(entry.inputPath), texRoot: entry.root,
                frameNumber: frame, pageNumber: step, outDir: directory, name, width: options.width,
                themeVariant: {}, structuralOnly: options.structuralOnly, pdfOnly: !options.vectorOracle, assertStructural: false,
              }, {
                source: loaded.source, preparedDocument: prepared, render,
                coreRenderer: { computerModernTexMetricProvider: core.computerModernTexMetricProvider },
              });
              page.status = "compared";
              page.comparisonReport = relative(options.outDir, comparison.reportPath);
              page.structural = comparison.report.structural.summary;
              page.structuralFailures = structuralContractFailures(page.structural);
              page.normalizedRmse = comparison.report.raster?.normalizedRmse ?? null;
              if (!options.structuralOnly) page.preview = relative(options.outDir, join(comparison.runDir, "side-by-side.png"));
            } catch (error) {
              const oracleReport = join(directory, name, "oracle/frame/report.json");
              page.status = /Overlay page counts differ|exceeds the compiled/u.test(error.message) ? "oracle-page-mismatch" : existsSync(oracleReport) ? "comparison-error" : "oracle-error";
              page.error = shortError(error);
              const log = join(directory, name, "oracle/frame/lualatex-stdout.txt");
              if (existsSync(log)) {
                page.oracleLog = relative(options.outDir, log);
                const lines = readFileSync(log, "utf8").split("\n");
                const errorLine = lines.findIndex((line) => /Undefined control sequence|LaTeX Error:|Package .* Error:|^!|Emergency stop|LuaTeX error/u.test(line));
                if (errorLine >= 0) page.error = lines.slice(errorLine, errorLine + 7).join("\n").slice(0, 1500);
              }
            }
          }
        } catch (error) { page.error = shortError(error); }
        page.elapsedMs = Math.round(performance.now() - pageStart);
        result.assets = graphics.report();
        checkpoint();
      }
    }
    result.status = result.frameCount ? "complete" : "no-frames";
  } catch (error) {
    result.status = "renderer-error";
    result.error = shortError(error);
  }
  checkpoint();
}

function writeReports(report) {
  writeJson(join(report.options.outDir, "report.json"), report);
  writeFileSync(join(report.options.outDir, "index.html"), corpusGallery(report));
  const s = report.summary;
  const rows = Object.entries(s.repositories).map(([name, counts]) => `| ${name} | ${counts.decks} | ${counts.frames} | ${counts.rendered} | ${counts.compared} |`);
  const diagnostics = s.diagnostics.slice(0, 40).map((diagnostic) => `| ${diagnostic.code.replaceAll("|", "\\|")} | ${diagnostic.pages} | ${diagnostic.occurrences} |`);
  writeFileSync(join(report.options.outDir, "summary.md"), `# Beamer renderer corpus\n\n${s.decks} decks; ${s.framesDiscovered} discovered frames; ${s.pagesRendered}/${s.pagesAttempted} sampled pages rendered; ${s.pagesWithoutDiagnostics} without renderer diagnostics.\n\n${s.pagesCompared} pages compared with TeX; ${s.structuralMatches} meet the strict structural contract.\n\nDeck statuses: ${JSON.stringify(s.deckStatuses)}. Page statuses: ${JSON.stringify(s.pageStatuses)}.\n\nSuccessful rendering is not a fidelity score. Oracle failures and undiscovered macro-generated frames remain outside the comparison denominator. See the JSON for per-page errors, inputs, graphics resolution and exact sample parameters.\n\n| Repository | Decks | Discovered frames | Rendered sample pages | Compared pages |\n|---|---:|---:|---:|---:|\n${rows.join("\n")}\n\n| Diagnostic | Sample pages | Occurrences |\n|---|---:|---:|\n${diagnostics.join("\n")}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(usage()); return; }
  let entries = options.inputs.length ? options.inputs.map((inputPath) => ({ inputPath, root: dirname(inputPath), repository: "local", path: relative(repoRoot, inputPath) })) : corpusEntries(options.index);
  entries = entries.filter((entry) => entry.repository.toLowerCase().includes(options.repository.toLowerCase()) && entry.path.toLowerCase().includes(options.deck.toLowerCase()));
  if (options.maxDecks) {
    const groups = new Map();
    for (const entry of entries) {
      if (!groups.has(entry.repository)) groups.set(entry.repository, []);
      groups.get(entry.repository).push(entry);
    }
    entries = [...groups.values()].flatMap((group) => sampleIndices(group.length, options.maxDecks).map((index) => group[index]));
  }
  if (!entries.length) throw new Error("No matching corpus entry points.");
  const tools = toolVersions();
  if (options.mode === "compare") {
    const required = ["lualatex", "kpsewhich", "pdfinfo", ...(options.structuralOnly ? [] : ["rsvg-convert", "magick", "pdftoppm", ...(options.vectorOracle ? ["dvisvgm"] : [])])];
    const missing = required.filter((tool) => !tools[tool]);
    if (missing.length) throw new Error(`Comparison tools unavailable: ${missing.join(", ")}. Use --mode native for renderer coverage.`);
  }
  ensureDistBuildFresh(repoRoot);
  const rendererFingerprint = sha256(["core", "lezer-tex", "lezer-tikz"].map((name) => snapshotStamp(join(repoRoot, "packages", name, "dist"), true)).join(""));
  const harnessFingerprint = sha256([scriptPath, join(repoRoot, "scripts/lib/beamer-corpus.mjs"), join(repoRoot, "scripts/compare-beamer-frame.mjs"), join(repoRoot, "scripts/probe-beamer-frame.mjs"), join(repoRoot, "scripts/lib/beamer-frame-oracle.mjs"), join(repoRoot, "scripts/lib/beamer-frame-compare.mjs")].map((path) => readFileSync(path, "utf8")).join(""));
  const stamps = new Map();
  mkdirSync(options.outDir, { recursive: true });
  const decks = new Array(entries.length);
  let next = 0;
  let completed = 0;
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const runOptions = { mode: options.mode, frames: options.frames, steps: options.steps, expandInputs: options.expandInputs, structuralOnly: options.structuralOnly, vectorOracle: options.vectorOracle, width: options.width, timeoutSeconds: options.timeoutSeconds };
  async function consume() {
    while (next < entries.length) {
      const index = next++;
      const entry = entries[index];
      if (!stamps.has(entry.root)) stamps.set(entry.root, snapshotStamp(entry.root));
      const fingerprint = sha256(JSON.stringify({ entry, options: runOptions, sources: stamps.get(entry.root), rendererFingerprint, harnessFingerprint, tools, node: process.version }));
      const directory = join(options.outDir, "decks", entryId(entry));
      let result;
      if (options.resume) {
        try {
          const previous = JSON.parse(readFileSync(join(directory, "result.json"), "utf8"));
          const artifactsPresent = previous.pages.every((page) => [page.svg, page.comparisonReport, page.preview, page.oracleLog].filter(Boolean).every((artifact) => existsSync(join(options.outDir, artifact))));
          if (previous.fingerprint === fingerprint && artifactsPresent && ["complete", "no-frames"].includes(previous.status)) result = previous;
        } catch { /* no valid cached result */ }
      }
      if (result) console.log(`[resume] ${entry.repository} / ${entry.path}`);
      else result = await runWorker({ entry, options, fingerprint }, directory);
      decks[index] = result;
      completed++;
      console.log(`[${completed}/${entries.length}] ${entry.repository} / ${entry.path}: ${result.status}, ${result.frameCount ?? 0} frames, ${result.pages.length} sampled pages`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.jobs, entries.length) }, consume));
  const report = { formatVersion: 1, startedAt, finishedAt: new Date().toISOString(), elapsedMs: Math.round(performance.now() - start), rendererFingerprint, harnessFingerprint, tools, options, summary: summarizeCorpus(decks), decks };
  writeReports(report);
  console.log(`[beamer-corpus] ${JSON.stringify(report.summary, (key, value) => ["repositories", "diagnostics"].includes(key) ? undefined : value)}`);
  console.log(`[beamer-corpus] ${join(options.outDir, "index.html")}`);
  if (options.strict && decks.some((deck) => deck.status !== "complete" || deck.pages.some((page) => !["rendered", "compared"].includes(page.status) || page.structuralFailures?.length || (options.maxRmse != null && page.normalizedRmse > options.maxRmse)))) process.exitCode = 1;
}

try {
  if (process.argv[2] === "--worker") await worker(process.argv[3]);
  else await main();
} catch (error) {
  console.error(shortError(error));
  process.exitCode = 1;
}

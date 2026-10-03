#!/usr/bin/env node
// A strict reproduction suite layered on the existing frame comparator.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compareBeamerFrame, loadCoreRenderer, rasterizePdfPage, rasterizeSvg } from "./compare-beamer-frame.mjs";
import { buildNativeBeamerPageTrace } from "./lib/beamer-frame-compare.mjs";
import { corpusGraphicsResolver, sha256 } from "./lib/beamer-corpus.mjs";
import { priorityFidelityFailures, priorityOracleFailures, unsupportedCodeFailures } from "./lib/beamer-priority-contracts.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultManifest = join(repoRoot, "test/fixtures/beamer/corpus-priorities/cases.json");
const readJson = file => JSON.parse(readFileSync(file, "utf8"));
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const escape = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function previewFigure(label, image, target = image) {
  return `<figure><figcaption>${escape(label)}</figcaption><a href="${escape(target)}"><img loading="lazy" src="${escape(image)}" alt="${escape(label)}"></a></figure>`;
}

function snapshotGallery(result, snapshot) {
  const native = snapshot.svg
    ? previewFigure(result.kind === "recognition" ? "Native · recognition contract" : `Native · state ${snapshot.page}`, snapshot.nativePreview ?? snapshot.svg, snapshot.svg)
    : "<p>Native rendering unavailable.</p>";
  const references = (snapshot.oraclePreviews ?? []).map(p => previewFigure(`TeX · page ${p.page}`, p.png));
  let renderings;
  if (snapshot.correspondence === "unmatched") {
    renderings = `<p class="notice">Page counts differ. The native rendering and all TeX pages are shown separately; glyph comparison is withheld.</p><div class="native-only">${native}</div><div class="oracle-pages">${references.join("")}</div>`;
  } else if (references.length) {
    renderings = `<div class="comparison">${native}${references.join("")}</div>`;
  } else {
    renderings = `<div class="native-only">${native}</div>${snapshot.oraclePdf ? `<p>TeX raster preview was not generated. <a href="${escape(snapshot.oraclePdf)}">Open the TeX PDF</a>.</p>` : ""}`;
  }
  return `<section>${renderings}<p class="artifact-links"><a href="${escape(snapshot.report)}">Detailed report</a>${snapshot.svg ? ` · <a href="${escape(snapshot.svg)}">Native SVG</a>` : ""}${snapshot.oraclePdf ? ` · <a href="${escape(snapshot.oraclePdf)}">TeX PDF</a>` : ""}</p></section>`;
}

function gallery(report) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(report.title ?? "Beamer priority reproductions")}</title><style>
body{font:16px/1.5 system-ui;margin:0;background:#f4f5f8;color:#202534}main{max-width:1320px;margin:auto;padding:28px}h1{margin-bottom:8px}h2{font-size:20px;margin:0}article{background:white;padding:22px;border:1px solid #dce0e8;border-radius:10px;margin:24px 0}.case-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}.badge{font-size:13px;border-radius:5px;padding:3px 9px;background:#fff0e6;color:#8a350c}.badge.passed{background:#e6f4ed;color:#186143}.metadata,.artifact-links{color:#5a6272;font-size:14px}.comparison,.oracle-pages{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.oracle-pages{grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}.native-only{max-width:760px}figure{margin:0;min-width:0}figcaption{font-size:14px;font-weight:600;margin:4px 0 8px}img{display:block;width:100%;height:auto;border:1px solid #dce0e8;box-sizing:border-box;background:white}section+section{border-top:1px solid #dce0e8;margin-top:24px;padding-top:18px}a{color:#0659a8}pre{white-space:pre-wrap;font:13px/1.5 ui-monospace,monospace}details{margin-top:12px}summary{cursor:pointer;color:#5a6272}.notice{font-size:14px;background:#fff6df;padding:10px 12px;border-radius:5px}@media(max-width:760px){main{padding:12px}article{padding:14px}.comparison{grid-template-columns:1fr}}
</style></head><body><main><h1>${escape(report.title ?? "Beamer priority reproductions")}</h1><p>${report.passed} passed · ${report.failed} failed · run ${escape(report.status)}</p><p class="metadata">Fidelity gates exact glyph positions and sizes, rule geometry, and sampled flat block fills. Raster previews support manual review; a green badge does not assert whole-image pixel equality. Unsupported-code recognition has its own contract. Current failures remain red reproductions.</p>${report.error ? `<pre>${escape(report.error)}</pre>` : ""}${report.results.map(result => `<article id="${escape(result.id)}"><div class="case-heading"><h2>${escape(result.id)}</h2><span class="badge ${result.status === "passed" ? "passed" : ""}">${escape(result.status)}</span></div><p class="metadata">${escape(result.fixture.family ?? result.fixture.environment)} · frame ${result.fixture.frame} · ${result.kind}</p>${result.snapshots.map(snapshot => snapshotGallery(result, snapshot)).join("")}${result.failures.length ? `<details><summary>${result.failures.length} contract failures</summary><pre>${escape(result.failures.join("\n"))}</pre></details>` : ""}</article>`).join("")}</main></body></html>`;
}

// Build previews from saved artifacts, including cases whose page counts differ.
// This leaves all comparison measurements and pass/fail decisions unchanged.
function addSnapshotPreviews(outDir, result) {
  for (const snapshot of result.snapshots) {
    if (!snapshot.svg) continue;
    const svgPath = join(outDir, snapshot.svg);
    const directory = dirname(svgPath);
    const svg = readFileSync(svgPath, "utf8");
    const viewBox = /\bviewBox="([^"]+)"/u.exec(svg)?.[1].trim().split(/[\s,]+/u).map(Number);
    if (!viewBox || viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0) throw new Error(`Invalid SVG viewBox: ${snapshot.svg}`);
    const width = 1280;
    const height = Math.round(width * viewBox[3] / viewBox[2]);
    const nativePng = join(directory, "gallery-native.png");
    rasterizeSvg(svgPath, nativePng, width, height);
    snapshot.nativePreview = relative(outDir, nativePng);
    snapshot.oraclePreviews = [];
    if (!snapshot.oraclePdf) continue;
    const comparison = readJson(join(outDir, snapshot.report));
    const paired = comparison.structural != null;
    snapshot.correspondence = paired ? "matched" : "unmatched";
    const pages = paired
      ? [comparison.input.compiledPage]
      : Array.from({ length: comparison.oracle.page.pageCount }, (_, i) => i + 1);
    for (const page of pages) {
      const png = join(directory, `gallery-tex-page-${page}.png`);
      rasterizePdfPage(join(outDir, snapshot.oraclePdf), png, page, width, height);
      snapshot.oraclePreviews.push({ page, png: relative(outDir, png) });
    }
  }
}

function refreshGallery(outDir, raster) {
  const reportPath = join(outDir, "report.json");
  const report = readJson(reportPath);
  for (const result of report.results) {
    if (raster) addSnapshotPreviews(outDir, result);
    writeJson(reportPath, report);
    writeFileSync(join(outDir, "index.html"), gallery(report));
  }
  report.galleryUpdatedAt = new Date().toISOString();
  writeJson(reportPath, report);
  writeFileSync(join(outDir, "index.html"), gallery(report));
  console.log(`[beamer-priorities] refreshed ${report.results.length} gallery cases without rerunning comparisons: ${join(outDir, "index.html")}`);
}

async function main(argv) {
  const options = { outDir: join(repoRoot, "artifacts/beamer-priority-conformance"), kind: "all", cases: null, raster: true, refreshGallery: false, manifest: defaultManifest };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--manifest") options.manifest = resolve(argv[++i]);
    else if (argv[i] === "--out-dir") options.outDir = resolve(argv[++i]);
    else if (argv[i] === "--kind") options.kind = argv[++i];
    else if (argv[i] === "--cases") options.cases = argv[++i].split(",");
    else if (argv[i] === "--raster") options.raster = true;
    else if (argv[i] === "--structural-only") options.raster = false;
    else if (argv[i] === "--refresh-gallery") options.refreshGallery = true;
    else if (argv[i] === "--help") { console.log("Usage: npm run compare:beamer-priorities -- [--kind all|fidelity|recognition] [--cases comma-separated-IDs] [--structural-only] [--refresh-gallery] [--out-dir directory] [--manifest cases.json]\nGenerates native and TeX raster previews by default. --refresh-gallery rebuilds previews from saved artifacts without rerunning conformance.\nConformance runs always exit nonzero on a mismatch, invalid oracle, recognition failure or exception."); return; }
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!["all", "fidelity", "recognition"].includes(options.kind)) throw new Error("--kind must be all, fidelity or recognition.");
  if (options.refreshGallery) { refreshGallery(options.outDir, options.raster); return; }
  const fixtureRoot = dirname(options.manifest);
  const manifest = readJson(options.manifest);
  const catalog = [...manifest.fidelity.map(fixture => ({ kind: "fidelity", fixture })), ...manifest.recognition.map(fixture => ({ kind: "recognition", fixture }))];
  if (options.cases?.some(id => !catalog.some(c => c.fixture.id === id))) throw new Error("Unknown case ID.");
  const selected = catalog.filter(c => (options.kind === "all" || options.kind === c.kind) && (!options.cases || options.cases.includes(c.fixture.id)));
  if (!selected.length) throw new Error("No selected cases.");
  mkdirSync(options.outDir, { recursive: true });
  const documents = new Map();
  const results = [];
  const report = { formatVersion: 1, generatedAt: new Date().toISOString(), status: "running", title: manifest.title ?? "Beamer priority reproductions", options, manifestSha256: sha256(readFileSync(options.manifest)), passed: 0, failed: 0, results };
  const checkpoint = () => {
    report.passed = results.filter(r => r.status === "passed").length;
    report.failed = results.length - report.passed;
    writeJson(join(options.outDir, "report.json"), report);
    writeFileSync(join(options.outDir, "index.html"), gallery(report));
  };
  checkpoint();
  let core;
  try { core = await loadCoreRenderer(); }
  catch (error) {
    report.status = "build-error";
    report.error = error.message;
    checkpoint();
    throw error;
  }
  for (const { kind, fixture } of selected) {
    const inputPath = join(fixtureRoot, fixture.file);
    if (!documents.has(inputPath)) {
      const source = readFileSync(inputPath, "utf8");
      documents.set(inputPath, { source, prepared: core.prepareBeamerDocument(source) });
    }
    const { source, prepared } = documents.get(inputPath);
    const result = { id: fixture.id, kind, fixture, sourceSha256: sha256(source), status: "passed", failures: [], snapshots: [] };
    try {
      if (kind === "recognition") {
        const directory = join(options.outDir, fixture.id);
        mkdirSync(directory, { recursive: true });
        const render = await prepared.renderFrame({ frameIndex: fixture.frame - 1, step: 1 });
        const body = render.frame.bodySpan;
        const from = source.indexOf(`\\begin{${fixture.environment}}`, body.from);
        const end = `\\end{${fixture.environment}}`;
        const to = source.indexOf(end, from) + end.length;
        if (from < body.from || to > body.to || to <= from) throw new Error("Invalid code environment span.");
        const trace = buildNativeBeamerPageTrace(render, core.computerModernTexMetricProvider);
        result.failures = unsupportedCodeFailures({ source, span: { from, to }, render, trace, requiredText: fixture.requiredText });
        writeFileSync(join(directory, "renderer.svg"), render.svg.svg);
        writeFileSync(join(directory, "source-frame.tex"), source.slice(render.frame.span.from, render.frame.span.to));
        writeJson(join(directory, "recognition.json"), { fixture, failures: result.failures, expectedSpan: { from, to }, diagnostics: render.diagnostics, unsupportedItems: render.layout.items.filter(i => i.kind === "unsupported"), trace });
        result.snapshots.push({ page: 1, report: relative(options.outDir, join(directory, "recognition.json")), svg: relative(options.outDir, join(directory, "renderer.svg")) });
      } else {
        for (let page = 1; page <= fixture.pages; page++) {
          const name = `${fixture.id}-state-${page}`;
          const directory = join(options.outDir, name);
          mkdirSync(join(directory, "assets"), { recursive: true });
          const graphics = corpusGraphicsResolver(source, inputPath, join(directory, "assets"));
          const comparisonPath = join(directory, "report.json");
          // A failed retry must not reuse a previous successful comparison.
          rmSync(comparisonPath, { force: true });
          let error = null;
          try {
            await compareBeamerFrame({ inputPath, frameNumber: fixture.frame, pageNumber: page, outDir: options.outDir, name, width: 1600, themeVariant: {}, structuralOnly: !options.raster, pdfOnly: true, assertStructural: false, paintProbes: fixture.paintProbes }, { source, preparedDocument: prepared, coreRenderer: core, graphicsResolver: graphics.resolver });
          } catch (caught) { error = caught.message; }
          if (!existsSync(comparisonPath)) throw new Error(error ?? "Comparator did not write a report.");
          const comparison = readJson(comparisonPath);
          const oracle = readJson(join(directory, comparison.oracle.report));
          const invalidOracle = priorityOracleFailures(oracle, fixture);
          const svgPath = join(directory, "renderer.svg");
          const imageCount = (readFileSync(svgPath, "utf8").match(/<image\b/gu) ?? []).length;
          const failures = priorityFidelityFailures(comparison, fixture, imageCount);
          if (error && comparison.status !== "page-count-mismatch") failures.push(error);
          const assets = graphics.report();
          for (const asset of assets) if (asset.status !== "resolved") failures.push(`Asset ${asset.filename}: ${asset.status}`);
          writeJson(join(directory, "priority-contract.json"), { fixture, page, invalidOracle, failures, assets });
          result.failures.push(...invalidOracle.map(f => `Invalid oracle: ${f}`), ...failures.map(f => `State ${page}: ${f}`));
          result.snapshots.push({ page, report: relative(options.outDir, comparisonPath), svg: relative(options.outDir, svgPath), oraclePdf: relative(options.outDir, join(dirname(join(directory, comparison.oracle.report)), "probe.pdf")), preview: comparison.artifacts.sideBySidePng ? relative(options.outDir, join(directory, comparison.artifacts.sideBySidePng)) : null, summary: comparison.structural?.summary ?? null });
          if (invalidOracle.length) { result.status = "invalid-oracle"; break; }
          if (comparison.status === "page-count-mismatch") { result.status = "page-count-mismatch"; break; }
        }
      }
      if (result.status === "passed" && result.failures.length) result.status = kind === "recognition" ? "recognition-failure" : "mismatch";
      if (options.raster) addSnapshotPreviews(options.outDir, result);
    } catch (error) { result.status = "error"; result.failures.push(error.message); }
    results.push(result);
    checkpoint();
    console.log(`[beamer-priorities] ${result.id}: ${result.status}${result.failures.length ? ` (${result.failures.length} failures)` : ""}`);
  }
  report.status = "complete";
  checkpoint();
  console.log(`[beamer-priorities] ${report.passed}/${results.length} passed; wrote ${join(options.outDir, "report.json")}`);
  if (report.failed) process.exitCode = 1;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });

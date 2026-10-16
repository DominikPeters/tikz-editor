#!/usr/bin/env node
// Validate complete authored TeX decks independently of native renderer support.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { texOracleEnv } from "./lib/tex-oracle.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
const manifestPath = join(repo, "test/fixtures/beamer/breadth-decks/manifest.json");
const sourceRoot = dirname(manifestPath);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
let out = join(repo, "artifacts/beamer-breadth-decks/tex"), selected = "";
for (let i = 2; i < process.argv.length; i++) {
  const option = process.argv[i], value = process.argv[++i];
  if (!value) throw new Error(`Missing value for ${option}`);
  if (option === "--out-dir") out = resolve(value);
  else if (option === "--deck") selected = value;
  else throw new Error(`Unknown option: ${option}`);
}
const decks = manifest.decks.filter(deck => deck.id.includes(selected));
if (!decks.length) throw new Error("No matching decks.");
mkdirSync(out, { recursive: true });
const sha = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const run = (command, args) => execFileSync(command, args, {
  cwd: sourceRoot, env: texOracleEnv(), encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
});
const report = {
  formatVersion: 1, generatedAt: new Date().toISOString(), status: "running",
  manifestSha256: sha(manifestPath), engine: run("lualatex", ["--version"]).split("\n")[0],
  scope: "Complete TeX compilation, page counts and content witnesses. Box warnings remain visible. No native fidelity claim.",
  passed: 0, failed: 0, results: [],
};
function checkpoint() {
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  const sections = report.results.map(result => `<section><h2>${escape(result.id)} — ${escape(result.status)}</h2><p>${escape(result.pedagogy)}</p>${result.pdf ? `<p><a href="${escape(result.pdf)}">Complete PDF (${result.pages} pages)</a></p>` : ""}${result.error ? `<pre>${escape(result.error)}</pre>` : ""}${result.boxWarnings?.length ? `<details><summary>${result.boxWarnings.length} TeX box warnings</summary><pre>${escape(result.boxWarnings.join("\n"))}</pre></details>` : ""}<div class="pages">${(result.previews ?? []).map((path, i) => `<figure><img loading="lazy" src="${escape(path)}" alt="${escape(result.id)} page ${i + 1}"><figcaption>Page ${i + 1}</figcaption></figure>`).join("")}</div></section>`).join("\n");
  writeFileSync(join(out, "index.html"), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Original Beamer breadth decks — TeX references</title><style>body{font:16px/1.5 system-ui;margin:2rem;background:#eef0f4;color:#202630}section{background:white;margin:2rem 0;padding:1.5rem;border-radius:8px}.pages{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:1rem}figure{margin:0}img{width:100%;border:1px solid #ddd}pre{white-space:pre-wrap}a{color:#125998}</style><h1>Original Beamer breadth decks</h1><p>${report.passed} valid TeX decks; ${report.failed} failures. Original teaching material; synthetic data are labeled. This gallery is the independent TeX reference, not native renderer output.</p>${sections}</html>`);
}
checkpoint();
for (const deck of decks) {
  const input = join(sourceRoot, deck.file), directory = join(out, deck.id);
  mkdirSync(directory, { recursive: true });
  const result = {
    id: deck.id, file: relative(repo, input), sourceSha256: sha(input), pedagogy: deck.pedagogy,
    assets: (deck.assets ?? []).map(file => ({ file, sha256: sha(join(sourceRoot, file)) })), status: "error",
  };
  try {
    for (let pass = 1; pass <= 2; pass++) {
      try {
        const log = run("lualatex", ["-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "-no-shell-escape", `-output-directory=${directory}`, input]);
        writeFileSync(join(directory, `pass-${pass}.txt`), log);
      } catch (error) {
        writeFileSync(join(directory, `pass-${pass}.txt`), `${error.stdout ?? ""}${error.stderr ?? ""}`);
        throw error;
      }
    }
    const pdf = join(directory, `${deck.id}.pdf`);
    const info = run("pdfinfo", [pdf]);
    result.pages = Number(/Pages:\s+(\d+)/u.exec(info)?.[1]);
    if (result.pages !== deck.expectedPdfPages) throw new Error(`Expected ${deck.expectedPdfPages} PDF pages, got ${result.pages}.`);
    const text = run("pdftotext", ["-layout", pdf, "-"]).normalize("NFKC").replace(/\s+/gu, " ");
    writeFileSync(join(directory, "text.txt"), text + "\n");
    result.witnesses = deck.witnesses.map(value => ({ text: value, found: text.includes(value) }));
    if (result.witnesses.some(witness => !witness.found)) throw new Error("Missing PDF content witness.");
    const log = readFileSync(join(directory, `${deck.id}.log`), "utf8");
    result.boxWarnings = [...log.matchAll(/Overfull \\[hv]box[^\n]*/gu)].map(match => match[0]);
    result.pdf = relative(out, pdf);
    for (const file of readdirSync(directory).filter(file => /^page-\d+\.png$/u.test(file))) rmSync(join(directory, file));
    run("pdftoppm", ["-scale-to", "960", "-png", pdf, join(directory, "page")]);
    result.previews = readdirSync(directory).filter(file => /^page-\d+\.png$/u.test(file)).sort().map(file => relative(out, join(directory, file)));
    result.status = "passed";
    report.passed++;
  } catch (error) {
    result.error = String(error.message).slice(0, 3000);
    report.failed++;
  }
  report.results.push(result);
  console.log(`${deck.id}: ${result.status}${result.pages ? `, ${result.pages} PDF pages` : ""}${result.boxWarnings?.length ? `, ${result.boxWarnings.length} box warnings` : ""}`);
  checkpoint();
}
report.status = "complete";
checkpoint();
if (report.failed) process.exitCode = 1;

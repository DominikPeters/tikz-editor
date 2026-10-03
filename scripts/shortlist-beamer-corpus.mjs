#!/usr/bin/env node
// Candidate discovery for human review, not a renderer support/pass classifier.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadCoreRenderer } from "./compare-beamer-frame.mjs";
import { corpusEntries, corpusGraphicsResolver, entryId, loadCorpusSource, sha256 } from "./lib/beamer-corpus.mjs";
import { beamerReviewSignals } from "./lib/beamer-review-signals.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const beamer = "https://texdoc.org/serve/beamer/0";
export const reviewFeatures = [
  { id: "columns", origin: "Beamer", envs: ["columns", "column"], commands: ["column"], reference: beamer },
  { id: "overlays", origin: "Beamer", commands: ["pause", "only", "uncover", "visible", "invisible", "onslide", "alt", "temporal"], reference: beamer },
  { id: "overlay-containers", origin: "Beamer", envs: ["overprint", "overlayarea", "onlyenv", "uncoverenv", "visibleenv", "actionenv"], reference: beamer },
  { id: "frame-sizing-breaks", origin: "Beamer", commands: ["framebreak", "framezoom", "againframe"], headPattern: /\b(?:allowframebreaks|shrink|squeeze)\b/u, reference: beamer },
  { id: "blocks-theorems", origin: "Beamer / amsthm", envs: ["block", "alertblock", "exampleblock", "theorem", "lemma", "definition", "example", "proof", "corollary", "proposition"], reference: beamer },
  { id: "toc-title", origin: "Beamer", commands: ["tableofcontents", "titlepage", "maketitle"], reference: beamer },
  { id: "tables", origin: "LaTeX / array / booktabs / tabularx", envs: ["tabular", "tabular*", "tabularx", "longtable"], commands: ["toprule", "midrule", "bottomrule", "multicolumn", "multirow", "rowcolor", "cellcolor"], reference: "https://ctan.org/pkg/booktabs" },
  { id: "math-alignment", origin: "LaTeX / amsmath", envs: ["align", "align*", "aligned", "alignedat", "alignat", "gather", "gather*", "split", "multline", "multline*", "eqnarray", "eqnarray*"], reference: "https://ctan.org/pkg/amsmath" },
  { id: "math-matrices", origin: "LaTeX / amsmath", envs: ["array", "matrix", "pmatrix", "bmatrix", "smallmatrix", "cases"], reference: "https://ctan.org/pkg/amsmath" },
  { id: "graphics-wrappers", origin: "LaTeX / graphics", commands: ["resizebox", "scalebox", "rotatebox", "makebox", "parbox", "raisebox"], envs: ["minipage"], reference: "https://ctan.org/pkg/graphics" },
  { id: "graphics", origin: "graphicx", commands: ["includegraphics"], reference: "https://ctan.org/pkg/graphicx" },
  { id: "figures-captions", origin: "LaTeX / caption / subcaption", envs: ["figure", "figure*", "subfigure", "subtable"], commands: ["caption", "captionof", "subcaption"], reference: "https://ctan.org/pkg/subcaption" },
  { id: "tikz-diagrams", origin: "PGF/TikZ", envs: ["tikzpicture"], commands: ["tikz"], reference: "https://ctan.org/pkg/pgf" },
  { id: "pgfplots", origin: "pgfplots", envs: ["axis", "semilogxaxis", "semilogyaxis", "loglogaxis", "groupplot"], commands: ["addplot", "pgfplotstabletypeset"], reference: "https://ctan.org/pkg/pgfplots" },
  { id: "code-listings", origin: "LaTeX / listings / fancyvrb / minted", envs: ["verbatim", "verbatim*", "semiverbatim", "lstlisting", "Verbatim", "minted", "alltt"], commands: ["verb", "lstinline", "lstinputlisting", "mintinline", "inputminted"], reference: "https://ctan.org/pkg/listings" },
  { id: "algorithms", origin: "algorithm2e / algorithms / algorithmicx", envs: ["algorithm", "algorithm*", "algorithmic"], commands: ["SetKw", "KwIn", "KwOut", "For", "While", "State"], reference: "https://ctan.org/pkg/algorithm2e" },
  { id: "footnotes", origin: "LaTeX / Beamer", commands: ["footnote", "footnotemark", "footnotetext"], reference: beamer },
  { id: "citations-bibliography", origin: "LaTeX / biblatex / natbib", commands: ["cite", "citep", "citet", "fullcite", "footcite", "parencite", "textcite", "printbibliography", "bibliography"], envs: ["thebibliography"], reference: "https://ctan.org/pkg/biblatex" },
  { id: "links-references", origin: "hyperref / LaTeX", commands: ["href", "url", "hyperlink", "hypertarget", "ref", "eqref", "autoref", "beamerbutton", "beamergotobutton"], reference: "https://ctan.org/pkg/hyperref" },
  { id: "units", origin: "siunitx", commands: ["SI", "si", "num", "qty", "unit"], reference: "https://ctan.org/pkg/siunitx" },
  { id: "color-boxes", origin: "LaTeX / xcolor / Beamer / tcolorbox", commands: ["colorbox", "fcolorbox", "fbox"], envs: ["beamercolorbox", "beamerboxesrounded", "tcolorbox", "mdframed"], reference: "https://ctan.org/pkg/tcolorbox" },
  { id: "text-formatting", origin: "LaTeX / Beamer", commands: ["small", "scriptsize", "footnotesize", "tiny", "Large", "Huge", "textcolor", "alert", "textbf", "textit", "texttt", "vspace", "hspace", "vfill", "hfill", "bigskip"], envs: ["small", "scriptsize", "footnotesize", "tiny", "center", "flushleft", "flushright"], reference: beamer },
];

export function featuresForFrame(context, frame) {
  const controls = context.syntax.controlsIn(frame.bodySpan);
  const commands = new Set(controls.map(c => c.name));
  const envs = new Set(context.syntax.environmentBoundariesIn(frame.bodySpan).filter(e => e.kind === "begin").map(e => e.name));
  const head = context.source.slice(frame.span.from, frame.bodySpan.from);
  // Anchoring overlay detection to real control tokens excludes comments and
  // commands printed inside an opaque code environment.
  const itemOverlay = controls.some(c => c.name === "item" && /^\s*</u.test(context.source.slice(c.span.to, c.span.to + 30)));
  const features = reviewFeatures.filter(f =>
    f.commands?.some(c => commands.has(c)) || f.envs?.some(e => envs.has(e)) ||
    (f.id === "overlays" && itemOverlay) || f.headPattern?.test(head)
  ).map(f => f.id);
  return { features, commands: [...commands], environments: [...envs] };
}

export function selectDiverseFrames(frames, limit = 40, maxPerDeck = 4, maxPerRepository = 8) {
  const selected = [];
  const covered = new Set();
  const decks = new Map();
  const repositories = new Map();
  const remaining = frames.filter(f => f.complete && f.features.length);
  while (selected.length < limit) {
    let best = null;
    let score = -Infinity;
    for (const f of remaining) {
      if (f.selected || (decks.get(f.deckId) ?? 0) >= maxPerDeck || (repositories.get(f.repository) ?? 0) >= maxPerRepository) continue;
      const novel = f.features.filter(x => !covered.has(`${f.repository}/${x}`)).length;
      const uncommon = f.features.filter(x => !["text-formatting", "graphics", "overlays", "columns"].includes(x)).length;
      // Prefer new author/feature combinations and compact interpretable cases.
      const value = novel * 20 + uncommon * 2 - Math.min(f.sourceBytes / 1500, 6) - (repositories.get(f.repository) ?? 0) * 3;
      if (value > score) { best = f; score = value; }
    }
    if (!best) break;
    best.selected = true;
    selected.push({ ...best, selectionScore: Math.round(score * 100) / 100 });
    best.features.forEach(x => covered.add(`${best.repository}/${x}`));
    decks.set(best.deckId, (decks.get(best.deckId) ?? 0) + 1);
    repositories.set(best.repository, (repositories.get(best.repository) ?? 0) + 1);
  }
  remaining.forEach(f => { delete f.selected; });
  selected.forEach(f => { delete f.selected; });
  return selected;
}

async function main(argv) {
  const options = { index: resolve(repoRoot, "artifacts/beamer-sources/deck-index.json"), out: resolve(repoRoot, "artifacts/beamer-corpus-renderer/shortlist"), count: 40, maxPerDeck: 4, maxPerRepository: 8, renderSelected: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (["--index", "--out"].includes(arg)) options[arg.slice(2)] = resolve(argv[++i]);
    else if (arg === "--count") options.count = Number(argv[++i]);
    else if (arg === "--max-per-deck") options.maxPerDeck = Number(argv[++i]);
    else if (arg === "--max-per-repository") options.maxPerRepository = Number(argv[++i]);
    else if (arg === "--render-selected") options.renderSelected = true;
    else if (arg === "--help") { console.log("Usage: node scripts/shortlist-beamer-corpus.mjs [--index deck-index.json] [--out directory] [--count 40] [--max-per-deck 4] [--max-per-repository 8] [--render-selected]"); return; }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  for (const n of [options.count, options.maxPerDeck, options.maxPerRepository]) if (!Number.isInteger(n) || n < 1) throw new Error("Sample limits must be positive integers.");
  const coreRenderer = await loadCoreRenderer();
  const [{ scanBeamerDocument }, { createBeamerSyntaxContext }] = await Promise.all([
    import(pathToFileURL(join(repoRoot, "packages/core/dist/beamer/index.js")).href),
    import(pathToFileURL(join(repoRoot, "packages/core/dist/beamer/syntax.js")).href),
  ]);
  const frames = [], decks = [], forms = new Set();
  for (const entry of corpusEntries(options.index)) {
    try {
      const loaded = loadCorpusSource(entry.inputPath, true);
      const document = scanBeamerDocument(loaded.source);
      const context = createBeamerSyntaxContext(loaded.source);
      const deckId = entryId(entry);
      const features = new Set();
      for (const [index, frame] of document.frames.entries()) {
        const info = featuresForFrame(context, frame);
        info.features.forEach(x => features.add(x));
        const raw = loaded.source.slice(frame.span.from, frame.span.to);
        const key = entry.repository + "/" + sha256(raw);
        const duplicateSourceForm = forms.has(key);
        forms.add(key);
        frames.push({ repository: entry.repository, inputPath: entry.inputPath, root: entry.root, path: entry.path, deckId, frame: index + 1, title: frame.title?.value ?? "", span: frame.span, complete: Boolean(frame.endSpan), sourceBytes: Buffer.byteLength(raw), duplicateSourceForm, ...info });
      }
      decks.push({ entry, frameCount: document.frames.length, features: [...features], scannerDiagnostics: document.diagnostics, inputs: loaded.inputs });
    } catch (error) { decks.push({ entry, error: error.message }); }
  }
  const uniqueFrames = frames.filter(f => !f.duplicateSourceForm);
  const frequency = reviewFeatures.map(({ headPattern, ...feature }) => {
    const matches = uniqueFrames.filter(f => f.complete && f.features.includes(feature.id));
    return { ...feature, distinctSourceForms: matches.length, entryPoints: new Set(matches.map(f => f.deckId)).size, repositories: [...new Set(matches.map(f => f.repository))] };
  }).sort((a, b) => b.repositories.length - a.repositories.length || b.distinctSourceForms - a.distinctSourceForms);
  const selected = selectDiverseFrames(uniqueFrames, options.count, options.maxPerDeck, options.maxPerRepository);
  mkdirSync(options.out, { recursive: true });
  const codeFiles = [];
  function fingerprint(directory) {
    for (const file of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const filePath = join(directory, file.name);
      if (file.isDirectory()) fingerprint(filePath);
      else if (file.name.endsWith(".js")) codeFiles.push([filePath.slice(repoRoot.length), sha256(readFileSync(filePath))]);
    }
  }
  fingerprint(join(repoRoot, "packages/core/dist"));
  const report = { generatedAt: new Date().toISOString(), rendererFingerprint: sha256(JSON.stringify(codeFiles)), options, limitations: ["Frequency counts only complete scanner-discovered environment frames. Command/macro-generated and recovery spans can be missed.", "Frequency is source usage, not rendering support. Package presence alone does not count as use.", "Exact repeated frame source is deduplicated per repository; semantic duplicates and generated variants can remain.", "Inputs are expanded conservatively; conditionals, package definitions and custom build wrappers are not executed.", "Repository diversity here covers eight source collections, not population-wide package popularity."], summary: { entryPoints: decks.length, frames: frames.length, distinctSourceForms: uniqueFrames.length, completeDistinctSourceForms: uniqueFrames.filter(f => f.complete).length, selected: selected.length }, frequency, selected, frames: uniqueFrames, decks };
  if (options.renderSelected) {
    const renders = [];
    for (const frame of selected) {
      const directory = join(options.out, `${frame.deckId}-f${frame.frame}`);
      mkdirSync(join(directory, "assets"), { recursive: true });
      try {
        const loaded = loadCorpusSource(frame.inputPath, true);
        const prepared = coreRenderer.prepareBeamerDocument(loaded.source);
        const graphics = corpusGraphicsResolver(loaded.source, frame.inputPath, join(directory, "assets"));
        const stepCount = prepared.frameStepCount(frame.frame - 1);
        for (const step of [...new Set([1, stepCount])]) {
          const render = await prepared.renderFrame({ frameIndex: frame.frame - 1, step, graphicsResolver: graphics.resolver });
          const svg = join(directory, `step-${step}.svg`);
          writeFileSync(svg, render.svg.svg);
          const expectedGraphics = render.frame.bodySpan && createBeamerSyntaxContext(loaded.source).syntax.controlsIn(render.frame.bodySpan).filter(c => c.name === "includegraphics").length;
          renders.push({ frame, step, stepCount, svg, diagnostics: render.diagnostics, signals: beamerReviewSignals(render, { expectedGraphics, assets: graphics.report() }) });
        }
      } catch (error) { renders.push({ frame, error: error.message }); }
      writeFileSync(join(options.out, "render-review-signals.json"), JSON.stringify(renders, null, 2) + "\n");
    }
    report.summary.renderedSnapshots = renders.filter(render => !render.error).length;
    report.summary.flaggedSnapshots = renders.filter(render => render.signals?.flags.length).length;
  }
  writeFileSync(join(options.out, "shortlist.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(join(options.out, "selected.json"), JSON.stringify(selected, null, 2) + "\n");
  console.log(JSON.stringify({ summary: report.summary, frequency: frequency.map(f => ({ feature: f.id, repositories: f.repositories.length, forms: f.distinctSourceForms })), output: options.out }, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });

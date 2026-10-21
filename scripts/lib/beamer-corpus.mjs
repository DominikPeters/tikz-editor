import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

export function sampleIndices(count, sample = 3) {
  if (sample === "all" || count <= sample) return Array.from({ length: count }, (_, i) => i);
  if (sample === 1) return count ? [0] : [];
  return Array.from({ length: sample }, (_, i) => Math.round(i * (count - 1) / (sample - 1)));
}

export function corpusEntries(indexPath) {
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  // Resolve beside the index, so a downloaded snapshot can be moved to another machine.
  return index.repositories.flatMap((repository) => repository.entry_points.map((path) => ({
    repository: repository.repository,
    commit: repository.commit,
    license: repository.license,
    path,
    root: resolve(dirname(indexPath), repository.directory),
    inputPath: resolve(dirname(indexPath), repository.directory, path),
  })));
}

/** A conservative literal-input adapter, not a TeX macro/conditional interpreter. */
export function loadCorpusSource(inputPath, expandInputs = false) {
  const dependencies = new Map();
  const inputs = [];
  const baseDir = dirname(inputPath);
  let expandedBytes = 0;
  function load(path, stack = []) {
    const canonical = realpathSync(path);
    if (stack.includes(canonical)) throw new Error("input-cycle");
    if (stack.length > 32) throw new Error("input-depth-limit");
    const source = readFileSync(canonical, "utf8");
    expandedBytes += Buffer.byteLength(source);
    if (expandedBytes > 5 * 1024 * 1024) throw new Error("input-size-limit");
    dependencies.set(canonical, sha256(source));
    const replacements = [];
    let depth = 0;
    for (let i = 0; i < source.length;) {
      if (source[i] === "%") { i = lineEnd(source, i); continue; }
      if (source[i] === "{") { depth++; i++; continue; }
      if (source[i] === "}") { depth = Math.max(0, depth - 1); i++; continue; }
      if (source[i] !== "\\") { i++; continue; }
      const from = i;
      const control = /^\\([a-zA-Z@]+|[^\r\n])/u.exec(source.slice(i));
      if (!control) { i++; continue; }
      i += control[0].length;
      const name = control[1];
      if (name === "verb" || name === "Verb") {
        if (source[i] === "*") i++;
        const delimiter = source[i++];
        const end = source.indexOf(delimiter, i);
        i = end < 0 ? lineEnd(source, i) : end + 1;
        continue;
      }
      if (name === "begin") {
        const opaque = /^\s*\{(verbatim\*?|Verbatim|BVerbatim|lstlisting|minted|semiverbatim|alltt)\}/u.exec(source.slice(i));
        if (opaque) {
          const endToken = `\\end{${opaque[1]}}`;
          const end = source.indexOf(endToken, i + opaque[0].length);
          i = end < 0 ? source.length : end + endToken.length;
          continue;
        }
      }
      if (name !== "input" && name !== "include") continue;
      // Do not execute input commands inside macro definitions or arguments.
      if (depth !== 0) continue;
      const argument = /^\s*(?:\{([^{}]*)\}|([^\s%{}]+))/u.exec(source.slice(i));
      const filename = (argument?.[1] ?? argument?.[2] ?? "").trim();
      const record = { fromFile: canonical, filename, status: "not-expanded" };
      inputs.push(record);
      if (!argument || /[\\#$]/u.test(filename) || !filename) {
        record.status = "dynamic-input";
        continue;
      }
      if (!expandInputs || name === "include") continue;
      const candidate = resolve(baseDir, filename);
      const resolved = existsSync(candidate) ? candidate : `${candidate}.tex`;
      if (!existsSync(resolved)) { record.status = "missing-input"; continue; }
      try {
        const replacement = load(resolved, [...stack, canonical]);
        record.status = "expanded";
        record.resolvedPath = resolved;
        // TeX supplies an end-of-line at the input file boundary.
        replacements.push({ from, to: i + argument[0].length, replacement: `${replacement}\n` });
        i += argument[0].length;
      } catch (error) {
        record.status = error.message;
      }
    }
    let expanded = source;
    for (const replacement of replacements.reverse()) {
      expanded = expanded.slice(0, replacement.from) + replacement.replacement + expanded.slice(replacement.to);
    }
    return expanded;
  }
  return { source: load(inputPath), inputs, dependencies: [...dependencies].map(([path, sha256]) => ({ path, sha256 })) };
}

function lineEnd(source, offset) {
  const end = source.indexOf("\n", offset);
  return end < 0 ? source.length : end + 1;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function entryId(entry) {
  const slug = `${entry.repository}-${entry.path}`.replace(/[^a-zA-Z0-9_-]+/gu, "-").slice(0, 90);
  return `${slug}-${sha256(`${entry.repository}/${entry.path}`).slice(0, 10)}`;
}

/** Resolve local graphics through the same core contract as the app. */
export function corpusGraphicsResolver(source, inputPath, assetDir) {
  const baseDir = dirname(inputPath);
  const directories = [baseDir];
  const paths = /\\graphicspath\s*\{((?:\s*\{[^{}]*\}\s*)+)\}/gu;
  for (const match of source.replace(/(?<!\\)%[^\n]*/gu, "").matchAll(paths)) {
    for (const group of match[1].matchAll(/\{([^{}]*)\}/gu)) directories.push(resolve(baseDir, group[1]));
  }
  const assets = new Map();
  const resolver = {
    cacheKey: sha256(inputPath + source),
    resolve(request) {
      const filename = request.filename.trim();
      const page = request.options.page?.pageNumber ?? 1;
      const key = `${filename}\n${page}`;
      if (assets.has(key)) return assets.get(key).resolution;
      const extensions = extname(filename) ? [""] : [".pdf", ".png", ".jpg", ".jpeg", ".svg"];
      const candidates = directories.flatMap((directory) => extensions.map((extension) => resolve(directory, filename + extension)));
      const path = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
      let resolution = { status: "missing" };
      if (/[\\#$]/u.test(filename)) resolution = { status: "unsupported", reason: "dynamic-filename" };
      else if (path) {
        try {
          if (request.options.page?.status === "invalid") throw new Error("invalid-pdf-page");
          const extension = extname(path).toLowerCase();
          const mimeType = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".pdf": "image/png" }[extension];
          if (!mimeType) throw new Error(`unsupported-extension:${extension}`);
          let dataPath = path;
          let width, height;
          const commandOptions = { encoding: "utf8", timeout: 20_000, maxBuffer: 5 * 1024 * 1024 };
          if (extension === ".pdf") {
            const info = execFileSync("pdfinfo", ["-f", String(page), "-l", String(page), path], commandOptions);
            const size = /(?:Page\s+\d+ size|Page size):\s+([\d.]+) x ([\d.]+)/u.exec(info);
            if (!size) throw new Error("missing-pdf-dimensions");
            [width, height] = size.slice(1).map(Number);
            const prefix = join(assetDir, sha256(key + path).slice(0, 24));
            execFileSync("pdftoppm", ["-png", "-singlefile", "-f", String(page), "-l", String(page), "-scale-to", "1600", path, prefix], commandOptions);
            dataPath = `${prefix}.png`;
          } else {
            const bytes = readFileSync(path);
            if (extension === ".svg") {
              [width, height] = svgDimensionsBp(bytes.toString("utf8"));
            } else if (extension === ".png" && bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
              width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
            } else {
              const dimensions = execFileSync("magick", ["identify", "-format", "%w %h", `${path}[0]`], commandOptions).trim();
              [width, height] = dimensions.split(/\s+/u).map(Number);
            }
          }
          if (!(width > 0 && height > 0)) throw new Error("invalid-image-dimensions");
          const bytes = readFileSync(dataPath);
          resolution = {
            status: "resolved", mimeType, dataBase64: bytes.toString("base64"),
            naturalWidthPt: width * 72.27 / 72, naturalHeightPt: height * 72.27 / 72,
            revision: sha256(bytes), resolvedPath: path,
          };
        } catch (error) {
          resolution = { status: "unsupported", reason: error.code === "ENOENT" ? "asset-tool-unavailable" : error.message.slice(0, 500), resolvedPath: path };
        }
      }
      assets.set(key, { filename, page, path, resolution });
      return resolution;
    },
  };
  return {
    resolver,
    report: () => [...assets.values()].map(({ filename, page, path, resolution }) => ({ filename, page, path, status: resolution.status, reason: resolution.reason })),
  };
}

function svgDimensionsBp(source) {
  const tag = /<svg\b[^>]*>/iu.exec(source)?.[0] ?? "";
  const attribute = (name) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "iu").exec(tag)?.slice(1).find((value) => value != null);
  const length = (value) => {
    const match = /^([\d.]+)(pt|bp|px|in|cm|mm|pc)?$/iu.exec(value?.trim() ?? "");
    const factors = { pt: 72 / 72.27, bp: 1, px: 1, in: 72, cm: 72 / 2.54, mm: 72 / 25.4, pc: 12 * 72 / 72.27 };
    return match ? Number(match[1]) * factors[(match[2] ?? "px").toLowerCase()] : NaN;
  };
  const width = length(attribute("width")), height = length(attribute("height"));
  if (width > 0 && height > 0) return [width, height];
  const viewBox = (attribute("viewBox") ?? "").trim().split(/[\s,]+/u).map(Number);
  return viewBox.length === 4 ? viewBox.slice(2) : [NaN, NaN];
}

export function summarizeCorpus(decks) {
  const summary = {
    decks: decks.length, framesDiscovered: 0, pagesAttempted: 0, pagesRendered: 0,
    pagesWithoutDiagnostics: 0, pagesCompared: 0, structuralMatches: 0,
    deckStatuses: {}, pageStatuses: {}, assetStatuses: {}, inputStatuses: {}, repositories: {}, diagnostics: [],
  };
  const diagnosticCounts = new Map();
  for (const deck of decks) {
    increment(summary.deckStatuses, deck.status);
    const repository = summary.repositories[deck.entry.repository] ??= { decks: 0, frames: 0, rendered: 0, compared: 0 };
    repository.decks++;
    repository.frames += deck.frameCount ?? 0;
    summary.framesDiscovered += deck.frameCount ?? 0;
    for (const asset of deck.assets ?? []) increment(summary.assetStatuses, asset.status);
    for (const input of deck.inputs ?? []) increment(summary.inputStatuses, input.status);
    for (const page of deck.pages ?? []) {
      summary.pagesAttempted++;
      increment(summary.pageStatuses, page.status);
      if (page.renderer) {
        summary.pagesRendered++; repository.rendered++;
        if (!page.renderer.diagnostics.length) summary.pagesWithoutDiagnostics++;
        const seen = new Set();
        for (const diagnostic of page.renderer.diagnostics) {
          const key = diagnostic.code ?? diagnostic.message;
          const count = diagnosticCounts.get(key) ?? { code: key, severity: diagnostic.severity, occurrences: 0, pages: 0, example: diagnostic.message };
          count.occurrences++;
          if (!seen.has(key)) count.pages++;
          seen.add(key);
          diagnosticCounts.set(key, count);
        }
      }
      if (page.status === "compared") {
        summary.pagesCompared++; repository.compared++;
        if (page.structuralFailures.length === 0) summary.structuralMatches++;
      }
    }
  }
  summary.diagnostics = [...diagnosticCounts.values()].sort((a, b) => b.pages - a.pages || a.code.localeCompare(b.code));
  return summary;
}

function increment(counts, key) { counts[key] = (counts[key] ?? 0) + 1; }

export function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function corpusGallery(report) {
  const escape = (value) => String(value ?? "").replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const summary = report.summary;
  const rows = report.decks.flatMap((deck) => (deck.pages?.length ? deck.pages : [{ status: deck.status }]).map((page) => {
    const artifact = page.comparisonReport ?? page.svg;
    const preview = page.preview ?? page.svg;
    const error = page.error ?? deck.error;
    return `<tr data-search="${escape(`${deck.entry.repository} ${deck.entry.path} ${page.status} ${JSON.stringify(page.renderer?.diagnostics ?? [])}`.toLowerCase())}"><td>${escape(deck.entry.repository)}<br>${escape(deck.entry.path)}</td><td>${page.frame ?? ""}/${page.step ?? ""}<br>${escape(page.title)}</td><td>${escape(page.status)}${error ? `<pre>${escape(error)}</pre>` : ""}${page.oracleLog ? `<a href="${escape(page.oracleLog)}">TeX log</a>` : ""}</td><td>${page.renderer?.diagnostics.length ?? ""}</td><td>${page.normalizedRmse == null ? "" : page.normalizedRmse.toFixed(5)}${page.structuralFailures ? `<br>${page.structuralFailures.length} structural failures` : ""}</td><td>${artifact ? `<a href="${escape(artifact)}">JSON / SVG</a>` : ""}${preview ? `<a href="${escape(preview)}"><img loading="lazy" src="${escape(preview)}" alt="${escape(page.title)}"></a>` : ""}</td></tr>`;
  })).join("\n");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Beamer corpus renderer report</title>
<style>body{font:15px system-ui;margin:28px;background:#fafafa;color:#222}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px;text-align:left;vertical-align:top}img{display:block;max-width:440px;max-height:200px;margin-top:8px}pre{white-space:pre-wrap;max-width:420px;font-size:11px}input{width:500px;padding:8px;margin:16px 0}th{position:sticky;top:0;background:#eee}</style>
<h1>Beamer corpus renderer report</h1><p>${summary.decks} decks · ${summary.framesDiscovered} discovered frames · ${summary.pagesRendered}/${summary.pagesAttempted} sampled pages rendered · ${summary.pagesCompared} compared with TeX · ${summary.structuralMatches} strict structural matches.</p>
<p>Mode: ${escape(report.options.mode)}. Literal input expansion: ${report.options.expandInputs}. Rendering without diagnostics does not establish visual fidelity. RMSE is normalized to 0–1; lower is closer, but large blank backgrounds can hide missing content. Structural matching covers supported trace primitives, not every paint operation.</p>
<p><a href="report.json">Full report</a> · <a href="summary.md">Summary and diagnostic counts</a></p><input id="filter" aria-label="Filter pages" placeholder="Filter repository, path, status or diagnostic"><table><thead><tr><th>Deck</th><th>Frame / step</th><th>Status</th><th>Diagnostics</th><th>Fidelity</th><th>Artifacts</th></tr></thead><tbody>${rows}</tbody></table>
<script>document.querySelector('#filter').addEventListener('input',e=>{const value=e.target.value.toLowerCase();document.querySelectorAll('tbody tr').forEach(row=>row.hidden=!row.dataset.search.includes(value));});</script></html>`;
}

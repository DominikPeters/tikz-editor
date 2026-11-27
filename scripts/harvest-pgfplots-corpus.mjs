#!/usr/bin/env node
// Harvest a corpus of real-world pgfplots usage from arXiv e-print sources.
//
// Strategy: the arXiv API searches metadata only, so we cannot ask it for
// "papers that use pgfplots". Instead we sample papers from plot-heavy
// categories, stratified by (category, year) over 2015-2026, download each
// paper's e-print source and keep those whose TeX sources contain an actual
// pgfplots axis environment. Counts are later made per distinct paper (see
// scripts/scan-pgfplots-corpus.mjs), as a proxy for distinct authors.
//
// Politeness: generic User-Agent, strictly sequential requests, at least
// --gap-ms (default 3000) between request starts to arxiv.org and
// export.arxiv.org, stops on 403/429/HTML challenge pages, and resumable via
// on-disk state so nothing is fetched twice.
//
// Safety: archives are untrusted. They are never executed or handed to a
// build tool. Tar archives are parsed in-process (no external tar on untrusted
// input): only regular-file members with a text extension we read
// (.tex/.tikz/.pgf/.sty/.cls) are written, each path is checked to stay
// inside artifacts/pgfplots-corpus/src/<id>/, absolute and `..` paths,
// symlinks and hard links are skipped. pgfplots implementation files that
// authors sometimes bundle (pgfplots*.sty, *.code.tex, *.lua,
// tikzlibrarypgfplots*, pgflibrary*) are skipped without being read or
// written, per design/pgfplots.md section 2.
//
// The corpus is for local analysis only and stays under artifacts/ (ignored).
//
// Usage:
//   node scripts/harvest-pgfplots-corpus.mjs [--out-dir artifacts/pgfplots-corpus]
//     [--max-candidates 1500] [--target-hits 250] [--max-minutes 85]
//     [--categories cs.LG,math.NA,...] [--years 2015-2026] [--seed 1]
//     [--gap-ms 3000] [--max-mb 40] [--min-rate 0.02] [--plan-only]

import { execFile } from "node:child_process";
import {
  existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync
} from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";

const execFileP = promisify(execFile);

const USER_AGENT = "pgfplots-usage-survey/0.1";
const API_URL = "https://export.arxiv.org/api/query";
const SRC_URL = "https://arxiv.org/src/"; // target of the /e-print/<id> redirect

const DEFAULT_CATEGORIES = [
  "cs.LG", "math.NA", "math.OC", "stat.ML", "cs.NI", "eess.SP",
  "physics.comp-ph", "cs.DS", "econ.TH", "cs.IT", "eess.SY"
];

const TEXT_EXTENSIONS = /\.(tex|tikz|pgf|sty|cls)$/i;
// pgfplots is GPL: never read or keep its implementation files, even bundled.
const FORBIDDEN_NAME = /^(pgfplots|tikzlibrarypgfplots|pgflibrary)|\.code\.tex$|\.lua$/i;
const AXIS_MARKER = /\\begin\s*\{\s*(axis|semilogxaxis|semilogyaxis|loglogaxis|groupplot|polaraxis|ternaryaxis|smithchart)\s*\}/;
const MAX_MEMBER_BYTES = 5 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 400 * 1024 * 1024;

function parseArgs(argv) {
  const options = {
    outDir: "artifacts/pgfplots-corpus",
    maxCandidates: 1500,
    targetHits: 250,
    maxMinutes: 85,
    categories: DEFAULT_CATEGORIES,
    years: [2015, 2026],
    seed: 1,
    gapMs: 3000,
    maxMb: 40,
    minRate: 0.02,
    minRateAfter: 300,
    planOnly: false
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out-dir") options.outDir = argv[++i];
    else if (arg === "--max-candidates") options.maxCandidates = Number(argv[++i]);
    else if (arg === "--target-hits") options.targetHits = Number(argv[++i]);
    else if (arg === "--max-minutes") options.maxMinutes = Number(argv[++i]);
    else if (arg === "--categories") options.categories = argv[++i].split(",").map((c) => c.trim()).filter(Boolean);
    else if (arg === "--years") options.years = argv[++i].split("-").map(Number);
    else if (arg === "--seed") options.seed = Number(argv[++i]);
    else if (arg === "--gap-ms") options.gapMs = Math.max(3000, Number(argv[++i]));
    else if (arg === "--max-mb") options.maxMb = Number(argv[++i]);
    else if (arg === "--min-rate") options.minRate = Number(argv[++i]);
    else if (arg === "--min-rate-after") options.minRateAfter = Number(argv[++i]);
    else if (arg === "--plan-only") options.planOnly = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

// Small deterministic PRNG (mulberry32) so the sample is reproducible.
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class StopHarvest extends Error {}

let lastRequestAt = 0;
async function politeCurl(url, { outFile, maxBytes, gapMs }) {
  const wait = lastRequestAt + gapMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  const args = [
    "-sS", "-L", "--max-redirs", "3", "-A", USER_AGENT,
    "--connect-timeout", "30", "--max-time", "300",
    "-w", "%{http_code}\t%{content_type}\t%{size_download}"
  ];
  if (maxBytes) args.push("--max-filesize", String(maxBytes));
  args.push("-o", outFile ?? "-", url);
  try {
    const { stdout } = await execFileP("curl", args, { maxBuffer: 64 * 1024 * 1024, encoding: outFile ? "utf8" : "buffer" });
    if (outFile) {
      const [code, type, size] = stdout.split("\t");
      return { code: Number(code), type, size: Number(size) };
    }
    // When writing to stdout, -w output is appended to the body.
    const text = stdout.toString("utf8");
    const match = /(\d{3})\t([^\t]*)\t(\d+)$/.exec(text);
    return { code: Number(match?.[1] ?? 0), type: match?.[2] ?? "", body: text.slice(0, match ? match.index : text.length) };
  } catch (error) {
    // curl exit 63 = --max-filesize exceeded
    if (error.code === 63) return { code: 0, tooLarge: true };
    return { code: 0, error: String(error.stderr ?? error.message).slice(0, 300) };
  }
}

function checkBlocked(result, what) {
  if (result.code === 403 || result.code === 429 || result.code === 503) {
    throw new StopHarvest(`${what}: HTTP ${result.code} from arXiv; stopping (back off before retrying).`);
  }
  if (/text\/html/i.test(result.type ?? "") && result.code === 200) {
    throw new StopHarvest(`${what}: got an HTML page instead of a source archive (possible challenge page); stopping.`);
  }
}

function writeJsonAtomic(path, value) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 1)}\n`);
  renameSync(tmp, path);
}

function pad(n, width = 2) {
  return String(n).padStart(width, "0");
}

function stamp(date) {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}0000`;
}

function parseAtom(xml) {
  const entries = [];
  for (const block of xml.split("<entry>").slice(1)) {
    const id = /<id>https?:\/\/arxiv\.org\/abs\/([^<]+)<\/id>/.exec(block)?.[1];
    if (!id) continue;
    entries.push({
      id: id.replace(/v\d+$/, ""),
      published: /<published>([^<]+)<\/published>/.exec(block)?.[1] ?? null,
      primary: /<arxiv:primary_category[^>]*term="([^"]+)"/.exec(block)?.[1] ?? null,
      title: (/<title>([\s\S]*?)<\/title>/.exec(block)?.[1] ?? "").replace(/\s+/g, " ").trim()
    });
  }
  return entries;
}

async function planCandidates(options, rng, outDir) {
  const path = join(outDir, "candidates.json");
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  const [y0, y1] = options.years;
  const strata = [];
  for (let year = y0; year <= y1; year++) {
    for (const category of options.categories) strata.push({ year, category });
  }
  const perStratum = Math.ceil(options.maxCandidates / strata.length);
  const fetchCount = perStratum + 6; // slack for duplicates via cross-listing
  const byStratum = [];
  const seen = new Set();
  for (const [index, { year, category }] of strata.entries()) {
    // Random 10-day window inside the year (2026: before mid-November).
    const lastDay = year === 2026 ? 318 : 355;
    const start = new Date(Date.UTC(year, 0, 1 + Math.floor(rng() * lastDay)));
    const end = new Date(start.getTime() + 10 * 86_400_000);
    const query = `cat:${category} AND submittedDate:[${stamp(start)} TO ${stamp(end)}]`;
    const url = `${API_URL}?search_query=${encodeURIComponent(query)}&start=0&max_results=${fetchCount}` +
      "&sortBy=submittedDate&sortOrder=ascending";
    const result = await politeCurl(url, { gapMs: options.gapMs });
    checkBlocked({ ...result, type: "" }, `API ${category} ${year}`);
    const entries = result.code === 200 ? parseAtom(result.body) : [];
    const fresh = [];
    for (const entry of entries) {
      if (seen.has(entry.id) || !/^\d{4}\.\d{4,5}$/.test(entry.id)) continue;
      seen.add(entry.id);
      fresh.push({ ...entry, category, year });
      if (fresh.length >= perStratum) break;
    }
    byStratum.push(fresh);
    console.log(`[api ${index + 1}/${strata.length}] ${category} ${year} ${start.toISOString().slice(0, 10)}: ${entries.length} results, ${fresh.length} taken`);
  }
  // Interleave strata round-robin in a shuffled order so an early stop keeps
  // the sample balanced across categories and years.
  const order = byStratum.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const candidates = [];
  for (let round = 0; candidates.length < options.maxCandidates; round++) {
    let any = false;
    for (const i of order) {
      const entry = byStratum[i][round];
      if (!entry) continue;
      any = true;
      candidates.push(entry);
      if (candidates.length >= options.maxCandidates) break;
    }
    if (!any) break;
  }
  writeJsonAtomic(path, candidates);
  return candidates;
}

// --- archive handling -------------------------------------------------------

function safeTarget(baseDir, name) {
  if (!name || name.includes("\0")) return null;
  const cleaned = name.replace(/\\/g, "/");
  if (cleaned.startsWith("/") || /^[A-Za-z]:/.test(cleaned)) return null;
  const parts = cleaned.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.length === 0 || parts.some((part) => part === "..")) return null;
  const target = resolve(baseDir, normalize(parts.join(sep)));
  if (!target.startsWith(baseDir + sep)) return null;
  return target;
}

function tarString(buf, start, length) {
  const slice = buf.subarray(start, start + length);
  const nul = slice.indexOf(0);
  return slice.subarray(0, nul === -1 ? slice.length : nul).toString("utf8");
}

function tarOctal(buf, start, length) {
  const text = tarString(buf, start, length).trim();
  return text ? Number.parseInt(text, 8) : 0;
}

function isTar(buf) {
  return buf.length >= 512 && buf.subarray(257, 262).toString("latin1") === "ustar";
}

// Minimal ustar/GNU/pax reader. Yields regular-file members only.
function* tarMembers(buf) {
  let offset = 0;
  let longName = null;
  let paxPath = null;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = tarOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    let name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const posix = header.subarray(257, 263).toString("latin1") === "ustar\0";
    if (prefix && posix) name = `${prefix}/${name}`;
    const dataStart = offset + 512;
    const data = buf.subarray(dataStart, Math.min(buf.length, dataStart + size));
    offset = dataStart + Math.ceil(size / 512) * 512;
    if (type === "L") { longName = tarString(data, 0, data.length); continue; }
    if (type === "x") {
      const match = /\d+ path=([^\n]*)\n/.exec(data.toString("utf8"));
      paxPath = match ? match[1] : null;
      continue;
    }
    if (type === "g") continue;
    const effectiveName = paxPath ?? longName ?? name;
    longName = null;
    paxPath = null;
    if (type !== "0" && type !== "7") continue; // skip dirs, symlinks, hard links, devices
    yield { name: effectiveName, size, data };
  }
}

function looksLikeTex(buf) {
  const head = buf.subarray(0, 200_000).toString("utf8");
  return /\\(documentclass|documentstyle|begin\s*\{|input|section)/.test(head);
}

// Returns { format, files: [relative paths written], skippedForbidden }.
function unpack(raw, baseDir) {
  let buf = raw;
  let format = "unknown";
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      buf = gunzipSync(buf, { maxOutputLength: MAX_UNPACKED_BYTES });
    } catch (error) {
      return { format: "bad-gzip", files: [], error: String(error.message).slice(0, 200) };
    }
    format = "gzip";
  }
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return { format: "pdf", files: [] };
  if (buf.subarray(0, 4).toString("latin1") === "%!PS") return { format: "ps", files: [] };
  mkdirSync(baseDir, { recursive: true });
  const files = [];
  let skippedForbidden = 0;
  if (isTar(buf)) {
    format = format === "gzip" ? "tar.gz" : "tar";
    for (const member of tarMembers(buf)) {
      const leaf = member.name.split("/").pop() ?? "";
      if (FORBIDDEN_NAME.test(leaf)) { skippedForbidden++; continue; }
      if (!TEXT_EXTENSIONS.test(leaf) || member.size > MAX_MEMBER_BYTES) continue;
      const target = safeTarget(baseDir, member.name);
      if (!target) continue;
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, member.data, { mode: 0o644 });
      files.push(target.slice(baseDir.length + 1));
    }
    return { format, files, skippedForbidden };
  }
  if (looksLikeTex(buf)) {
    writeFileSync(join(baseDir, "main.tex"), buf.subarray(0, MAX_MEMBER_BYTES), { mode: 0o644 });
    return { format: format === "gzip" ? "single-tex.gz" : "single-tex", files: ["main.tex"] };
  }
  return { format: format === "gzip" ? "gzip-other" : "other", files: [] };
}

function stripComments(text) {
  return text.replace(/(^|[^\\])%.*$/gm, "$1");
}

function detectAxes(baseDir, files) {
  let axisFiles = 0;
  let pgfplotsPackage = false;
  for (const rel of files) {
    if (!/\.(tex|tikz|pgf)$/i.test(rel)) continue;
    let text;
    try {
      text = stripComments(readFileSync(join(baseDir, rel), "utf8"));
    } catch {
      continue;
    }
    if (AXIS_MARKER.test(text)) axisFiles++;
    if (/\\usepackage\s*(\[[^\]]*\])?\s*\{[^}]*\bpgfplots\b/.test(text)) pgfplotsPackage = true;
  }
  return { axisFiles, pgfplotsPackage };
}

// --- main -------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv);
  const startedAt = Date.now();
  const outDir = resolve(process.cwd(), options.outDir);
  const rawDir = join(outDir, "raw");
  const srcDir = join(outDir, "src");
  mkdirSync(rawDir, { recursive: true });
  mkdirSync(srcDir, { recursive: true });
  const statePath = join(outDir, "state.json");
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { papers: {}, runs: [] };
  const run = { startedAt: new Date(startedAt).toISOString(), options, stoppedBecause: null };
  state.runs.push(run);

  const rng = makeRng(options.seed);
  let candidates;
  try {
    candidates = await planCandidates(options, rng, outDir);
  } catch (error) {
    if (error instanceof StopHarvest) {
      run.stoppedBecause = error.message;
      writeJsonAtomic(statePath, state);
      console.error(error.message);
      process.exitCode = 2;
      return;
    }
    throw error;
  }
  console.log(`Planned ${candidates.length} candidates.`);
  if (options.planOnly) return;

  const counts = () => {
    const values = Object.values(state.papers);
    return {
      processed: values.length,
      downloaded: values.filter((p) => p.downloaded).length,
      hits: values.filter((p) => p.hit).length
    };
  };
  let consecutiveErrors = 0;

  for (const [index, candidate] of candidates.entries()) {
    const { id } = candidate;
    if (state.papers[id]) continue;
    const now = counts();
    const elapsedMin = (Date.now() - startedAt) / 60_000;
    if (now.hits >= options.targetHits) { run.stoppedBecause = `target of ${options.targetHits} hits reached`; break; }
    if (elapsedMin >= options.maxMinutes) { run.stoppedBecause = `time budget of ${options.maxMinutes} min reached`; break; }
    if (now.downloaded >= options.minRateAfter && now.hits / now.downloaded < options.minRate) {
      run.stoppedBecause = `hit rate ${(now.hits / now.downloaded * 100).toFixed(1)}% below ${options.minRate * 100}% after ${now.downloaded} downloads`;
      break;
    }

    const rawPath = join(rawDir, id);
    const record = { id, category: candidate.category, year: candidate.year, primary: candidate.primary, published: candidate.published };
    if (!existsSync(rawPath)) {
      const result = await politeCurl(SRC_URL + id, { outFile: `${rawPath}.part`, maxBytes: options.maxMb * 1024 * 1024, gapMs: options.gapMs });
      try {
        checkBlocked(result, `e-print ${id}`);
      } catch (error) {
        rmSync(`${rawPath}.part`, { force: true });
        run.stoppedBecause = error.message;
        console.error(error.message);
        process.exitCode = 2;
        break;
      }
      if (result.tooLarge) {
        rmSync(`${rawPath}.part`, { force: true });
        state.papers[id] = { ...record, downloaded: false, status: "too-large" };
        writeJsonAtomic(statePath, state);
        continue;
      }
      if (result.code !== 200) {
        rmSync(`${rawPath}.part`, { force: true });
        consecutiveErrors++;
        state.papers[id] = { ...record, downloaded: false, status: `http-${result.code}`, error: result.error };
        writeJsonAtomic(statePath, state);
        if (consecutiveErrors >= 10) { run.stoppedBecause = "10 consecutive download errors"; break; }
        continue;
      }
      consecutiveErrors = 0;
      renameSync(`${rawPath}.part`, rawPath);
    }

    const baseDir = join(srcDir, id);
    rmSync(baseDir, { recursive: true, force: true }); // fresh directory per paper
    const raw = readFileSync(rawPath);
    const unpacked = unpack(raw, resolve(baseDir));
    const detection = unpacked.files.length ? detectAxes(resolve(baseDir), unpacked.files) : { axisFiles: 0, pgfplotsPackage: false };
    const hit = detection.axisFiles > 0;
    state.papers[id] = {
      ...record,
      downloaded: true,
      bytes: statSync(rawPath).size,
      format: unpacked.format,
      textFiles: unpacked.files.length,
      skippedForbidden: unpacked.skippedForbidden ?? 0,
      pgfplotsPackage: detection.pgfplotsPackage,
      axisFiles: detection.axisFiles,
      hit,
      status: "ok"
    };
    if (!hit) {
      // Misses are fully described by the state record; drop the bulky data.
      rmSync(baseDir, { recursive: true, force: true });
      rmSync(rawPath, { force: true });
    }
    writeJsonAtomic(statePath, state);
    const c = counts();
    const rate = c.downloaded ? (c.hits / c.downloaded * 100).toFixed(1) : "0";
    console.log(
      `[${index + 1}/${candidates.length}] ${id} ${candidate.category} ${candidate.year} ${unpacked.format}` +
      ` ${hit ? `HIT (${detection.axisFiles} files)` : "-"} | hits ${c.hits}/${c.downloaded} (${rate}%) ` +
      `${((Date.now() - startedAt) / 60_000).toFixed(1)} min`
    );
  }
  if (!run.stoppedBecause) run.stoppedBecause = "candidate list exhausted";
  run.finishedAt = new Date().toISOString();
  run.totals = counts();
  writeJsonAtomic(statePath, state);
  console.log(`Stopped: ${run.stoppedBecause}. Totals: ${JSON.stringify(run.totals)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

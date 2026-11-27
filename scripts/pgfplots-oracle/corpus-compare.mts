/**
 * Real-document differential run (design/pgfplots.md 5.7): every corpus
 * snippet whose axes the editor evaluates without unsupported-feature
 * diagnostics is compiled with LuaLaTeX *as is* and compared, primitive by
 * primitive (Tier 2, `mutool trace`), with the editor's rendering of the
 * same source.
 *
 *   node --import tsx scripts/pgfplots-oracle/corpus-compare.mts [--corpus dir] [--only substr[,substr]]
 *        [--png N] [--out dir] [--mutate name] [--list file] [--all]
 *
 * --corpus  directory holding axes/ and src/ (default: artifacts/pgfplots-corpus of
 *           this checkout; a worktree passes the main checkout's absolute path)
 * --only    restrict to snippets whose path (paper/NNN-axis.tex) contains one of the substrings
 * --png N   side-by-side PNGs (editor left, LuaLaTeX right) of the N worst snippets (default 30)
 * --out     output directory (default <corpus>/compare)
 * --mutate  apply a known rendering error to the editor side (mutation check; see MUTATIONS)
 * --all     also compile and compare snippets with unsupported diagnostics (marked unclean)
 *
 * What is injected into the third-party sources: nothing. Every snippet is a
 * standalone document with exactly one tikzpicture (the harvester's format;
 * checked here, others are skipped), so `standalone` already gives one
 * picture per page with border 0. The only environment change is
 * TEXINPUTS, extended *after* the TeX tree's default path with the paper's
 * source directory (and the directory of the file that held the axis), so
 * table files and local style files are found and the installed
 * pgfplots/PGF always win.
 *
 * Alignment: the PDF page origin is the picture's lower-left bounding-box
 * corner (standalone, border 0); our scene has its own origin. The page is
 * translated so that the axis box (clip rectangle or box stroke of the first
 * axis whose size matches ours within 1pt) coincides with ours; when no such
 * rectangle exists, the page's lower-left corner goes to our scene bounds'
 * lower-left corner. The residual reported is the distance between the two
 * candidate translations (axis vs. bbox): it is the bounding-box error plus
 * the page-size rounding of the PDF (3 decimals in bp).
 *
 * Outputs (gitignored, under the corpus directory): compare/results.tsv
 * (ranked), compare/results.json (with the first findings per snippet),
 * compare/summary.txt, compare/png/<paper>-<n>.png, compare/cache/.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { renderObservedSource, type AdaptedPicture } from "./adapter.js";
import { compareTier2, type CompareResult } from "./compare.js";
import { corpusFiles, paperDirectories, snippetMeta, unsupportedFeature, walkTex } from "./corpus-common.js";
import { pagePrimitives, splitMutoolTrace } from "./mutool-trace.js";
import { toolchainFingerprint } from "./run.js";
import type { Box, PathSegment, Point, Tier2, Tier2Primitive } from "./schema.js";
import { CORPUS_MUTATIONS, type CorpusMutation } from "./corpus-mutations.js";

const root = resolve(import.meta.dirname, "..", "..");
const args = process.argv.slice(2);
const opt = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const corpusRoot = resolve(opt("--corpus") ?? join(root, "artifacts", "pgfplots-corpus"));
const axesDir = join(corpusRoot, "axes");
const srcDir = join(corpusRoot, "src");
const outDir = resolve(opt("--out") ?? join(corpusRoot, "compare"));
const only = opt("--only")?.split(",").filter(Boolean) ?? [];
const pngCount = Number(opt("--png") ?? "30");
const mutationName = opt("--mutate");
const includeUnclean = args.includes("--all");
const listFile = opt("--list");
const TEX_TIMEOUT_MS = 180_000;

/** Strict tolerances: path error 0.05pt after alignment (task), glyph origins 0.05pt (harness 0.02 + alignment residual + PDF text positioning). */
const STRICT = { layoutPt: 0.05, curvePt: 0.05, glyphPt: 0.05, colour: 0.002 };
/** "Visibly the same": nothing missing or extra, every matched item within 0.5pt. */
const VISUAL_PT = 0.5;

const mutation: CorpusMutation | undefined = mutationName ? CORPUS_MUTATIONS.find((m) => m.name === mutationName) : undefined;
if (mutationName && !mutation) throw new Error(`unknown mutation ${mutationName}; known: ${CORPUS_MUTATIONS.map((m) => m.name).join(", ")}`);

function sh(command: string, argv: string[], cwd: string, env?: NodeJS.ProcessEnv, timeout = TEX_TIMEOUT_MS) {
  const result = spawnSync(command, argv, { cwd, encoding: "utf8", timeout, killSignal: "SIGKILL", maxBuffer: 512 * 1024 * 1024, env: env ?? process.env });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}

// ---------------------------------------------------------------------------
// TeX side: compile as is, cache by content

type TexResult = { status: "ok"; width: number; height: number; xml: string; pages: number } | { status: "failed"; reason: string };

function texInputs(paper: string, source: string): string {
  // Default tree first (empty component), then the paper's directories.
  return [".", "", ...paperDirectories(srcDir, paper, source)].join(":");
}

function compileTex(id: string, paper: string, source: string): TexResult & { fromCache: boolean } {
  const fp = toolchainFingerprint("lualatex");
  const key = createHash("sha256").update(JSON.stringify({ v: 1, source, inputs: texInputs(paper, source), fp })).digest("hex");
  const cachePath = join(outDir, "cache", key.slice(0, 2), `${key}.json`);
  if (existsSync(cachePath)) {
    try { return { ...(JSON.parse(readFileSync(cachePath, "utf8")) as TexResult), fromCache: true }; } catch { /* recompile */ }
  }
  const work = join(outDir, "work", id);
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, "snippet.tex"), source);
  const env = { ...process.env, TEXINPUTS: texInputs(paper, source) };
  const tex = sh("lualatex", ["-interaction=nonstopmode", "-halt-on-error", "-no-shell-escape", "snippet.tex"], work, env);
  let result: TexResult;
  const pdf = join(work, "snippet.pdf");
  if (tex.error || tex.status !== 0 || !existsSync(pdf)) {
    const log = existsSync(join(work, "snippet.log")) ? readFileSync(join(work, "snippet.log"), "utf8") : tex.stdout;
    const lines = log.split("\n");
    const at = lines.findIndex((l) => l.startsWith("!"));
    const reason = tex.error ? `timeout/error: ${String(tex.error.message).slice(0, 80)}` : at >= 0 ? lines.slice(at, at + 3).join(" ").replace(/\s+/gu, " ").slice(0, 200) : "no pdf";
    result = { status: "failed", reason };
  } else {
    const trace = sh("mutool", ["trace", pdf], work);
    const pages = splitMutoolTrace(trace.stdout);
    const page = pages[0];
    result = page ? { status: "ok", width: page.width, height: page.height, xml: page.xml, pages: pages.length } : { status: "failed", reason: "mutool: no page" };
  }
  mkdirSync(dirname(cachePath), { recursive: true });
  const temporary = `${cachePath}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(result));
  renameSync(temporary, cachePath);
  return { ...result, fromCache: false };
}

/**
 * The corpus harvester dropped comment lines and left them empty; inside an
 * axis option list an empty line is `\par`, which stops TeX ("Paragraph ended
 * before \…@environment@axis was complete"). Such lines are given back a `%`
 * (what they were: comment lines). Both sides see the same text.
 */
export function restoreOptionComments(source: string): { text: string; changed: number } {
  let changed = 0;
  let text = source;
  const begin = /\\begin\{(?:axis|semilogxaxis|semilogyaxis|loglogaxis)\}\s*\[/gu;
  for (let match = begin.exec(text); match; match = begin.exec(text)) {
    const open = match.index + match[0].length;
    let depth = 0; let close = -1;
    for (let j = open; j < text.length; j += 1) {
      const c = text[j];
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === "]" && depth === 0) { close = j; break; }
    }
    if (close < 0) break;
    const inner = text.slice(open, close).replace(/\n[ \t]*(?=\n)/gu, () => { changed += 1; return "\n%"; });
    text = text.slice(0, open) + inner + text.slice(close);
    begin.lastIndex = open + inner.length;
  }
  return { text, changed };
}

// ---------------------------------------------------------------------------
// Geometry helpers

function shiftSegments(segments: PathSegment[], dx: number, dy: number): PathSegment[] {
  return segments.map((s) => s.op === "Z" ? s : s.op === "C" ? { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy, x: s.x + dx, y: s.y + dy } : { ...s, x: s.x + dx, y: s.y + dy });
}
const shiftBox = (b: Box, dx: number, dy: number): Box => ({ minX: b.minX + dx, minY: b.minY + dy, maxX: b.maxX + dx, maxY: b.maxY + dy });

export function translateTier2(tier2: Tier2, dx: number, dy: number): Tier2 {
  const primitives = tier2.primitives.map((p): Tier2Primitive => {
    if (p.type === "path") return { ...p, segments: shiftSegments(p.segments, dx, dy), ...(p.rect ? { rect: shiftBox(p.rect, dx, dy) } : {}), ...(p.clipBox ? { clipBox: shiftBox(p.clipBox, dx, dy) } : {}) };
    if (p.type === "glyphs") return { ...p, glyphs: p.glyphs.map((g) => ({ ...g, x: g.x + dx, y: g.y + dy })), ...(p.clipBox ? { clipBox: shiftBox(p.clipBox, dx, dy) } : {}) };
    return { ...p, bounds: shiftBox(p.bounds, dx, dy) };
  });
  return { ...tier2, primitives };
}

function primitiveBounds(p: Tier2Primitive): Box | undefined {
  if (p.type === "glyphs") {
    if (p.glyphs.length === 0) return undefined;
    const xs = p.glyphs.flatMap((g) => [g.x, g.x + Math.max(0, g.advance)]); const ys = p.glyphs.flatMap((g) => [g.y - 0.3 * p.size, g.y + 0.8 * p.size]);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }
  if (p.type !== "path") return p.bounds;
  const pts = p.segments.flatMap((s) => (s.op === "Z" ? [] : s.op === "C" ? [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }, { x: s.x, y: s.y }] : [{ x: s.x, y: s.y }]));
  if (pts.length === 0) return undefined;
  const w = p.operation === "stroke" ? (p.lineWidth ?? 0) / 2 : 0;
  return { minX: Math.min(...pts.map((q) => q.x)) - w, minY: Math.min(...pts.map((q) => q.y)) - w, maxX: Math.max(...pts.map((q) => q.x)) + w, maxY: Math.max(...pts.map((q) => q.y)) + w };
}

/**
 * Removes clip paths that cut nothing: every primitive painted while the clip
 * is active lies inside its bounding box (0.01pt). pgfplots below compat 1.11
 * wraps grid and tick paths in such clips (5cm beyond the box); they change no
 * pixel. A clip that cuts anything stays and is compared. The remaining clips'
 * intersection is recomputed for every primitive. Applied to both sides.
 */
export function dropInertClips(tier2: Tier2): Tier2 {
  type Entry = { primitive: Tier2Primitive & { type: "path" }; box: Box | undefined; inert: boolean };
  const stack: Entry[] = [];
  const entries: Entry[] = [];
  const active = new Map<Tier2Primitive, Entry[]>();
  for (const p of tier2.primitives) {
    stack.length = Math.min(stack.length, p.clipDepth);
    if (p.type === "path" && p.operation === "clip") {
      const pts = p.segments.flatMap((s) => (s.op === "Z" ? [] : s.op === "C" ? [{ x: s.x, y: s.y }, { x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }] : [{ x: s.x, y: s.y }]));
      const box = pts.length > 0 ? { minX: Math.min(...pts.map((q) => q.x)), minY: Math.min(...pts.map((q) => q.y)), maxX: Math.max(...pts.map((q) => q.x)), maxY: Math.max(...pts.map((q) => q.y)) } : undefined;
      const entry: Entry = { primitive: p, box, inert: !!box && !!rectangleLike(p.segments) };
      active.set(p, [...stack]);
      stack.push(entry); entries.push(entry);
      continue;
    }
    active.set(p, [...stack]);
    const b = primitiveBounds(p);
    for (const e of stack) {
      if (!e.inert) continue;
      if (!b || !e.box || b.minX < e.box.minX - 0.01 || b.minY < e.box.minY - 0.01 || b.maxX > e.box.maxX + 0.01 || b.maxY > e.box.maxY + 0.01) e.inert = false;
    }
  }
  const inert = new Set(entries.filter((e) => e.inert).map((e) => e.primitive as Tier2Primitive));
  if (inert.size === 0) return tier2;
  const primitives: Tier2Primitive[] = [];
  for (const p of tier2.primitives) {
    if (inert.has(p)) continue;
    const kept = (active.get(p) ?? []).filter((e) => !e.inert);
    const clipBox = kept.reduce<Box | undefined>((acc, e) => (!e.box ? acc : !acc ? e.box : { minX: Math.max(acc.minX, e.box.minX), minY: Math.max(acc.minY, e.box.minY), maxX: Math.min(acc.maxX, e.box.maxX), maxY: Math.min(acc.maxY, e.box.maxY) }), undefined);
    const copy = { ...p, clipDepth: kept.length } as Tier2Primitive & { clipBox?: Box };
    if (p.type !== "image" && p.type !== "shading") { if (clipBox) copy.clipBox = clipBox; else delete copy.clipBox; }
    primitives.push(copy);
  }
  return { ...tier2, primitives };
}

/** Axis-aligned rectangle (closed or not) given by its four corners. */
function rectangleLike(segments: PathSegment[]): boolean {
  const pts = segments.filter((s) => s.op !== "Z").map((s) => (s.op === "C" ? null : { x: s.x, y: s.y }));
  if (pts.some((q) => q === null) || pts.length < 4 || pts.length > 5) return false;
  const q = pts as Point[];
  for (let i = 0; i < 4; i += 1) {
    const a = q[i]; const b = q[(i + 1) % 4];
    if (!a || !b || (Math.abs(a.x - b.x) > 1e-6 && Math.abs(a.y - b.y) > 1e-6)) return false;
  }
  return true;
}

type Alignment = { method: "axis-clip" | "axis-box" | "bbox"; dx: number; dy: number; residual: number };

/** Translation taking the page frame (lower-left page corner = 0,0) onto our scene. */
function align(texPrims: Tier2Primitive[], picture: AdaptedPicture): Alignment {
  const sceneMin = { x: picture.tier1.boundingBox?.minX ?? 0, y: picture.tier1.boundingBox?.minY ?? 0 };
  const bbox = { dx: sceneMin.x, dy: sceneMin.y };
  for (const axis of picture.tier1.axes) {
    const r = axis.rect;
    if (!r) continue;
    const ll: Point = { x: Math.min(r.r00.x, r.r11.x), y: Math.min(r.r00.y, r.r11.y) };
    const w = Math.abs(r.r11.x - r.r00.x); const h = Math.abs(r.r11.y - r.r00.y);
    let best: { method: "axis-clip" | "axis-box"; dx: number; dy: number; cost: number } | undefined;
    for (const p of texPrims) {
      if (p.type !== "path" || !p.rect || (p.operation !== "clip" && p.operation !== "stroke")) continue;
      const pw = p.rect.maxX - p.rect.minX; const ph = p.rect.maxY - p.rect.minY;
      if (Math.abs(pw - w) > 1 || Math.abs(ph - h) > 1) continue;
      const dx = ll.x - p.rect.minX; const dy = ll.y - p.rect.minY;
      // Prefer the rectangle the bounding-box alignment also puts there; clips over strokes.
      const cost = Math.hypot(dx - bbox.dx, dy - bbox.dy) + Math.abs(pw - w) + Math.abs(ph - h) + (p.operation === "clip" ? 0 : 0.001);
      if (!best || cost < best.cost) best = { method: p.operation === "clip" ? "axis-clip" : "axis-box", dx, dy, cost };
    }
    if (best && Math.hypot(best.dx - bbox.dx, best.dy - bbox.dy) < 30) return { method: best.method, dx: best.dx, dy: best.dy, residual: Math.hypot(best.dx - bbox.dx, best.dy - bbox.dy) };
  }
  return { method: "bbox", ...bbox, residual: NaN };
}

// ---------------------------------------------------------------------------
// Per-snippet run

type Row = {
  id: string; paper: string; compat: string; status: string; reason?: string;
  align?: Alignment;
  pathMissing: number; pathExtra: number; pathGeometry: number; glyphMissing: number; glyphExtra: number; glyphPosition: number; glyphFont: number;
  paint: number; stroke: number; clip: number; paintOrder: number;
  maxPath: number; maxGlyph: number; strict: boolean; visual: boolean; diagnostics: string[];
  findings?: Array<{ code: string; where: string; message: string }>;
  pageSize?: { tex: { w: number; h: number }; editor: { w: number; h: number } };
};

function count(result: CompareResult, ...codes: string[]): number { return result.findings.filter((f) => codes.includes(f.code)).length; }

function summarise(id: string, paper: string, compat: string, picture: AdaptedPicture, alignment: Alignment, result: CompareResult, tex: { width: number; height: number }): Row {
  const maxPath = Math.max(0, result.stats.maxDelta["path-straight"] ?? 0, result.stats.maxDelta["path-curve"] ?? 0);
  const maxGlyph = Math.max(0, result.stats.maxDelta.glyph ?? 0);
  const row: Row = {
    id, paper, compat, status: "compared", align: alignment,
    pathMissing: count(result, "path-missing"), pathExtra: count(result, "path-extra"), pathGeometry: count(result, "path-geometry"),
    glyphMissing: count(result, "glyph-missing"), glyphExtra: count(result, "glyph-extra"), glyphPosition: count(result, "glyph-position"), glyphFont: count(result, "glyph-font", "glyph-size"),
    paint: count(result, "paint"), stroke: count(result, "line-width", "dash", "line-cap", "line-join"), clip: count(result, "clip"), paintOrder: count(result, "paint-order"),
    maxPath, maxGlyph, strict: result.pass, visual: false,
    diagnostics: picture.diagnostics.map((d) => d.code ?? d.message.slice(0, 60)),
    findings: result.findings.slice(0, 40).map((f) => ({ code: f.code, where: f.where, message: f.message })),
    pageSize: { tex: { w: tex.width, h: tex.height }, editor: { w: (picture.tier1.boundingBox?.maxX ?? 0) - (picture.tier1.boundingBox?.minX ?? 0), h: (picture.tier1.boundingBox?.maxY ?? 0) - (picture.tier1.boundingBox?.minY ?? 0) } }
  };
  row.visual = row.pathMissing + row.pathExtra + row.glyphMissing + row.glyphExtra === 0 && maxPath <= VISUAL_PT && maxGlyph <= VISUAL_PT && row.paint === 0 && row.stroke === 0;
  return row;
}

function emptyRow(id: string, paper: string, compat: string, status: string, reason?: string, diagnostics: string[] = []): Row {
  return { id, paper, compat, status, ...(reason ? { reason } : {}), pathMissing: 0, pathExtra: 0, pathGeometry: 0, glyphMissing: 0, glyphExtra: 0, glyphPosition: 0, glyphFont: 0, paint: 0, stroke: 0, clip: 0, paintOrder: 0, maxPath: 0, maxGlyph: 0, strict: false, visual: false, diagnostics };
}

const severity = (r: Row) => (r.status !== "compared" ? -1 : (r.visual ? 0 : 1000) + r.pathMissing + r.pathExtra + r.glyphMissing + r.glyphExtra + r.paint + r.stroke + Math.min(100, r.maxPath) + Math.min(10, r.maxGlyph));

const files = (listFile ? readFileSync(listFile, "utf8").split("\n").filter(Boolean).map((f) => join(axesDir, f)) : walkTex(axesDir).sort())
  .filter((f) => only.length === 0 || only.some((o) => f.slice(axesDir.length + 1).includes(o)));
mkdirSync(outDir, { recursive: true });
const rows: Row[] = [];
const pictures = new Map<string, { svg: string; work: string }>();
let compiled = 0;
let restoredSnippets = 0;
const started = Date.now();
for (const file of files) {
  const id = file.slice(axesDir.length + 1).replace(/\.tex$/u, "");
  const paper = id.split("/")[0] ?? id;
  const restored = restoreOptionComments(readFileSync(file, "utf8"));
  const source = restored.text;
  if (restored.changed > 0) restoredSnippets += 1;
  const meta = snippetMeta(source);
  const compat = (meta.compat ?? []).join("+") || "none";
  const axisCount = (source.match(/\\begin\{(?:axis|semilogxaxis|semilogyaxis|loglogaxis)\}/gu) ?? []).length;
  if (axisCount === 0) { rows.push(emptyRow(id, paper, compat, "no-axis-env")); continue; }
  if ((source.match(/\\begin\{tikzpicture\}/gu) ?? []).length !== 1 || !/\\documentclass(\[[^\]]*\])?\{standalone\}/u.test(source)) { rows.push(emptyRow(id, paper, compat, "not-one-picture")); continue; }
  let picture: AdaptedPicture;
  let effective = true;
  try {
    picture = await renderObservedSource(source, { graphicsResolver: corpusFiles(srcDir, paper, source) });
    if (mutation) {
      if (!mutation.applies(source, picture)) { rows.push(emptyRow(id, paper, compat, "mutation-n/a")); continue; }
      const base = picture;
      if (mutation.source) picture = await renderObservedSource(mutation.source(source, base), { graphicsResolver: corpusFiles(srcDir, paper, source) });
      const mutatedTier2 = mutation.tier2 ? mutation.tier2(picture) : picture.tier2;
      picture = { ...picture, tier2: mutatedTier2 };
      effective = !compareTier2(base.tier2, { ...mutatedTier2, textBoxes: [] }, { tolerances: STRICT, textBoxes: false }).pass;
    }
  } catch (error) {
    rows.push(emptyRow(id, paper, compat, "editor-threw", String(error).slice(0, 160)));
    continue;
  }
  const unsupported = picture.diagnostics.map((d) => unsupportedFeature(d.code, d.message)).filter((f): f is string => f !== null);
  const clean = unsupported.length === 0 && picture.axes.length === axisCount;
  if (!clean && (!includeUnclean || mutation)) { rows.push(emptyRow(id, paper, compat, "editor-unsupported", [...new Set(unsupported)].join("; ").slice(0, 200), picture.diagnostics.map((d) => d.code ?? ""))); continue; }
  const tex = compileTex(id.replace("/", "-"), paper, source);
  if (!tex.fromCache) compiled += 1;
  if (tex.status !== "ok") { rows.push(emptyRow(id, paper, compat, "tex-failed", tex.reason)); continue; }
  if (tex.pages !== 1) { rows.push(emptyRow(id, paper, compat, "tex-pages", `${tex.pages} pages`)); continue; }
  const texPrims = pagePrimitives({ number: 1, width: tex.width, height: tex.height, xml: tex.xml }, { minX: 0, maxY: tex.height });
  const alignment = align(texPrims, picture);
  const expected: Tier2 = dropInertClips(translateTier2({ page: { width: tex.width, height: tex.height }, primitives: texPrims, textBoxes: [] }, alignment.dx, alignment.dy));
  const result = compareTier2(expected, dropInertClips({ ...picture.tier2, textBoxes: [] }), { tolerances: STRICT, textBoxes: false });
  const row = summarise(id, paper, compat, picture, alignment, result, tex);
  if (!clean) { row.status = "compared-unclean"; row.reason = [...new Set(unsupported)].join("; ").slice(0, 200); }
  if (mutation && !effective) { row.status = "mutation-ineffective"; }
  rows.push(row);
  pictures.set(id, { svg: picture.svg, work: join(outDir, "work", id.replace("/", "-")) });
  if (rows.length % 25 === 0) console.log(`${rows.length}/${files.length} (${compiled} compiled, ${((Date.now() - started) / 1000).toFixed(0)}s)`);
}

// ---------------------------------------------------------------------------
// Report

const compared = rows.filter((r) => r.status === "compared");
const ranked = [...rows].sort((a, b) => severity(b) - severity(a));
const header = ["snippet", "paper", "compat", "status", "strict", "visual", "align", "residual", "missing", "extra", "geom>0.05", "glyph-miss", "glyph-extra", "glyph-pos", "glyph-font", "paint", "stroke", "clip", "order", "max-path", "max-glyph", "reason/diagnostics"];
const tsv = [header.join("\t"), ...ranked.map((r) => [
  r.id, r.paper, r.compat, r.status, r.strict ? "yes" : "no", r.visual ? "yes" : "no", r.align?.method ?? "", r.align ? (Number.isNaN(r.align.residual) ? "-" : r.align.residual.toFixed(4)) : "",
  r.pathMissing, r.pathExtra, r.pathGeometry, r.glyphMissing, r.glyphExtra, r.glyphPosition, r.glyphFont, r.paint, r.stroke, r.clip, r.paintOrder,
  r.maxPath.toFixed(4), r.maxGlyph.toFixed(4), r.reason ?? r.diagnostics.join(",")
].join("\t"))].join("\n");
const suffix = mutation ? `-${mutation.name}` : "";
writeFileSync(join(outDir, `results${suffix}.tsv`), `${tsv}\n`);
writeFileSync(join(outDir, `results${suffix}.json`), JSON.stringify(ranked, null, 1));

const byStatus = new Map<string, number>();
for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
const papers = (list: Row[]) => new Set(list.map((r) => r.paper)).size;
const residuals = compared.map((r) => r.align?.residual ?? NaN).filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
const pct = (q: number) => residuals[Math.min(residuals.length - 1, Math.floor(q * residuals.length))]?.toFixed(4) ?? "-";
const lines: string[] = [];
lines.push(`snippets ${rows.length}; ${[...byStatus].map(([k, v]) => `${k} ${v}`).join(", ")}`);
lines.push(`snippets with empty lines in axis options given back their \`%\`: ${restoredSnippets}`);
lines.push(`compared ${compared.length} (papers ${papers(compared)}): strict match ${compared.filter((r) => r.strict).length} (papers ${papers(compared.filter((r) => r.strict))}), visual match ${compared.filter((r) => r.visual).length}`);
lines.push(`alignment: ${["axis-clip", "axis-box", "bbox"].map((m) => `${m} ${compared.filter((r) => r.align?.method === m).length}`).join(", ")}; residual (axis vs bbox) median ${pct(0.5)}, p90 ${pct(0.9)}, max ${pct(1)}`);
lines.push("", "by paper: compared / strict / visual / compat");
const paperIds = [...new Set(rows.map((r) => r.paper))].sort();
for (const p of paperIds) {
  const c = compared.filter((r) => r.paper === p);
  const all = rows.filter((r) => r.paper === p);
  lines.push(`  ${p.padEnd(12)} ${String(c.length).padStart(3)} / ${String(c.filter((r) => r.strict).length).padStart(3)} / ${String(c.filter((r) => r.visual).length).padStart(3)}   ${all[0]?.compat ?? ""}   (of ${all.length}; ${[...new Set(all.map((r) => r.status))].join(",")})`);
}
const summary = lines.join("\n");
writeFileSync(join(outDir, `summary${suffix}.txt`), `${summary}\n`);
console.log(summary);

// Side-by-side PNGs of the worst snippets.
if (pngCount > 0 && !mutation) {
  const pngDir = join(outDir, "png");
  mkdirSync(pngDir, { recursive: true });
  const worst = ranked.filter((r) => r.status === "compared" && !r.strict).slice(0, pngCount);
  for (const r of worst) {
    const pic = pictures.get(r.id);
    if (!pic || !existsSync(join(pic.work, "snippet.pdf"))) continue;
    const name = r.id.replace("/", "-");
    const DPI = 200;
    writeFileSync(join(pngDir, `${name}-editor.svg`), pic.svg);
    const a = sh("rsvg-convert", ["-d", String(DPI), "-p", String(DPI), "-z", String(DPI / 72), "-b", "white", "-o", `${name}-editor.png`, `${name}-editor.svg`], pngDir);
    const b = sh("mutool", ["draw", "-q", "-r", String(DPI), "-o", join(pngDir, `${name}-tex.png`), join(pic.work, "snippet.pdf")], pngDir);
    if (a.status !== 0 || b.status !== 0) continue;
    sh("convert", [`${name}-editor.png`, `${name}-tex.png`, "-bordercolor", "white", "-border", "10", "+append", "-background", "white", "-gravity", "north", "-splice", "0x30", "-pointsize", "20", "-annotate", "+0+2", `${r.id}: editor (left) | LuaLaTeX (right)  missing ${r.pathMissing} extra ${r.pathExtra} glyph ${r.glyphMissing}/${r.glyphExtra} maxpath ${r.maxPath.toFixed(2)}`, `${name}.png`], pngDir);
  }
  console.log(`wrote ${worst.length} side-by-side PNGs to ${pngDir}`);
}
void basename;

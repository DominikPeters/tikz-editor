/**
 * Shared machinery for pgfplots behaviour experiments (design/pgfplots.md 5.3).
 *
 * Reuses the oracle harness unchanged: `runOracleCases` for batching and the
 * content-addressed cache, `buildBatchDocument`'s probes for Tier 1, and the
 * mutool Tier 2 trace. Adds one thing through the harness' `extraPreamble`
 * hook: a custom record macro `\xrec{key=value}` usable in a case body. It
 * writes `X|key=value` lines into the probe file; the lines are cached with
 * the case's raw records and read back here from the cache entry.
 *
 * Licence rule (design/pgfplots.md section 2): experiments only read values of
 * documented keys (`\pgfkeysvalueof{/pgfplots/<documented key>}`), documented
 * macros and lengths, and measure output. Never probe pgfplots internals.
 *
 * Upstream candidates for the harness: the `\xrec` hook (generic custom
 * records) and returning raw records from `runOracleCases`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "../fixtures.js";
import { caseCacheKey, runOracleCases } from "../run.js";
import type { OracleAxis, PathPrimitive, Tier2, GlyphRun, Box, Point } from "../schema.js";
import type { BatchCase, CaseVariant, ProbeKind } from "../tex-source.js";

export const EXP_DIR = join(REPO_ROOT, "artifacts", "pgfplots-experiments");
export const EXP_CACHE = join(EXP_DIR, "cache");

/** `\xrec{key=value}`: custom record, fully expanded at write time. */
export const XREC_PREAMBLE = String.raw`\makeatletter
\def\xrec#1{\pgfplotsoracle@rec{X|#1}}
% \xpt{name}: canvas position of a named coordinate/node centre (after the axis).
\def\xpt#1{\pgfplotsoracle@anchor{xpt}{#1}{center}}
% \xanchor{name}{anchor}
\def\xanchor#1#2{\pgfplotsoracle@anchor{xpt}{#1}{#2}}
% Harness workaround: the tick-scale label (scaled ticks factor) is typeset
% with the tick label style but without \ticknum, so the harness' name=...\ticknum
% fails. Outside tick labels \ticknum expands to "S": the scale label node is
% then named pgfplotsoracle-<case>-a1-xS / -yS (read with \xanchor).
\def\ticknum{S}
\makeatother`;

export interface ExpCase { id: string; body: string; meta?: Record<string, unknown> }

export interface ExpResult {
  id: string;
  meta: Record<string, unknown>;
  axis?: OracleAxis;
  axes: OracleAxis[];
  bbox?: Box;
  tier2: Tier2;
  /** Custom `\xrec` records, in order. */
  x: [string, string][];
  /** First value of each custom key. */
  xv: Record<string, string>;
  /** Points read with \\xpt / \\xanchor: key "name" (center) or "name|anchor". */
  pts: Record<string, Point>;
  /** All raw probe records of the case. */
  records: string[][];
}

export interface ExpOptions {
  probes?: readonly ProbeKind[];
  trace?: boolean;
  extraPreamble?: string;
  batchSize?: number;
  quiet?: boolean;
}

/** Cases that failed in the last runExperiment call (TeX error), with the first error line. */
export let lastFailures: { id: string; meta: Record<string, unknown>; error: string }[] = [];

const ALL_PROBES: readonly ProbeKind[] = ["limits", "map", "axisAnchors", "ticks", "descriptions", "pictureBox"];

/** Run cases (batched, cached) and return per-case results. One TeX process at a time. */
export function runExperiment(name: string, cases: readonly ExpCase[], options: ExpOptions = {}): ExpResult[] {
  // pictureBox is always on: Tier 2 needs the picture bounding box to convert page coordinates.
  const probes = options.probes ? [...new Set<ProbeKind>([...options.probes, "pictureBox"])] : ALL_PROBES;
  const variant: CaseVariant = { probes, textboxTrace: options.trace ?? false };
  const extraPreamble = `${XREC_PREAMBLE}\n${options.extraPreamble ?? ""}`;
  const batchSize = options.batchSize ?? 150;
  const out: ExpResult[] = [];
  const failed: { id: string; meta: Record<string, unknown>; error: string }[] = [];
  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.id)) throw new Error(`duplicate case id ${c.id}`);
    seen.add(c.id);
  }
  const runBatch = (chunk: readonly ExpCase[], label: string): void => {
    const batch: BatchCase[] = chunk.map((c) => ({ id: c.id, body: c.body, variant }));
    let report;
    try {
      report = runOracleCases(batch, { engine: "lualatex", cacheDir: EXP_CACHE, workDir: join(EXP_DIR, "work", name), extraPreamble });
    } catch (error) {
      // Bisect a failing batch down to the failing case(s); those are reported, not fatal.
      if (chunk.length === 1) {
        const message = String((error as Error).message).split("\n").find((l) => l.startsWith("!")) ?? String((error as Error).message).slice(0, 200);
        if (!options.quiet) console.error(`[${name}] case ${chunk[0]!.id} failed: ${message}`);
        failed.push({ id: chunk[0]!.id, meta: chunk[0]!.meta ?? {}, error: message });
        return;
      }
      const mid = Math.ceil(chunk.length / 2);
      runBatch(chunk.slice(0, mid), `${label}a`);
      runBatch(chunk.slice(mid), `${label}b`);
      return;
    }
    if (!options.quiet && report.compiledCases > 0) {
      console.error(`[${name}] batch ${label} (${chunk.length}): ${report.compiledCases} compiled, ${report.cachedCases} cached, TeX ${report.texSeconds.toFixed(1)}s`);
    }
    for (const entry of batch) {
      const r = report.results.get(entry.id);
      if (!r) throw new Error(`no result for ${entry.id}`);
      const key = caseCacheKey(entry, "lualatex", extraPreamble);
      const path = join(EXP_CACHE, key.slice(0, 2), `${key}.json`);
      const raw = JSON.parse(readFileSync(path, "utf8")) as { value: { records: { fields: string[] }[] } };
      const x: [string, string][] = raw.value.records
        .filter((rec) => rec.fields[0] === "X")
        .map((rec) => {
          const s = rec.fields.slice(1).join("|");
          const eq = s.indexOf("=");
          return [s.slice(0, eq), s.slice(eq + 1)];
        });
      const xv: Record<string, string> = {};
      for (const [k, v] of x) if (!(k in xv)) xv[k] = v;
      const pts: Record<string, Point> = {};
      for (const rec of raw.value.records) {
        const f = rec.fields;
        if (f[0] === "A" && f[1] === "xpt") pts[f[3] === "center" ? f[2]! : `${f[2]}|${f[3]}`] = { x: Number.parseFloat(f[4]!), y: Number.parseFloat(f[5]!) };
      }
      const meta = chunk.find((c) => c.id === entry.id)?.meta ?? {};
      out.push({ id: entry.id, meta, axis: r.tier1.axes[0], axes: r.tier1.axes, ...(r.tier1.boundingBox ? { bbox: r.tier1.boundingBox } : {}), tier2: r.tier2, x, xv, pts, records: raw.value.records.map((rec) => rec.fields) });
    }
  };
  for (let start = 0; start < cases.length; start += batchSize) runBatch(cases.slice(start, start + batchSize), String(start));
  const order = new Map(cases.map((c, i) => [c.id, i]));
  out.sort((p, q) => (order.get(p.id) ?? 0) - (order.get(q.id) ?? 0));
  lastFailures = failed;
  return out;
}

/** A one-axis picture body. `plots` and `extra` go inside the axis. */
export function axisBody(options: string, plots: string, extra = "", before = ""): string {
  return `\\begin{tikzpicture}${before}\n\\begin{axis}[${options}]\n${plots}\n${extra}\n\\end{axis}\n\\end{tikzpicture}`;
}

export function saveTable(name: string, file: string, rows: Record<string, unknown>[]): string {
  const dir = join(EXP_DIR, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, file);
  if (file.endsWith(".json")) writeFileSync(path, `${JSON.stringify(rows, null, 1)}\n`);
  else {
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const cell = (v: unknown) => (typeof v === "number" ? String(Number(v.toPrecision(10))) : Array.isArray(v) ? v.join(" ") : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? ""));
    writeFileSync(path, `${cols.join("\t")}\n${rows.map((r) => cols.map((c) => cell(r[c])).join("\t")).join("\n")}\n`);
  }
  return path;
}

export function saveText(name: string, file: string, text: string): string {
  const dir = join(EXP_DIR, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, file);
  writeFileSync(path, text);
  return path;
}

export function ensureDir(name: string): string {
  const dir = join(EXP_DIR, name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Axis rectangle from `rel axis cs` corners. */
export function rectOf(axis: OracleAxis | undefined): { x0: number; y0: number; rw: number; rh: number } | undefined {
  if (!axis?.rect) return undefined;
  const { r00, r10, r01 } = axis.rect;
  return { x0: r00.x, y0: r00.y, rw: r10.x - r00.x, rh: r01.y - r00.y };
}

export function tickValues(axis: OracleAxis | undefined, letter: "x" | "y"): number[] {
  return (axis?.ticks?.[letter] ?? []).map((t) => t.value);
}

export function tickLabels(axis: OracleAxis | undefined, letter: "x" | "y"): string[] {
  return (axis?.ticks?.[letter] ?? []).map((t) => t.label?.text ?? "");
}

export function strokes(t2: Tier2): PathPrimitive[] {
  return t2.primitives.filter((p): p is PathPrimitive => p.type === "path" && p.operation === "stroke");
}

export function glyphRuns(t2: Tier2): GlyphRun[] {
  return t2.primitives.filter((p): p is GlyphRun => p.type === "glyphs");
}

/** Split a path into subpaths of points (M/L only; curves contribute their endpoint). */
export function subpaths(p: PathPrimitive): Point[][] {
  const out: Point[][] = [];
  let cur: Point[] = [];
  for (const s of p.segments) {
    if (s.op === "M") { if (cur.length) out.push(cur); cur = [{ x: s.x, y: s.y }]; }
    else if (s.op === "L" || s.op === "C") cur.push({ x: s.x, y: s.y });
    else if (s.op === "Z") { if (cur[0]) cur.push(cur[0]); }
  }
  if (cur.length) out.push(cur);
  return out;
}

export const r5 = (v: number) => Math.round(v * 1e5) / 1e5;

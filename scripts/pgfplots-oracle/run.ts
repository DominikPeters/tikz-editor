/**
 * Batched, cached oracle runs: N cases -> one TeX run -> per-case Tier 1/2.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";

import { assembleTier1, assembleTier2, parseProbeRecords, parseTextBoxTrace, versionsFrom, type CasePageSize, type ProbeRecord, type RawTextBoxPage } from "./assemble.js";
import { splitMutoolTrace, type MutoolPage } from "./mutool-trace.js";
import { PGFPLOTS_ORACLE_HARNESS_VERSION, type OracleToolchain, type Tier1, type Tier2 } from "./schema.js";
import { buildBatchDocument, pgfplotsOracleLuaSource, type BatchCase, type OracleEngine } from "./tex-source.js";

const TOOL_TIMEOUT_MS = Number(process.env.TIKZ_ORACLE_TOOL_TIMEOUT_MS ?? 300_000);

function run(command: string, args: string[], cwd?: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: TOOL_TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: 256 * 1024 * 1024 });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function firstLine(text: string): string {
  return text.split(/\r?\n/u).map((l) => l.trim()).find(Boolean) ?? "unknown";
}

export interface ToolchainFingerprint {
  engine: OracleEngine;
  engineVersion: string;
  mutoolVersion: string;
  /** kpsewhich-resolved paths with size and mtime (stat only; contents are never read). */
  packages: Record<string, string>;
}

const fingerprintCache = new Map<OracleEngine, ToolchainFingerprint>();

export function toolchainFingerprint(engine: OracleEngine): ToolchainFingerprint {
  const cached = fingerprintCache.get(engine);
  if (cached) return cached;
  const engineVersion = firstLine(run(engine, ["--version"]).stdout);
  const mutool = run("mutool", ["-v"]);
  const mutoolVersion = firstLine(`${mutool.stderr}\n${mutool.stdout}`);
  const packages: Record<string, string> = {};
  for (const name of ["pgfplots.sty", "pgf.sty", "tikz.sty", "pgfsys-luatex.def", "pgfsys-pdftex.def"]) {
    const path = firstLine(run("kpsewhich", [name]).stdout);
    try {
      const stat = statSync(path);
      packages[name] = `${path}|${stat.size}|${stat.mtimeMs}`;
    } catch {
      packages[name] = "missing";
    }
  }
  const fingerprint = { engine, engineVersion, mutoolVersion, packages };
  fingerprintCache.set(engine, fingerprint);
  return fingerprint;
}

export interface CaseResult {
  id: string;
  tier1: Tier1;
  tier2: Tier2;
  page?: CasePageSize;
  toolchain: OracleToolchain;
  /** Text-box walk health (LuaLaTeX only). */
  textBoxTrace?: { unreadableLiterals: number; openScopes: number };
  /** Raw mutool trace of the page, kept for exact disturbance comparison. */
  mutoolXml: string;
  fromCache: boolean;
}

export interface RunOptions {
  engine: OracleEngine;
  /** Cache directory (default artifacts/pgfplots-oracle/cache). `null` disables caching. */
  cacheDir: string | null;
  /** Directory for the batch's TeX work files. */
  workDir: string;
  /** Extra preamble lines (part of the cache key). */
  extraPreamble?: string;
}

export interface RunReport { results: Map<string, CaseResult>; compiledCases: number; cachedCases: number; texSeconds: number; mutoolSeconds: number; totalSeconds: number }

export function caseCacheKey(entry: BatchCase, engine: OracleEngine, extraPreamble = ""): string {
  // The case rendered as its own one-page document captures every TeX-side
  // input: preamble, instrumentation macros, injected hooks, flags and body.
  const material = JSON.stringify({
    harness: PGFPLOTS_ORACLE_HARNESS_VERSION,
    document: buildBatchDocument([entry], engine, extraPreamble),
    lua: pgfplotsOracleLuaSource(),
    toolchain: toolchainFingerprint(engine),
  });
  return createHash("sha256").update(material).digest("hex");
}

function cachePath(dir: string, key: string): string {
  return join(dir, key.slice(0, 2), `${key}.json`);
}

/**
 * What the cache stores: the raw TeX/mutool outputs of one case. Assembly
 * into Tier 1/2 is re-run on every read, so parser fixes never need a cache
 * flush; only TeX-side changes (harness version, preamble, Lua, toolchain)
 * change the key.
 */
interface RawCase {
  records: ProbeRecord[];
  page: MutoolPage;
  boxPage?: RawTextBoxPage;
  toolchain: OracleToolchain;
}

function readCache(dir: string, key: string): RawCase | undefined {
  const path = cachePath(dir, key);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { key?: string; value?: RawCase };
    return parsed.key === key ? parsed.value : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(dir: string, key: string, value: RawCase): void {
  const path = cachePath(dir, key);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ key, value })}\n`);
  renameSync(temporary, path);
}

function assembleCase(entry: BatchCase, raw: RawCase, fromCache: boolean): CaseResult {
  const { tier1, page: pageSize } = assembleTier1(raw.records);
  const tier2 = assembleTier2(raw.page, tier1, entry.variant.textboxTrace ? raw.boxPage?.boxes ?? [] : []);
  return {
    id: entry.id, tier1, tier2,
    ...(pageSize ? { page: pageSize } : {}),
    toolchain: raw.toolchain,
    ...(raw.boxPage && entry.variant.textboxTrace ? { textBoxTrace: { unreadableLiterals: raw.boxPage.unreadableLiterals, openScopes: raw.boxPage.openScopes } } : {}),
    mutoolXml: raw.page.xml,
    fromCache,
  };
}

/** Compile all uncached cases in one TeX run and return every case's result. */
export function runOracleCases(cases: readonly BatchCase[], options: RunOptions): RunReport {
  const started = performance.now();
  const results = new Map<string, CaseResult>();
  const pending: { entry: BatchCase; key: string }[] = [];
  for (const entry of cases) {
    const key = caseCacheKey(entry, options.engine, options.extraPreamble);
    const cached = options.cacheDir ? readCache(options.cacheDir, key) : undefined;
    if (cached) results.set(entry.id, assembleCase(entry, cached, true));
    else pending.push({ entry, key });
  }
  let texSeconds = 0;
  let mutoolSeconds = 0;
  if (pending.length > 0) {
    mkdirSync(options.workDir, { recursive: true });
    const jobname = "pgfplots-oracle-batch";
    writeFileSync(join(options.workDir, `${jobname}.tex`), buildBatchDocument(pending.map((p) => p.entry), options.engine, options.extraPreamble));
    writeFileSync(join(options.workDir, "pgfplots-oracle-trace.lua"), pgfplotsOracleLuaSource());
    const texStart = performance.now();
    const tex = run(options.engine, ["-interaction=nonstopmode", "-halt-on-error", `${jobname}.tex`], options.workDir);
    texSeconds = (performance.now() - texStart) / 1000;
    if (tex.status !== 0) {
      const log = existsSync(join(options.workDir, `${jobname}.log`)) ? readFileSync(join(options.workDir, `${jobname}.log`), "utf8") : tex.stdout;
      const error = log.split("\n").findIndex((line) => line.startsWith("!"));
      throw new Error(`${options.engine} failed (see ${options.workDir}):\n${log.split("\n").slice(Math.max(0, error), error + 12).join("\n")}`);
    }
    const mutoolStart = performance.now();
    const trace = run("mutool", ["trace", join(options.workDir, `${jobname}.pdf`)]);
    mutoolSeconds = (performance.now() - mutoolStart) / 1000;
    if (trace.status !== 0) throw new Error(`mutool trace failed: ${trace.stderr}`);
    const pages = splitMutoolTrace(trace.stdout);
    const records = parseProbeRecords(readFileSync(join(options.workDir, `${jobname}-probe.tsv`), "utf8"));
    const versions = versionsFrom(records);
    const boxPath = join(options.workDir, `${jobname}-textbox.tsv`);
    const boxPages = options.engine === "lualatex" && existsSync(boxPath) ? parseTextBoxTrace(readFileSync(boxPath, "utf8")) : [];
    const fingerprint = toolchainFingerprint(options.engine);
    if (pages.length !== pending.length) throw new Error(`Expected ${pending.length} pages, mutool reported ${pages.length}.`);
    const toolchain: OracleToolchain = {
      engine: options.engine,
      engineVersion: fingerprint.engineVersion,
      pgfVersion: versions.pgf,
      pgfplotsVersion: versions.pgfplots,
      mutoolVersion: fingerprint.mutoolVersion,
      compat: "1.18",
    };
    pending.forEach(({ entry, key }, index) => {
      const page = pages[index];
      if (!page) throw new Error(`Missing page ${index + 1}`);
      const boxPage = boxPages.find((p) => p.page === index + 1);
      const raw: RawCase = { records: records.filter((r) => r.caseId === entry.id), page, ...(boxPage ? { boxPage } : {}), toolchain };
      if (options.cacheDir) writeCache(options.cacheDir, key, raw);
      results.set(entry.id, assembleCase(entry, raw, false));
    });
  }
  return {
    results,
    compiledCases: pending.length,
    cachedCases: cases.length - pending.length,
    texSeconds,
    mutoolSeconds,
    totalSeconds: (performance.now() - started) / 1000,
  };
}

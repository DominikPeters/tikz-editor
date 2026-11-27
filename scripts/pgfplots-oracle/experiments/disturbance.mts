/**
 * Disturbance check for the experiment preamble (lib.ts XREC_PREAMBLE: \xrec,
 * \xpt and the global \ticknum fallback). Compiles bodies with the harness'
 * full probes, once with the plain harness and once with the experiment
 * preamble, and compares the raw mutool traces (font subset tags removed).
 * Scaled-tick bodies cannot run under the plain harness (it fails on the tick
 * scale label), so they are compared against the bare (no probe) page instead.
 */
import { join } from "node:path";
import { runOracleCases } from "../run.js";
import { BARE_VARIANT, FULL_VARIANT } from "../tex-source.js";
import { EXP_DIR, XREC_PREAMBLE } from "./lib.js";

const bodies: Record<string, string> = {
  plain: "\\begin{tikzpicture}\\begin{axis}[xlabel=X,ylabel=Y,title=T]\\addplot coordinates {(0,0) (1,3) (2,1)};\\end{axis}\\end{tikzpicture}",
  grid: "\\begin{tikzpicture}\\begin{axis}[grid=both,minor tick num=1,xmin=-3,xmax=7]\\addplot {x^2};\\end{axis}\\end{tikzpicture}",
  scaled: "\\begin{tikzpicture}\\begin{axis}[xlabel=X]\\addplot coordinates {(0,0) (20000,0.001)};\\end{axis}\\end{tikzpicture}",
};
const norm = (xml: string) => xml.replace(/[A-Z]{6}\+/gu, "");
const opts = (extra: string, tag: string) => ({ engine: "lualatex" as const, cacheDir: join(EXP_DIR, "cache"), workDir: join(EXP_DIR, "work", `disturbance-${tag}`), extraPreamble: extra });
for (const [name, body] of Object.entries(bodies)) {
  const exp = runOracleCases([{ id: name, body, variant: FULL_VARIANT }], opts(XREC_PREAMBLE, "exp")).results.get(name)!;
  let ref; let refKind = "plain harness, full probes";
  try { ref = runOracleCases([{ id: name, body, variant: FULL_VARIANT }], opts("", "ref")).results.get(name)!; }
  catch { refKind = "bare page (plain harness fails)"; ref = runOracleCases([{ id: name, body, variant: BARE_VARIANT }], opts("", "bare")).results.get(name)!; }
  console.log(`${name.padEnd(8)} vs ${refKind}: ${norm(exp.mutoolXml) === norm(ref.mutoolXml) ? "IDENTICAL" : "DIFFERENT"}`);
}

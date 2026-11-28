/**
 * pdfTeX oracle for PGF layers and environments: compiles each document in
 * test/fixtures/pgf-layers/*.tex with pdflatex, records every primitive the
 * page paints, in paint order, with `mutool trace`, and saves it as
 * `<name>.oracle.json` next to the document, so test/pgf-layers-oracle.spec.ts
 * checks the editor's scene against it without TeX.
 *
 *   npx tsx scripts/capture-pgf-layer-oracles.mts [--only name,name] [--compare]
 *
 * `--compare` also renders each document with the editor and prints the
 * comparison. Work files go to artifacts/pgf-layers-oracle/.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { renderObservedSource } from "./pgfplots-oracle/adapter.js";
import { compareTier2 } from "./pgfplots-oracle/compare.js";
import { pagePrimitives, splitMutoolTrace } from "./pgfplots-oracle/mutool-trace.js";
import { PGF_LAYER_FIXTURE_DIR, sourceSha256, type PgfLayerOracle } from "./pgf-layers-oracle.js";

const WORK_DIR = join("artifacts", "pgf-layers-oracle");

/** Logs the picture's bounding box (pt) at its end: the page's corner in picture coordinates. */
const BBOX_PROBE = String.raw`\makeatletter
\tikzset{every picture/.append style={execute at end picture={\immediate\write16{PGFLAYERSBBOX \the\pgf@picminx\space\the\pgf@picminy\space\the\pgf@picmaxx\space\the\pgf@picmaxy}}}}
\makeatother
`;

function capture(name: string, source: string): PgfLayerOracle {
  mkdirSync(WORK_DIR, { recursive: true });
  const probed = source.replace("\\begin{document}", `${BBOX_PROBE}\\begin{document}`);
  writeFileSync(join(WORK_DIR, `${name}.tex`), probed);
  try {
    execFileSync("pdflatex", ["-interaction=nonstopmode", "-halt-on-error=false", `${name}.tex`], { cwd: WORK_DIR, stdio: "pipe" });
  } catch {
    // Errors are part of what is recorded; the PDF is still written in nonstop mode.
  }
  const log = readFileSync(join(WORK_DIR, `${name}.log`), "latin1");
  const texErrors = [...log.matchAll(/^! (.*)$/gmu)].map((match) => match[1] ?? "");
  const bbox = /PGFLAYERSBBOX (-?[\d.]+)pt (-?[\d.]+)pt (-?[\d.]+)pt (-?[\d.]+)pt/u.exec(log);
  if (!bbox) throw new Error(`${name}: no bounding box in the log`);
  const [minX, minY, maxX, maxY] = bbox.slice(1, 5).map(Number) as [number, number, number, number];
  const trace = execFileSync("mutool", ["trace", join(WORK_DIR, `${name}.pdf`)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const page = splitMutoolTrace(trace)[0];
  if (!page) throw new Error(`${name}: no page`);
  return {
    sourceSha256: sourceSha256(source),
    engine: "pdflatex",
    boundingBox: { minX, minY, maxX, maxY },
    texErrors,
    tier2: { page: { width: page.width, height: page.height }, primitives: pagePrimitives(page, { minX, maxY }), textBoxes: [] }
  };
}

function round(value: unknown): unknown {
  if (typeof value === "number") return Math.round(value * 1e4) / 1e4;
  if (Array.isArray(value)) return value.map(round);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, round(entry)]));
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const onlyIndex = args.indexOf("--only");
  const only = onlyIndex >= 0 ? (args[onlyIndex + 1] ?? "").split(",").filter(Boolean) : [];
  const compare = args.includes("--compare");
  const names = readdirSync(PGF_LAYER_FIXTURE_DIR).filter((file) => file.endsWith(".tex")).map((file) => file.slice(0, -4)).sort()
    .filter((name) => only.length === 0 || only.includes(name));
  for (const name of names) {
    const source = readFileSync(join(PGF_LAYER_FIXTURE_DIR, `${name}.tex`), "utf8");
    const oracle = capture(name, source);
    writeFileSync(join(PGF_LAYER_FIXTURE_DIR, `${name}.oracle.json`), `${JSON.stringify(round(oracle), null, 1)}\n`);
    const kinds = oracle.tier2.primitives.map((primitive) => primitive.type === "path" ? primitive.operation : primitive.type).join(" ");
    console.log(`${name}: ${oracle.tier2.primitives.length} primitives (${kinds}); ${oracle.texErrors.length} TeX errors`);
    if (compare) {
      const observed = await renderObservedSource(source);
      const result = compareTier2(oracle.tier2, observed.tier2, { textBoxes: false, fontNames: false });
      console.log(`  editor: ${result.pass ? "match" : "differs"}`);
      for (const finding of result.findings) console.log(`    ${finding.code} ${finding.where}: ${finding.message}`);
    }
  }
}

await main();

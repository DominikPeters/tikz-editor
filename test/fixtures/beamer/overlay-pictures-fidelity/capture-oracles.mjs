import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BEAMER_FRAME_ORACLE_VERSION } from "../../../../scripts/lib/beamer-frame-oracle.mjs";

export const CASES = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(frame => ({ frame, page: 1 })),
  { frame: 10, page: 2 },
  { frame: 10, page: 3 },
  { frame: 11, page: 3 },
];

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../../..");
const artifacts = path.resolve(root, process.argv[2] ?? "artifacts/beamer-overlay-pictures-fidelity");
const sourceSha256 = createHash("sha256").update(readFileSync(path.join(directory, "pictures.tex"))).digest("hex");
let environment;
const pages = CASES.map(({ frame, page }) => {
  const output = path.join(artifacts, `pictures-${frame}-state-${page}`);
  const report = JSON.parse(readFileSync(path.join(output, "oracle/frame/report.json"), "utf8"));
  if (report.environment.engine !== "lualatex" || report.input.sha256 !== sourceSha256 || report.formatVersion !== BEAMER_FRAME_ORACLE_VERSION) {
    throw new Error(`Invalid current LuaLaTeX source/page provenance for frame ${frame} page ${page}`);
  }
  environment ??= { engine: report.environment.engineBanner, beamerClass: report.environment.beamerClass };
  const trace = JSON.parse(readFileSync(path.join(output, "oracle-page-trace.json"), "utf8"));
  return { ...trace, frame, step: page, boxes: [] };
});
writeFileSync(path.join(directory, "pictures.oracle.json"), JSON.stringify({ environment, oracleVersion: BEAMER_FRAME_ORACLE_VERSION, sourceSha256, pages }, null, 2) + "\n");

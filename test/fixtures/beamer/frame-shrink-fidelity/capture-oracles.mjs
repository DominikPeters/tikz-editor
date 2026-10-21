import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BEAMER_FRAME_ORACLE_VERSION } from "../../../../scripts/lib/beamer-frame-oracle.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../../..");
const artifacts = path.resolve(root, process.argv[2] ?? "artifacts/beamer-shrink-fidelity");
const sourceSha256 = createHash("sha256").update(readFileSync(path.join(directory, "shrink.tex"))).digest("hex");
let environment;
const pages = [1, 2, 3].map(frame => {
  const output = path.join(artifacts, `shrink-${frame}-state-1`);
  const report = JSON.parse(readFileSync(path.join(output, "oracle/frame/report.json"), "utf8"));
  if (report.environment.engine !== "lualatex" || report.pdf.pageCount !== 1 || report.input.sha256 !== sourceSha256 || report.formatVersion !== BEAMER_FRAME_ORACLE_VERSION) {
    throw new Error(`Invalid current LuaLaTeX source/page provenance for frame ${frame}`);
  }
  environment ??= { engine: report.environment.engineBanner, beamerClass: report.environment.beamerClass };
  const trace = JSON.parse(readFileSync(path.join(output, "oracle-page-trace.json"), "utf8"));
  return { ...trace, boxes: [] };
});
writeFileSync(path.join(directory, "shrink.oracle.json"), JSON.stringify({ environment, oracleVersion: BEAMER_FRAME_ORACLE_VERSION, sourceSha256, pages }, null, 2) + "\n");

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../../..");
const artifacts = path.resolve(root, process.argv[2] ?? "artifacts/beamer-followup-conformance");
const cases = [
  ["flow-subtitle-control", "flow-titles.tex", 0, 1],
  ["flow-subtitle-command", "flow-titles.tex", 1, 1],
  ["flow-subtitle-header", "flow-titles.tex", 2, 1],
  ["flow-title-uncover", "flow-titles.tex", 3, 2],
  ["flow-title-only", "flow-titles.tex", 4, 2],
  ["text-explicit-empty-title", "text-empty-frame-title.tex", 0, 1],
  ["text-absent-title-control", "text-empty-frame-title.tex", 1, 1],
];
const sourceFiles = {};
const pages = [];
let environment;
for (const [id, file, frameIndex, pageCount] of cases) {
  const source = readFileSync(path.resolve(directory, "../corpus-followups", file), "utf8");
  sourceFiles[file] = createHash("sha256").update(source).digest("hex");
  for (let step = 1; step <= pageCount; step++) {
    const caseDirectory = path.join(artifacts, `${id}-state-${step}`);
    const oracle = JSON.parse(readFileSync(path.join(caseDirectory, "oracle/frame/report.json"), "utf8"));
    if (oracle.environment.engine !== "lualatex" || oracle.pdf.pageCount !== pageCount) {
      throw new Error(`Invalid LuaLaTeX page correspondence for ${id} state ${step}`);
    }
    if (oracle.input.sha256 !== sourceFiles[file]) throw new Error(`Source hash changed for ${id}`);
    environment ??= { engine: oracle.environment.engineBanner, beamerClass: oracle.environment.beamerClass };
    const trace = JSON.parse(readFileSync(path.join(caseDirectory, "oracle-page-trace.json"), "utf8"));
    // Box ancestry is not part of the glyph/rule comparator. Retain every
    // glyph, rule and grouped line, including covered overlay content.
    pages.push({ id, file, frameIndex, step, pageCount,
      trace: { ...trace, boxes: [] } });
  }
}
writeFileSync(path.join(directory, "titles.oracle.json"), JSON.stringify({
  formatVersion: 1, environment, sourceFiles, pages,
}, null, 2) + "\n");
console.log(`Captured ${pages.length} LuaLaTeX title pages.`);

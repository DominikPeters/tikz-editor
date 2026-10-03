import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../../..");
const artifacts = path.resolve(root, process.argv[2] ?? "artifacts/beamer-followup-conformance");
const manifest = JSON.parse(readFileSync(path.join(directory, "../corpus-followups/cases.json"), "utf8"));
const selected = ["tables-command-columns-totalwidth", "text-small-display-control"];
const sourceFiles = {};
const pages = [];
let environment;
for (const id of selected) {
  const fixture = manifest.fidelity.find(fixture => fixture.id === id);
  const source = readFileSync(path.join(directory, "../corpus-followups", fixture.file), "utf8");
  sourceFiles[fixture.file] = createHash("sha256").update(source).digest("hex");
  for (let step = 1; step <= fixture.pages; step++) {
    const caseDirectory = path.join(artifacts, `${id}-state-${step}`);
    const oracle = JSON.parse(readFileSync(path.join(caseDirectory, "oracle/frame/report.json"), "utf8"));
    if (oracle.environment.engine !== "lualatex" || oracle.pdf.pageCount !== fixture.pages || oracle.input.sha256 !== sourceFiles[fixture.file]) {
      throw new Error(`Invalid LuaLaTeX source/page correspondence: ${id}`);
    }
    environment ??= { engine: oracle.environment.engineBanner, beamerClass: oracle.environment.beamerClass };
    const trace = JSON.parse(readFileSync(path.join(caseDirectory, "oracle-page-trace.json"), "utf8"));
    pages.push({ id, file: fixture.file, frameIndex: fixture.frame - 1, step, trace: { ...trace, boxes: [] } });
  }
}
writeFileSync(path.join(directory, "flow.oracle.json"), JSON.stringify({ formatVersion: 1, environment, sourceFiles, pages }, null, 2) + "\n");
console.log(`Captured ${pages.length} LuaLaTeX flow pages.`);

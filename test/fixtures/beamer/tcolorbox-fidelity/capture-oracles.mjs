import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeOracleBeamerPageTrace } from "../../../../scripts/lib/beamer-frame-compare.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../../..");
const input = path.join(directory, "boxes.tex");
const output = path.resolve(root, process.argv[2] ?? "artifacts/beamer-tcolorbox-fidelity");
mkdirSync(output, { recursive: true });
const pages = [];
let environment;
for (let frameIndex = 0; frameIndex < 5; frameIndex++) {
  const name = `frame-${frameIndex + 1}`;
  execFileSync(process.execPath, [path.join(root, "scripts/probe-beamer-frame.mjs"), "--input", input,
    "--frame", String(frameIndex + 1), "--out-dir", output, "--name", name, "--trace-only"], { cwd: root, stdio: "inherit" });
  const report = JSON.parse(readFileSync(path.join(output, name, "report.json"), "utf8"));
  if (report.environment.engine !== "lualatex" || report.pdf.pageCount !== 1) throw new Error(`Invalid reference for ${name}`);
  environment ??= { engine: report.environment.engineBanner, beamerClass: report.environment.beamerClass };
  const trace = normalizeOracleBeamerPageTrace(report.pageTrace.selectedPage, report.tex.selectedPage);
  pages.push({ frameIndex, trace: { ...trace, boxes: [] } });
}
writeFileSync(path.join(directory, "boxes.oracle.json"), JSON.stringify({
  formatVersion: 1, sourceSha256: createHash("sha256").update(readFileSync(input)).digest("hex"), environment, pages,
}, null, 2) + "\n");

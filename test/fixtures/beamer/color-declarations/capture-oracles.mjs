import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { runTexOracleDocument } from "../../../../scripts/lib/tex-oracle.mjs";

const casesPath = new URL("./cases.json", import.meta.url);
const cases = JSON.parse(readFileSync(casesPath, "utf8"));
let environment;
const pages = cases.map(testCase => {
  const probes = testCase.roles.map(role => String.raw`\begingroup\usebeamercolor*{${role}}
\extractcolorspecs{fg}\probeModel\probeSpec\typeout{BEAMER-COLOR|${role}|fg|\probeModel|\probeSpec}
\extractcolorspecs{bg}\probeModel\probeSpec\typeout{BEAMER-COLOR|${role}|bg|\probeModel|\probeSpec}\endgroup`).join("\n");
  const source = String.raw`\documentclass{beamer}
${testCase.preamble}
\begin{document}
${probes}
\begin{frame}Alpha\end{frame}
\end{document}`;
  const log = runTexOracleDocument({ engine: "lualatex", source, filename: `${testCase.id}.tex` });
  environment ??= { engineBanner: log.split(/\r?\n/u).find(line => line.startsWith("This is LuaHBTeX")),
    beamerClass: log.split(/\r?\n/u).find(line => line.startsWith("Document Class: beamer") || line.startsWith("DocumentClass: beamer")) };
  const colors = {};
  for (const match of log.matchAll(/^BEAMER-COLOR\|([^|]+)\|(fg|bg)\|([^|]+)\|([^\r\n]+)$/gmu)) {
    (colors[match[1]] ??= {})[match[2]] = { model: match[3], specification: match[4] };
  }
  if (Object.keys(colors).length !== testCase.roles.length) throw new Error(`Incomplete TeX oracle for ${testCase.id}`);
  console.log(`Captured ${testCase.id}`);
  return { id: testCase.id, colors };
});
writeFileSync(new URL("./colors.oracle.json", import.meta.url), JSON.stringify({
  engine: "lualatex", environment, sourceSha256: createHash("sha256").update(readFileSync(casesPath)).digest("hex"), cases: pages,
}, null, 2) + "\n");

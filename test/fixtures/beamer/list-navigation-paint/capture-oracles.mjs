import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { runTexOracleDocument } from "../../../../scripts/lib/tex-oracle.mjs";

const casesPath = new URL("./cases.json", import.meta.url);
const cases = JSON.parse(readFileSync(casesPath, "utf8"));
let environment;
const captured = cases.map(testCase => {
  const hooks = ["enumerate item", "enumerate subitem", "enumerate subsubitem", "itemize item", "itemize subitem", "itemize subsubitem"].map(role =>
    String.raw`\addtobeamertemplate{${role}}{\probeListPaint{${role}}}{}`).join("\n");
  const source = String.raw`\documentclass{beamer}
${testCase.preamble}
\newcommand{\probeListPaint}[1]{\extractcolorspecs{.}\probeModel\probeSpec\typeout{BEAMER-LABEL-PAINT|#1|\probeModel|\probeSpec}}
${hooks}
${testCase.recordCounter ? String.raw`\addtobeamertemplate{enumerate item}{\typeout{BEAMER-ENUM-COUNTER|\insertenumlabel}}{}` : ""}
\begin{document}
\ifbeamertemplateempty{navigation symbols}{\typeout{BEAMER-NAVIGATION|empty}}{\typeout{BEAMER-NAVIGATION|nonempty}}
\begin{frame}[t]${testCase.body}\end{frame}
\end{document}`;
  const log = runTexOracleDocument({ engine: "lualatex", source, filename: `${testCase.id}.tex` });
  environment ??= {
    engineBanner: log.split(/\r?\n/u).find(line => line.startsWith("This is LuaHBTeX")),
    beamerClass: log.split(/\r?\n/u).find(line => line.startsWith("Document Class: beamer")),
  };
  const labels = Array.from(log.matchAll(/^BEAMER-LABEL-PAINT\|([^|]+)\|([^|]+)\|([^\r\n]+)$/gmu), match => ({ role: match[1], model: match[2], specification: match[3] }));
  const navigation = /^BEAMER-NAVIGATION\|(empty|nonempty)$/mu.exec(log)?.[1];
  if (!navigation) throw new Error(`Missing navigation oracle for ${testCase.id}`);
  console.log(`Captured ${testCase.id}: ${labels.length} labels; navigation ${navigation}`);
  const counters = Array.from(log.matchAll(/^BEAMER-ENUM-COUNTER\|([^\r\n]+)$/gmu), match => match[1]);
  return { id: testCase.id, labels, navigation, ...(testCase.recordCounter ? { counters } : {}) };
});
writeFileSync(new URL("./paint.oracle.json", import.meta.url), JSON.stringify({
  engine: "lualatex", environment, sourceSha256: createHash("sha256").update(readFileSync(casesPath)).digest("hex"), cases: captured,
}, null, 2) + "\n");

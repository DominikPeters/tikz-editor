// Regenerate the checked-in independent PGF oracle. Ordinary Vitest runs
// consume its numbers and require no TeX installation.
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import data from "../test/fixtures/coordinate-oracles/coordinates.json" with { type: "json" };

const fixture = fileURLToPath(new URL("../test/fixtures/coordinate-oracles/coordinates.json", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "tikz-coordinate-oracle-"));
try {
  const body = data.cases.map((entry, index) => {
    if (entry.kind === "node") {
      const probes = ["center", "north", "south", "east", "west"].map(anchor => `\\Probe{${index}}{${anchor}}`).join("\n");
      return entry.source.replace("\\end{tikzpicture}", `${probes}\n\\end{tikzpicture}`);
    }
    return entry.source.replace("\\draw", "\\draw[save path=\\savedpath]") + `\n\\TracePath{${index}}\n`;
  }).join("\n");
  const source = String.raw`\documentclass{article}
\usepackage{tikz}
\pagestyle{empty}
\makeatletter
\newwrite\oraclerecord
\immediate\openout\oraclerecord=coordinates.txt
\immediate\write\oraclerecord{PGF|\pgfversion}
\def\Probe#1#2{\begingroup\pgftransformreset\pgf@process{\pgfpointanchor{N}{#2}}\immediate\write\oraclerecord{#1|#2|\the\pgf@x|\the\pgf@y}\endgroup}
\def\TracePath#1{\begingroup
  \def\pgfsyssoftpath@movetotoken##1##2{\immediate\write\oraclerecord{#1|M|##1|##2}}
  \def\pgfsyssoftpath@linetotoken##1##2{\immediate\write\oraclerecord{#1|L|##1|##2}}
  \def\pgfsyssoftpath@curvetosupportatoken##1##2{\immediate\write\oraclerecord{#1|C1|##1|##2}}
  \def\pgfsyssoftpath@curvetosupportbtoken##1##2{\immediate\write\oraclerecord{#1|C2|##1|##2}}
  \def\pgfsyssoftpath@curvetotoken##1##2{\immediate\write\oraclerecord{#1|C|##1|##2}}
  \savedpath\endgroup}
\begin{document}
` + body + String.raw`
\immediate\closeout\oraclerecord
\end{document}
`;
  writeFileSync(join(directory, "oracle.tex"), source);
  execFileSync("pdflatex", ["-interaction=nonstopmode", "-halt-on-error", "oracle.tex"], { cwd: directory, stdio: "pipe" });
  for (const entry of data.cases) entry.expected = [];
  for (const line of readFileSync(join(directory, "coordinates.txt"), "utf8").trim().split("\n")) {
    const [index, kind, x, y] = line.split("|");
    if (index === "PGF") { data.pgfVersion = kind; continue; }
    data.cases[Number(index)].expected.push({ kind, x: parseFloat(x), y: parseFloat(y) });
  }
  if (data.cases.some(entry => entry.expected.length === 0)) throw new Error("PGF omitted a probe");
  writeFileSync(fixture, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`Captured ${data.cases.length} cases from PGF ${data.pgfVersion}.`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}

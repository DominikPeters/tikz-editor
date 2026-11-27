// Table input (design/pgfplots-behaviour.md section V): every expectation
// below is what LuaLaTeX drew for the same input in experiment E17
// (scripts/pgfplots-oracle/experiments/e17-tables.mts), read back in data
// units; the oracle fixtures tables-* hold the same rules at layout tolerance.
// A lone point after a jump paints nothing; TeX's PDF may keep its moveto,
// which the Tier 2 comparison ignores too (compare.ts), so it is left out here.
import { describe, expect, it } from "vitest";

import type { DocumentGraphicsResolver } from "../packages/core/src/graphics/types.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { getAxisEvaluations } from "../packages/core/src/pgfplots/evaluate-axis.js";
import { pgfplotsTableFileNames } from "../packages/core/src/pgfplots/table-files.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";

const LIMITS = "xmin=-1,xmax=10,ymin=-1,ymax=10";

function render(plots: string, options = LIMITS, before = "", resolver?: DocumentGraphicsResolver) {
  const source = `\\pgfplotsset{compat=1.18}\n\\begin{tikzpicture}${before}\n\\begin{axis}[${options}]\n${plots}\n\\end{axis}\n\\end{tikzpicture}`;
  const parsed = parseTikz(source, { includeContextDefinitions: true });
  const semantic = evaluateTikzFigure(parsed.figure, source, resolver ? { graphicsResolver: resolver } : {});
  return { parsed, semantic };
}

/** The plot lines as `M1,2 L3,4` in data units (what the E17 digest prints). */
function lines(plots: string, options = LIMITS, before = "", resolver?: DocumentGraphicsResolver): string[] {
  const { semantic } = render(plots, options, before, resolver);
  const axis = getAxisEvaluations(semantic.scene)[0];
  if (!axis) return [];
  const { origin, xUnit, yUnit } = axis.layout.map;
  const r = (v: number) => String(Math.round(v * 1000) / 1000);
  return semantic.scene.elements.filter((element) => element.kind === "Path" && element.id.endsWith(":line")).map((element) =>
    element.kind === "Path" ? element.commands.map((c) => (c.kind === "M" || c.kind === "L" ? `${c.kind}${r((c.to.x - origin.x) / xUnit.x)},${r((c.to.y - origin.y) / yUnit.y)}` : c.kind)).join(" ") : "");
}

const cases: Array<[string, string, string, string?, string?]> = [
  ["column names", "\\addplot table [x=b,y=a] {\na b c\n1 2 3\n4 5 6\n};", "M2,1 L5,4"],
  ["column indices", "\\addplot table [x index=2,y index=0] {\na b c\n1 2 3\n4 5 6\n};", "M3,1 L6,4"],
  ["a name beats an index", "\\addplot table [x=c,x index=0,y=a] {\na b c\n1 2 3\n4 5 6\n};", "M3,1 L6,4"],
  ["no header: columns 0 and 1", "\\addplot table {\n1 2 3\n4 5 6\n};", "M1,2 L4,5"],
  ["header=has colnames", "\\addplot table [header=has colnames,x=3,y=1] {\n1 2 3\n4 5 6\n7 8 9\n};", "M6,4 L9,7"],
  ["skip first n counts the line after the brace", "\\addplot table [skip first n=2] {\njunk line here\nmore junk\na b\n1 2\n3 4\n};", "M1,2 L3,4"],
  ["comment chars", "\\addplot table [comment chars=!] {\n! c\na b\n1 2 ! tail\n3 4\n};", "M1,2 L3,4"],
  ["col sep=comma with spaces", "\\addplot table [col sep=comma] {\na,b\n1, 2\n3 ,4\n};", "M1,2 L3,4"],
  ["col sep=semicolon", "\\addplot table [col sep=semicolon] {\na;b\n1;2\n3;4\n};", "M1,2 L3,4"],
  ["col sep=& with row sep=\\\\", "\\addplot table [col sep=&, row sep=\\\\] {\na & b \\\\ 1 & 2 \\\\ 3 & 4 \\\\\n};", "M1,2 L3,4"],
  ["row sep=crcr (matlab2tikz)", "\\addplot table [row sep=crcr] {%\na b\\\\\n1 2\\\\\n3 4\\\\\n};", "M1,2 L3,4"],
  ["nan and inf are discarded", "\\addplot table {\na b\n1 1\n2 nan\n3 3\n4 inf\n5 5\n6 -inf\n7 7\n};", "M1,1 L3,3 L5,5 L7,7"],
  ["an empty line jumps", "\\addplot table {\na b\n1 1\n2 2\n\n3 3\n4 4\n};", "M1,1 L2,2 M3,3 L4,4"],
  ["\\coordindex skips comments and empty lines", "\\addplot table [x expr=\\coordindex, y expr=\\thisrow{b}*2] {\n% c\na b\n5 1\n% c\n6 2\n\n7 3\n};", "M0,2 L1,4"],
  ["\\lineno counts every line", "\\addplot table [x expr=\\lineno, y expr=\\thisrowno{1}] {%\na b\n5 1\n% c\n6 2\n\n7 3\nnan 4\n8 5\n};", "M1,1 L2,2 M4,3 L5,4 L6,5"],
  ["\\coordindex counts a discarded row", "\\addplot table [x expr=\\coordindex, y=b] {\na b\n0 0\n1 nan\n2 2\n\n3 3\n};", "M0,0 L2,2"],
  ["each nth point keeps 0, n, 2n", "\\addplot[each nth point=3] table {\na b\n0 0\n1 1\n2 2\n3 3\n4 4\n5 5\n6 6\n7 7\n};", "M0,0 L3,3 L6,6"],
  ["restrict expr to domain", "\\addplot[restrict expr to domain={\\thisrow{a}}{2:5}] table {\na b\n0 0\n1 1\n2 2\n3 3\n4 4\n5 5\n6 6\n};", "M2,2 L3,3 L4,4 L5,5"],
  ["restrict expr to domain* clamps x", "\\addplot[restrict expr to domain*={\\thisrow{a}}{2:5}] table {\na b\n0 0\n1 1\n2 2\n3 3\n4 4\n5 5\n6 6\n};", "M2,0 L2,1 L2,2 L3,3 L4,4 L5,5 L5,6"],
  ["ignore chars", "\\addplot table [ignore chars={(,)}] {\na b\n(1) (2)\n(3) 4\n};", "M1,2 L3,4"],
  ["white space chars", "\\addplot table [white space chars={;}] {\na b\n1;2\n3 ; 4\n};", "M1,2 L3,4"],
  ["a %-comment joins the next line (TeX eats the end of line)", "\\addplot table {\na b\n1 2 % c\n3 4\n5 6\n};", "M1,2 L5,6"],
  ["a missing cell keeps the previous row's value", "\\addplot table [x=a,y=c] {\na b c\n1 2 3\n4 5\n6 7 8\n};", "M1,3 L4,3 L6,8"],
  ["\\pgfplotstableread with row sep", "\\addplot table [x=b,y=a] {\\tbl};", "M2,1 L4,3", "\\pgfplotstableread[row sep=\\\\]{a b\\\\ 1 2\\\\ 3 4\\\\}\\tbl"],
  ["\\pgfplotstableread inline rows", "\\addplot table [x=b,y=a] {\\tbl};", "M2,1 L4,3", "\\pgfplotstableread{\na b\n1 2\n3 4\n}\\tbl"],
  ["\\pgfplotstableset", "\\addplot table {\na,b\n1,2\n3,4\n};", "M1,2 L3,4", "\\pgfplotstableset{col sep=comma}"],
  ["number forms", "\\addplot table {\na b\n+1 .5e1\n2E0 1e-0\n};", "M1,5 L2,1"],
  ["y expr over two columns", "\\addplot table [x=a, y expr=\\thisrow{a}+\\thisrow{b}] {\na b\n1 2\n3 4\n};", "M1,3 L3,7"]
];

describe("pgfplots tables (behaviour V, measured in E17)", () => {
  it.each(cases)("%s", (_name, plots, expected, before) => {
    expect(lines(plots, LIMITS, before ? `\n${before}` : "")).toEqual([expected]);
  });

  it("jumps over unbounded coordinates with unbounded coords=jump", () => {
    expect(lines("\\addplot table {\na b\n1 1\n2 2\n3 nan\n4 4\n5 5\n};", `${LIMITS},unbounded coords=jump`)).toEqual(["M1,1 L2,2 M4,4 L5,5"]);
  });

  it("keeps discarded coordinates out of the limits", () => {
    const { semantic } = render("\\addplot table {\na b\n1 1\n2 nan\n3 3\nnan 9\n};", "");
    expect(getAxisEvaluations(semantic.scene)[0]?.layout.limits).toEqual({ xmin: 0.8, xmax: 3.2, ymin: 0.8, ymax: 3.2 });
  });

  it("names a missing column", () => {
    const { semantic } = render("\\addplot table [x=a,y=q] {\na b\n1 2\n};");
    expect(semantic.diagnostics.find((d) => d.code === "unsupported-pgfplots-plot")?.message).toContain("`q`");
  });
});

describe("pgfplots tables from files (the document's resolver)", () => {
  const data = "# generated\nt v\n0 1\n1 3\n2 2\n";
  const withFiles = (files: Record<string, string>): DocumentGraphicsResolver => ({
    cacheKey: "test",
    resolve: () => ({ status: "missing" }),
    readTextFile: (name) => (name in files ? { status: "resolved", text: files[name] ?? "" } : { status: "missing" })
  });

  it("reads a file next to the document, with `#` comment lines", () => {
    expect(lines("\\addplot table [x=t,y=v] {data/run.dat};", LIMITS, "", withFiles({ "data/run.dat": data }))).toEqual(["M0,1 L1,3 L2,2"]);
  });

  it("reads a file loaded by \\pgfplotstableread", () => {
    expect(lines("\\addplot table [x=t,y=v] {\\loaded};", LIMITS, "\n\\pgfplotstableread{run.dat}\\loaded", withFiles({ "run.dat": data }))).toEqual(["M0,1 L1,3 L2,2"]);
  });

  it("says which file is missing, and why it cannot be read without a folder", () => {
    const missing = render("\\addplot table {gone.dat};", LIMITS, "", withFiles({}));
    expect(missing.semantic.diagnostics.find((d) => d.code === "pgfplots-table-file-unavailable")?.message).toContain("`gone.dat` was not found next to the document");
    const noFolder = render("\\addplot table {gone.dat};");
    expect(noFolder.semantic.diagnostics.find((d) => d.code === "pgfplots-table-file-unavailable")?.message).toContain("no access to the document's folder");
  });

  it("lists the table files a document reads, for the host to load", () => {
    expect(pgfplotsTableFileNames(String.raw`\pgfplotstableread[col sep=comma]{a.csv}\t
\begin{axis}\addplot table [x=a, y=b] {data/b.dat}; \addplot table {\t}; \addplot table {
1 2
}; % \addplot table {c.dat};
\end{axis}`).sort()).toEqual(["a.csv", "data/b.dat"]);
  });
});

describe("pgfplots: generator idioms (matlab2tikz, tikzplotlib)", () => {
  it("reads a matlab2tikz axis without diagnostics beyond legends", () => {
    const source = String.raw`\definecolor{mycolor1}{rgb}{0.00000,0.44700,0.74100}
\pgfplotsset{compat=1.18}
\begin{tikzpicture}
\begin{axis}[%
width=4.521in,
height=3.566in,
at={(0.758in,0.481in)},
scale only axis,
xmin=0,
xmax=10,
ymin=0,
ymax=1,
axis background/.style={fill=white},
legend style={legend cell align=left, align=left, draw=white!15!black}
]
\addplot [color=mycolor1, forget plot]
  table[row sep=crcr]{%
0	0.1\\
5	0.5\\
10	0.9\\
};
\addplot [color=mycolor1, line width=1.0pt]
  table[row sep=crcr]{%
0	0.2\\
10	0.8\\
};
\end{axis}
\end{tikzpicture}`;
    const parsed = parseTikz(source, { includeContextDefinitions: true });
    expect(parsed.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const codes = semantic.diagnostics.map((d) => d.code ?? "");
    expect(codes.filter((code) => code.startsWith("unsupported-pgfplots-plot") || code.startsWith("invalid-pgfplots-value"))).toEqual([]);
    expect(semantic.scene.elements.filter((element) => element.id.endsWith(":line"))).toHaveLength(2);
  });

  it("evaluates a 20,000-row inline table quickly", () => {
    const rows = ["x y"];
    for (let i = 0; i < 20000; i += 1) rows.push(`${(i / 1000).toFixed(4)} ${Math.sin(i / 300).toFixed(6)}`);
    const source = `\\pgfplotsset{compat=1.18}\\begin{tikzpicture}\\begin{axis}[no marks]\n\\addplot table {\n${rows.join("\n")}\n};\n\\end{axis}\\end{tikzpicture}`;
    const parsed = parseTikz(source, { includeContextDefinitions: true });
    evaluateTikzFigure(parsed.figure, source);
    const start = performance.now();
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const elapsed = performance.now() - start;
    const line = semantic.scene.elements.find((element) => element.id.endsWith(":line"));
    expect(line?.kind === "Path" && line.commands.length).toBe(20000);
    // Measured ~45 ms warm on the shared 4-CPU machine; the bound leaves room for load.
    expect(elapsed).toBeLessThan(500);
  });
});

/**
 * Standalone export round trip: each document below is exported with
 * `createStandaloneLatexExportArtifact` and the result is compiled with
 * LuaLaTeX. The export must compile to one page, and the exporter must not
 * mark these documents incomplete. For a few of them the exported picture's
 * page size must equal the original document's (compiled as `standalone`),
 * which catches settings that are dropped but still compile.
 *
 * The TeX part runs with `EXPORT_COMPILE_TESTS=1` (`npm run test:export-compile`)
 * when `lualatex` and pgfplots are installed, like the other TeX oracle specs.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStandaloneLatexExportArtifact } from "../packages/core/src/export/index.js";
import { parseTikz } from "../packages/core/src/parser/index.js";

const commandExists = (command: string, args = ["--version"]): boolean =>
  spawnSync(command, args, { stdio: "ignore", timeout: 5_000 }).status === 0;
const pgfplotsInstalled = (): boolean => spawnSync("kpsewhich", ["pgfplots.sty"], { encoding: "utf8", timeout: 5_000 }).stdout?.trim().length > 0;
const runTex = process.env.EXPORT_COMPILE_TESTS === "1" && commandExists("lualatex") && pgfplotsInstalled() && commandExists("pdfinfo", ["-v"]);

type ExportCase = {
  name: string;
  source: string;
  /** Which picture to export (default: the first). */
  figure?: number;
  /** Compare the exported picture's page size with the original's. */
  comparePageSize?: boolean;
};

const doc = (preamble: string, body: string): string =>
  `\\documentclass{article}\n\\usepackage{pgfplots}\n${preamble}\n\\begin{document}\n${body}\n\\end{document}\n`;

const CASES: ExportCase[] = [
  {
    name: "bare picture",
    source: String.raw`\begin{tikzpicture}
\begin{axis}[xlabel=$x$, ylabel=$y$]
\addplot[domain=-2:2, samples=20] {x^2};
\end{axis}
\end{tikzpicture}`
  },
  {
    name: "preamble styles and a cycle list",
    comparePageSize: true,
    source: doc(String.raw`\pgfplotsset{compat=1.18}
\pgfplotsset{
  mystyle/.style={width=7cm, height=4cm, grid=major},
  every axis plot/.append style={thick},
  cycle list={{red, mark=*}, {blue, mark=square*}}
}`, String.raw`\begin{tikzpicture}
\begin{axis}[mystyle, title={Styled}]
\addplot coordinates {(0,0) (1,1) (2,4)};
\addplot coordinates {(0,1) (1,2) (2,2)};
\end{axis}
\end{tikzpicture}`)
  },
  {
    name: "settings between plots in the axis body (behaviour AB)",
    comparePageSize: true,
    source: doc(String.raw`\pgfplotsset{compat=1.18}`, String.raw`\begin{tikzpicture}
\begin{axis}[domain=0:1, samples=3]
\def\k{1}
\addplot {x+\k};
\pgfplotsset{domain=2:3, cycle list={{teal},{violet}}}
{\pgfplotsset{samples=5}\def\k{4}\addplot {x+\k};}
\tikzset{mark=x}
\addplot[red] {x};
\pgfplotsset{title={Late}, legend entries={a,b,c}}
\end{axis}
\end{tikzpicture}`)
  },
  {
    name: "compat 1.11",
    source: doc(String.raw`\pgfplotsset{compat=1.11}`, String.raw`\begin{tikzpicture}
\begin{axis}[xlabel=time]
\addplot coordinates {(0,1) (1,3) (2,2)};
\end{axis}
\end{tikzpicture}`)
  },
  {
    name: "full document without compat",
    source: doc("", String.raw`\begin{tikzpicture}
\begin{axis}
\addplot {sin(deg(x))};
\end{axis}
\end{tikzpicture}`)
  },
  {
    name: "preamble table read inline",
    comparePageSize: true,
    source: doc(String.raw`\pgfplotsset{compat=1.18}
\pgfplotstableset{col sep=comma}
\pgfplotstableread{
x,y
0,1
1,2
2,4
3,3
}\mytable`, String.raw`\begin{tikzpicture}
\begin{axis}
\addplot table [x=x, y=y] {\mytable};
\end{axis}
\end{tikzpicture}`)
  },
  {
    name: "picture-level table read",
    source: doc(String.raw`\pgfplotsset{compat=1.18}`, String.raw`\begin{tikzpicture}
\pgfplotstableread{
a b
0 0
1 2
2 1
}\datatable
\begin{axis}
\addplot table [x=a, y=b] {\datatable};
\end{axis}
\end{tikzpicture}`)
  },
  {
    name: "user colours, macros and lengths in an axis",
    comparePageSize: true,
    source: doc(String.raw`\pgfplotsset{compat=1.18}
\definecolor{brand}{RGB}{200,40,40}
\colorlet{soft}{brand!40}
\newcommand{\xupper}{4}
\def\ylabeltext{Height}
\pgfmathsetmacro{\yupper}{3*2}
\newlength{\plotwidth}
\setlength{\plotwidth}{6cm}`, String.raw`\begin{tikzpicture}
\begin{axis}[width=\plotwidth, xmax=\xupper, ymax=\yupper, ylabel=\ylabeltext]
\addplot[color=brand, fill=soft] coordinates {(0,0) (1,2) (2,3)} \closedcycle;
\end{axis}
\end{tikzpicture}`)
  },
  {
    name: "preamble settings that read user definitions",
    comparePageSize: true,
    source: doc(String.raw`\pgfplotsset{compat=1.18}
\definecolor{accent}{HTML}{1F77B4}
\newlength{\figw}
\setlength{\figw}{5cm}
\newcommand{\ttl}{Settings}
\pgfplotsset{mine/.style={width=\figw, title=\ttl}, cycle list={{accent, mark=*}}}
\pgfmathdeclarefunction{sq}{1}{\pgfmathparse{(#1)^2}}`, String.raw`\pgfmathsetmacro{\shift}{1.5}% (no space before the picture in the original)
\begin{tikzpicture}
\begin{axis}[mine]
\addplot coordinates {(0,0) (1,\shift)};
\addplot[domain=0:2, samples=5] {sq(x)};
\end{axis}
\end{tikzpicture}`)
  },
  {
    name: "log axis",
    source: doc(String.raw`\pgfplotsset{compat=1.18}`, String.raw`\begin{tikzpicture}
\begin{semilogyaxis}[xlabel=$n$]
\addplot coordinates {(1,10) (2,100) (3,1000) (4,20000)};
\end{semilogyaxis}
\end{tikzpicture}`)
  },
  {
    name: "bars with symbolic coordinates",
    source: doc(String.raw`\pgfplotsset{compat=1.18}`, String.raw`\begin{tikzpicture}
\begin{axis}[ybar, symbolic x coords={apples, pears, plums}, xtick=data, nodes near coords, ymin=0]
\addplot coordinates {(apples,3) (pears,5) (plums,2)};
\end{axis}
\end{tikzpicture}`)
  },
  {
    name: "legend",
    source: doc(String.raw`\pgfplotsset{compat=1.18}`, String.raw`\begin{tikzpicture}
\begin{axis}[legend pos=north west]
\addplot coordinates {(0,0) (1,1)};
\addlegendentry{first}
\addplot coordinates {(0,1) (1,0)};
\addlegendentry{second}
\end{axis}
\end{tikzpicture}`)
  },
  {
    name: "function plot with declare function",
    source: doc(String.raw`\pgfplotsset{compat=1.18}
\tikzset{declare function={bump(\x)=exp(-\x*\x);}}`, String.raw`\begin{tikzpicture}
\begin{axis}[declare function={twice(\t)=2*\t;}]
\addplot[domain=-2:2, samples=30] {bump(x)};
\addplot[domain=-2:2, samples=5] {twice(x)};
\end{axis}
\end{tikzpicture}`)
  },
  {
    name: "library marks and patterns",
    source: doc(String.raw`\pgfplotsset{compat=1.18}`, String.raw`\begin{tikzpicture}
\begin{axis}
\addplot[mark=pentagon*] coordinates {(0,0) (1,1) (2,0)};
\addplot[mark=star, pattern=north east lines] coordinates {(0,1) (1,2) (2,1)} \closedcycle;
\end{axis}
\end{tikzpicture}`)
  },
  {
    name: "two pictures, exporting the second",
    figure: 1,
    source: doc(String.raw`\pgfplotsset{compat=1.18}
\newcommand{\topvalue}{5}`, String.raw`\begin{tikzpicture}
\draw (0,0) -- (1,1);
\end{tikzpicture}

\begin{tikzpicture}
\begin{axis}[ymax=\topvalue]
\addplot coordinates {(0,0) (1,3)};
\end{axis}
\end{tikzpicture}`)
  },
  {
    name: "axis inside a scope",
    source: doc(String.raw`\pgfplotsset{compat=1.18}`, String.raw`\begin{tikzpicture}
\draw (0,0) rectangle (1,1);
\begin{scope}[xshift=2cm]
\begin{axis}[width=5cm]
\addplot coordinates {(0,0) (1,1)};
\end{axis}
\end{scope}
\end{tikzpicture}`)
  },
  // Plain TikZ pictures on PGF layers: the layer declarations and the list
  // come from the preamble, or the `backgrounds` library is inferred.
  {
    name: "PGF layers declared in the preamble",
    comparePageSize: true,
    source: doc(String.raw`\pgfdeclarelayer{back}
\pgfdeclarelayer{front}
\pgfsetlayers{back,main,front}`, String.raw`\begin{tikzpicture}
\node[draw, fill=white] (a) {A};
\begin{pgfonlayer}{back}
\fill[yellow] (-1,-1) rectangle (1,1);
\end{pgfonlayer}
\begin{pgfonlayer}{front}
\draw[red] (a.south west) -- (a.north east);
\end{pgfonlayer}
\end{tikzpicture}`)
  },
  {
    name: "background layer of the backgrounds library",
    comparePageSize: true,
    source: doc(String.raw`\usetikzlibrary{backgrounds}`, String.raw`\begin{tikzpicture}
\node[draw] (a) {A};
\begin{pgfonlayer}{background}
\fill[yellow] (a.south west) rectangle (a.north east);
\end{pgfonlayer}
\begin{scope}[on background layer]
\draw (-1,0) -- (1,0);
\end{scope}
\end{tikzpicture}`)
  },
  {
    name: "bare picture on the background layer",
    source: String.raw`\begin{tikzpicture}
\node[draw] (a) {A};
\begin{pgfonlayer}{background}
\fill[yellow] (-1,-1) rectangle (1,1);
\end{pgfonlayer}
\end{tikzpicture}`
  }
];

function figureId(source: string, index: number): string {
  const figures = parseTikz(source, { recover: true }).figures;
  const figure = figures[index];
  if (!figure) throw new Error(`No figure ${index}`);
  return figure.id;
}

function exportCase(entry: ExportCase) {
  return createStandaloneLatexExportArtifact({ source: entry.source, activeFigureId: figureId(entry.source, entry.figure ?? 0) });
}

type Compiled = { status: number | null; pages: number; size: [number, number] | null; log: string };

function compile(text: string): Compiled {
  const directory = mkdtempSync(join(tmpdir(), "pgfplots-export-"));
  try {
    writeFileSync(join(directory, "doc.tex"), text);
    const result = spawnSync("lualatex", ["-interaction=batchmode", "-halt-on-error", "doc.tex"], { cwd: directory, encoding: "utf8", timeout: 60_000 });
    let log = "";
    try { log = readFileSync(join(directory, "doc.log"), "utf8"); } catch { /* no log */ }
    if (result.status !== 0) return { status: result.status, pages: 0, size: null, log };
    const info = spawnSync("pdfinfo", [join(directory, "doc.pdf")], { encoding: "utf8", timeout: 10_000 }).stdout ?? "";
    const pages = Number(/^Pages:\s+(\d+)/mu.exec(info)?.[1] ?? 0);
    const size = /^Page size:\s+([\d.]+) x ([\d.]+) pts/mu.exec(info);
    return { status: result.status, pages, size: size ? [Number(size[1]), Number(size[2])] : null, log };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** The original document with its class replaced by `standalone`, so its one page is the picture. */
function originalAsStandalone(source: string): string {
  return source.replace(/\\documentclass(?:\[[^\]]*\])?\{[^{}]*\}/u, "\\documentclass{standalone}");
}

describe("pgfplots standalone export: completeness", () => {
  it.each(CASES.map((entry) => [entry.name, entry] as const))("%s is exported complete", (_name, entry) => {
    const artifact = exportCase(entry);
    expect(artifact.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(artifact.complete).toBe(true);
  });
});

describe.skipIf(!runTex)("pgfplots standalone export: compiles with LuaLaTeX", () => {
  it.each(CASES.map((entry) => [entry.name, entry] as const))("%s compiles to one page", (_name, entry) => {
    const artifact = exportCase(entry);
    const compiled = compile(artifact.text);
    if (compiled.status !== 0) {
      const error = compiled.log.split("\n").filter((line) => line.startsWith("!") || line.startsWith("l.")).slice(0, 6).join("\n");
      throw new Error(`lualatex exited ${compiled.status} on:\n${artifact.text}\n${error}`);
    }
    expect(compiled.pages).toBe(1);
    if (entry.comparePageSize) {
      const original = compile(originalAsStandalone(entry.source));
      expect(original.status).toBe(0);
      expect(original.size).not.toBeNull();
      expect(compiled.size).not.toBeNull();
      const [width, height] = compiled.size ?? [0, 0];
      const [originalWidth, originalHeight] = original.size ?? [0, 0];
      expect(Math.abs(width - originalWidth)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(height - originalHeight)).toBeLessThanOrEqual(0.01);
    }
  }, 180_000);
});

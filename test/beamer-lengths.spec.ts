import { describe, expect, it } from "vitest";

import { renderBeamerFrame, scanBeamerDocument } from "../packages/core/src/beamer/index.js";
import { projectBeamerLengthRegisters, scanBeamerLengthRegisters } from "../packages/core/src/beamer/lengths.js";
import { createIdentityMappedText } from "../packages/core/src/text/source-map.js";
import { evaluateTexLengthExpression } from "../packages/core/src/text/tex/dimensions.js";

// Expected values are \the of each register in pdfLaTeX (TeX Live 2026),
// printed from inside the frame of the same document.
const PROBE = String.raw`\documentclass{beamer}
\newlength{\before}\setlength{\before}{0.5\paperwidth}
\usepackage[size=a1,scale=1.4]{beamerposter}
\newlength{\after}\setlength{\after}{0.5\paperwidth}
\newlength{\lw}\setlength{\lw}{\linewidth}
\newlength{\tw}\setlength{\tw}{\textwidth}
\newlength{\cw}\setlength{\cw}{\columnwidth}
\newlength{\emw}\setlength{\emw}{2em}
\newlength{\exw}\setlength{\exw}{2ex}
\usepackage{calc}
\newlength{\calcw}\setlength{\calcw}{\paperwidth - 2\after + 3cm}
\newlength{\dimw}\setlength{\dimw}{\dimexpr\paperwidth/3 - 1pt\relax}
\newlength{\addw}\setlength{\addw}{1cm}\addtolength{\addw}{0.1\paperwidth}
\usetheme{Madrid}
\begin{document}
\begin{frame}x\end{frame}
\end{document}`;

describe("preamble length registers", () => {
  const { registers, diagnostics } = scanBeamerLengthRegisters(scanBeamerDocument(PROBE), { em: 10.95, ex: 4.86665 });

  it("evaluates each assignment with the values current at that point", () => {
    expect(registers.get("before")).toBeCloseTo(182.09767, 4);
    expect(registers.get("after")).toBeCloseTo(1196.43846, 4);
  });

  it("keeps the class text width in \\linewidth and \\columnwidth until the document starts", () => {
    expect(registers.get("lw")).toBeCloseTo(307.28987, 3);
    expect(registers.get("cw")).toBeCloseTo(307.28987, 3);
    expect(registers.get("tw")).toBeCloseTo(2335.97145, 3);
  });

  it("evaluates em and ex in the class font", () => {
    expect(registers.get("emw")).toBeCloseTo(21.90005, 3);
    expect(registers.get("exw")).toBeCloseTo(9.7333, 3);
  });

  it("evaluates calc sums, \\dimexpr and \\addtolength", () => {
    expect(registers.get("calcw")).toBeCloseTo(85.35828, 4);
    expect(registers.get("dimw")).toBeCloseTo(796.62564, 4);
    expect(registers.get("addw")).toBeCloseTo(267.75504, 4);
    expect(diagnostics).toEqual([]);
  });

  it("reports assignments it cannot evaluate", () => {
    const source = String.raw`\documentclass{beamer}
\newlength{\x}\setlength{\x}{\widthof{abc}}
\begin{document}\begin{frame}x\end{frame}\end{document}`;
    const result = scanBeamerLengthRegisters(scanBeamerDocument(source), { em: 10.95, ex: 4.86665 });
    expect(result.diagnostics.map(d => d.code)).toEqual(["beamer-length-unsupported"]);
  });
});

describe("length expressions", () => {
  const lookup = (name: string) => ({ a: 100, b: 10 } as Record<string, number>)[name];

  it("reads factors, units, sums and scaling", () => {
    expect(evaluateTexLengthExpression(String.raw`\a`, lookup)).toBe(100);
    expect(evaluateTexLengthExpression(String.raw`-\a`, lookup)).toBe(-100);
    expect(evaluateTexLengthExpression(String.raw`\a - 2\b + 1pt`, lookup)).toBe(81);
    expect(evaluateTexLengthExpression(String.raw`\a*\real{0.5}`, lookup)).toBe(50);
    expect(evaluateTexLengthExpression(String.raw`{\dimexpr \a / 4 \relax}`, lookup)).toBe(25);
  });

  it("refuses unknown registers and stray text", () => {
    expect(evaluateTexLengthExpression(String.raw`\c`, lookup)).toBeNull();
    expect(evaluateTexLengthExpression(String.raw`\a \b`, lookup)).toBeNull();
    expect(evaluateTexLengthExpression("", lookup)).toBeNull();
  });
});

describe("register uses in frames", () => {
  it("replaces uses but not assignment targets", () => {
    const mapped = projectBeamerLengthRegisters(
      createIdentityMappedText(String.raw`\rule{0.5\colwidth}{1pt} \setlength{\colwidth}{1pt}`),
      new Map([["colwidth", 100]])
    );
    expect(mapped.text).toBe(String.raw`\rule{50pt}{1pt} \setlength{\colwidth}{1pt}`);
  });

  it("sizes columns given by registers", async () => {
    const result = await renderBeamerFrame(String.raw`\documentclass{beamer}
\newlength{\colwidth}\setlength{\colwidth}{0.3\paperwidth}
\begin{document}
\begin{frame}
\begin{columns}
\begin{column}{\colwidth}Left\end{column}
\begin{column}{\colwidth}Right\end{column}
\end{columns}
\end{frame}
\end{document}`, { frameIndex: 0 });
    const widths = result.layout.paragraphs.filter(paragraph => paragraph.role === "body").map(paragraph => paragraph.bounds.width);
    expect(widths).toHaveLength(2);
    for (const width of widths) expect(width).toBeCloseTo(0.3 * 364.19528, 1);
  });
});

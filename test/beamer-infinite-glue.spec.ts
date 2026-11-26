import { describe, expect, it } from "vitest";
import { prepareBeamerDocument } from "../packages/core/src/beamer/index.js";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/index.js";
import { buildNativeBeamerPageTrace } from "../scripts/lib/beamer-frame-compare.mjs";

const frame = (body: string) => String.raw`\documentclass[11pt]{beamer}
\begin{document}
\begin{frame}{T}
${body}
\end{frame}
\end{document}`;

async function glyphXs(body: string) {
  const result = await prepareBeamerDocument(frame(body)).renderFrame();
  const trace = buildNativeBeamerPageTrace(result, computerModernTexMetricProvider);
  return trace.lines.filter(line => line.text !== "T").map(line => ({ text: line.text, glyphs: line.glyphs.map(glyph => glyph.x), baselineY: line.baselineY }));
}

// Expected x positions are from LuaLaTeX page traces (beamer 11pt, text width 307.29pt from x=28.45).
// The trace splits a line at each glue gap, one entry per chunk.
const starts = async (body: string) => Object.fromEntries((await glyphXs(body)).map(line => [line.text, line.glyphs[0]]));

describe("infinite horizontal glue in paragraph text", () => {
  it("sets \\hfill between words flush against both margins and does not literalise it", async () => {
    const x = await starts(String.raw`Left\hfill Right`);
    expect(Object.keys(x)).toEqual(["Left", "Right"]);
    expect(x.Left).toBeCloseTo(28.452756, 2);
    expect(x.Right).toBeCloseTo(310.96, 1);
  });

  it("splits the shortfall between two \\hfill glues and keeps blank lines as paragraph breaks", async () => {
    const x = await starts(String.raw`Name\hfill{\small centre}\hfill Date

\hfill Flush right

Flush left\hfill`);
    expect(x.Name).toBeCloseTo(28.45, 2);
    expect(x.centre).toBeCloseTo(171.63, 1);
    expect(x.Date).toBeCloseTo(313.76, 1);
    expect(x.Flushright).toBeCloseTo(286.28, 1);
    expect(x.Flushleft).toBeCloseTo(28.45, 2);
  });

  it("centres with \\hspace*{\\fill} on both sides and weights \\stretch", async () => {
    const x = await starts(String.raw`\hspace*{\fill}Centred\hspace*{\fill}

A\hspace{\fill}B\hspace*{\fill}C

Stretch\hspace{\stretch{1}}one\hspace{\stretch{3}}three`);
    expect(x.Centred).toBeCloseTo(164.23, 1);
    expect(x.B).toBeCloseTo(178.60, 1);
    expect(x.C).toBeCloseTo(328.75, 1);
    expect(x.one).toBeCloseTo(120.35, 1);
    expect(x.three).toBeCloseTo(312.66, 1);
  });
});

describe("tcolorbox text inside a column", () => {
  it("is justified (halign=justify overrides the column's \\raggedright) and hyphenates like LuaLaTeX", async () => {
    const source = String.raw`\documentclass[final]{beamer}
\usepackage[orientation=landscape,size=a1,scale=1.2]{beamerposter}
\usepackage[most]{tcolorbox}
\begin{document}
\begin{frame}[t]
\begin{columns}[T]
\begin{column}{0.32\linewidth}
\begin{tcolorbox}[colback=white]
\large
\textbf{Goal}: Recover full connectivity matrix from \textbf{partial measurements} across multiple recording sessions and some more words to break more lines than one or two.
\end{tcolorbox}
\end{column}
\end{columns}
\end{frame}
\end{document}`;
    const result = await prepareBeamerDocument(source).renderFrame();
    const trace = buildNativeBeamerPageTrace(result, computerModernTexMetricProvider);
    const lines = trace.lines.filter(line => line.role === "block-body");
    // LuaLaTeX: justified lines; line 1 is stretched to the full 716pt measure (ragged text would end near 690).
    expect(lines).toHaveLength(3);
    const widths = lines.slice(0, 2).map(line => line.glyphs.at(-1)!.x - line.glyphs[0].x);
    expect(widths[0]).toBeGreaterThan(700);
  });
});

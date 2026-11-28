import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { applyDeckEditAction, renderBeamerFrame } from "../packages/core/src/beamer/index.js";
import { pgfplotsPreambleInsertions } from "../packages/core/src/edit/pgfplots/templates.js";
import { CHART_KINDS } from "../packages/core/src/edit/pgfplots/chart-kinds.js";
import { deckChartHeight } from "../packages/core/src/beamer/deck-insert-pgfplots.js";
import { beamerPictureLengths } from "../packages/core/src/beamer/picture-lengths.js";
import { createBeamerSyntaxContext } from "../packages/core/src/beamer/syntax.js";
import { parseTikz, renderTikzToSvgAsync } from "../packages/core/src/index.js";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/index.js";
import { buildNativeBeamerPageTrace, compareBeamerPageTraces, type OracleBeamerPageTrace } from "../scripts/lib/beamer-frame-compare.mjs";

// pgfplots axes on Beamer slides, against LuaLaTeX (fixtures written for this
// spec; oracles from scripts/compare-beamer-frame.mjs page traces).
const fixture = (name: string) => ({
  source: readFileSync(new URL(`./fixtures/beamer/pgfplots/${name}.tex`, import.meta.url), "utf8"),
  oracle: JSON.parse(readFileSync(new URL(`./fixtures/beamer/pgfplots/${name}.oracle.json`, import.meta.url), "utf8")) as {
    pages: Array<{ frame: number; step: number; trace: OracleBeamerPageTrace }>;
  },
});

const CASES = ["d2-columns", "d4-block", "d7-only", "d8-madrid", "d9-169", "d12-pause-inside", "d13-overlay-matrix", "d14-overfull", "d15-inserted", "d16-madrid169-heights", "d18-colour-font"];

describe("pgfplots in Beamer frames", () => {
  for (const name of CASES) {
    const { source, oracle } = fixture(name);
    it.each(oracle.pages.map((page) => [page.frame, page.step, page] as const))(`${name}: frame %i step %i matches LuaLaTeX`, async (frame, step, page) => {
      const rendered = await renderBeamerFrame(source, { frameIndex: frame - 1, step });
      expect(rendered.diagnostics.filter((diagnostic) => !diagnostic.code?.startsWith("pgfplots-compat"))).toEqual([]);
      const comparison = compareBeamerPageTraces(buildNativeBeamerPageTrace(rendered, computerModernTexMetricProvider), page.trace);
      expect(comparison.summary.glyphCodeMatch).toBe(true);
      expect(comparison.summary.fontMatch).toBe(true);
      expect(comparison.summary.unmatchedNativeTextLines).toBe(0);
      expect(comparison.summary.unmatchedOracleTextLines).toBe(0);
      // Tick labels sit where the axis box puts them: positions check its size too.
      expect(comparison.summary.maxAbsoluteGlyphDxPt).toBeLessThan(0.01);
      expect(comparison.summary.maxAbsoluteGlyphDyPt).toBeLessThan(0.01);
    });
  }

  const red = (rendered: Awaited<ReturnType<typeof renderBeamerFrame>>) =>
    rendered.layout.embeddedTikz.flatMap((tikz) => tikz.model.parts).filter((part) => /stroke="(?:#f00|#ff0000|red|rgb\(255,\s*0,\s*0\))"/iu.test(part.markup)).length;

  it("draws a plot inside \\only<2>{…} on step 2 only, with its legend entry", async () => {
    const { source } = fixture("d7-only");
    const first = await renderBeamerFrame(source, { step: 1 });
    const second = await renderBeamerFrame(source, { step: 2 });
    expect(first.diagnostics).toEqual([]);
    expect(second.diagnostics).toEqual([]);
    expect(red(first)).toBe(0);
    // The plot and its legend image.
    expect(red(second)).toBe(2);
  });

  it("covers the whole axis while a \\pause in its body holds (pgfplots draws at \\end{axis})", async () => {
    const { source } = fixture("d12-pause-inside");
    const first = await renderBeamerFrame(source, { step: 1 });
    const second = await renderBeamerFrame(source, { step: 2 });
    const [tikz1] = first.layout.embeddedTikz;
    const [tikz2] = second.layout.embeddedTikz;
    expect(tikz1?.model.parts.filter((part) => part.elementId)).toEqual([]);
    expect(tikz1?.coveredModel?.parts.length ?? 0).toBeGreaterThan(0);
    expect(tikz2?.coveredModel?.parts ?? []).toEqual([]);
    // Same box on both steps.
    expect(tikz1?.bounds).toEqual(tikz2?.bounds);
  });

  it("ignores \\uncover and \\visible around a plot: they end before the axis is drawn", async () => {
    const { source } = fixture("d13-overlay-matrix");
    const first = await renderBeamerFrame(source, { frameIndex: 1, step: 1 });
    expect(first.layout.embeddedTikz[0]?.coveredModel?.parts ?? []).toEqual([]);
  });

  it("draws the axis in the theme's text colour, as LuaLaTeX does", async () => {
    // normal text fg=blue!50!black: box, ticks and labels #000080; the plot keeps its cycle colour.
    const { source } = fixture("d18-colour-font");
    const rendered = await renderBeamerFrame(source);
    const markup = rendered.layout.embeddedTikz.flatMap((tikz) => tikz.model.parts.map((part) => part.markup)).join("");
    expect(markup).toContain("#000080");
    expect(markup).toContain("#0000ff");
  });

  it("reports \\addplot<spec>, which pgfplots refuses", async () => {
    const source = String.raw`\documentclass{beamer}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\begin{document}
\begin{frame}
\begin{tikzpicture}
\begin{axis}
\addplot coordinates {(0,0) (1,1)};
\addplot<2-> coordinates {(0,1) (1,0)};
\end{axis}
\end{tikzpicture}
\end{frame}
\end{document}`;
    const rendered = await renderBeamerFrame(source);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.code === "pgfplots-addplot-overlay-spec" && diagnostic.severity === "error")).toBe(true);
  });

  it("sizes \\textwidth, \\linewidth and \\columnwidth axes by the environment around the picture", async () => {
    const deck = (body: string) => String.raw`\documentclass{beamer}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\begin{document}
\begin{frame}
${body}
\end{frame}
\end{document}`;
    const picture = (width: string) => String.raw`\begin{tikzpicture}\begin{axis}[width=${width}, height=3cm]\addplot coordinates {(0,0) (1,1)};\end{axis}\end{tikzpicture}`;
    const widthOf = async (body: string) => (await renderBeamerFrame(deck(body))).layout.embeddedTikz[0]?.bounds.width ?? NaN;
    // TeX (len/l.tex): a column sets all three lengths; a block none; itemize narrows \linewidth by 2em.
    const half = await widthOf(picture("153.64493pt"));
    expect(await widthOf(String.raw`\begin{columns}\begin{column}{0.5\textwidth}${picture("\\columnwidth")}\end{column}\end{columns}`)).toBeCloseTo(half, 2);
    const block = await widthOf(picture("245.8319pt"));
    expect(await widthOf(String.raw`\begin{block}{B}${picture("0.8\\linewidth")}\end{block}`)).toBeCloseTo(block, 2);
    const item = await widthOf(picture("285.38988pt"));
    expect(await widthOf(String.raw`\begin{itemize}\item ${picture("\\linewidth")}\end{itemize}`)).toBeCloseTo(item, 2);
  });
});

describe("Insert → Function Plot on a slide", () => {
  const DECK = String.raw`\documentclass{beamer}
\usepackage{tikz}
\begin{document}
\begin{frame}{Plot}
Some text.
\end{frame}
\end{document}`;
  it("puts a centred picture with the axis at the end of the frame and the preamble lines once", async () => {
    const first = await renderBeamerFrame(DECK);
    const inserted = applyDeckEditAction(DECK, first.layout, { kind: "deckInsertPgfplotsTemplate", frameId: first.layout.frameId, template: "function", placement: { kind: "end" } });
    expect(inserted.kind).toBe("success");
    if (inserted.kind !== "success") return;
    expect(inserted.newSource).toBe(String.raw`\documentclass{beamer}
\usepackage{tikz}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\begin{document}
\begin{frame}{Plot}
Some text.
\begin{center}
  \begin{tikzpicture}
    \begin{axis}[width=0.8\linewidth, height=0.6\textheight, xlabel={$x$}, ylabel={$f(x)$}, domain=-2:2, samples=50]
      \addplot {x^2 - 1};
      \addlegendentry{$x^2 - 1$}
    \end{axis}
  \end{tikzpicture}
\end{center}
\end{frame}
\end{document}`);
    const second = await renderBeamerFrame(inserted.newSource);
    expect(second.diagnostics).toEqual([]);
    const picture = second.layout.embeddedTikz[0];
    // The axis fits on the slide (its size against LuaLaTeX: fixture d15-inserted).
    expect(picture?.bounds.width ?? 0).toBeLessThan(307.28987);
    expect((picture?.bounds.y ?? 0) + (picture?.bounds.height ?? 0)).toBeLessThan(273.14662);
    const again = applyDeckEditAction(inserted.newSource, second.layout, { kind: "deckInsertPgfplotsTemplate", frameId: second.layout.frameId, template: "bar", placement: { kind: "end" } });
    expect(again.kind === "success" ? again.newSource.match(/usepackage\{pgfplots\}|compat=1\.18/gu) : null).toEqual(["usepackage{pgfplots}", "compat=1.18"]);
  });
  it("adds only what the preamble lacks", () => {
    expect(pgfplotsPreambleInsertions(String.raw`\documentclass{beamer}\n\usepackage{pgfplots}\n\pgfplotsset{compat=1.17}\n\begin{document}\end{document}`)).toEqual([]);
    expect(pgfplotsPreambleInsertions("\\documentclass{beamer}\n\\usepackage{pgfplots}\n\\begin{document}\n\\end{document}").map((entry) => entry.text)).toEqual(["\n\\pgfplotsset{compat=1.18}"]);
    expect(pgfplotsPreambleInsertions("\\begin{tikzpicture}\\end{tikzpicture}")).toEqual([]);
  });
});

describe("beamerPictureLengths", () => {
  // \the\textwidth / \the\linewidth measured in LuaLaTeX (beamer 3.72, 11pt).
  const lengthsAt = (body: string, marker = "PICTURE", textWidth = 307.28987) => {
    const source = `\\begin{frame}${body}\\end{frame}`;
    const from = source.indexOf(marker);
    return beamerPictureLengths({ context: createBeamerSyntaxContext(source), span: { from, to: from + marker.length },
      bodySpan: { from: 0, to: source.length }, textWidth, paperWidth: 364.19536, emPt: 10.95, listLeftMarginEmByDepth: [2, 2, 2] });
  };
  it("follows columns, minipages, blocks and lists", () => {
    expect(lengthsAt(String.raw`\begin{columns}\begin{column}{0.5\textwidth}PICTURE\end{column}\end{columns}`)).toEqual({ textwidth: expect.closeTo(153.64493, 2), linewidth: expect.closeTo(153.64493, 2) });
    expect(lengthsAt(String.raw`\begin{block}{b}PICTURE\end{block}`)).toEqual({ textwidth: 307.28987, linewidth: 307.28987 });
    expect(lengthsAt(String.raw`\begin{itemize}\item PICTURE\end{itemize}`)?.linewidth).toBeCloseTo(285.38988, 2);
    // Madrid's text width.
    expect(lengthsAt(String.raw`\begin{itemize}\item\begin{itemize}\item\begin{itemize}\item PICTURE\end{itemize}\end{itemize}\end{itemize}`, "PICTURE", 342.29536)?.linewidth).toBeCloseTo(276.59538, 2);
    expect(lengthsAt(String.raw`\begin{description}\item[a] PICTURE\end{description}`, "PICTURE", 342.29536)?.linewidth).toBeCloseTo(279.91487, 2);
    expect(lengthsAt(String.raw`\begin{columns}[onlytextwidth]\begin{column}{0.4\textwidth}\begin{itemize}\item PICTURE\end{itemize}\end{column}\end{columns}`, "PICTURE", 342.29536))
      .toEqual({ textwidth: expect.closeTo(136.91605, 2), linewidth: expect.closeTo(115.01605, 2) });
    expect(lengthsAt(String.raw`\begin{columns}\begin{column}{0.4\textwidth}\begin{minipage}{0.5\textwidth}PICTURE\end{minipage}\end{column}\end{columns}`, "PICTURE", 342.29536))
      .toEqual({ textwidth: expect.closeTo(68.45802, 2), linewidth: expect.closeTo(68.45802, 2) });
  });
});

describe("overlay commands in an axis body", () => {
  const picture = (body: string) => String.raw`\begin{tikzpicture}
\begin{axis}
${body}
\end{axis}
\end{tikzpicture}`;
  it("reads \\only<2>{\\addplot …;} as an axis plot in an overlay group", () => {
    const parsed = parseTikz(picture(String.raw`\addplot coordinates {(0,0) (1,1)};
\only<2>{\addplot coordinates {(0,1) (1,0)};}
\only<2>{\addlegendentry{B}}`));
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const axis = parsed.figure.body.find((statement) => statement.kind === "Axis");
    expect(axis?.kind === "Axis" ? axis.body.map((item) => `${item.kind}${item.overlayGroups?.length ? "@" : ""}`) : null)
      .toEqual(["AddPlot", "OverlayGroup", "AddPlot@", "OverlayGroup", "AddLegendEntry@"]);
  });
  it("drops what \\only removes and keeps what \\uncover covers, in standalone evaluation too", async () => {
    const source = picture(String.raw`\addplot coordinates {(0,0) (1,1)};
\only<2>{\addplot coordinates {(0,3) (1,3)};}
\uncover<2>{\addplot coordinates {(0,1) (1,0)};}`);
    const at = (step: number) => (span: { from: number; to: number }) => {
      const text = source.slice(span.from, span.to);
      if (step < 2 && text.includes("(0,3)")) return "removed" as const;
      if (step < 2 && text.includes("(1,0)};")) return "hidden" as const;
      return "visible" as const;
    };
    const first = await renderTikzToSvgAsync(source, { evaluate: { overlayVisibility: at(1) } });
    const second = await renderTikzToSvgAsync(source, { evaluate: { overlayVisibility: at(2) } });
    const plots = (result: typeof first) => result.semantic.scene.elements.filter((element) => element.id.includes(":plot:") && element.kind === "Path" && !element.overlayCovered).length;
    expect(plots(second) - plots(first)).toBeGreaterThan(0);
    expect(first.semantic.scene.elements.some((element) => element.overlayCovered)).toBe(false);
  });
  it("reports an axis command in an overlay body outside an axis", async () => {
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}\only<2>{\addplot coordinates {(0,0) (1,1)};}\end{tikzpicture}`, {});
    expect(result.semantic.diagnostics.some((diagnostic) => diagnostic.code === "pgfplots-command-outside-axis")).toBe(true);
  });
});

describe("every chart kind on a slide (the shared chart-kind list feeds the deck rule)", () => {
  const DECK = String.raw`\documentclass{beamer}
\usepackage{tikz}
\begin{document}
\begin{frame}{Plot}
Some text.
\end{frame}
\end{document}`;
  it("inserts each kind without diagnostics, sized to the slide", async () => {
    const first = await renderBeamerFrame(DECK);
    for (const kind of CHART_KINDS) {
      const inserted = applyDeckEditAction(DECK, first.layout, { kind: "deckInsertPgfplotsTemplate", frameId: first.layout.frameId, template: kind.id, placement: { kind: "end" } });
      expect(inserted.kind, kind.id).toBe("success");
      if (inserted.kind !== "success") continue;
      expect(inserted.newSource, kind.id).toMatch(/\\begin\{\w+\}\[width=0\.8\\linewidth, height=0\.6\\textheight, /u);
      const rendered = await renderBeamerFrame(inserted.newSource);
      expect(rendered.diagnostics, kind.id).toEqual([]);
      const picture = rendered.layout.embeddedTikz[0];
      expect((picture?.bounds.y ?? 0) + (picture?.bounds.height ?? 0), kind.id).toBeLessThan(273.14662);
    }
  });

  it("a second chart takes the room that is left (at least 0.3\\textheight)", async () => {
    const first = await renderBeamerFrame(DECK);
    const once = applyDeckEditAction(DECK, first.layout, { kind: "deckInsertPgfplotsTemplate", frameId: first.layout.frameId, template: "data", placement: { kind: "end" } });
    if (once.kind !== "success") throw new Error("first insert failed");
    const second = await renderBeamerFrame(once.newSource);
    expect(deckChartHeight(second.layout)).toBe("0.3");
    const empty = await renderBeamerFrame(DECK.replace("Some text.\n", ""));
    expect(deckChartHeight(empty.layout)).toBe("0.6");
  });
});

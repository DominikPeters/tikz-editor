import type { NodeTextMeasureRequest } from "../../packages/core/src/text/types.js";
import type { DocumentGraphicsResolver } from "../../packages/core/src/graphics/types.js";
import { createIdentityMappedText } from "../../packages/core/src/text/source-map.js";
import { createBeamerTexMathFontProfile } from "../../packages/core/src/beamer/theme/font.js";
import type { BenchSample, BenchStep, TextEngineBenchCase } from "./text-engine-bench.js";

export const beamerBenchMathProfile = createBeamerTexMathFontProfile({
  family: "sans", series: "medium", shape: "upright", sizePt: 11, lineHeightPt: 13.2,
});

export function textBenchRequest(text: string, options: Partial<NodeTextMeasureRequest> = {}): NodeTextMeasureRequest {
  return {
    text, textWidthPt: null, fontStyle: "normal", fontWeight: "normal",
    fontFamily: "serif", fontSizePt: 10, ...options,
  };
}

type FixtureOptions = {
  request?: Partial<NodeTextMeasureRequest>;
  expected?: BenchStep["expected"];
  requiredSvg?: readonly string[];
  mode?: TextEngineBenchCase["mode"];
  engine?: "beamer";
};

function fixture(name: string, group: string, template: string, options: FixtureOptions = {}): TextEngineBenchCase {
  return {
    name, group, mode: options.mode ?? "cold", engine: options.engine,
    steps: ({ token }) => [{
      request: textBenchRequest(template.replaceAll("{i}", token), options.request),
      expected: options.expected, requiredSvg: options.requiredSvg,
    }],
  };
}

const mathSvg = ['data-tex-inline-math="true"'];
const displaySvg = ['data-tex-display-math="true"'];
const listSvg = ['data-tex-hbox-role="list-label"'];
const paragraph = "Consider a weighted directed graph {i} whose vertices represent voters and whose " +
  "edges encode delegation choices; we study the complexity of finding an " +
  "assignment that maximizes total welfare subject to rationality constraints.";
const mixedParagraph = String.raw`For every $\varepsilon > 0$ there is an integer {i} such that the mechanism is ` +
  String.raw`$\varepsilon$-approximately strategyproof and runs in $O(n^2 \log n)$ time on ` +
  "profiles with $n$ voters and $m$ alternatives.";
const multiline = String.raw`first line {i}\\second line\\third and final line`;
const graphicsAsset = {
  status: "resolved" as const, mimeType: "image/svg+xml" as const,
  dataBase64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="blue"/></svg>').toString("base64"),
  naturalWidthPt: 40, naturalHeightPt: 20, revision: "text-bench-image-v1",
};
const resolvedGraphics: DocumentGraphicsResolver = {
  cacheKey: "text-bench-image", resolve: () => graphicsAsset,
};

function proseEditSteps({ token }: BenchSample, wrap: (text: string) => string, width: number | null): BenchStep[] {
  const base = `State ${token}: `;
  const suffix = "ready to publish";
  const texts = Array.from({ length: suffix.length + 1 }, (_, index) => base + suffix.slice(0, index));
  const last = texts[texts.length - 1];
  const insertion = last.indexOf("ready");
  const inserted = last.slice(0, insertion) + "almost " + last.slice(insertion);
  return [
    ...texts.map((text) => ({ request: textBenchRequest(wrap(text), { textWidthPt: width }) })),
    { request: textBenchRequest(wrap(inserted), { textWidthPt: width }) },
    // Delete the inserted word, backspace the last character, then undo/redo.
    ...[last, texts[texts.length - 2], last, inserted].map((text) => ({
      request: textBenchRequest(wrap(text), { textWidthPt: width }), cache: "hit" as const,
    })),
  ];
}

export const TEXT_ENGINE_BENCH_CASES: readonly TextEngineBenchCase[] = [
  // Preserve the original case names for --only filters and result comparisons.
  fixture("tiny word", "labels", "n{i}"),
  fixture("short label", "labels", "state q{i}"),
  fixture("inline math short", "math", "$x_{{i}}$", { requiredSvg: mathSvg }),
  fixture("inline math", "math", String.raw`cost $O(n \log n) + {i}$`, { requiredSvg: mathSvg }),
  fixture("styled text", "fonts", String.raw`\textbf{server {i}} node`),
  fixture("sentence (natural width)", "labels", "The quick brown fox {i} jumps over the lazy dog near the river bank."),
  fixture("paragraph wrapped 150pt", "paragraphs", paragraph, { request: { textWidthPt: 150 } }),
  fixture("paragraph wrapped 150pt + math", "paragraphs", mixedParagraph, { request: { textWidthPt: 150 }, requiredSvg: mathSvg }),
  fixture("explicit multiline", "paragraphs", multiline),
  fixture("matrix math cell", "math", String.raw`$\sum_{k=1}^{n} k^2 + {i}$`, { requiredSvg: mathSvg }),

  fixture("ligatures and kerning", "shaping", "office affinity efficient fluff AV To Wa {i}"),
  fixture("quotes dashes and escaped prose", "shaping", String.raw`\%\&\_\#\$\{\} \textbackslash{} ` + "``quoted'' -- --- " + String.raw`\ldots\ text~tie {i}`),
  fixture("Unicode and TeX accents", "shaping", String.raw`Café naïve résumé Ångström \"{o} \'{e} \c{c} ` + "e\u0301 i\u0303 {i}"),
  fixture("automatic hyphenation", "shaping", "Sample {i} snuffless internationalization representation communication", { request: { textWidthPt: 60 }, requiredSvg: ['data-tex-glyph="45"'] }),
  ...(["serif", "sans", "monospace"] as const).map((fontFamily) =>
    fixture(`font ${fontFamily} bold italic`, "fonts", "Formatted label {i}", {
      request: { fontFamily, fontStyle: "italic", fontWeight: "bold" },
    })
  ),
  ...[7, 12, 20].map((fontSizePt) => fixture(`font size ${fontSizePt}pt`, "fonts", String.raw`Sized {i} $x_i^2$`, { request: { fontSizePt }, requiredSvg: mathSvg })),
  fixture("nested styles sizes and colors", "fonts", String.raw`Plain {i} \textbf{bold \textit{italic}} {\small small} {\Large large} \textcolor{red}{red $x$} {\color{blue}blue}`, { requiredSvg: ['fill="#ff0000"', 'fill="#0000ff"', ...mathSvg] }),

  ...(["ragged-right", "ragged-left", "center", "justified"] as const).flatMap((alignment) =>
    [80, 300].map((textWidthPt) => fixture(`paragraph ${alignment} ${textWidthPt}pt`, "paragraphs", paragraph, { request: { alignment, textWidthPt } }))
  ),
  ...(["ragged-left", "center", "justified"] as const).map((alignment) =>
    fixture(`natural multiline ${alignment}`, "paragraphs", multiline, { request: { alignment } })
  ),
  fixture("forced breaks and paragraph boundaries", "paragraphs", String.raw`Alpha {i} Beta Gamma Delta \\[4pt] Epsilon Zeta\par Another paragraph with words and math $x^2$.`, { request: { textWidthPt: 100, alignment: "justified" }, requiredSvg: mathSvg }),
  fixture("long paragraph 120pt", "paragraphs", paragraph + " " + "Automatic paragraph breaking considers several alternatives and keeps source geometry for every glyph. ".repeat(12), { request: { textWidthPt: 120, alignment: "justified" } }),
  fixture("overfull unbreakable inline math", "paragraphs", String.raw`\begin{minipage}{30pt}$a+b+c+d+e+f+g+h+{i}$\end{minipage}`, { request: { textWidthPt: 120 }, requiredSvg: mathSvg }),

  fixture("itemize with math", "structure", String.raw`\begin{itemize}\item State {i} with enough words to wrap over more than one line.\item Cost $O(n^2)$\end{itemize}`, { request: { textWidthPt: 180 }, requiredSvg: [...listSvg, ...mathSvg] }),
  fixture("nested enumerate and itemize", "structure", String.raw`\begin{enumerate}\item Outer {i}\begin{itemize}\item Inner words for wrapping\item Inner $x_i$\end{itemize}\item Last outer\end{enumerate}`, { request: { textWidthPt: 200 }, requiredSvg: [...listSvg, ...mathSvg] }),
  fixture("description item paragraphs", "structure", String.raw`\begin{description}\item[State] Active {i}\item[Cost] The running time is $O(n^2)$\end{description}`, { request: { textWidthPt: 200 }, requiredSvg: mathSvg }),
  fixture("quote with multiple paragraphs", "structure", String.raw`Lead {i}\begin{quote}Quoted prose with words that should wrap.\par A second paragraph $x^2$.\end{quote}Tail`, { request: { textWidthPt: 180 }, requiredSvg: mathSvg }),
  fixture("center and flush environments", "structure", String.raw`\begin{center}Centered {i} words\\next line\end{center}\begin{flushright}Right aligned tail\end{flushright}`, { request: { textWidthPt: 180 } }),
  fixture("minipage with display and list", "structure", String.raw`\begin{minipage}{120pt}Frame {i}\[\frac{x^2}{1+x}\]\begin{itemize}\item A nested item\item Another item\end{itemize}\end{minipage}`, { request: { textWidthPt: 200 }, requiredSvg: [...displaySvg, ...listSvg] }),
  fixture("parbox with nested quote", "structure", String.raw`\parbox{100pt}{State {i}\par\begin{quote}Quoted words inside a box\end{quote}}`, { request: { textWidthPt: 180 } }),

  fixture("text boxes frames and overlaps", "boxes", String.raw`{i} \mbox{unbroken words} \makebox[40pt][r]{right} \fbox{frame} \llap{L}\rlap{R}`, { requiredSvg: ['data-tex-rule="boxed-rule"'] }),
  fixture("color boxes rules and raised text", "boxes", String.raw`{i} \colorbox{yellow}{a \textcolor{blue}{b} $x$} \fcolorbox{red}{white}{c} \rule[2pt]{10pt}{1pt} \raisebox{3pt}{lift}`, { requiredSvg: ['data-tex-rule="colorbox-background"', ...mathSvg] }),
  fixture("phantom and smash dimensions", "boxes", String.raw`State {i} \phantom{hidden} \smash{tall}`, { request: { textWidthPt: 150 } }),
  fixture("vertical skips and penalties", "boxes", String.raw`State {i}\par\vspace{4pt}Next\par\smallskip\penalty100 Tail`, { request: { textWidthPt: 150 } }),

  fixture("nested fractions radicals and delimiters", "math", String.raw`$\left(\frac{1}{\sqrt{1+\frac{x_{{i}}^2}{y}}}\right)$`, { requiredSvg: mathSvg }),
  fixture("scripts accents and large operators", "math", String.raw`$\widehat{x_{{i}}}+\sum_{k=1}^{n}\frac{k^2}{n}+\int_0^1 f(t)\,dt$`, { requiredSvg: mathSvg }),
  fixture("AMS symbols alphabets and text in math", "math", String.raw`$\mathbb{R}^{i_{{i}}}\to\mathcal{F},\quad\operatorname{argmax}_{x}\text{utility}(x)$`, { requiredSvg: mathSvg }),
  fixture("actual math matrix with delimiters", "math", String.raw`$\begin{pmatrix}{i}&\frac{1}{2}\\x_i&\sqrt{y}\end{pmatrix}$`, { requiredSvg: mathSvg }),
  fixture("cases and aligned inline math", "math", String.raw`$f_{{i}}(x)=\begin{cases}x^2&x>0\\0&x\le0\end{cases}$ $\begin{aligned}a&=b+c\\d&=e\end{aligned}$`, { requiredSvg: mathSvg }),
  fixture("display equation with surrounding prose", "math", String.raw`Result {i}\[\sum_{k=1}^n\frac{k^2}{1+k}=\sqrt{x}\]This completes the calculation.`, { request: { textWidthPt: 220 }, requiredSvg: displaySvg }),
  fixture("display align environment", "math", String.raw`Equations {i}\begin{align}a&=b+c\\d&=\frac{e}{f}\end{align}Final words`, { request: { textWidthPt: 220 }, requiredSvg: ['data-tex-hbox-role="display-align-row"', 'data-tex-math-style="display"'] }),
  fixture("Beamer sans math profile", "math", String.raw`Frame {i}: $x_i^2+\alpha+\sum_{k=1}^{n}\frac{k}{n}$`, { engine: "beamer", request: { fontFamily: "sans", fontSizePt: 11 }, requiredSvg: [...mathSvg, 'data-tex-font="lmsans12-oblique"'] }),

  fixture("resolved contextual graphics", "resources", String.raw`Figure {i} \includegraphics[width=.5\linewidth,height=2em]{figure.svg}`, { request: { textWidthPt: 150, graphicsResolver: resolvedGraphics }, requiredSvg: ['data-tex-includegraphics="true"', '<image '] }),
  fixture("missing graphics placeholder", "resources", String.raw`Figure {i} \includegraphics[width=20pt]{missing.png}`, { request: { graphicsResolver: { cacheKey: "text-bench-missing", resolve: () => ({ status: "missing" }) } }, requiredSvg: ['data-tex-includegraphics-status="missing"'] }),
  {
    name: "named color resolver revisions", group: "resources", mode: "cold",
    steps: ({ token, index }) => {
      const color = index % 2 === 0 ? "#ff0000" : "#0000ff";
      return [{
        request: textBenchRequest(String.raw`\textcolor{brand}{Revision state}`, { colorResolver: {
          cacheKey: `bench-color-${token}`, resolve: (name) => name === "brand" ? color : null,
        } }), requiredSvg: [`fill="${color}"`],
      }];
    },
  },
  {
    name: "graphics resolver revisions", group: "resources", mode: "cold",
    steps: ({ token, index }) => [{
      request: textBenchRequest(String.raw`\includegraphics{revision.svg}`, { graphicsResolver: {
        cacheKey: `bench-graphics-${token}`,
        resolve: () => ({ ...graphicsAsset,
          naturalWidthPt: 40 + index % 10, revision: token,
        }),
      } }), requiredSvg: ['data-tex-includegraphics="true"', '<image '],
    }],
  },
  {
    name: "source map cold layout", group: "cache", mode: "cold",
    steps: ({ token, index }) => {
      const text = String.raw`Mapped {i} \textbf{words} and $x_i$`.replaceAll("{i}", token);
      const offset = 1000 + index * 100;
      return [{ request: textBenchRequest(text, { sourceMap: createIdentityMappedText(text, offset).sourceMap }), requiredSvg: [...mathSvg, `data-source-start="${offset}"`] }];
    },
  },
  {
    name: "source map shifted layout reuse", group: "cache", mode: "layout-reuse",
    steps: ({ index }) => {
      const text = String.raw`Shifted \textbf{words} and $x_i$`;
      const offset = 5000 + index * 100;
      return [{ request: textBenchRequest(text, { sourceMap: createIdentityMappedText(text, offset).sourceMap }), requiredSvg: [...mathSvg, `data-source-start="${offset}"`] }];
    },
  },
  fixture("evicted label remeasurement", "cache", "Evicted label {i}", { mode: "cache-churn" }),

  { name: "label append insert backspace undo redo", group: "editing", mode: "sequence", steps: (sample) => proseEditSteps(sample, (text) => text, null) },
  { name: "styled paragraph edit sequence", group: "editing", mode: "sequence", steps: (sample) => proseEditSteps(sample, (text) => String.raw`\textbf{${text}} with a wrapped paragraph of extra words.`, 100) },
  {
    name: "math typing incomplete to complete", group: "editing", mode: "sequence",
    steps: ({ token }) => {
      const formula = String.raw`$x^{2}+\frac{1}{n}$`;
      return Array.from({ length: formula.length }, (_, index) => ({
        request: textBenchRequest(`Formula ${token}: ` + formula.slice(0, index + 1)),
        expected: index === formula.length - 1 ? "native" as const : "literal" as const,
        requiredSvg: index === formula.length - 1 ? mathSvg : ['data-tex-literal="malformed-input"'],
      }));
    },
  },
  fixture("incomplete list literal", "fallback", String.raw`\begin{enumerate}\item Alpha {i}`, { request: { textWidthPt: 150 }, expected: "literal", requiredSvg: ['data-tex-literal="malformed-input"'] }),
  fixture("unsupported command rejection", "fallback", String.raw`Alpha {i} \noindent Beta`, { expected: "null" }),
  fixture("empty input rejection", "fallback", "   ", { expected: "null" }),
  {
    name: "paragraph width changes with shared IR", group: "cache", mode: "sequence",
    steps: ({ token }) => [80, 150, 300, 210].map((textWidthPt) => ({
      request: textBenchRequest(paragraph.replaceAll("{i}", token), { textWidthPt }),
    })),
  },
  fixture("repeated fractions with source projection", "cache", String.raw`State {i}: $\frac{x_1}{\sqrt{1+y^2}}$ and $\frac{x_1}{\sqrt{1+y^2}}$ then $\frac{x_1}{\sqrt{1+y^2}}$ finally $\frac{x_1}{\sqrt{1+y^2}}$.`, { request: { textWidthPt: 180 }, requiredSvg: mathSvg }),
];

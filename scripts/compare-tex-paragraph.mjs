#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { escapeTexText, runTexOracleDocument } from "./lib/tex-oracle.mjs";

const distEntry = resolve(process.cwd(), "packages/core/dist/text/tex/index.js");
if (!existsSync(distEntry)) {
  throw new Error("Missing packages/core/dist/text/tex/index.js. Run `npm run -w @tikz-editor/core build` first.");
}

const {
  classicComputerModernTextFontProfile,
  layoutSimpleTexParagraph,
} = await import(distEntry);

// Oracle/regeneration helper for TeX paragraph layout fixtures in
// test/tex-shaping.spec.ts. Run via `npm run compare:tex-paragraph`.
const fixtures = [
  { text: "Alpha Beta", width: 32, parindent: 0 },
  { text: "office AV To", width: 65, parindent: 0 },
  { text: "A simple Computer Modern paragraph uses TeX metrics", width: 105, parindent: 0 },
  { text: "Alpha Beta Gamma", width: 44, parindent: 10 },
  { text: "A simple Computer Modern paragraph uses TeX metrics", width: 105, parindent: 15 },
  { text: "Alpha\nBeta Gamma", width: 150, parindent: 0 },
  { text: "Alpha\n\nGamma", width: 150, parindent: 10 },
  { text: String.raw`Alpha \\ Beta`, width: 150, parindent: 0, texSyntax: true },
  { text: String.raw`Alpha \\[7pt] Beta`, width: 150, parindent: 0, texSyntax: true },
  { text: String.raw`Alpha \par Gamma`, width: 150, parindent: 10, texSyntax: true },
  { text: String.raw`\noindent Alpha \par Gamma \par \noindent Delta`, width: 150, parindent: 10, texSyntax: true },
  { text: String.raw`Alpha \par \smallskip Beta \par \vspace{7pt} Gamma`, width: 150, parindent: 0, texSyntax: true, compareY: true },
  { text: String.raw`Alpha \par \medskip Beta \par \bigskip Gamma`, width: 150, parindent: 0, texSyntax: true, compareY: true },
  { text: String.raw`Alpha \par \vspace{-4pt} Beta \par \vskip -2pt Gamma`, width: 150, parindent: 0, texSyntax: true, compareY: true },
  { text: String.raw`Alpha \par \vskip 6pt plus 2pt minus 3pt Beta`, width: 150, parindent: 0, texSyntax: true, compareY: true },
  { text: String.raw`\begin{quote} Alpha \par \smallskip Beta \end{quote}`, width: 150, parindent: 0, texSyntax: true, compareY: true },
  { text: String.raw`\begin{quote} Alpha \par \vspace{7pt} Beta \end{quote}`, width: 150, parindent: 0, texSyntax: true, compareY: true },
  { text: String.raw`\begin{quote} Alpha \par \vskip -2pt Beta \end{quote}`, width: 150, parindent: 0, texSyntax: true, compareY: true },
  { text: String.raw`\begin{quote} Alpha \par \hrule width 24pt height 2pt depth 1pt Beta \end{quote}`, width: 150, parindent: 0, texSyntax: true, compareY: true },
  { text: String.raw`\begin{quotation} Alpha \par Beta \end{quotation}`, width: 150, parindent: 0, texSyntax: true, compareY: true },
  { text: String.raw`\begin{itemize}\item Alpha\item Beta\end{itemize}`, width: 150, parindent: 0, texSyntax: true, compareY: true },
  { text: String.raw`Before \par \begin{itemize}\item Alpha\item Beta\end{itemize} \par After`, width: 150, parindent: 0, texSyntax: true, compareY: true },
  { text: String.raw`\begin{itemize}\item Alpha \par \vspace{7pt} More\item Beta\end{itemize}`, width: 150, parindent: 0, texSyntax: true, compareY: true },
  { text: String.raw`\begin{itemize}\item Alpha \par \hrule width 24pt height 2pt depth 1pt More\item Beta\end{itemize}`, width: 150, parindent: 0, texSyntax: true, compareY: true },
  { text: String.raw`\begin{enumerate}\item Alpha \begin{enumerate}\item Nested\end{enumerate}\item Beta\end{enumerate}`, width: 150, parindent: 0, texSyntax: true, compareY: true },
  { text: String.raw`\begin{description}\item[Term] Alpha\item Plain\end{description}`, width: 150, parindent: 0, texSyntax: true, compareY: true },
  { text: String.raw`\begin{itemize}\item Alpha \par More\item Beta\end{itemize}`, width: 150, parindent: 0, texSyntax: true, compareY: true },
  { text: String.raw`\begin{description}\item[Term] Alpha \par More\item[Next] Beta\end{description}`, width: 150, parindent: 0, texSyntax: true, compareY: true },
];

function texEscapeText(text, texSyntax = false) {
  return texSyntax ? text : escapeTexText(text);
}

function lineCollectorLua() {
  return String.raw`local function scaled_pt(value)
    if value == nil then
      return 0
    end
    return value / 65536
  end

  local function collect(line)
    local out = table.pack()
    for n in node.traverse(line.list) do
      local kind = node.type(n.id)
      if kind == "glyph" then
        if n.char == 11 then
          table.insert(out, "ff")
        elseif n.char == 12 then
          table.insert(out, "fi")
        elseif n.char == 13 then
          table.insert(out, "fl")
        elseif n.char == 14 then
          table.insert(out, "ffi")
        elseif n.char == 15 then
          table.insert(out, "ffl")
        else
          table.insert(out, utf8.char(n.char))
        end
      elseif kind == "glue" then
        table.insert(out, " ")
      end
    end
    return table.concat(out)
  end

  local function glue_width(n)
    if not (n.width == nil) then
      return n.width
    end
    if not (n.spec == nil) and not (n.spec.width == nil) then
      return n.spec.width
    end
    return 0
  end

  local y = 0
  for n in node.traverse(tex.box[0].list) do
    local kind = node.type(n.id)
    if kind == "hlist" then
      local baseline = y + scaled_pt(n.height)
      texio.write_nl(
        "term",
        "TIKZ_PARAGRAPH_LINE " ..
          baseline ..
          " " ..
          collect(n) ..
          " TIKZ_PARAGRAPH_END"
      )
      y = y + scaled_pt(n.height) + scaled_pt(n.depth)
    elseif kind == "glue" then
      y = y + scaled_pt(glue_width(n))
    elseif kind == "kern" then
      y = y + scaled_pt(n.kern)
    elseif kind == "rule" then
      y = y + scaled_pt(n.height) + scaled_pt(n.depth)
    end
  end`;
}

function plainTeXSource(text, width, parindent) {
  return String.raw`\font\test=cmr10 at 10pt
\test\language=-1
\hsize=${width}pt
\pretolerance=100
\tolerance=200
\parindent=${parindent}pt
\rightskip=0pt plus ${width}pt
\setbox0=\vbox{${texEscapeText(text)}\par}
\directlua{
  ${lineCollectorLua()}
}
\bye
`;
}

function laTeXSource(text, width, parindent) {
  return String.raw`\documentclass{article}
\begin{document}
\font\test=cmr10 at 10pt
\test\language=-1
\hsize=${width}pt
\pretolerance=100
\tolerance=200
\parindent=${parindent}pt
\rightskip=0pt plus ${width}pt
\setbox0=\vbox{${texEscapeText(text, true)}\par}
\directlua{
  ${lineCollectorLua()}
}
\end{document}
`;
}

function luaTeXLines(text, width, parindent, texSyntax = false) {
  const texSource = texSyntax
    ? laTeXSource(text, width, parindent)
    : plainTeXSource(text, width, parindent);
  const output = runTexOracleDocument({
    engine: texSyntax ? "lualatex" : "luatex",
    source: texSource,
    filename: "paragraph.tex",
    tempPrefix: "tikz-tex-para-",
  });
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith("TIKZ_PARAGRAPH_LINE "))
    .map((line) => {
      const marked = line.slice("TIKZ_PARAGRAPH_LINE ".length);
      const end = marked.indexOf(" TIKZ_PARAGRAPH_END");
      const payload = end >= 0 ? marked.slice(0, end) : marked;
      const spaceIndex = payload.indexOf(" ");
      if (spaceIndex < 0) {
        throw new Error(`Malformed oracle line payload: ${payload}`);
      }
      return {
        y: Number(payload.slice(0, spaceIndex)),
        text: payload.slice(spaceIndex + 1).trimEnd(),
      };
    });
}

function reportLines(report, layout) {
  const placementByLineIndex = new Map(
    (layout?.linePlacements ?? []).map((placement) => [placement.lineIndex, placement])
  );
  return report.lines.map((line, index) => ({
    y: (placementByLineIndex.get(line.lineIndex ?? index)?.y ?? line.y ?? 0) +
      (line.ascent ?? 0),
    text: line.segments
      // The Lua oracle collector reads paragraph body hlists; list labels live
      // in nested label boxes, so compare body text here and validate labels in
      // dedicated SVG/vlist tests.
      .filter((segment) => segment.role !== "list-label")
      .map((segment) => segment.text ?? "")
      .join("")
      .trimEnd(),
  }));
}

function lineTexts(lines) {
  return lines.map((line) => line.text);
}

function lineYs(lines) {
  return lines.map((line) => Number(line.y.toFixed(4)));
}

function lineBaselineDeltas(lines) {
  const first = lines[0]?.y ?? 0;
  return lines.map((line) => Number((line.y - first).toFixed(4)));
}

function lineBaselineDeltasClose(actual, expected, epsilon = 0.02) {
  if (actual.length !== expected.length) {
    return false;
  }
  const actualFirst = actual[0]?.y ?? 0;
  const expectedFirst = expected[0]?.y ?? 0;
  return actual.every((line, index) =>
    Math.abs(
      (line.y - actualFirst) -
        ((expected[index]?.y ?? Number.NaN) - expectedFirst)
    ) <= epsilon
  );
}

let failures = 0;
for (const fixture of fixtures) {
  const actualResult = layoutSimpleTexParagraph(fixture.text, {
    paragraphId: "oracle",
    width: fixture.width,
    parindent: fixture.parindent,
    tolerance: 200,
    hyphenator: { hyphenate: () => [] },
    textFontProfile: classicComputerModernTextFontProfile,
  });
  const actual = actualResult.report
    ? reportLines(actualResult.report, actualResult.vlistLayout)
    : [];
  const expected = luaTeXLines(fixture.text, fixture.width, fixture.parindent, fixture.texSyntax);
  const textMatches = JSON.stringify(lineTexts(actual)) === JSON.stringify(lineTexts(expected));
  const yMatches = fixture.compareY === true ? lineBaselineDeltasClose(actual, expected) : true;
  if (!textMatches || !yMatches) {
    failures += 1;
    console.error(`FAIL ${JSON.stringify(fixture)}`);
    console.error(`  ours text: ${JSON.stringify(lineTexts(actual))}`);
    console.error(`  tex text:  ${JSON.stringify(lineTexts(expected))}`);
    if (fixture.compareY === true) {
      console.error(`  ours baseline y: ${JSON.stringify(lineYs(actual))}`);
      console.error(`  tex baseline y:  ${JSON.stringify(lineYs(expected))}`);
      console.error(`  ours deltas:     ${JSON.stringify(lineBaselineDeltas(actual))}`);
      console.error(`  tex deltas:      ${JSON.stringify(lineBaselineDeltas(expected))}`);
    }
    continue;
  }
  const suffix = fixture.compareY === true
    ? ` baselineDeltas=${JSON.stringify(lineBaselineDeltas(actual))}`
    : "";
  console.log(`ok ${JSON.stringify(fixture.text)} ${actual.length} lines${suffix}`);
}

if (failures > 0) {
  process.exitCode = 1;
}

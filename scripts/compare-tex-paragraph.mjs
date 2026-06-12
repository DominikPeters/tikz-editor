#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { escapeTexText, runTexOracleDocument } from "./lib/tex-oracle.mjs";

const distEntry = resolve(process.cwd(), "packages/core/dist/text/tex/index.js");
if (!existsSync(distEntry)) {
  throw new Error("Missing packages/core/dist/text/tex/index.js. Run `npm run -w @tikz-editor/core build` first.");
}

const { layoutSimpleTexParagraph } = await import(distEntry);

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
];

function texEscapeText(text, texSyntax = false) {
  return escapeTexText(text, { preserveCommands: texSyntax });
}

function lineCollectorLua() {
  return String.raw`local function collect(line)
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
  for n in node.traverse(tex.box[0].list) do
    if node.type(n.id) == "hlist" then
      texio.write_nl("term", "TIKZ_PARAGRAPH_LINE " .. collect(n) .. " TIKZ_PARAGRAPH_END")
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
      return (end >= 0 ? marked.slice(0, end) : marked).trimEnd();
    });
}

function reportLines(report) {
  return report.lines.map((line) =>
    line.segments
      .map((segment) => segment.text ?? "")
      .join("")
      .trimEnd()
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
  });
  const actual = actualResult.report ? reportLines(actualResult.report) : [];
  const expected = luaTeXLines(fixture.text, fixture.width, fixture.parindent, fixture.texSyntax);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures += 1;
    console.error(`FAIL ${JSON.stringify(fixture)}`);
    console.error(`  ours: ${JSON.stringify(actual)}`);
    console.error(`  tex:  ${JSON.stringify(expected)}`);
    continue;
  }
  console.log(`ok ${JSON.stringify(fixture.text)} ${actual.length} lines`);
}

if (failures > 0) {
  process.exitCode = 1;
}

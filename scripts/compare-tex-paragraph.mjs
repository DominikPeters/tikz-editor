#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const distEntry = resolve(process.cwd(), "packages/core/dist/text/tex/index.js");
if (!existsSync(distEntry)) {
  throw new Error("Missing packages/core/dist/text/tex/index.js. Run `npm run -w @tikz-editor/core build` first.");
}

const { layoutSimpleTexParagraph } = await import(distEntry);

const fixtures = [
  { text: "Alpha Beta", width: 32 },
  { text: "office AV To", width: 65 },
  { text: "A simple Computer Modern paragraph uses TeX metrics", width: 105 },
];

function texEscapeText(text) {
  return text.replaceAll("\\", "\\\\").replaceAll("{", "\\{").replaceAll("}", "\\}");
}

function luaTeXLines(text, width) {
  const tempDir = mkdtempSync(join(tmpdir(), "tikz-tex-para-"));
  const texPath = join(tempDir, "paragraph.tex");
  const texSource = String.raw`\font\test=cmr10 at 10pt
\test\language=-1
\hsize=${width}pt
\pretolerance=100
\tolerance=200
\parindent=0pt
\rightskip=0pt plus ${width}pt
\setbox0=\vbox{${texEscapeText(text)}\par}
\directlua{
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
  for n in node.traverse(tex.box[0].list) do
    if node.type(n.id) == "hlist" then
      texio.write_nl("term", "TIKZ_PARAGRAPH_LINE " .. collect(n))
    end
  end
}
\bye
`;
  writeFileSync(texPath, texSource);
  try {
    const output = execFileSync("luatex", ["--interaction=nonstopmode", "--halt-on-error", texPath], {
      encoding: "utf8",
      cwd: tempDir,
    });
    return output
      .split(/\r?\n/)
      .filter((line) => line.startsWith("TIKZ_PARAGRAPH_LINE "))
      .map((line) => line.slice("TIKZ_PARAGRAPH_LINE ".length).replace(/\s+\)+$/, "").trimEnd());
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
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
    tolerance: 200,
  });
  const actual = actualResult.report ? reportLines(actualResult.report) : [];
  const expected = luaTeXLines(fixture.text, fixture.width);
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

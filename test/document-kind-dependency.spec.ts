import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { beamerDocumentParser } from "@tikz-editor/lezer-tex";
import { detectDocumentKind } from "../packages/core/src/document/kind.js";
import { scanBeamerDocumentClass } from "../packages/core/src/beamer/scan.js";
import { documentKindForSource } from "../packages/app/src/store/workspace-state.js";

afterEach(() => { vi.restoreAllMocks(); });
const freshKind = (source: string) => scanBeamerDocumentClass(source)?.className.value.trim() === "beamer" ? "beamer" : "tikz";

describe("document kind declaration dependency", () => {
  it.each(["beamer", "scrartcl"])("does not parse the paper body again while editing a leading %s declaration", className => {
    const parse = vi.spyOn(beamerDocumentParser, "parse");
    const prefix = `% dependency-cost-${className}\n\\documentclass[10pt]{${className}}`;
    const body = "\n" + Array.from({ length: 240 }, (_, index) => `\\draw (${index},0)--(${index},1);`).join("\n");
    for (let index = 0; index < 40; index++) {
      const source = prefix + String.raw`\begin{document}\begin{tikzpicture}` + body + `\n% body edit ${index}\n` + String.raw`\end{tikzpicture}\end{document}`;
      expect(documentKindForSource(source)).toBe(className === "beamer" ? "beamer" : "tikz");
    }
    expect(parse).toHaveBeenCalledTimes(1);
    expect(parse.mock.calls[0][0]).toBe(prefix);
  });

  it.each([
    ["leading literal", String.raw`\documentclass{beamer}`],
    ["class whitespace", String.raw`\documentclass{ beamer }`],
    ["leading comments", "% \\documentclass{article}\r\n\\documentclass{beamer}"],
    ["trivia around arguments", "\\documentclass % options\r\n[10pt] % class\n{beamer}"],
    ["nested options", String.raw`\documentclass[title={a]b}]{beamer}`],
    ["commented options", "\\documentclass[10pt,% comment\n aspectratio=169]{beamer}"],
    ["BOM", "\ufeff  \\documentclass{beamer}"],
    ["first declaration wins", String.raw`\documentclass{article}\documentclass{beamer}`],
    ["longer control word", String.raw`\documentclassification{beamer}\documentclass{article}`],
    ["incomplete class", String.raw`\documentclass{beamer`],
    ["incomplete options", String.raw`\documentclass[10pt{beamer}`],
    ["no arguments", String.raw`\documentclass`],
    ["starred control", String.raw`\documentclass*{beamer}`],
    ["class macro", String.raw`\documentclass{\modeclass}`],
    ["option macro", String.raw`\documentclass[\options]{beamer}`],
    ["escaped option bracket", String.raw`\documentclass[title=\]]{beamer}`],
    ["comment in class", "\\documentclass{beamer% comment\n}"],
    ["macro prelude", String.raw`\def\hello{world}\documentclass{beamer}`],
    ["nested declaration", String.raw`{\documentclass{beamer}}`],
    ["unclosed prelude group", String.raw`{\documentclass{beamer}`],
    ["escaped percent prelude", String.raw`\%\documentclass{beamer}`],
    ["literal verb prelude", String.raw`\verb|\documentclass{beamer}|\documentclass{article}`],
    ["opaque environment prelude", String.raw`\begin{verbatim}\documentclass{beamer}\end{verbatim}\documentclass{article}`],
    ["commented declaration only", "% \\documentclass{beamer}\n\\draw (0,0)--(1,1);"],
    ["TikZ snippet", String.raw`\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}`],
    ["empty source", ""]
  ])("preserves full-parser classification for %s", (_label, prefix) => {
    for (const suffix of ["", "\nplain body", String.raw`\begin{document}\begin{frame}\node {\documentclass{article}};\end{frame}\end{document}`, "\n% changed body\n}"]) {
      const source = prefix + suffix;
      expect(detectDocumentKind(source)).toBe(freshKind(source));
      expect(documentKindForSource(source)).toBe(freshKind(source));
    }
  });

  it("invalidates declaration and lexical-prefix edits while retaining body edits", () => {
    const prefix = "% cache lifecycle\n\\documentclass{beamer}";
    const body = String.raw`\begin{document}\begin{frame}Hello\end{frame}\end{document}`;
    for (const source of [prefix + body, prefix + body + "\n% edit", prefix.replace("{beamer}", "{article}") + body,
      "% cache lifecycle\n%\\documentclass{beamer}\n" + body, prefix.replace("{beamer}", "{beamer") + body,
      prefix + body, String.raw`\def\modeclass{beamer}\documentclass{\modeclass}` + body, prefix + body]) {
      expect(documentKindForSource(source)).toBe(freshKind(source));
    }
  });

  it("keeps the real paper classification stable across visual-edit-shaped body replacements", () => {
    const source = readFileSync(new URL("./papers/equal_shares_arxiv_v2.tex", import.meta.url), "utf8");
    const target = String.raw`\draw[thick,->,magenta] (0.0, 0.0) -- (0.0, 4.5);`;
    expect(source).toContain(target);
    expect(documentKindForSource(source)).toBe("tikz");
    for (const endpoint of ["4.6", "4.7", "4.8"]) {
      const edited = source.replace(target, target.replace("4.5", endpoint));
      expect(documentKindForSource(edited)).toBe("tikz");
      expect(detectDocumentKind(edited)).toBe(freshKind(edited));
    }
  });
});

import { describe, expect, it } from "vitest";
import { expandBeamerLocalMacros } from "../packages/core/src/beamer/local-macros.js";
import { collectMacroBindings } from "../packages/core/src/macros/bindings.js";
import { collectContextDefinitions } from "../packages/core/src/transform/cst-to-ast.js";
import { createIdentityMappedText } from "../packages/core/src/text/source-map.js";
import { prepareBeamerDocument } from "../packages/core/src/beamer/render.js";
const expand = (source: string, preamble = String.raw`\newcommand{\unit}{ms}`) => expandBeamerLocalMacros(createIdentityMappedText(source, preamble.length), collectMacroBindings(collectContextDefinitions(preamble))).mapped;
const text = (page: Awaited<ReturnType<ReturnType<typeof prepareBeamerDocument>["renderFrame"]>>) => page.layout.paragraphs.flatMap(p => p.report.lines.map(l => l.segments.map(s => s.text ?? "").join(""))).join("").replace(/\s/gu, "");
describe("source-ordered local macro execution", () => {
  it("protects declaration tokens, captures aliases, and restores groups and environments", () => {
    const result = expand(String.raw`\unit {\renewcommand{\unit}{ticks}\let\old\unit\renewcommand{\unit}{s}\unit/\old}\unit \begin{center}\renewcommand{\unit}{Hz}\unit\end{center}\unit`);
    expect(result.text.replace(/\s/gu, "")).toBe(String.raw`ms{s/ticks}ms\begin{center}Hz\end{center}ms`);
  });
  it("handles declaration aliases and declarations emitted by parameterized macros", () => {
    const result = expand(String.raw`\setunit{ticks}\unit {\change{\unit}{Hz}\unit}\unit`, String.raw`\newcommand{\unit}{ms}\let\change\renewcommand\newcommand{\setunit}[1]{\renewcommand{\unit}{#1}}`);
    expect(result.text.replace(/\s/gu, "")).toBe("ticks{Hz}ticks");
  });
  it("bounds recursive calls without limiting a sequence of independent calls", () => {
    const result = expand(String.raw`\renewcommand{\unit}{ticks}` + String.raw`\unit `.repeat(150));
    expect(result.text.match(/ticks/gu)).toHaveLength(150);
    const recursive = expand(String.raw`\newcommand{\a}{\b}\newcommand{\b}{\a}\a`);
    expect(recursive.text.length).toBeLessThan(10);
  });
  it("retains original argument ownership after executing a declaration", () => {
    const source = String.raw`\newcommand{\pair}[1]{Value:#1}\pair{Direct}`;
    const result = expand(source);
    expect(result.text).toBe("Value:Direct");
    const origin = result.sourceMap.charOrigins[result.text.indexOf("Direct")];
    expect(origin).toMatchObject({ kind: "macro-argument", from: String.raw`\newcommand{\unit}{ms}`.length + source.indexOf("Direct") });
  });
  it.each(["\\renewcommand", "\\change"])("carries %s across structural flow and resolves declaration aliases between frames", async declaration => {
    const source = String.raw`\documentclass{beamer}\newcommand{\unit}{ms}\let\change\renewcommand
\begin{document}\begin{frame}${declaration}{\unit}{ticks}Before:7\unit.\begin{block}{Panel}Inside:8\unit.\end{block}After:9\unit.\end{frame}
\change{\unit}{s}\begin{frame}Next:10\unit.\end{frame}\end{document}`;
    const prepared = prepareBeamerDocument(source);
    expect(text(await prepared.renderFrame({ frameIndex: 1 }))).toContain("Next:10s.");
    expect(text(await prepared.renderFrame())).toContain("Inside:8ticks.");
    expect(text(await prepared.renderFrame())).toContain("After:9ticks.");
  });
});

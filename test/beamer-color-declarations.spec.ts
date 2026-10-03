import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scanBeamerDocument } from "../packages/core/src/beamer/scan.js";
import { prepareBeamerDocument } from "../packages/core/src/beamer/render.js";
import { resolveBeamerTheme, resolveBeamerThemeColor } from "../packages/core/src/beamer/theme/resolve.js";
import { scanBeamerColorDeclarations } from "../packages/core/src/beamer/theme/color-declarations.js";
import { resolveDefineColorModel } from "../packages/core/src/semantic/style/colors.js";

const casesSource = readFileSync(new URL("./fixtures/beamer/color-declarations/cases.json", import.meta.url), "utf8");
const cases = JSON.parse(casesSource) as Array<{ id: string; preamble: string; roles: string[] }>;
const oracle = JSON.parse(readFileSync(new URL("./fixtures/beamer/color-declarations/colors.oracle.json", import.meta.url), "utf8")) as {
  sourceSha256: string; cases: Array<{ id: string; colors: Record<string, Record<"fg" | "bg", { model: string; specification: string }>> }>;
};
const deck = (preamble: string, body = "Alpha") => String.raw`\documentclass{beamer}
${preamble}
\setbeamertemplate{navigation symbols}{}
\begin{document}\begin{frame}[plain,t]${body}\end{frame}\end{document}`;
const themeFor = (preamble: string) => resolveBeamerTheme(scanBeamerDocument(deck(preamble)));

describe("authored preamble Beamer colors", () => {
  it("pins the LuaLaTeX declaration and queried-role source", () => {
    expect(createHash("sha256").update(casesSource).digest("hex")).toBe(oracle.sourceSha256);
  });

  for (const testCase of cases) it(`matches actual TeX effective foreground/background: ${testCase.id}`, () => {
    const theme = themeFor(testCase.preamble);
    expect(theme.diagnostics).toEqual([]);
    const reference = oracle.cases.find(entry => entry.id === testCase.id)!;
    const normal = resolveBeamerThemeColor(theme, "normal text");
    for (const role of testCase.roles) {
      const actual = { ...normal, ...resolveBeamerThemeColor(theme, role) };
      for (const field of ["fg", "bg"] as const) {
        const color = reference.colors[role][field];
        expect(actual[field], `${role}.${field}`).toBe(resolveDefineColorModel(color.model, color.specification));
      }
    }
  });

  it("preserves empty fields and clears inherited state with a star", () => {
    const theme = themeFor(String.raw`\setbeamercolor{parent}{fg=red,bg=blue}\setbeamercolor{child}{parent=parent}\setbeamercolor{child}{fg=}\setbeamercolor*{reset}{fg=blue}`);
    expect(resolveBeamerThemeColor(theme, "child")).toEqual({ bg: "#0000ff" });
    expect(resolveBeamerThemeColor(theme, "reset")).toEqual({ fg: "#0000ff" });
  });

  it("keeps authored role/expression offsets and ignores comments and unexecuted macro definitions", () => {
    const source = deck(String.raw`% \setbeamercolor{normal text}{bg=red}
\newcommand{\unused}{\usetheme{Warsaw}\setbeamercolor{normal text}{bg=green}}
\setbeamercolor{normal text}{fg=black,% a key comment
bg={blue!10!white}}`);
    const document = scanBeamerDocument(source);
    const events = scanBeamerColorDeclarations(document);
    expect(events).toHaveLength(1);
    const theme = resolveBeamerTheme(document);
    expect(theme.diagnostics).toEqual([]);
    expect(theme.id).toBe("default");
    const expression = theme.colors["normal text"].bgExpression!;
    expect(source.slice(expression.span.from, expression.span.to)).toBe("{blue!10!white}");
    expect(resolveBeamerThemeColor(theme, "normal text").bg).toBe("#e6e6ff");
  });

  it("retains a line comment inside a color option as trivia and permits later color definitions", () => {
    const theme = themeFor(String.raw`\setbeamercolor{normal text}{fg=later,bg=blue% a continued expression
!10!white}\definecolor{later}{HTML}{123456}\providecolor{red}{rgb}{0,0,1}`);
    expect(theme.diagnostics).toEqual([]);
    expect(resolveBeamerThemeColor(theme, "normal text")).toEqual({ fg: "#123456", bg: "#e6e6ff" });
    expect(theme.colorAliases?.red).toBeUndefined();
  });

  it("snapshots explicit preamble usebeamercolor aliases before a later role update", () => {
    const theme = themeFor(String.raw`\setbeamercolor{structure}{fg=red}\usebeamercolor{structure}\colorlet{snapshot}{structure.fg}\setbeamercolor{structure}{fg=blue}\setbeamercolor{normal text}{fg=snapshot}`);
    expect(theme.diagnostics).toEqual([]);
    expect(resolveBeamerThemeColor(theme, "normal text").fg).toBe("#ff0000");
  });

  it("bounds parent/use cycles and reports an authored diagnostic", () => {
    const theme = themeFor(String.raw`\setbeamercolor{one}{parent=two,fg=red}\setbeamercolor{two}{parent=one,bg=blue}`);
    expect(resolveBeamerThemeColor(theme, "one")).toEqual({ fg: "#ff0000", bg: "#0000ff" });
    expect(theme.diagnostics.some(diagnostic => diagnostic.code === "beamer-color-parent-cycle")).toBe(true);
    const useCycle = themeFor(String.raw`\setbeamercolor{one}{use=two,fg=two.fg}\setbeamercolor{two}{use=one,fg=one.fg}`);
    expect(resolveBeamerThemeColor(useCycle, "one")).toEqual({});
    expect(useCycle.diagnostics.some(diagnostic => diagnostic.code === "beamer-color-parent-cycle")).toBe(true);
  });

  it.each([String.raw`\setbeamercolor{normal text}{unknown=red}`, String.raw`\setbeamercolor{normal text}{bg=\customcolor}`, String.raw`\definecolor{custom}{unsupported}{1,2,3}`, String.raw`{\setbeamercolor{normal text}{bg=red}}`])("diagnoses unsupported authored declarations without applying invented colors", preamble => {
    const theme = themeFor(preamble);
    expect(theme.diagnostics).not.toEqual([]);
    expect(resolveBeamerThemeColor(theme, "background canvas").bg).toBe("#ffffff");
  });

  it("does not apply frame-local declarations to all frames", () => {
    const theme = resolveBeamerTheme(scanBeamerDocument(deck("", String.raw`\setbeamercolor{normal text}{bg=red}Alpha`)));
    expect(resolveBeamerThemeColor(theme, "background canvas").bg).toBe("#ffffff");
  });

  it("paints the native page canvas and ordinary text with the resolved roles", async () => {
    const page = await prepareBeamerDocument(deck(String.raw`\definecolor{ink}{RGB}{20,40,60}\setbeamercolor{normal text}{fg=ink,bg=blue!10}`)).renderFrame();
    expect(page.diagnostics).toEqual([]);
    expect(page.svg.svg).toMatch(/<rect[^>]*width="364\.195[^"]*"[^>]*height="273\.146[^"]*"[^>]*fill="#e6e6ff"/u);
    expect(page.svg.svg).toContain('color="#14283c"');
  });

  it("lets background canvas override its normal-text parent", async () => {
    const source = deck(String.raw`\setbeamercolor{normal text}{fg=black,bg=blue!10}\setbeamercolor{background canvas}{bg=yellow!20!white}`);
    const page = await prepareBeamerDocument(source).renderFrame();
    expect(page.svg.svg).toMatch(/<rect[^>]*width="364\.195[^"]*"[^>]*height="273\.146[^"]*"[^>]*fill="#ffffcc"/u);
    expect(resolveBeamerThemeColor(resolveBeamerTheme(page.document), "normal text").bg).toBe("#e6e6ff");
  });
});

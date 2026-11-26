import { describe, expect, it } from "vitest";

import { prepareBeamerDocument } from "../packages/core/src/beamer/index.js";
import { resolveBeamerTheme, resolveBeamerThemeColor } from "../packages/core/src/beamer/theme/resolve.js";
import { themeCaptionSkips } from "../packages/core/src/beamer/theme/theme-spacing.js";
import { scanBeamerDocument } from "../packages/core/src/beamer/scan.js";
import { withBeamerProjectFiles } from "../packages/core/src/beamer/project-files.js";
import { beamerThemeFileName, collectBeamerProjectFiles, createBeamerProjectFiles } from "../packages/core/src/beamer/project-files.js";

const THEME = String.raw`\ProvidesPackage{beamerthememine}
\mode<presentation>{
\usecolortheme{mine}
\setbeamerfont{block title}{series=\bfseries}
\setbeamertemplate{frametitle}{\begin{beamercolorbox}{frametitle}\insertframetitle\end{beamercolorbox}}
}
\mode<all>`;

const COLORS = String.raw`\definecolor{minered}{RGB}{170, 30, 40}
\setbeamercolor{block title}{fg=white,bg=minered}
\setbeamercolor{mystery}{fg=nosuchcolor}`;

const DOCUMENT = String.raw`\documentclass{beamer}
\usetheme{mine}
\begin{document}
\begin{frame}\begin{block}{T}x\end{block}\end{frame}
\end{document}`;

const files = new Map([["beamerthememine.sty", THEME], ["beamercolorthememine.sty", COLORS]]);

describe("project theme files", () => {
  it("names theme files as Beamer loads them", () => {
    expect(beamerThemeFileName("theme", "gemini")).toBe("beamerthemegemini.sty");
    expect(beamerThemeFileName("color-theme", "gemini")).toBe("beamercolorthemegemini.sty");
    expect(beamerThemeFileName("outer-theme", "x")).toBe("beamerouterthemex.sty");
    expect(beamerThemeFileName("inner-theme", "x")).toBe("beamerinnerthemex.sty");
    expect(beamerThemeFileName("font-theme", "x")).toBe("beamerfontthemex.sty");
  });

  it("collects the files a theme loads in turn", async () => {
    const requested: string[] = [];
    const collected = await collectBeamerProjectFiles(DOCUMENT, async name => { requested.push(name); return files.get(name) ?? null; });
    expect([...collected.keys()]).toEqual(["beamerthememine.sty", "beamercolorthememine.sty"]);
    expect(requested).toEqual(["beamerthememine.sty", "beamercolorthememine.sty"]);
  });

  it("applies a local theme's colors and fonts at its \\usetheme", () => {
    const prepared = prepareBeamerDocument(DOCUMENT, { projectFiles: createBeamerProjectFiles(files, "k") });
    const theme = prepared.theme;
    // minered is RGB 170, 30, 40.
    expect(resolveBeamerThemeColor(theme, "block title").bg?.toLowerCase()).toBe("#aa1e28");
    expect(theme.fonts["block-title"].series).toBe("bold");
    expect(theme.appliedComponents.some(component => component.name === "mine")).toBe(true);
  });

  it("reports a theme file's problems at the \\usetheme that loaded it", () => {
    const prepared = prepareBeamerDocument(DOCUMENT, { projectFiles: createBeamerProjectFiles(files, "k") });
    const usetheme = { from: DOCUMENT.indexOf("\\usetheme"), to: DOCUMENT.indexOf("\\usetheme") + "\\usetheme{mine}".length };
    const templates = prepared.theme.diagnostics.find(d => d.code === "beamer-local-theme-templates");
    expect(templates?.span).toEqual(usetheme);
    expect(templates?.message).toContain("beamerthememine.sty");
    for (const diagnostic of prepared.theme.diagnostics) {
      expect(diagnostic.span.from).toBeGreaterThanOrEqual(0);
      expect(diagnostic.span.to).toBeLessThanOrEqual(DOCUMENT.length);
    }
  });

  it("keeps the unknown-component diagnostic without the file", () => {
    const prepared = prepareBeamerDocument(DOCUMENT);
    expect(prepared.theme.diagnostics.map(d => d.code)).toContain("beamer-unknown-theme-component");
  });
});

// Expected values: LuaLaTeX on the same sources (artifacts/review-fixes/fixes/order.tex, mainmodes.tex).
describe("local themes in TeX's reading order", () => {
  const ORDER = String.raw`\setlength{\abovecaptionskip}{30pt}
\setlength{\belowcaptionskip}{30pt}
\renewcommand{\mybar}{\vskip2ex}
\setbeamertemplate{footline}{\begin{beamercolorbox}[wd=\paperwidth]{footline}\mybar x\end{beamercolorbox}}`;
  const resolve = (source: string, themeFiles: ReadonlyMap<string, string>) =>
    resolveBeamerTheme(withBeamerProjectFiles(scanBeamerDocument(source), createBeamerProjectFiles(themeFiles, "k")));

  it("reads a theme file at its \\usetheme: it overrides earlier main-file settings, later ones override it", () => {
    const source = String.raw`\documentclass{beamer}
\setlength{\abovecaptionskip}{1pt}
\newcommand{\mybar}{\mysteryrule}
\usetheme{order}
\setlength{\belowcaptionskip}{5pt}
\begin{document}\begin{frame}x\end{frame}\end{document}`;
    const theme = resolve(source, new Map([["beamerthemeorder.sty", ORDER]]));
    expect(themeCaptionSkips(theme)).toEqual({ above: 30, below: 5 });
    // The theme's \renewcommand wins over the main file's earlier definition.
    expect(theme.diagnostics.some(item => item.code === "beamer-template-unsupported")).toBe(false);
    expect(theme.interpreted?.units.map(unit => unit.file)).toEqual([null, "beamerthemeorder.sty", null]);
    const [before, file, after] = theme.interpreted?.units ?? [];
    expect(before?.offset).toBe(0);
    expect(source.slice(0, before?.text.length).endsWith("\\usetheme{order}")).toBe(true);
    expect(file).toMatchObject({ offset: null, fileOffset: 0, text: ORDER });
    expect(source.slice(after?.offset ?? -1).startsWith("\n\\setlength{\\belowcaptionskip}{5pt}")).toBe(true);
  });

  it("splices a theme loaded by a theme file in at that file's load command", () => {
    const outer = String.raw`\setlength{\abovecaptionskip}{2pt}
\useoutertheme{inner}
\setlength{\belowcaptionskip}{4pt}`;
    const inner = String.raw`\setlength{\abovecaptionskip}{8pt}
\setlength{\belowcaptionskip}{8pt}
\setbeamertemplate{footline}{x}`;
    const source = "\\documentclass{beamer}\n\\usetheme{outer}\n\\begin{document}\\end{document}";
    const theme = resolve(source, new Map([["beamerthemeouter.sty", outer], ["beamerouterthemeinner.sty", inner]]));
    expect(themeCaptionSkips(theme)).toEqual({ above: 8, below: 4 });
    expect(theme.interpreted?.units.map(unit => unit.file)).toEqual([null, "beamerthemeouter.sty", "beamerouterthemeinner.sty", "beamerthemeouter.sty", null]);
    const resumed = theme.interpreted?.units[3];
    expect(outer.slice(resumed?.fileOffset)).toBe(resumed?.text);
  });

  it("keeps a theme file's presentation material and drops its article-only material", () => {
    const modes = String.raw`\mode<presentation>{\setbeamercolor{structure}{fg=red}}
\mode<article>{\setbeamercolor{structure}{fg=blue}}
\mode<article>
\setbeamercolor{alerted text}{fg=blue}
\mode
<all>
\mode<beamer|handout>{\setbeamercolor{example text}{fg=orange}}`;
    const source = "\\documentclass{beamer}\n\\usecolortheme{modes}\n\\begin{document}\\end{document}";
    const theme = resolve(source, new Map([["beamercolorthememodes.sty", modes]]));
    expect(resolveBeamerThemeColor(theme, "structure").fg).toBe("#ff0000");
    expect(resolveBeamerThemeColor(theme, "alerted text").fg).toBe("#ff0000");
    expect(resolveBeamerThemeColor(theme, "example text").fg).toBe("#ff8000");
  });

  it("applies \\mode in the main preamble too, keeping spans in the source", () => {
    const source = String.raw`\documentclass{beamer}
\mode<presentation>{\setbeamercolor{structure}{fg=red}}
\mode<article>{\setbeamercolor{structure}{fg=blue}}
\mode<article>
\setbeamercolor{alerted text}{fg=blue}
\mode
<all>
\begin{document}\begin{frame}x\end{frame}\end{document}`;
    const theme = resolveBeamerTheme(scanBeamerDocument(source));
    expect(resolveBeamerThemeColor(theme, "structure").fg).toBe("#ff0000");
    expect(resolveBeamerThemeColor(theme, "alerted text").fg).toBe("#ff0000");
    const red = theme.colors.structure?.fgExpression;
    expect(red && source.slice(red.span.from, red.span.to)).toBe("red");
  });
});

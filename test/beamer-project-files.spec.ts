import { describe, expect, it } from "vitest";

import { prepareBeamerDocument } from "../packages/core/src/beamer/index.js";
import { resolveBeamerThemeColor } from "../packages/core/src/beamer/theme/resolve.js";
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

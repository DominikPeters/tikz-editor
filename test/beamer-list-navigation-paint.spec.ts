import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareBeamerDocument } from "../packages/core/src/beamer/render.js";
import { scanBeamerDocument } from "../packages/core/src/beamer/scan.js";
import { resolveBeamerTheme, resolveBeamerThemeColor } from "../packages/core/src/beamer/theme/resolve.js";
import { resolveBeamerEnumerateMarker, resolveBeamerItemizeMarkers, resolveBeamerListLabelColor } from "../packages/core/src/beamer/theme/list-markers.js";
import { scanBeamerNavigationTemplates } from "../packages/core/src/beamer/theme/template-declarations.js";
import { resolveDefineColorModel } from "../packages/core/src/semantic/style/colors.js";
import type { PositionedTexVListItem } from "../packages/core/src/text/tex/vlist/types.js";
import type { RenderBeamerFrameResult } from "../packages/core/src/beamer/types.js";

const casesSource = readFileSync(new URL("./fixtures/beamer/list-navigation-paint/cases.json", import.meta.url), "utf8");
const cases = JSON.parse(casesSource) as Array<{ id: string; preamble: string; body: string; generatedOnly?: boolean; recordCounter?: boolean }>;
const oracle = JSON.parse(readFileSync(new URL("./fixtures/beamer/list-navigation-paint/paint.oracle.json", import.meta.url), "utf8")) as {
  sourceSha256: string;
  cases: Array<{ id: string; navigation: "empty" | "nonempty"; labels: Array<{ role: string; model: string; specification: string }>; counters?: string[] }>;
};
const deck = (preamble = "", body = "Alpha") => String.raw`\documentclass{beamer}${preamble}\begin{document}\begin{frame}[t]${body}\end{frame}\end{document}`;

function paintedLabels(result: RenderBeamerFrameResult, generatedOnly = false) {
  const flattened = (items: readonly PositionedTexVListItem[]): PositionedTexVListItem[] => items.flatMap(item => [item, ...flattened(item.children ?? [])]);
  return result.layout.paragraphs.flatMap(paragraph => flattened(paragraph.vlistLayout.items))
    .filter(positioned => positioned.item.kind === "hbox" && positioned.item.role?.kind === "list-label" && (!generatedOnly || positioned.item.role.labelKind === "default"))
    .map(positioned => {
      if (positioned.item.kind !== "hbox") throw new Error("Expected label hbox");
      return { text: positioned.item.box.renderItems.map(item => item.kind === "tex-math-svg" ? "" : item.text).join(""),
        colors: [...new Set(positioned.item.box.renderItems.flatMap(item => item.kind === "tex-math-svg" ? [] : [item.color]))] };
    });
}

describe("Beamer list label paint and authored navigation symbols", () => {
  it("pins actual LuaLaTeX stock-template paint and navigation probes", () => {
    expect(createHash("sha256").update(casesSource).digest("hex")).toBe(oracle.sourceSha256);
  });

  for (const testCase of cases) it(`matches exact label paint and navigation: ${testCase.id}`, async () => {
    const reference = oracle.cases.find(entry => entry.id === testCase.id)!;
    const page = await prepareBeamerDocument(deck(testCase.preamble, testCase.body)).renderFrame();
    expect(page.diagnostics).toEqual([]);
    const labels = paintedLabels(page, testCase.generatedOnly);
    expect(labels.map(label => label.colors)).toEqual(reference.labels.map(label => [resolveDefineColorModel(label.model, label.specification)]));
    if (testCase.recordCounter) expect(labels.map(label => label.text)).toEqual(reference.counters!.map(counter => `${counter}.`));
    const navigation = page.layout.items.filter(item => item.id.endsWith(":navigation-symbols"));
    expect(navigation.length).toBe(reference.navigation === "empty" ? 0 : 1);
    if (reference.navigation === "empty") expect(page.svg.svg).not.toContain('data-layout-kind="navigation-symbols"');
    for (const label of reference.labels) expect(page.svg.svg).toContain(`fill="${resolveDefineColorModel(label.model, label.specification)}"`);
  });

  it("keeps authored custom-label colors inside the class-owned foreground", async () => {
    const page = await prepareBeamerDocument(deck(String.raw`\setbeamercolor{enumerate item}{fg=red}`, String.raw`\begin{enumerate}\item[Custom] Alpha\item[\textcolor{green}{Green}] Beta\item Gamma\end{enumerate}`)).renderFrame();
    expect(page.diagnostics).toEqual([]);
    const labels = paintedLabels(page);
    expect(labels.slice(0, 2)).toEqual([
      { text: "Custom", colors: ["#ff0000"] },
      { text: "Green", colors: ["#00ff00"] },
    ]);
    expect(labels.map(label => label.colors)).toEqual([["#ff0000"], ["#00ff00"], ["#ff0000"]]);
    expect(labels[2].text).toBe("1.");
    expect(page.svg.svg).toContain('fill="#00ff00"');
    expect(page.svg.svg).toContain('fill="#ff0000"');
  });

  it("inherits structure while leaving the list body foreground black", async () => {
    const source = deck(String.raw`\setbeamercolor{structure}{fg=red}`, String.raw`\begin{enumerate}\item Alpha\end{enumerate}`);
    const page = await prepareBeamerDocument(source).renderFrame();
    expect(paintedLabels(page)[0].colors).toEqual(["#ff0000"]);
    expect(page.layout.paragraphs[0].report.lines.flatMap(line => line.segments).filter(segment => segment.text === "Alpha").map(segment => segment.color)).toEqual([undefined]);
    expect(page.svg.svg).toContain('color="#000000"');
  });

  it("paints the corpus shrink reproduction with blue counters and no navigation strip", async () => {
    const source = readFileSync(new URL("./fixtures/beamer/corpus-followups/flow-frame-options.tex", import.meta.url), "utf8");
    const page = await prepareBeamerDocument(source).renderFrame({ frameIndex: 1 });
    expect(page.diagnostics).toEqual([]);
    expect(paintedLabels(page).map(label => label.colors)).toEqual(Array.from({ length: 4 }, () => ["#3333b3"]));
    expect(page.layout.items.some(item => item.id.endsWith(":navigation-symbols"))).toBe(false);
    expect(page.svg.svg).toContain('fill="#3333b3"');
  });

  it("resolves label colors by the total nesting depth across mixed list kinds", () => {
    const theme = resolveBeamerTheme(scanBeamerDocument(deck(String.raw`\setbeamercolor{enumerate item}{fg=red}\setbeamercolor{enumerate subitem}{fg=green}`)));
    expect(resolveBeamerListLabelColor(theme, "enumerate", 1, 2)).toBe("#00ff00");
    expect(resolveBeamerThemeColor(theme, "itemize subsubitem").fg).toBe("#3333b3");
  });

  it("applies projected foreground/background roles independently at each depth", () => {
    const theme = resolveBeamerTheme(scanBeamerDocument(deck(String.raw`\useinnertheme{rectangles}\setbeamercolor{item projected}{fg=yellow,bg=red}\setbeamercolor{subitem projected}{fg=green,bg=blue}`)));
    expect(resolveBeamerEnumerateMarker(theme, 1, 1)?.projectedText?.color).toBe("#ffff00");
    expect(resolveBeamerEnumerateMarker(theme, 1, 1)?.svgBody).toContain('fill="#ff0000"');
    expect(resolveBeamerEnumerateMarker(theme, 1, 2)?.projectedText?.color).toBe("#00ff00");
    expect(resolveBeamerEnumerateMarker(theme, 1, 2)?.svgBody).toContain('fill="#0000ff"');
    const ballTheme = resolveBeamerTheme(scanBeamerDocument(deck(String.raw`\useinnertheme{rounded}\setbeamercolor{subitem projected}{bg=red}`)));
    expect(resolveBeamerItemizeMarkers(ballTheme)[1].svgBody).toContain('stop-color="#ff4040"');
  });

  it("orders authored empty/default navigation templates with outer-theme uses", () => {
    const after = resolveBeamerTheme(scanBeamerDocument(deck(String.raw`\useoutertheme{metropolis}\setbeamertemplate{navigation symbols}[default]`)));
    expect(after.templates.navigationSymbols.id).toBe("beamer/navigation-symbols/default");
    const before = resolveBeamerTheme(scanBeamerDocument(deck(String.raw`\setbeamertemplate{navigation symbols}[default]\useoutertheme{metropolis}`)));
    expect(before.templates.navigationSymbols.id).toBe("beamer/navigation-symbols/none");
  });

  it("retains source spans and ignores commented/unexecuted navigation declarations", () => {
    const source = deck(String.raw`% \setbeamertemplate{navigation symbols}{}
\newcommand{\unused}{\setbeamertemplate{navigation symbols}{}}
\setbeamertemplate{navigation symbols}{}`);
    const events = scanBeamerNavigationTemplates(scanBeamerDocument(source));
    expect(events).toHaveLength(1);
    expect(source.slice(events[0].span.from, events[0].span.to)).toBe(String.raw`\setbeamertemplate{navigation symbols}{}`);
  });

  it.each([String.raw`\setbeamertemplate{navigation symbols}{\insertframenavigationsymbol}`, String.raw`\setbeamertemplate{navigation symbols}[unknown]`, String.raw`{\setbeamertemplate{navigation symbols}{}}`])("diagnoses bounded unsupported navigation template code", preamble => {
    const theme = resolveBeamerTheme(scanBeamerDocument(deck(preamble)));
    expect(theme.diagnostics).not.toEqual([]);
    expect(theme.templates.navigationSymbols.id).toBe("beamer/navigation-symbols/default");
  });
});

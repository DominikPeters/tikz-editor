import { describe, expect, it } from "vitest";
import { applyDeckEditAction, prepareBeamerDocument } from "../packages/core/src/beamer/index.js";
import type { BeamerFrameLayout } from "../packages/core/src/beamer/index.js";

const BODY = [
  "\\begin{document}",
  "\\section{Intro}",
  "\\begin{frame}{Frame}",
  "\\begin{itemize}",
  "\\item One",
  "\\end{itemize}",
  "\\end{frame}",
  "\\end{document}",
];

function deck(...preamble: string[]): string {
  return [...preamble, ...BODY].join("\n");
}

// The action is document-scoped and never reads the layout.
const NO_LAYOUT = {} as BeamerFrameLayout;

function switched(source: string, name: string): string {
  const result = applyDeckEditAction(source, NO_LAYOUT, { kind: "deckSetPresentationTheme", name });
  if (result.kind !== "success") throw new Error(`expected success, got ${result.kind}`);
  return result.newSource;
}

describe("deckSetPresentationTheme", () => {
  it("renames the last executing \\usetheme and keeps the options the new theme reads", () => {
    const source = deck(
      "\\documentclass{beamer}",
      "\\newcommand{\\later}{\\usetheme{Warsaw}}",
      "\\usetheme{Berlin}",
      "\\usetheme[progressbar=frametitle, numbering=fraction,unknown]{moloch}",
      "\\usecolortheme{beaver}",
    );
    const next = switched(source, "metropolis");
    expect(next).toContain("\\usetheme[progressbar=frametitle,numbering=fraction]{metropolis}");
    expect(next).toContain("\\usetheme{Berlin}");
    expect(next).toContain("\\newcommand{\\later}{\\usetheme{Warsaw}}");
    expect(next).toContain("\\usecolortheme{beaver}");
  });

  it("drops the option bracket when the new theme reads none of it", () => {
    const next = switched(deck("\\documentclass{beamer}", "\\usetheme[progressbar=foot]{moloch}"), "Madrid");
    expect(next).toContain("\\usetheme{Madrid}");
    expect(next).not.toContain("progressbar");
  });

  it("keeps sidebar flags across sidebar themes, in the catalog's spelling", () => {
    const next = switched(deck("\\documentclass{beamer}", "\\usetheme[right,width=2cm]{Berkeley}"), "paloalto");
    expect(next).toContain("\\usetheme[right,width=2cm]{PaloAlto}");
  });

  it("inserts a \\usetheme after \\documentclass when the deck has none", () => {
    const next = switched(deck("\\documentclass[aspectratio=169]{beamer}", "\\usepackage{amsmath}"), "Warsaw");
    expect(next.startsWith("\\documentclass[aspectratio=169]{beamer}\n\\usetheme{Warsaw}\n\\usepackage{amsmath}")).toBe(true);
  });

  it("refuses a theme the preview does not know", () => {
    const result = applyDeckEditAction(deck("\\documentclass{beamer}"), NO_LAYOUT, { kind: "deckSetPresentationTheme", name: "Sherbrooke" });
    expect(result.kind).toBe("unsupported");
  });
});

describe("presentationTheme preview override", () => {
  const cases: Array<[string, string[]]> = [
    ["Madrid", ["\\documentclass{beamer}", "\\usetheme[progressbar=frametitle]{moloch}", "\\title[Short]{Long}", "\\author{A}"]],
    ["Berkeley", ["\\documentclass{beamer}", "\\usecolortheme{beaver}", "\\title{T}"]],
    ["moloch", ["\\documentclass{beamer}", "\\usetheme{Warsaw}", "\\setbeamercolor{structure}{fg=red}"]],
  ];
  for (const [name, preamble] of cases) {
    it(`renders ${name} exactly as applying the switch would`, async () => {
      const source = deck(...preamble);
      const preview = await prepareBeamerDocument(source, { presentationTheme: name }).renderFrame({ frameIndex: 0, step: 1 });
      const applied = await prepareBeamerDocument(switched(source, name)).renderFrame({ frameIndex: 0, step: 1 });
      // Source offsets differ (the applied deck is longer), so compare what is
      // painted where, with offsets stripped from the SVG.
      const strip = (svg: string) => svg.replace(/data-[a-z-]*(span|source|offset)[a-z-]*="[^"]*"/gu, "");
      expect(strip(preview.svg.svg)).toBe(strip(applied.svg.svg));
      const unswitched = await prepareBeamerDocument(source).renderFrame({ frameIndex: 0, step: 1 });
      expect(strip(preview.svg.svg)).not.toBe(strip(unswitched.svg.svg));
      expect(preview.layout.items.map((item) => [item.kind, item.bounds])).toEqual(applied.layout.items.map((item) => [item.kind, item.bounds]));
    });
  }
});

import { describe, expect, it } from "vitest";

import { applyBeamerModes, beamerModeSpecSelects } from "../packages/core/src/beamer/modes.js";

// Expected values: LuaLaTeX on the same specs in a theme file (artifacts/review-fixes/modes).
describe("\\mode specs outside frames", () => {
  it("selects as beamerbasedecode.sty does in beamer, handout and trans mode", () => {
    const table: Record<string, readonly [beamer: boolean, handout: boolean, trans: boolean]> = {
      "presentation": [true, true, true], "article": [false, false, false], "beamer|handout": [true, true, false],
      "handout": [false, true, false], "second": [false, false, false], "beamer": [true, false, false], "trans": [false, false, true],
      "all": [true, true, true], "+-": [true, true, true], "1": [true, true, true], "2": [false, true, true], "2-": [false, true, true],
      "-3": [true, true, true], "0": [false, true, true], "beamer:0": [false, true, true], "presentation:0": [false, false, false],
      "article:1": [true, true, true], "handout:0|beamer:1": [true, false, true], "presentation|article": [true, true, true],
      "article|presentation:0": [false, false, false], "all:0": [false, false, false], " presentation ": [true, true, true],
      "1-3": [true, true, true], "2-3": [false, true, true], "1,3": [true, true, true], "alert@1": [false, false, false],
    };
    for (const [spec, [beamer, handout, trans]] of Object.entries(table)) {
      expect([spec, beamerModeSpecSelects(spec, "beamer")]).toEqual([spec, beamer]);
      expect([spec, beamerModeSpecSelects(spec, "handout")]).toEqual([spec, handout]);
      expect([spec, beamerModeSpecSelects(spec, "trans")]).toEqual([spec, trans]);
    }
    expect(beamerModeSpecSelects("beamer", "second")).toBe(true);
  });

  it("advances beamerpauses at each +, from 0 in the preamble", () => {
    const pauses = { value: 0 };
    expect(beamerModeSpecSelects("+", "beamer", pauses)).toBe(false);
    expect(beamerModeSpecSelects("+", "beamer", pauses)).toBe(true);
    expect(beamerModeSpecSelects(".", "beamer", pauses)).toBe(true);
  });
});

/** The \typeout probes a theme file's text keeps in presentation mode. */
function kept(text: string): string[] {
  const applied = applyBeamerModes(text);
  expect(applied.length).toBe(text.length);
  return [...applied.matchAll(/\\typeout\{(\w[\w-]*)\}/gu)].map(match => match[1] ?? "");
}

describe("\\mode in theme text", () => {
  it("keeps a braced body only when its spec selects presentation mode", () => {
    const text = String.raw`\mode<presentation>{\setbeamercolor{structure}{fg=red}\typeout{red}}
\mode<article>{\setbeamercolor{structure}{fg=blue}\typeout{blue}}
\mode<article>
{\typeout{nextline}}
\typeout{after}`;
    expect(kept(text)).toEqual(["red", "after"]);
    expect(applyBeamerModes(text)).toContain("\\setbeamercolor{structure}{fg=red}");
    expect(applyBeamerModes(text)).not.toContain("blue");
    expect(applyBeamerModes(text)).not.toMatch(/\\mode|[{]\\setbeamercolor/u);
  });

  it("skips lines after an unselected switch until a line that is exactly \\mode", () => {
    const text = String.raw`\mode<article>
\typeout{a}
\mode<all>
\typeout{oneline}
\mode
<all>
\typeout{b}
\mode<article>
\mode
<all>
\typeout{immediate}
\mode
<all>
\typeout{c}
\mode<article>\typeout{sameline}
\mode   
<all>
\typeout{d}
\mode<article>

\mode
<all>
\typeout{oneblank}
\mode
<all>
\typeout{e}
\mode<article>
\typeout{f}
\presentation
\typeout{g}
\mode<article>
  \mode
\typeout{indented}
\common
\typeout{h}`;
    expect(kept(text)).toEqual(["b", "c", "d", "e", "g", "h"]);
  });

  it("skips tokens after \\mode* until \\mode or \\title, and again after a braced \\mode", () => {
    const text = String.raw`\mode*
\typeout{star}\mode<all>\typeout{inline}
\mode*
\typeout{star2}\title{T}\typeout{title}
\mode<all>{\typeout{braced}}
\typeout{skipped}
\mode
<all>
\typeout{end}`;
    expect(kept(text)).toEqual(["inline", "title", "braced", "end"]);
  });

  it("returns text without \\mode unchanged", () => {
    const text = "\\setbeamercolor{structure}{fg=red}\n";
    expect(applyBeamerModes(text)).toBe(text);
    expect(applyBeamerModes("\\constructor\\toString\\mode<all>x")).toBe("\\constructor\\toString          x");
  });
});

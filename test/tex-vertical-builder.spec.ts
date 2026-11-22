import { describe, expect, it } from "vitest";
import { glue, VerticalListBuilder, type VerticalListRegisters } from "../packages/core/src/text/tex/vlist/vertical-builder.js";

// article.cls 10pt \@listi / \@listii (size10.clo).
const listI: VerticalListRegisters = { topsep: glue(8, 2, 4), partopsep: glue(2, 1, 1), itemsep: glue(4, 2, 1), parsep: glue(4, 2, 1) };
const listII: VerticalListRegisters = { topsep: glue(4, 2, 1), partopsep: glue(2, 1, 1), itemsep: glue(2, 1, 1), parsep: glue(2, 1, 1) };
const natural = (builder: VerticalListBuilder, id: string) => builder.glueBefore(id).natural;

describe("VerticalListBuilder", () => {
  it("opens, separates and closes a list started in vertical mode", () => {
    const b = new VerticalListBuilder({ parskip: glue(0, 1) });
    b.startParagraph("lead"); b.par(true);
    b.beginList(listI);
    b.item(); b.startParagraph("one"); b.par();
    b.item(); b.startParagraph("two"); b.par();
    b.endList();
    b.startParagraph("after");
    // \@topsep = topsep + partopsep + parskip; \addvspace{-\parskip}; then \parsep.
    expect(natural(b, "one")).toBe(10);
    expect(natural(b, "two")).toBe(8);
    expect(natural(b, "after")).toBe(10);
  });

  it("takes a pending label into a nested list through @donoparitem", () => {
    const b = new VerticalListBuilder();
    b.beginList(listI);
    b.item(); b.startParagraph("one"); b.par();
    b.item();
    b.beginList(listII);
    b.item(); b.startParagraph("inner"); b.par();
    b.endList();
    b.startParagraph("tail");
    // itemsep + outer parsep, as for a plain item boundary.
    expect(natural(b, "inner")).toBe(8);
    // @noparlist: no closing glue, only the outer \parskip.
    expect(natural(b, "tail")).toBe(4);
  });

  it("raises an alignment's closing topsep by parskip - outerparskip at \\endlist", () => {
    const small: VerticalListRegisters = { topsep: glue(6, 2, 2), partopsep: glue(0), itemsep: glue(3, 2, 1), parsep: glue(3, 2, 1) };
    const b = new VerticalListBuilder();
    b.startParagraph("lead"); b.par(true);
    b.beginList(small);
    b.item(); b.startParagraph("text"); b.par();
    b.beginTrivlist({ topsep: glue(9), partopsep: glue(0) });
    b.startParagraph("centered"); b.par();
    b.endList();
    b.endList();
    b.startParagraph("after");
    expect(natural(b, "centered")).toBe(12);
    expect(natural(b, "after")).toBe(12);
  });

  it("keeps a whatsit between a closing skip and an alignment's addvspace", () => {
    const b = new VerticalListBuilder();
    b.startParagraph("lead"); b.par(true);
    b.beginList(listI); b.item(); b.startParagraph("one"); b.par(); b.endList();
    b.whatsit();
    b.beginTrivlist({ topsep: glue(8), partopsep: glue(0) });
    b.startParagraph("centered");
    // Both skips survive: the whatsit hides \lastskip from \addvspace.
    expect(natural(b, "centered")).toBe(18);
  });

  it("suppresses the opening skips at the top of a minipage", () => {
    const b = new VerticalListBuilder({ minipage: true });
    b.beginList(listI); b.item(); b.startParagraph("one");
    expect(natural(b, "one")).toBe(0);
  });

  it("appends baseline glue from prevdepth, falling back to lineskip (tex.web §679)", () => {
    const b = new VerticalListBuilder({ prevDepth: 2 });
    b.startParagraph("one", { height: 7, depth: 2, baselineSkip: 12 });
    b.par(true);
    b.startParagraph("two", { height: 11, depth: 1, baselineSkip: 12 });
    // 12 - 2 - 7 = 3, then 12 - 2 - 11 < 0 gives \lineskip.
    expect(natural(b, "one")).toBe(3);
    expect(natural(b, "two")).toBe(1);
  });

  it("brackets a display with its skips and resumes the paragraph without parskip", () => {
    const b = new VerticalListBuilder({ parskip: glue(5) });
    b.startParagraph("before", { height: 7, depth: 2, baselineSkip: 12 });
    b.displayAbove(glue(10, 2, 5));
    b.displayBox("display", { height: 9, depth: 4, baselineSkip: 12 });
    b.displayBelow(glue(6, 3, 3));
    b.startParagraph("after", { height: 7, depth: 2, baselineSkip: 12 });
    // Above skip, then baseline glue 12 - 2 - 9 = 1.
    expect(natural(b, "display")).toBe(11);
    // Below skip, then 12 - 4 - 7 = 1; no \parskip for the resumed lines.
    expect(natural(b, "after")).toBe(7);
  });

  it("lets a list closing after a display adjust the below skip (\\endtrivlist)", () => {
    const small: VerticalListRegisters = { topsep: glue(6, 2, 2), partopsep: glue(0), itemsep: glue(3, 2, 1), parsep: glue(3, 2, 1) };
    const b = new VerticalListBuilder();
    b.startParagraph("lead"); b.par(true);
    b.beginList(small);
    b.item(); b.startParagraph("text");
    b.displayAbove(glue(0)); b.displayBox("display", undefined); b.displayBelow(glue(6.5));
    b.endList();
    b.startParagraph("after");
    // 6.5 + parskip (3) - outer parskip (0) = 9.5, larger than the list's 6pt topsep.
    expect(natural(b, "after")).toBe(9.5);
  });
});


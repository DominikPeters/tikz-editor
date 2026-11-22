import { describe, expect, it } from "vitest";
import { glue, VerticalListBuilder, type VerticalListRegisters } from "../packages/core/src/text/tex/vlist/vertical-builder.js";

// article.cls 10pt \@listi / \@listii (size10.clo).
const listI: VerticalListRegisters = { topsep: glue(8, 2, 4), partopsep: glue(2, 1, 1), itemsep: glue(4, 2, 1), parsep: glue(4, 2, 1) };
const listII: VerticalListRegisters = { topsep: glue(4, 2, 1), partopsep: glue(2, 1, 1), itemsep: glue(2, 1, 1), parsep: glue(2, 1, 1) };
const natural = (builder: VerticalListBuilder, id: string) => builder.glueBefore(id).natural;

describe("VerticalListBuilder", () => {
  it("opens, separates and closes a list started in vertical mode", () => {
    const b = new VerticalListBuilder({ parskip: glue(0, 1) });
    b.startParagraph("lead"); b.par();
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
    b.startParagraph("lead"); b.par();
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
    b.startParagraph("lead"); b.par();
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
});

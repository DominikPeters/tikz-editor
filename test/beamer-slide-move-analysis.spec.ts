import { describe, expect, it } from "vitest";
import { analyzeBeamerSlideMove, editBeamerSlides, scanBeamerDocument, type BeamerSlideEdit } from "../packages/core/src/beamer/index.js";
import { applySourcePatches } from "../packages/core/src/edit/source-patches.js";
const frame = (title: string, body = title) => `\\begin{frame}{${title}}${body}\\end{frame}\n`;
const deck = (body: string, preamble = "") => `\\documentclass{beamer}\n${preamble}\\begin{document}\n${body}\\end{document}`;
const move = (ids: string[], destination: Extract<BeamerSlideEdit, { kind: "move" }>["destination"]): Extract<BeamerSlideEdit, { kind: "move" }> => ({ kind: "move", frameIds: ids, destination });
const earlier = move(["frame:1"], { kind: "before", frameId: "frame:0" });
const later = move(["frame:0"], { kind: "end" });

describe("slide move safety", () => {
  it.each(["\\iffalse", "\\ifnum1<2", "\\ifdefined\\foo", "\\newif\\ifdraft\\ifdraft"])("blocks crossing %s and cannot be overridden", open => {
    const source = deck(open + "\n" + frame("A") + "\\fi\n" + frame("B"));
    expect(analyzeBeamerSlideMove(source, later)).toMatchObject({ status: "blocked", issues: [{ message: "This move crosses a conditional branch." }] });
    expect(editBeamerSlides(source, later, { allowWarnings: true })).toBeNull();
  });
  it.each(["\\else", "\\or"])("blocks moving between branches separated by %s", branch => {
    const source = deck("\\ifcase0\n" + frame("A") + branch + "\n" + frame("B") + "\\fi\n");
    expect(analyzeBeamerSlideMove(source, earlier).status).toBe("blocked");
  });
  it("allows reordering within one nested branch", () => {
    const source = deck("\\iftrue\\iffalse\n" + frame("A") + frame("B") + "\\else X\\fi\\fi\n");
    expect(analyzeBeamerSlideMove(source, earlier).status).toBe("safe");
    expect(editBeamerSlides(source, earlier)?.source).toContain(frame("B") + frame("A"));
  });
  it.each([["\\begingroup", "\\endgroup"], ["\\bgroup", "\\egroup"]])("blocks crossing primitive groups %s", (open, close) => {
    const source = deck(open + "\n" + frame("A") + close + "\n" + frame("B"));
    expect(analyzeBeamerSlideMove(source, later).status).toBe("blocked");
  });
  it("rejects malformed boundaries and owned frames", () => {
    for (const source of [deck("\\iftrue\n" + frame("A") + frame("B")), deck("{" + frame("A") + "}" + frame("B"))]) {
      expect(analyzeBeamerSlideMove(source, later).status).toBe("blocked");
    }
  });
  it("does not execute tokens stored in macro bodies, comments, or verbatim", () => {
    const source = deck(String.raw`\def\unused{\iftrue\begingroup}` + "\n% \\fi\n" + frame("A", String.raw`\begin{verbatim}\iftrue\begingroup\end{verbatim}`) + frame("B"));
    expect(analyzeBeamerSlideMove(source, later).status).toBe("safe");
  });
  it("moves a private literal definition with its comment as one exact source edit", () => {
    const definition = "% sample count\n\\newcommand{\\sampleSize}{128}\n";
    const a = frame("A"), b = frame("B", "N=\\sampleSize");
    const source = deck(a + definition + b);
    const analysis = analyzeBeamerSlideMove(source, earlier);
    expect(analysis.status).toBe("safe");
    expect(analysis.dependencies).toHaveLength(1);
    const result = editBeamerSlides(source, earlier)!;
    expect(result.source).toBe(deck(definition + b + a));
    expect(result.frameIds).toEqual({ "frame:0": "frame:1", "frame:1": "frame:0" });
    expect(applySourcePatches(source, result.patches)).toMatchObject({ kind: "success", source: result.source });
  });
  it("carries private transitive definitions in declaration order", () => {
    const definitions = "\\def\\countText{128}\n\\newcommand{\\sampleSize}{\\countText}\n";
    const source = deck(frame("A") + definitions + frame("B", "\\sampleSize"));
    const result = editBeamerSlides(source, earlier);
    expect(result?.source).toBe(deck(definitions + frame("B", "\\sampleSize") + frame("A")));
  });
  it("keeps shared definitions in place and blocks a consumer moved before them", () => {
    const source = deck(frame("A") + "\\def\\unit{ms}\n" + frame("B", "\\unit") + frame("C", "\\unit"));
    const analysis = analyzeBeamerSlideMove(source, earlier);
    expect(analysis.status).toBe("blocked");
    expect(analysis.dependencies).toHaveLength(0);
    expect(analysis.issues[0].message).toContain("lose the definition of \\unit");
    expect(analyzeBeamerSlideMove(source, move(["frame:1"], { kind: "end" })).status).toBe("safe");
  });
  it("checks uses in section headings and macro expansions on unmoved slides", () => {
    const source = deck(frame("A") + "\\def\\unit{ms}\n\\def\\captionText{\\unit}\n" + frame("B", "\\unit") + frame("C", "\\captionText"));
    expect(analyzeBeamerSlideMove(source, earlier).status).toBe("blocked");
    const heading = deck(frame("A") + "\\def\\unit{ms}\n" + frame("B", "\\unit") + "\\section{\\unit}\n");
    expect(analyzeBeamerSlideMove(heading, earlier).status).toBe("blocked");
  });
  it("reviews changed providers with both definitions and requires an explicit override", () => {
    const source = deck("\\def\\unit{ms}\n" + frame("A", "\\unit") + "\\def\\unit{s}\n" + frame("B"));
    const analysis = analyzeBeamerSlideMove(source, later);
    expect(analysis.status).toBe("review");
    expect(analysis.issues[0].excerpts.map(item => item.text)).toEqual(["\\unit", "\\def\\unit{ms}", "\\def\\unit{s}"]);
    for (const part of analysis.issues[0].excerpts) expect(source.slice(part.span.from, part.span.to)).toBe(part.text);
    expect(editBeamerSlides(source, later)).toBeNull();
    expect(scanBeamerDocument(editBeamerSlides(source, later, { allowWarnings: true })!.source).frames.map(item => item.title?.value)).toEqual(["B", "A"]);
  });
  it("checks transitive binding changes at use time and captures let aliases at declaration time", () => {
    const source = deck("\\def\\unit{ms}\n\\def\\captionText{\\unit}\n\\let\\fixed\\unit\n" + frame("A", "\\captionText \\fixed") + "\\def\\unit{s}\n" + frame("B"));
    const analysis = analyzeBeamerSlideMove(source, later);
    expect(analysis.status).toBe("review");
    expect(analysis.issues.filter(issue => issue.message.includes("different definition"))).toHaveLength(1);
    expect(analysis.issues[0].message).toContain("\\unit");
  });
  it.each(["\\setcounter{equation}{4}", "\\setbeamertemplate{footline}{Custom}", "\\input{macros}", "\\mystery", "\\gdef\\external{changed}"])("reviews state changes and unknown code: %s", command => {
    const source = deck(frame("A") + command + "\n" + frame("B"));
    expect(analyzeBeamerSlideMove(source, later).status).toBe("review");
    expect(editBeamerSlides(source, later)).toBeNull();
  });
  it("reviews global effects inside moved or crossed frames", () => {
    for (const source of [deck(frame("A", "\\global\\def\\x{1}") + frame("B")), deck(frame("A") + frame("B", "\\global\\def\\x{1}"))]) {
      expect(analyzeBeamerSlideMove(source, later).status).toBe("review");
    }
  });
  it("does not prove ownership when unknown code could consume a macro", () => {
    const source = deck(frame("A") + "\\def\\unit{ms}\n" + frame("B", "\\unit") + frame("C", "\\mystery"));
    const analysis = analyzeBeamerSlideMove(source, earlier);
    expect(analysis.status).toBe("blocked");
    expect(analysis.dependencies).toEqual([]);
  });
  it("treats ordinary slide counters, local definitions and section membership as expected", () => {
    const source = deck("\\section{One}\n" + frame("A", "\\def\\local{X}\\textbf{\\local}\\insertframenumber") + "\\section{Two}\n" + frame("B", "\\inserttotalframenumber"));
    expect(analyzeBeamerSlideMove(source, later).status).toBe("safe");
  });
});

describe("dependency edge cases", () => {
  it("moves a private alias and its captured definition together", () => {
    const definitions = "\\def\\value{128}\n\\let\\sampleSize\\value\n";
    const source = deck(frame("A") + definitions + frame("B", "\\sampleSize"));
    expect(editBeamerSlides(source, earlier)?.source).toBe(deck(definitions + frame("B", "\\sampleSize") + frame("A")));
  });
  it("resolves a let alias's captured body dependencies at use time", () => {
    const source = deck("\\def\\unit{ms}\n\\def\\value{\\unit}\n\\let\\fixed\\value\n" + frame("A", "\\fixed") + "\\def\\unit{s}\n" + frame("B"));
    const analysis = analyzeBeamerSlideMove(source, later);
    expect(analysis.status).toBe("review");
    expect(analysis.issues.some(issue => issue.message.includes("different definition of \\unit"))).toBe(true);
  });
  it("treats references in unused definitions as shared ownership", () => {
    const source = deck(frame("A") + "\\def\\unit{ms}\n\\def\\other{\\unit}\n" + frame("B", "\\unit"));
    expect(analyzeBeamerSlideMove(source, earlier).status).toBe("blocked");
  });
  it("reviews redefinitions of implicit Beamer state", () => {
    const source = deck(frame("A") + "\\def\\insertframenumber{hidden}\n" + frame("B"));
    expect(analyzeBeamerSlideMove(source, later).status).toBe("review");
  });
  it("checks undocumented conditional commands conservatively", () => {
    const source = deck("\\ifdraft\n" + frame("A") + "\\fi\n" + frame("B"));
    expect(analyzeBeamerSlideMove(source, later).status).toBe("blocked");
  });
  it("rejects a boundary opened inside a frame and closed outside it", () => {
    const source = deck(frame("A", "\\iftrue Content") + "\\fi\n" + frame("B"));
    expect(analyzeBeamerSlideMove(source, later).status).toBe("blocked");
  });
  it("preserves mappings for inline definitions and a noncontiguous multiselection", () => {
    const source = deck(frame("A") + "\\def\\x{1}" + frame("B", "\\x") + frame("C") + "\\def\\y{2}" + frame("D", "\\y"));
    const action = move(["frame:3", "frame:1"], { kind: "before", frameId: "frame:0" });
    const result = editBeamerSlides(source, action)!;
    expect(result).not.toBeNull();
    expect(scanBeamerDocument(result.source).frames.map(frame => frame.title?.value)).toEqual(["B", "D", "A", "C"]);
    expect(result.frameIds).toEqual({ "frame:0": "frame:2", "frame:1": "frame:0", "frame:2": "frame:3", "frame:3": "frame:1" });
    expect(applySourcePatches(source, result.patches)).toMatchObject({ kind: "success", source: result.source });
  });
});

it("reviews conditional definitions whose consumers are outside the branch", () => {
  const source = deck(frame("A") + "\\iftrue\\def\\unit{ms}\\fi\n" + frame("B", "\\unit"));
  expect(analyzeBeamerSlideMove(source, earlier).status).toBe("review");
  expect(editBeamerSlides(source, earlier)).toBeNull();
});
it("reviews package environments with unknown effects", () => {
  const source = deck(frame("A", "\\begin{custom}Content\\end{custom}") + frame("B"));
  expect(analyzeBeamerSlideMove(source, later).status).toBe("review");
});
it("does not carry a definition past an outside use that was previously unresolved", () => {
  const source = deck(frame("A", "\\unit") + "\\def\\unit{ms}\n" + frame("B", "\\unit"));
  const analysis = analyzeBeamerSlideMove(source, earlier);
  expect(analysis.status).toBe("blocked");
  expect(analysis.dependencies).toEqual([]);
});
it.each(["\\color{red}", "\\bfseries", "\\small", "\\textwidth=3cm", "\\label{outside}"])("reviews document-level formatting and state: %s", command => {
  const source = deck(frame("A") + command + "\n" + frame("B"));
  expect(analyzeBeamerSlideMove(source, later).status).toBe("review");
});
it("does not warn when an unchanged slide group is dropped back in place", () => {
  const source = deck(frame("A", "\\mystery") + frame("B"));
  const unchanged = move(["frame:0", "frame:1"], { kind: "end" });
  expect(analyzeBeamerSlideMove(source, unchanged).status).toBe("safe");
  expect(editBeamerSlides(source, unchanged)).toBeNull();
});

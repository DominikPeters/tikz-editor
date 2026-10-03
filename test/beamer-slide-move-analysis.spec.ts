import { readFileSync } from "node:fs";
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

describe("formatting macro effects", () => {
  it("allows the reported KKT slide 2 → 3 move without moving preamble macros", () => {
    const source = readFileSync(new URL("./fixtures/beamer/kkt_theorem_beamer.tex", import.meta.url), "utf8");
    const action = move(["frame:1"], { kind: "after", frameId: "frame:2" });
    expect(analyzeBeamerSlideMove(source, action)).toEqual({ status: "safe", issues: [], dependencies: [] });
    const result = editBeamerSlides(source, action)!;
    expect(result).not.toBeNull();
    expect(scanBeamerDocument(result.source).frames[2].title?.value).toBe("Why KKT conditions matter");
    expect(result.source.slice(0, result.source.indexOf("\\begin{document}"))).toBe(source.slice(0, source.indexOf("\\begin{document}")));
  });
  it("allows every adjacent move in the KKT fixture, including math symbols and loop variables", () => {
    const source = readFileSync(new URL("./fixtures/beamer/kkt_theorem_beamer.tex", import.meta.url), "utf8");
    const frames = scanBeamerDocument(source).frames;
    for (let i = 0; i < frames.length - 1; i++) {
      for (const action of [move([frames[i].id], { kind: "after", frameId: frames[i + 1].id }), move([frames[i + 1].id], { kind: "before", frameId: frames[i].id })]) {
        expect(analyzeBeamerSlideMove(source, action), `Adjacent slides ${i + 1} and ${i + 2}`).toMatchObject({ status: "safe", issues: [] });
      }
    }
  });
  it("understands nested formatting, parameters, defaults, math scripts, and aliases", () => {
    const definitions = String.raw`\newcommand{\R}{\mathbb{R}}
\newcommand{\inner}[2]{\left\langle #1,#2\right\rangle}
\newcommand{\norm}[2][2]{\left\lVert#2\right\rVert_{#1}}
\newcommand{\vectorR}{\R^n}
\let\spaceR\vectorR
\newcommand{\bold}[1]{\textbf{#1}}`;
    const source = deck(frame("A", String.raw`\bold{Space} $\spaceR,\inner{x}{y},\norm{x}, x^\star \succeq y,\min f(x)$`) + frame("B"), definitions);
    expect(analyzeBeamerSlideMove(source, later).status).toBe("safe");
  });
  it.each([
    String.raw`\newcommand{\R}{\global\def\x{1}}`,
    String.raw`\newcommand{\R}{\setcounter{equation}{4}}`,
    String.raw`\newcommand{\R}{\csname change\endcsname}`,
    String.raw`\newcommand{\R}{\unknown}`,
    String.raw`\newcommand{\R}{\R}`,
    String.raw`\newcommand{\R}{\mathbb{R}}\renewcommand{\mathbb}[1]{\global\def\x{#1}}`,
    String.raw`\newcommand{\R}[1][\setcounter{equation}{4}]{#1}`,
  ])("still reviews actual, dynamic, cyclic, and default-argument effects: %s", definitions => {
    const source = deck(frame("A", "\\R") + frame("B"), definitions);
    expect(analyzeBeamerSlideMove(source, later).status).toBe("review");
    expect(editBeamerSlides(source, later)).toBeNull();
  });
  it("checks arguments passed to a formatting macro for effects", () => {
    const source = deck(frame("A", String.raw`\bold{\setcounter{equation}{4}}`) + frame("B"), String.raw`\newcommand{\bold}[1]{\textbf{#1}}`);
    expect(analyzeBeamerSlideMove(source, later).status).toBe("review");
  });
  it("follows the binding at use time, including a redefined stock math command", () => {
    const source = deck(frame("A", "\\R") + String.raw`\renewcommand{\mathbb}[1]{\mathbf{#1}}` + "\n" + frame("B"), String.raw`\newcommand{\R}{\mathbb{R}}`);
    const analysis = analyzeBeamerSlideMove(source, later);
    expect(analysis.status).toBe("review");
    expect(analysis.issues.some(issue => issue.message.includes("different definition of \\mathbb"))).toBe(true);
  });
  it("does not confuse safe macro expansion with permission to move a shared provider", () => {
    const source = deck(frame("A") + String.raw`\newcommand{\R}{\mathbb{R}}` + "\n" + frame("B", "\\R") + frame("C", "\\R"));
    expect(analyzeBeamerSlideMove(source, earlier)).toMatchObject({ status: "blocked", dependencies: [] });
  });
  it("keeps foreach variables scoped and still inspects loop effects", () => {
    const loop = String.raw`\foreach \x/\y in {1/2,3/4}{\draw (\x,\y) circle (2pt);}`;
    expect(analyzeBeamerSlideMove(deck(frame("A", loop) + frame("B")), later).status).toBe("safe");
    for (const body of [loop + "\\x", loop.replace("\\draw", "\\global\\def\\z{1}\\draw"), loop.replace("\\draw", "\\def\\x{\\setcounter{equation}{4}}\\x\\draw")]) {
      expect(analyzeBeamerSlideMove(deck(frame("A", body) + frame("B")), later).status).toBe("review");
    }
  });
});
it.each(["constructor", "toString"])("does not mistake object properties for stock math commands: %s", name => {
  const source = deck(frame("A", `\\${name}`) + frame("B"));
  expect(analyzeBeamerSlideMove(source, later).status).toBe("review");
});
it("checks an overridden foreach rather than assuming it binds iteration variables", () => {
  const source = deck(frame("A", String.raw`\foreach \x in {1,2}{\draw (\x,0) circle (1pt);}`) + frame("B"), String.raw`\renewcommand{\foreach}{Plain text}`);
  expect(analyzeBeamerSlideMove(source, later).status).toBe("review");
});

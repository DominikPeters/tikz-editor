import { describe, expect, it } from "vitest";

import { buildDeckDocumentInspector, prepareBeamerDocument, scanBeamerDocument } from "../packages/core/src/beamer/index.js";
import { beamerInputFileCandidates, beamerMainSyntaxForReparse, findBeamerInputUses } from "../packages/core/src/beamer/input-files.js";
import { parseBeamerFrameBody } from "../packages/core/src/beamer/content.js";
import { collectBeamerProjectFiles, createBeamerProjectFiles } from "../packages/core/src/beamer/project-files.js";

const files = (entries: Record<string, string>) => createBeamerProjectFiles(new Map(Object.entries(entries)), "k");
const render = async (source: string, projectFiles?: ReturnType<typeof files>) =>
  (await prepareBeamerDocument(source, projectFiles ? { projectFiles } : {}).renderFrame({ frameIndex: 0 })).layout;
const columnXs = (layout: Awaited<ReturnType<typeof render>>) => layout.items.filter(item => item.kind === "column").map(item => Math.round(item.bounds.x * 100) / 100);

const HEAD = String.raw`\documentclass{beamer}
\usepackage[size=a1,orientation=landscape]{beamerposter}
\newlength{\sepwidth}\newlength{\colwidth}
\setlength{\sepwidth}{0.04\paperwidth}\setlength{\colwidth}{0.44\paperwidth}
`;

describe("\\input and \\include names", () => {
  it("tries .tex first, as TeX does", () => {
    expect(beamerInputFileCandidates("blocks/a")).toEqual(["blocks/a.tex", "blocks/a"]);
    expect(beamerInputFileCandidates("a.tex")).toEqual(["a.tex"]);
    expect(beamerInputFileCandidates("\\jobname")).toEqual([]);
  });

  it("finds uses outside comments", () => {
    const text = String.raw`\input{a}
% \input{b}
x \include{c/d} 50\% \input{e}`;
    expect(findBeamerInputUses(text).map(use => use.name)).toEqual(["a", "c/d", "e"]);
  });

  it("collects input files, nested ones, and the theme files they load", async () => {
    const source = String.raw`\documentclass{beamer}
\input{shared/preamble}
\begin{document}\begin{frame}\input{body/one}\end{frame}\end{document}`;
    const known: Record<string, string> = {
      "shared/preamble.tex": String.raw`\usetheme{mine}`, "beamerthememine.sty": "", "body/one.tex": String.raw`\input{body/two.tex}`, "body/two.tex": "two",
    };
    const requested: string[] = [];
    const collected = await collectBeamerProjectFiles(source, async name => { requested.push(name); return known[name] ?? null; });
    expect([...collected.keys()].sort()).toEqual(["beamerthememine.sty", "body/one.tex", "body/two.tex", "shared/preamble.tex"]);
    expect(requested).not.toContain("body/one");
  });
});

describe("\\input in frame bodies", () => {
  const body = String.raw`\begin{block}{Included}
Included text here.
\end{block}
`;
  const main = (inner: string) => `${HEAD}\\begin{document}\n\\begin{frame}[t]\n\\begin{columns}[t]\n\\begin{column}{\\colwidth}\n${inner}\n\\end{column}\n\\end{columns}\n\\end{frame}\n\\end{document}\n`;

  it("renders the included block like the same text inline", async () => {
    const inline = await render(main(body));
    const source = main("\\input{blocks/a}");
    const included = await render(source, files({ "blocks/a.tex": body }));
    const blockOf = (layout: typeof inline) => layout.items.find(item => item.kind === "block");
    expect(blockOf(included)).toBeDefined();
    expect(blockOf(included)?.bounds.y).toBeCloseTo(blockOf(inline)?.bounds.y ?? -1, 3);
    expect(blockOf(included)?.bounds.height).toBeCloseTo(blockOf(inline)?.bounds.height ?? -1, 3);
    expect(included.paragraphs.length).toBe(inline.paragraphs.length);
  });

  it("keeps the other file out of reach of canvas edits", async () => {
    const source = main("Before.\n\\input{blocks/a}\nAfter.");
    const layout = await render(source, files({ "blocks/a.tex": body }));
    const use = { from: source.indexOf("\\input"), to: source.indexOf("\\input") + "\\input{blocks/a}".length };
    for (const paragraph of layout.paragraphs) {
      expect(paragraph.sourceSpan.to).toBeLessThanOrEqual(source.length);
      for (const editable of paragraph.editableTextSpans) expect(editable.span.to).toBeLessThanOrEqual(source.length);
    }
    for (const item of layout.items) expect(item.sourceSpan.to).toBeLessThanOrEqual(source.length);
    const block = layout.items.find(item => item.kind === "block");
    expect(block?.sourceSpan).toEqual(use);
    const text = layout.paragraphs.filter(paragraph => paragraph.role === "body").map(paragraph => paragraph.sourceSpan);
    expect(text.some(span => span.from === source.indexOf("Before."))).toBe(true);
    expect(text.some(span => span.from === source.indexOf("After."))).toBe(true);
  });

  it("leaves the use as text when the project lacks the file", async () => {
    const layout = await render(main("\\input{blocks/a}"));
    expect(layout.items.some(item => item.kind === "block")).toBe(false);
  });
});

describe("macros that expand to a column", () => {
  it("count in the columns layout like the written-out column", async () => {
    const written = String.raw`\begin{column}{\sepwidth}\end{column}`;
    const frame = (separator: string) => String.raw`\begin{document}
\begin{frame}[t]
\begin{columns}[t]
${separator}
\begin{column}{\colwidth}A\end{column}
${separator}
\begin{column}{\colwidth}B\end{column}
${separator}
\end{columns}
\end{frame}
\end{document}`;
    const expected = columnXs(await render(`${HEAD}${frame(written)}`));
    const macro = `${HEAD}\\newcommand{\\separatorcolumn}{${written}}\n${frame("\\separatorcolumn")}`;
    const layout = await render(macro);
    expect(columnXs(layout)).toEqual(expected);
    expect(expected).toHaveLength(5);
    // The macro's columns belong to its uses.
    const uses = [...macro.matchAll(/\\separatorcolumn(?![A-Za-z])(?=\n)/gu)].map(match => match.index);
    const sepSpans = layout.items.filter(item => item.kind === "column").map(item => item.sourceSpan).filter(span => uses.includes(span.from));
    expect(sepSpans).toHaveLength(3);
    for (const item of layout.items) expect(item.sourceSpan.to).toBeLessThanOrEqual(macro.length);
  });
});

describe("macros with arguments and several columns", () => {
  const frame = (columns: string) => String.raw`\begin{document}
\begin{frame}[t]
\begin{columns}[t]
${columns}
\end{columns}
\end{frame}
\end{document}`;
  it("realise a column macro with an argument like the written-out column", async () => {
    const written = frame("\\begin{column}{0.3\\paperwidth}A\\end{column}\n\\begin{column}{\\colwidth}B\\end{column}");
    const expected = await render(`${HEAD}${written}`);
    const macro = `${HEAD}\\newcommand{\\col}[2]{\\begin{column}{#1}#2\\end{column}}\n${frame("\\col{0.3\\paperwidth}{A}\n\\col{\\colwidth}{B}")}`;
    const layout = await render(macro);
    expect(columnXs(layout)).toEqual(columnXs(expected));
    expect(columnXs(layout)).toHaveLength(2);
    for (const item of layout.items) expect(item.sourceSpan.to).toBeLessThanOrEqual(macro.length);
  });

  it("realise a macro whose body is two columns", async () => {
    const pair = String.raw`\begin{column}{\sepwidth}\end{column}\begin{column}{\colwidth}C\end{column}`;
    const expected = await render(`${HEAD}${frame(pair + "\n" + pair)}`);
    const macro = `${HEAD}\\newcommand{\\pair}{${pair}}\n${frame("\\pair\n\\pair")}`;
    const layout = await render(macro);
    expect(columnXs(layout)).toEqual(columnXs(expected));
    expect(columnXs(layout)).toHaveLength(4);
  });
});

describe("\\input in the preamble", () => {
  it("executes shared lengths and beamerposter loading", async () => {
    const shared = String.raw`\usepackage[size=a1,orientation=landscape]{beamerposter}
\newlength{\sepwidth}\newlength{\colwidth}
\setlength{\sepwidth}{0.04\paperwidth}\setlength{\colwidth}{0.44\paperwidth}
`;
    const doc = (preamble: string) => String.raw`\documentclass{beamer}
${preamble}
\begin{document}
\begin{frame}[t]
\begin{columns}[t]
\begin{column}{\colwidth}A\end{column}
\begin{column}{\sepwidth}\end{column}
\begin{column}{\colwidth}B\end{column}
\end{columns}
\end{frame}
\end{document}`;
    const inline = prepareBeamerDocument(doc(shared));
    const source = doc("\\input{../shared/poster}");
    const included = prepareBeamerDocument(source, { projectFiles: files({ "../shared/poster.tex": shared }) });
    const a = await inline.renderFrame({ frameIndex: 0 });
    const b = await included.renderFrame({ frameIndex: 0 });
    expect(b.layout.page.page.width).toBeCloseTo(a.layout.page.page.width, 3);
    expect(columnXs(b.layout)).toEqual(columnXs(a.layout));
    expect(b.layout.page.page.width).toBeGreaterThan(1000);
    for (const diagnostic of b.diagnostics) if (diagnostic.span) expect(diagnostic.span.to).toBeLessThanOrEqual(source.length);
  });

  it("runs a macro from the shared file that loads beamerposter", async () => {
    const shared = String.raw`\newcommand{\PosterSize}{\usepackage[size=a1,orientation=landscape]{beamerposter}}`;
    const source = String.raw`\documentclass{beamer}
\input{shared}
\PosterSize
\begin{document}\begin{frame}x\end{frame}\end{document}`;
    const prepared = prepareBeamerDocument(source, { projectFiles: files({ "shared.tex": shared }) });
    const { layout } = await prepared.renderFrame({ frameIndex: 0 });
    expect(layout.page.page.width).toBeGreaterThan(1000);
  });
});

describe("document inspector with project files", () => {
  const theme = String.raw`\setbeamercolor{structure}{fg=red}`;
  const attach = (source: string, projectFiles: ReturnType<typeof files>) => prepareBeamerDocument(source, { projectFiles });

  it("shows a loaded local theme as previewed", () => {
    const source = String.raw`\documentclass{beamer}
\usetheme{mine}
\begin{document}\begin{frame}x\end{frame}\end{document}`;
    const without = buildDeckDocumentInspector(scanBeamerDocument(source)).theme;
    expect(without).toMatchObject({ name: "mine", supported: false, local: false });
    const prepared = attach(source, files({ "beamerthememine.sty": theme }));
    const withFiles = buildDeckDocumentInspector(prepared.document).theme;
    expect(withFiles).toMatchObject({ name: "mine", supported: true, local: true });
    expect(buildDeckDocumentInspector(prepared.document, prepared.theme).theme.local).toBe(true);
  });

  it("reads a theme chosen in an included file, without offering to edit it", () => {
    const source = String.raw`\documentclass{beamer}
\input{shared/preamble}
\begin{document}\begin{frame}x\end{frame}\end{document}`;
    const prepared = attach(source, files({ "shared/preamble.tex": String.raw`\usetheme{Madrid}`, }));
    const card = buildDeckDocumentInspector(prepared.document).theme;
    expect(card).toMatchObject({ name: "Madrid", supported: true });
    expect(card.readOnly?.span).toEqual({ from: source.indexOf("\\input"), to: source.indexOf("\\input") + "\\input{shared/preamble}".length });
  });

  it("shows the poster page of a beamerposter document instead of the aspect ratio", () => {
    const source = String.raw`\documentclass{beamer}
\usepackage[size=a1,orientation=portrait,scale=1.2]{beamerposter}
\begin{document}\begin{frame}x\end{frame}\end{document}`;
    const page = buildDeckDocumentInspector(scanBeamerDocument(source)).page;
    expect(page.map(field => field.id)).toEqual(["poster-size", "poster-orientation", "poster-scale", "navigation-symbols"]);
    expect(page[0]).toMatchObject({ value: "a1", write: null, readOnly: { span: { from: source.indexOf("\\usepackage") } } });
    expect(page[1]).toMatchObject({ value: "portrait" });
    expect(page[2]).toMatchObject({ value: "1.2" });
  });

  it("finds beamerposter loaded by a macro of an included file", () => {
    const source = String.raw`\documentclass{beamer}
\input{sizes}
\PosterWorkshop
\begin{document}\begin{frame}x\end{frame}\end{document}`;
    const sizes = String.raw`\newcommand{\PosterWorkshop}{\usepackage[size=custom,width=60.96,height=91.44]{beamerposter}}`;
    const page = buildDeckDocumentInspector(attach(source, files({ "sizes.tex": sizes })).document).page;
    expect(page[0]).toMatchObject({ id: "poster-size", value: "custom", options: expect.arrayContaining([{ value: "custom", label: "Custom (60.96 × 91.44 cm)" }]) });
    expect(page[1]).toMatchObject({ value: "landscape" });
  });

  it("keeps slide documents on the aspect ratio", () => {
    const page = buildDeckDocumentInspector(scanBeamerDocument(String.raw`\documentclass{beamer}\begin{document}\end{document}`)).page;
    expect(page.map(field => field.id)).toEqual(["aspectratio", "class-font-size", "navigation-symbols"]);
  });
});

describe("vertical fill in column flow", () => {
  const doc = (inner: string) => String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}[t]
\begin{columns}[T]
\begin{column}{0.5\textwidth}
${inner}
\end{column}
\end{columns}
\end{frame}
\end{document}`;
  for (const fill of ["\\vfill", "\\vspace{\\fill}", "\\vspace*{\\fill}"]) {
    it(`cuts a column paragraph at ${fill}`, () => {
      const source = doc(`left${fill} foot`);
      const body = prepareBeamerDocument(source) && parseColumnsOf(source);
      expect(body.map(node => node.kind)).toEqual(["paragraph", "paragraph"]);
    });
  }
});

function parseColumnsOf(source: string) {
  const document = scanBeamerDocument(source);
  const ir = parseBeamerFrameBody({ source, frame: document.frames[0], document });
  const columns = ir.children.find(node => node.kind === "columns");
  if (columns?.kind !== "columns") throw new Error("Expected columns");
  return columns.columns[0].children;
}

describe("\\input inside text and groups", () => {
  const TIKZ = String.raw`\begin{tikzpicture}
\draw[fill=blue!20] (0,0) rectangle (3,1.5);
\node at (1.5,0.75) {Schematic};
\end{tikzpicture}
`;
  const frame = (body: string) => String.raw`\documentclass{beamer}
\usepackage{tikz}
\begin{document}
\begin{frame}{Title}
${body}
\end{frame}
\end{document}
`;
  const assertInside = (layout: Awaited<ReturnType<typeof render>>, source: string) => {
    const spans = [
      ...layout.items.map(item => item.sourceSpan),
      ...layout.embeddedTikz.map(picture => picture.sourceSpan),
      ...layout.graphics.map(graphic => graphic.sourceSpan),
      ...layout.paragraphs.flatMap(paragraph => [paragraph.sourceSpan, ...paragraph.editableTextSpans.map(entry => entry.span),
        ...paragraph.atomicRenderSpans.map(atom => atom.span), ...(paragraph.readOnlySourceSpans ?? []), ...(paragraph.hiddenSourceSpans ?? [])]),
    ];
    for (const span of spans) expect(span.to).toBeLessThanOrEqual(source.length);
  };

  it("draws a picture from a file inside a figure like the inline picture, owned by the use", async () => {
    const source = frame("Above.\n\\begin{figure}\n\\centering\n\\input{fig.tikz}\n\\caption{Cap.}\n\\end{figure}\nBelow.");
    const inline = frame("Above.\n\\begin{figure}\n\\centering\n" + TIKZ.trimEnd() + "\n\\caption{Cap.}\n\\end{figure}\nBelow.");
    const included = await render(source, files({ "fig.tikz": TIKZ }));
    const expected = await render(inline);
    assertInside(included, source);
    const use = source.indexOf("\\input{fig.tikz}");
    expect(included.embeddedTikz).toHaveLength(1);
    expect(included.embeddedTikz[0]?.sourceSpan).toEqual({ from: use, to: use + "\\input{fig.tikz}".length });
    for (const key of ["x", "y", "width", "height"] as const) {
      expect(included.embeddedTikz[0]?.bounds[key]).toBeCloseTo(expected.embeddedTikz[0]?.bounds[key] ?? -1, 3);
    }
    expect(included.paragraphs.length).toBe(expected.paragraphs.length);
    // Nothing of the included text can be typed into.
    for (const paragraph of included.paragraphs) {
      for (const editable of paragraph.editableTextSpans) {
        expect(editable.span.to <= use || editable.span.from >= use + "\\input{fig.tikz}".length).toBe(true);
      }
    }
  });

  it("scales an included picture inside \\scalebox", async () => {
    const source = frame("\\scalebox{0.6}{\\input{plot}}");
    const layout = await render(source, files({ "plot.tex": TIKZ }));
    assertInside(layout, source);
    expect(layout.paragraphs.some(paragraph => paragraph.atomicRenderSpans.length > 0 || paragraph.editableTextSpans.length === 0)).toBe(true);
  });

  it("keeps prose around an \\input in one paragraph", async () => {
    const source = frame("Before \\input{words} after, and more.\n\\begin{itemize}\n\\item One \\input{words} item.\n\\end{itemize}");
    const layout = await render(source, files({ "words.tex": "the included words\n" }));
    assertInside(layout, source);
    const body = layout.paragraphs.filter(paragraph => paragraph.role === "body");
    expect(body).toHaveLength(1);
    const text = body[0]?.report.lines.map(line => line.segments.map(segment => segment.text).join("")).join(" ") ?? "";
    expect(text).toContain("Before the included words");
    expect(text).toMatch(/One the included words\s+item/u);
    // The words before and after the use stay editable, the file's do not.
    const use = source.indexOf("\\input{words}");
    const spans = body[0]?.editableTextSpans.map(entry => entry.span) ?? [];
    expect(spans.some(span => span.from < use && span.to <= use)).toBe(true);
    expect(spans.some(span => span.from >= use + "\\input{words}".length)).toBe(true);
    expect(spans.every(span => span.to <= use || span.from >= use + "\\input{words}".length)).toBe(true);
  });

  it("reads nested inputs inside text", async () => {
    const source = frame("A \\input{one} Z");
    const layout = await render(source, files({ "one.tex": "one \\input{two}\n", "two.tex": "two\n" }));
    assertInside(layout, source);
    const text = layout.paragraphs.filter(paragraph => paragraph.role === "body").map(paragraph => paragraph.report.lines.map(line => line.segments.map(segment => segment.text).join("")).join(" ")).join(" ");
    expect(text).toMatch(/A one two\s+Z/u);
  });
});

describe("incremental reparse of documents with a virtual tail", () => {
  const doc = (word: string) => String.raw`\documentclass{beamer}
\usepackage[size=a1,orientation=landscape]{beamerposter}
\newlength{\sepwidth}\newlength{\colwidth}
\setlength{\sepwidth}{0.04\paperwidth}\setlength{\colwidth}{0.44\paperwidth}
\newcommand{\separatorcolumn}{\begin{column}{\sepwidth}\end{column}}
\begin{document}
\begin{frame}[t]
\begin{columns}[t]
\separatorcolumn
\begin{column}{\colwidth}
${word} text.
\input{blocks/a}
\end{column}
\separatorcolumn
\end{columns}
\end{frame}
\end{document}
`;
  const project = files({ "blocks/a.tex": "\\begin{block}{B}\nIncluded.\n\\end{block}\n" });
  const trees = (source: string, extra: object) => {
    const prepared = prepareBeamerDocument(source, { projectFiles: project, ...extra });
    return { prepared, tree: String(prepared.syntax.tree) };
  };

  for (const masked of [false, true]) {
    it(`matches a fresh parse after an edit${masked ? " under a structural mask" : ""}`, async () => {
      const first = doc("Alpha");
      const second = doc("Alpha beta gamma");
      const masks = masked ? { structuralMasks: [{ from: first.indexOf("Alpha"), to: first.indexOf("Alpha") + 5 }] } : {};
      const before = trees(first, masks);
      const incremental = trees(second, { ...masks, previousSyntax: before.prepared.syntax });
      const fresh = trees(second, { ...masks, exactSyntax: true });
      expect(incremental.tree).toBe(fresh.tree);
      expect(incremental.prepared.syntax.source).toBe(fresh.prepared.syntax.source);
      expect(incremental.prepared.syntax.source.length).toBeGreaterThan(second.length);
      const a = (await incremental.prepared.renderFrame({ frameIndex: 0 })).layout;
      const b = (await fresh.prepared.renderFrame({ frameIndex: 0 })).layout;
      expect(a.paragraphs.map(paragraph => paragraph.bounds)).toEqual(b.paragraphs.map(paragraph => paragraph.bounds));
      expect(a.items.map(item => item.sourceSpan)).toEqual(b.items.map(item => item.sourceSpan));
    });
  }

  it("reparses the document's own source from its own earlier tree", () => {
    const first = trees(doc("Alpha"), {});
    expect(beamerMainSyntaxForReparse(first.prepared.syntax)?.source).toBe(doc("Alpha"));
    expect(beamerMainSyntaxForReparse(undefined)).toBeUndefined();
  });
});

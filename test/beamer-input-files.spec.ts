import { describe, expect, it } from "vitest";

import { buildDeckDocumentInspector, prepareBeamerDocument, scanBeamerDocument } from "../packages/core/src/beamer/index.js";
import { beamerInputFileCandidates, findBeamerInputUses } from "../packages/core/src/beamer/input-files.js";
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

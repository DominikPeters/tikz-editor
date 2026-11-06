import { describe, expect, it } from "vitest";
import { prepareBeamerDocument } from "../packages/core/src/beamer/render.js";
const picture = String.raw`\begin{tikzpicture}\fill[red] (0,0) rectangle (1,1);\end{tikzpicture}`;
const deck = (body: string, preamble = String.raw`\date{}`) => String.raw`\documentclass{beamer}\usepackage{tikz}` + preamble + String.raw`\begin{document}\begin{frame}` + body + String.raw`\end{frame}\end{document}`;
const column = (body: string) => String.raw`\begin{columns}\begin{column}{.5\textwidth}` + body + String.raw`\end{column}\begin{column}{.5\textwidth}Neighbor\end{column}\end{columns}`;
describe("Beamer text/picture flow boundaries", () => {
  it.each(["centering", "raggedleft"])("honors \\%s in prose and columns", async command => {
    for (const wrap of [(body:string)=>body,column]) {
      const page=await prepareBeamerDocument(deck(wrap(`\\${command} Alpha\\par Omega`))).renderFrame();
      const paragraph=page.layout.paragraphs.find(p=>p.report.lines.some(l=>l.segments.some(s=>s.text==='Alpha')))!;
      for(const line of paragraph.report.lines) {
        const expected=(paragraph.bounds.width-Number(line.naturalWidth))/(command==='centering'?2:1);
        expect(Number(line.xStart)).toBeCloseTo(expected,3);
      }
    }
  });
  it.each([column(String.raw`\begin{center}`+picture+String.raw`\end{center}`),String.raw`\begin{center}Alpha\par `+picture+String.raw`\par Omega\end{center}`,String.raw`\begin{block}{Block}`+picture+String.raw`\end{block}`])("keeps wrapper environments around inline pictures",async body=>{
    const page=await prepareBeamerDocument(deck(body)).renderFrame();
    expect(page.diagnostics).toEqual([]);
    expect(page.svg.svg).not.toContain('data-tex-literal=');
    expect(page.layout.embeddedTikz).toHaveLength(1);
    expect(page.svg.svg).toContain('#ff0000');
  });
  it.each([String.raw`\fill<2->[red] (0,0) rectangle (1,1);`,String.raw`\only<2->{\fill[red] (0,0) rectangle (1,1);}`,String.raw`\uncover<2->{\fill[red] (0,0) rectangle (1,1);}`])("projects path overlays and wrapper overlays before TikZ parsing",async body=>{
    const pages=await prepareBeamerDocument(deck(String.raw`\begin{tikzpicture}`+body+String.raw`\end{tikzpicture}`)).renderFramePages();
    expect(pages.pageCount).toBe(2);
    for(const page of pages.pages)expect(page.diagnostics).toEqual([]);
    expect(pages.pages[0].svg.svg).not.toContain('fill="#ff0000"');
    expect(pages.pages[1].svg.svg).toContain('fill="#ff0000"');
  });
  it("does not treat label punctuation or comments as path terminators", async () => {
    const source = deck(String.raw`\begin{tikzpicture}% comment with an astral character 🖉
\node<2-> {Alpha;]Beta};
\end{tikzpicture}`);
    const pages = await prepareBeamerDocument(source).renderFramePages();
    expect(pages.pageCount).toBe(2);
    expect(pages.pages.every(page => page.diagnostics.length === 0)).toBe(true);
    expect(pages.pages[0].layout.embeddedTikz[0]?.bounds.height).toBe(0);
    expect(pages.pages[1].layout.embeddedTikz[0]?.sourceSpan.from).toBe(source.indexOf(String.raw`\begin{tikzpicture}`));
    expect(pages.pages[1].svg.svg).toContain('data-tex-glyph=');
  });

  it("supports fixed compilation dates, default title dates and user overrides",async()=>{
    const fixed=String.raw`\year=2026\month=11\day=5\title{Probe}`;
    const prepared = prepareBeamerDocument(deck(String.raw`\titlepage`,fixed));
    expect(prepared.document.preamble.metadata.date).toBeUndefined();
    const page=await prepared.renderFrame();
    const text=page.layout.paragraphs.flatMap(p=>p.report.lines.map(l=>l.segments.map(s=>s.text??'').join(''))).join(' ');
    expect(text).toContain('November 5, 2026');
    const custom=await prepareBeamerDocument(deck(String.raw`\today`,fixed+String.raw`\renewcommand{\today}{Custom}`)).renderFrame();
    expect(custom.layout.paragraphs[0]?.report.lines[0]?.segments.map(s=>s.text).join('')).toBe('Custom');
    const registers = await prepareBeamerDocument(deck(String.raw`\number\year/\the\month/\number\day`,fixed)).renderFrame();
    expect(registers.layout.paragraphs[0]?.report.lines[0]?.segments.map(s=>s.text).join('')).toBe('2026/11/5');
  });
});

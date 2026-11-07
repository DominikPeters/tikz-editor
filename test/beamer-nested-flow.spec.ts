import { describe, expect, it } from "vitest";
import { prepareBeamerDocument } from "../packages/core/src/beamer/render.js";
import { resolveBeamerEditScopeAt } from "../packages/core/src/beamer/edit-scopes.js";
const deck = (body: string) => String.raw`\documentclass{beamer}\date{}\begin{document}\begin{frame}[t]{Flow}\relax ` + body + String.raw`\end{frame}\end{document}`;
const columns = (body: string, mode = "T") => String.raw`\begin{columns}[onlytextwidth,` + mode + String.raw`]\begin{column}{.6\textwidth}` + body + String.raw`\end{column}\begin{column}{.35\textwidth}Neighbor\end{column}\end{columns}`;
const inner = String.raw`\begin{columns}[onlytextwidth,T]\begin{column}{.45\textwidth}Left\end{column}\begin{column}{.45\textwidth}Right\end{column}\end{columns}`;
describe("structural Beamer flow within native text containers", () => {
  it.each(["T", "t", "c", "b"])("retains nested columns and nearest editing scopes (%s)", async mode => {
    const source = deck(columns(inner, mode));
    const page = await prepareBeamerDocument(source).renderFrame();
    expect(page.diagnostics).toEqual([]);
    expect(page.svg.svg).not.toContain("data-tex-literal=");
    for (const word of ["Left", "Right", "Neighbor"]) {
      expect(page.layout.paragraphs.some(p => p.report.lines.some(l => l.segments.some(s => s.text === word)))).toBe(true);
      const scope = resolveBeamerEditScopeAt(page.layout.editScopes ?? [], source.indexOf(word));
      expect(scope?.kind).toBe("column");
      expect(source.slice(scope!.span.from, scope!.span.to)).not.toContain("begin{columns}");
    }
  });
  it("restores scoped sizes after grouped columns", async () => {
    const page = await prepareBeamerDocument(deck("{\\scriptsize " + inner + "\\par} Outside.")).renderFrame();
    expect(page.diagnostics).toEqual([]);
    const segments = page.layout.paragraphs.flatMap(p => p.report.lines.flatMap(l => l.segments));
    expect(Number(segments.find(s => s.text === "Left")?.fontAtPt)).toBe(8);
    expect(Number(segments.find(s => s.text === "Outside.")?.fontAtPt)).toBe(10.95);
  });
  it("keeps a block inside its list without printing delimiters", async () => {
    const page = await prepareBeamerDocument(deck(String.raw`\begin{itemize}\item Before\begin{block}{Panel}Inside\end{block}\item After\end{itemize}`)).renderFrame();
    expect(page.diagnostics).toEqual([]);
    expect(page.svg.svg).not.toContain("data-tex-literal=");
    expect(page.layout.paragraphs.find(p => p.role === "block-title")?.report.lines[0].segments.map(s => s.text).join("")).toBe("Panel");
    const inside = page.layout.paragraphs.find(p => p.role === "block-body");
    const outside = page.layout.paragraphs.find(p => p.role === "body");
    expect(inside).toBeDefined();
    expect(outside?.report.lines.map(l => l.segments.map(s => s.text).join("")).join("|")).toBe("Before|After");
  });
});

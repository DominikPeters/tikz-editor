import { describe, expect, it } from "vitest";
import { prepareBeamerDocument, scanBeamerDocument } from "../packages/core/src/beamer/index.js";

describe("Beamer speaker notes", () => {
  it("accumulates build-specific prose and items without adding notes to audience output", async () => {
    const prepared = prepareBeamerDocument(String.raw`\documentclass{beamer}
\AtBeginNote{Remember.\par}\AtEndNote{\par Finish.}
\begin{document}\begin{frame}Public text.
\note{Private prose.}\note[item]<2>{Private item.}
\note<2>{\begin{block}{Secret title}Secret block.\end{block}}
\end{frame}\end{document}`);
    expect(prepared.frameStepCount(0)).toBe(2);
    expect(prepared.speakerNotes(0, 1)).toContain("Private prose.");
    expect(prepared.speakerNotes(0, 1)).not.toContain("Private item.");
    expect(prepared.speakerNotes(0, 2)).toContain(String.raw`\begin{enumerate}\item Private item.\end{enumerate}`);
    expect(prepared.speakerNotes(0, 2)).toContain("Secret block.");
    const rendered = await prepared.renderFrame({ step: 2 });
    expect(rendered.svg.svg).not.toMatch(/Private|Secret/);
    expect(rendered.layout.paragraphs).toHaveLength(1);
    expect(rendered.diagnostics.some(d => d.code?.includes("unsupported"))).toBe(false);
  });

  it("uses the last following outside note on the last build and keeps earlier build notes", () => {
    const prepared = prepareBeamerDocument(String.raw`\documentclass{beamer}\begin{document}
\begin{frame}One\pause Two\note{Inside}\end{frame}
\note{First outside}\note[itemize]{\item Last outside}
\begin{frame}Next\end{frame}\end{document}`);
    expect(prepared.speakerNotes(0, 1)).toBe("Inside");
    expect(prepared.speakerNotes(0, 2)).toBe(String.raw`\begin{itemize}\item Last outside\end{itemize}`);
    expect(prepared.speakerNotes(1, 1)).toBe("");
  });

  it("does not let overlays or list items inside private note bodies affect slide builds", () => {
    const prepared = prepareBeamerDocument(String.raw`\documentclass{beamer}\begin{document}\begin{frame}
Hello\note{\pause\begin{itemize}\item<9> Secret\end{itemize}}\end{frame}\end{document}`);
    expect(prepared.frameStepCount(0)).toBe(1);
  });

  it("also removes notes introduced by a user macro from audience text", async () => {
    const prepared = prepareBeamerDocument(String.raw`\documentclass{beamer}\newcommand{\reminder}{\note{PRIVATE MACRO NOTE}}\begin{document}\begin{frame}Public\reminder\end{frame}\end{document}`);
    const page = await prepared.renderFrame();
    expect(page.svg.svg).not.toMatch(/PRIVATE|MACRO NOTE/);
  });
  it("keeps private frames and diagrams out of the document's public root inventory", () => {
    const source = String.raw`\documentclass{beamer}\begin{document}\begin{frame}
\note{\begin{frame}Private\end{frame}\begin{tikzpicture}\node{Private};\end{tikzpicture}}
\begin{tikzpicture}\node{Public};\end{tikzpicture}\end{frame}\end{document}`;
    const scanned = scanBeamerDocument(source);
    expect(scanned.frames).toHaveLength(1);
    expect(scanned.frames[0].children).toHaveLength(1);
    expect(source.slice(scanned.frames[0].children[0].span.from, scanned.frames[0].children[0].span.to)).toContain("Public");
    expect(prepareBeamerDocument(source).document.frames[0].children).toHaveLength(1);
  });
});

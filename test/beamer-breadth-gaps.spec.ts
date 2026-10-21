import { describe, expect, it } from "vitest";
import { prepareBeamerDocument } from "../packages/core/src/beamer/render.js";

const deck = (body: string, preamble = "") => String.raw`\documentclass{beamer}` + preamble +
  String.raw`\begin{document}` + body + String.raw`\end{document}`;

describe("Beamer breadth gap boundaries", () => {
  it("keeps a notes-only frame empty without producing an unsupported-content card", async () => {
    const prepared = prepareBeamerDocument(deck(String.raw`\begin{frame}\note{Private reminder.}\end{frame}`));
    const page = await prepared.renderFrame();
    expect(prepared.speakerNotes(0, 1)).toBe("Private reminder.");
    expect(page.layout.paragraphs).toEqual([]);
    expect(page.layout.items.some(item => item.kind === "unsupported")).toBe(false);
    expect(page.svg.svg).not.toContain("Private");
    expect(page.diagnostics).toEqual([]);
  });

  it("diagnoses contents options beyond the supported subsection filters", async () => {
    const source = deck(String.raw`\section{First}\begin{frame}\tableofcontents[currentsection]\end{frame}`);
    const page = await prepareBeamerDocument(source).renderFrame();
    const warning = page.diagnostics.find(item => item.code === "beamer-contents-unsupported-options");
    expect(warning).toBeDefined();
    expect(source.slice(warning!.span.from, warning!.span.to)).toContain("currentsection");
    expect(page.svg.svg).not.toContain("data-tex-literal=");
  });

  it.each(["frametitle", "head", "foot"])("paints Moloch %s progress with the configured foreground", async position => {
    const source = deck(String.raw`\begin{frame}{First}Body\end{frame}\begin{frame}{Second}Body\end{frame}`,
      String.raw`\usetheme[progressbar=` + position + String.raw`]{moloch}\setbeamercolor{progress bar}{fg=red,bg=blue}`);
    const page = await prepareBeamerDocument(source).renderFrame();
    const bars = Array.from(page.svg.svg.matchAll(/<rect\b[^>]*data-beamer-template-part="[^"]*:progress(?:-background)?"[^>]*>/gu), match => match[0]);
    expect(bars).toHaveLength(2);
    expect(bars.some(markup => markup.includes('fill="#ff0000"'))).toBe(true);
    expect(bars.some(markup => markup.includes('fill="#0000ff"'))).toBe(true);
  });
});

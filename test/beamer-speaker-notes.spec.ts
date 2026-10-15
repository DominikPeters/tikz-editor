import { describe, expect, it } from "vitest";
import { beamerFrameNotes, checkBeamerNoteBody, editBeamerFrameNote, prepareBeamerDocument, scanBeamerDocument } from "../packages/core/src/beamer/index.js";

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

describe("Beamer speaker note editing", () => {
  const deck = (frames: string) => String.raw`\documentclass{beamer}
\begin{document}
` + frames + String.raw`\end{document}
`;
  const frameId = (source: string, index = 0) => scanBeamerDocument(source).frames[index].id;

  it("lists a frame's notes inside it, then those after it, with their specifications", () => {
    const source = deck(String.raw`\begin{frame}{One}
  Text\note<2->{Later}
  \note[item]{Point}
\end{frame}
\note[enumerate]{\item After}
\section{Next}
\begin{frame}{Two}\note{Other}\end{frame}
`);
    const notes = beamerFrameNotes(source, frameId(source));
    expect(notes?.map(note => [note.placement, note.overlay, note.option, note.text])).toEqual([
      ["frame", "2-", "", "Later"], ["frame", "", "item", "Point"], ["after", "", "enumerate", String.raw`\item After`]]);
    expect(beamerFrameNotes(source, frameId(source, 1))?.map(note => note.text)).toEqual(["Other"]);
    expect(beamerFrameNotes(source, "missing")).toBeNull();
  });

  it("writes a first note on its own line at the end of the frame, shown with every build", () => {
    const source = deck(String.raw`\begin{frame}{One}
	Text\pause More
\end{frame}
`);
    const result = editBeamerFrameNote(source, { kind: "set", frameId: frameId(source), index: 0, text: "Say hello." });
    expect(result?.source).toBe(deck(String.raw`\begin{frame}{One}
	Text\pause More
	\note{Say hello.}
\end{frame}
`));
    const prepared = prepareBeamerDocument(requireValue(result).source);
    expect([1, 2].map(step => prepared.speakerNotes(0, step))).toEqual(["Say hello.", "Say hello."]);
    const oneLine = deck(String.raw`\begin{frame}Public\end{frame}
`);
    expect(editBeamerFrameNote(oneLine, { kind: "set", frameId: frameId(oneLine), index: 0, text: "x" })?.source)
      .toContain(String.raw`\begin{frame}Public\note{x}\end{frame}`);
  });

  it("replaces a note's text, keeping its specification, and removes a note with its line", () => {
    const source = deck(String.raw`\begin{frame}
  Text
  \note<2>{Old}
\end{frame}
`);
    const id = frameId(source);
    const set = requireValue(editBeamerFrameNote(source, { kind: "set", frameId: id, index: 0, text: "New\n\nSecond paragraph" }));
    expect(set.source).toContain("\\note<2>{New\n\nSecond paragraph}");
    expect(set.source.slice(0, set.patch.oldSpan.from) + set.patch.replacement + source.slice(set.patch.oldSpan.to)).toBe(set.source);
    expect(editBeamerFrameNote(set.source, { kind: "remove", frameId: id, index: 0 })?.source).toBe(deck(String.raw`\begin{frame}
  Text
\end{frame}
`));
  });

  it("refuses text that would change where the note or frame ends", () => {
    const source = deck(String.raw`\begin{frame}\note{Old}\end{frame}
`);
    const id = frameId(source);
    for (const text of ["a}b{c", "{open", "50% done", "ends \\", "\\end{frame}"]) {
      expect(editBeamerFrameNote(source, { kind: "set", frameId: id, index: 0, text })).toBeNull();
    }
    for (const text of ["\\{ \\} \\% \\\\", "50% done\n", "{\\bf bold} $x^{2}$"]) {
      expect(editBeamerFrameNote(source, { kind: "set", frameId: id, index: 0, text })?.source).toContain(`\\note{${text}}`);
    }
    expect(checkBeamerNoteBody("a % b\n")).toEqual({ problem: null, comment: true });
    expect(checkBeamerNoteBody("a % b")).toEqual({ problem: "open-comment", comment: true });
    expect(checkBeamerNoteBody("a \\% b")).toEqual({ problem: null, comment: false });
  });
});

function requireValue<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected a value");
  return value;
}

import { describe, it, expect } from "vitest";
import { copyBeamerSlides, editBeamerSlides, scanBeamerDocument, type BeamerSlideEdit } from "../packages/core/src/beamer/index.js";
import { applySourcePatches } from "../packages/core/src/edit/source-patches.js";
const frame = (title: string, body = title, options = "") => `\\begin{frame}${options}{${title}}\n${body}\n\\end{frame}\n`;
const deck = (body: string) => `\\documentclass{beamer}\n\\begin{document}\n${body}\\end{document}\n`;
function edit(source: string, action: BeamerSlideEdit) {
  const result = editBeamerSlides(source, action);
  expect(result).not.toBeNull();
  expect(applySourcePatches(source, result!.patches)).toMatchObject({ kind: "success", source: result!.source });
  return result!;
}
const titles = (source: string) => scanBeamerDocument(source).frames.map(frame => frame.title?.value);

describe("Beamer slide source operations", () => {
  it("moves an ordered multiselection with attached comments, leaving inter-frame commands in place", () => {
    const a = `% A note\n${frame("A")}`, b = frame("B"), c = `% C note\n${frame("C")}`, d = frame("D");
    const source = deck(a + "\\def\\unrelated{keep}\n" + b + c + d);
    const result = edit(source, { kind: "move", frameIds: ["frame:2", "frame:0"], destination: { kind: "after", frameId: "frame:3" } });
    expect(result.source).toBe(deck("\\def\\unrelated{keep}\n" + b + d + a + c));
    expect(result.selectedFrameIds).toEqual(["frame:2", "frame:3"]);
    expect(result.frameIds).toEqual({ "frame:0": "frame:2", "frame:1": "frame:0", "frame:2": "frame:3", "frame:3": "frame:1" });
  });
  it("moves backward and treats dropping back in place as a no-op", () => {
    const source = deck(frame("A") + frame("B") + frame("C"));
    const result = edit(source, { kind: "move", frameIds: ["frame:2"], destination: { kind: "before", frameId: "frame:0" } });
    expect(titles(result.source)).toEqual(["C", "A", "B"]);
    expect(editBeamerSlides(source, { kind: "move", frameIds: ["frame:1"], destination: { kind: "before", frameId: "frame:1" } })).toBeNull();
    expect(editBeamerSlides(source, { kind: "move", frameIds: ["frame:1"], destination: { kind: "after", frameId: "frame:0" } })).toBeNull();
  });
  it("distinguishes either side of section boundaries, including empty sections and trailing comments", () => {
    const source = deck("\\section{One}\n" + frame("A") + "\\section{Two} % keep\n" + frame("B") + "\\subsection{Empty}\n");
    const before = edit(source, { kind: "move", frameIds: ["frame:1"], destination: { kind: "section", sectionId: "section:1", edge: "before" } });
    expect(scanBeamerDocument(before.source).frames.map(frame => frame.sectionId)).toEqual(["section:0", "section:0"]);
    const after = edit(source, { kind: "move", frameIds: ["frame:0"], destination: { kind: "section", sectionId: "section:2" } });
    expect(after.source).toContain("\\subsection{Empty}\n" + frame("A"));
    expect(scanBeamerDocument(after.source).frames.at(-1)?.subsectionId).toBe("section:2");
  });
  it("duplicates several frames together, renaming local targets and internal cross-links", () => {
    const a = frame("A", String.raw`\label{detail}\hyperlink{later<2>}{Next}\ref{external}`, "[label={first}]");
    const b = frame("B", String.raw`\hypertarget{spot}{Here}\hyperref[detail]{Back}\pageref{first}`, "[label=later]");
    const source = deck(a + b + frame("Other", String.raw`\label{first-copy}\label{external}`));
    const result = edit(source, { kind: "duplicate", frameIds: ["frame:1", "frame:0"] });
    expect(titles(result.source)).toEqual(["A", "B", "A", "B", "Other"]);
    expect(result.source).toContain("[label={first-copy-2}]");
    expect(result.source).toContain(String.raw`\hyperlink{later-copy<2>}{Next}\ref{external}`);
    expect(result.source).toContain(String.raw`\hypertarget{spot-copy}{Here}\hyperref[detail-copy]{Back}\pageref{first-copy-2}`);
    expect(result.selectedFrameIds).toEqual(["frame:2", "frame:3"]);
    expect(result.frameIds["frame:2"]).toBe("frame:4");
  });
  it("does not rewrite labels in verbatim or ordinary text", () => {
    const body = String.raw`\label{real}
real \ref{real}
\begin{verbatim}
\label{fake}\ref{real}
\end{verbatim}`;
    const result = edit(deck(frame("A", body, "[fragile]")), { kind: "duplicate", frameIds: ["frame:0"] });
    expect(result.source).toContain(String.raw`real \ref{real-copy}`);
    expect(result.source.match(/\\label\{fake\}\\ref\{real\}/gu)).toHaveLength(2);
  });
  it("deletes only selected slides, keeps sections, and selects a surviving neighbor", () => {
    const source = deck("\\section{One}\n" + frame("A") + frame("B") + frame("C"));
    const result = edit(source, { kind: "delete", frameIds: ["frame:0", "frame:2"] });
    expect(result.source).toBe(deck("\\section{One}\n" + frame("B")));
    expect(result.selectedFrameIds).toEqual(["frame:0"]);
  });
  it("supports deleting the last slide and inserting into an empty deck", () => {
    const empty = edit(deck(frame("A")), { kind: "delete", frameIds: ["frame:0"] });
    expect(empty.selectedFrameIds).toEqual([]);
    const result = edit(empty.source, { kind: "insert", destination: { kind: "end" } });
    expect(result.source).toBe(deck("\\begin{frame}\n\n\\end{frame}\n"));
    expect(result.selectedFrameIds).toEqual(["frame:0"]);
  });
  it("inserts after a selected frame without adding a title placeholder", () => {
    const source = deck(frame("A") + frame("B"));
    const result = edit(source, { kind: "insert", destination: { kind: "after", frameId: "frame:0" } });
    expect(titles(result.source)).toEqual(["A", undefined, "B"]);
    expect(result.frameIds).toEqual({ "frame:0": "frame:0", "frame:1": "frame:2" });
  });
  it("keeps inline surrounding source intact and preserves identical frame identities", () => {
    const source = deck("\\def\\x{1}" + frame("A").trim() + frame("A").trim());
    expect(editBeamerSlides(source, { kind: "move", frameIds: ["frame:0"], destination: { kind: "before", frameId: "frame:0" } })).toBeNull();
    const result = edit(source, { kind: "move", frameIds: ["frame:1"], destination: { kind: "before", frameId: "frame:0" } });
    expect(result.source).toContain("\\def\\x{1}");
    expect(result.frameIds).toEqual({ "frame:0": "frame:1", "frame:1": "frame:0" });
  });
  it("does not restructure incomplete frames or frames inside command arguments", () => {
    const incomplete = deck("\\begin{frame}Unfinished");
    expect(editBeamerSlides(incomplete, { kind: "delete", frameIds: ["frame:0"] })).toBeNull();
    const generated = deck(String.raw`\only<1>{\begin{frame}Owned\end{frame}}`);
    expect(editBeamerSlides(generated, { kind: "delete", frameIds: ["frame:0"] })).toBeNull();
  });
  it("keeps frames owned by environments in place and rejects insertion into them", () => {
    const source = deck("\\begin{onlyenv}<1>\n" + frame("Owned") + "\\end{onlyenv}\n" + frame("Free"));
    expect(editBeamerSlides(source, { kind: "delete", frameIds: ["frame:0"] })).toBeNull();
    expect(editBeamerSlides(source, { kind: "insert", destination: { kind: "after", frameId: "frame:0" } })).toBeNull();
    expect(editBeamerSlides(source, { kind: "move", frameIds: ["frame:1"], destination: { kind: "before", frameId: "frame:0" } })).toBeNull();
  });
  it("renames copied bibliography entries and their citations without redirecting outside links", () => {
    const source = deck(frame("References", String.raw`\begin{thebibliography}{9}\bibitem{key}A title.\end{thebibliography}\cite{key}\hyperlink{beamerbibkey}{Read}`) + frame("Other", String.raw`\cite{key}`));
    const result = edit(source, { kind: "duplicate", frameIds: ["frame:0"] });
    expect(result.source).toContain(String.raw`\bibitem{key-copy}`);
    expect(result.source).toContain(String.raw`\cite{key-copy}\hyperlink{beamerbibkey-copy}{Read}`);
    expect(result.source).toContain(frame("Other", String.raw`\cite{key}`));
  });
  it("rejects stale targets and computed label names", () => {
    const source = deck(frame("A", String.raw`\label{\prefix:thing}`));
    expect(editBeamerSlides(source, { kind: "duplicate", frameIds: ["frame:0"] })).toBeNull();
    expect(editBeamerSlides(source, { kind: "move", frameIds: ["frame:8"], destination: { kind: "end" } })).toBeNull();
  });
});


describe("slide clipboard source operations", () => {
  it("copies a noncontiguous selection in source order with comments", () => {
    const source = deck("% A note\n" + frame("A") + frame("B") + frame("C"));
    expect(copyBeamerSlides(source, ["frame:2", "frame:0"])).toBe("% A note\n" + frame("A") + frame("C"));
    expect(copyBeamerSlides(source, ["frame:99"])).toBeNull();
  });
  it("pastes after a destination, preserves existing identities, and selects the new frames", () => {
    const source = deck(frame("A") + frame("B"));
    const copied = "% copied\n" + frame("C") + frame("D");
    const result = edit(source, { kind: "paste", source: copied, destination: { kind: "after", frameId: "frame:0" } });
    expect(result.source).toBe(deck(frame("A") + copied + frame("B")));
    expect(result.frameIds).toEqual({ "frame:0": "frame:0", "frame:1": "frame:3" });
    expect(result.selectedFrameIds).toEqual(["frame:1", "frame:2"]);
  });
  it("renames colliding labels and internal references together while retaining free labels", () => {
    const source = deck(frame("A", String.raw`\label{taken}`));
    const payload = frame("B", String.raw`\label{free}`, "[label=taken]") + frame("C", String.raw`\hyperlink{taken}{Back}\ref{free}`);
    const result = edit(source, { kind: "paste", source: payload, destination: { kind: "end" } });
    expect(result.source).toContain("[label=taken-copy]");
    expect(result.source).toContain(String.raw`\hyperlink{taken-copy}{Back}\ref{free}`);
    expect(result.source).toContain(String.raw`\label{free}`);
    const repeated = edit(result.source, { kind: "paste", source: payload, destination: { kind: "end" } });
    expect(repeated.source).toContain("[label=taken-copy-2]");
    expect(repeated.source).toContain(String.raw`\ref{free-copy}`);
  });
  it("pastes into an empty deck", () => {
    expect(edit(deck(""), { kind: "paste", source: frame("A"), destination: { kind: "end" } }).selectedFrameIds).toEqual(["frame:0"]);
  });
  it.each(["Not a slide", "\\begin{frame}Incomplete", deck(frame("A")), "\\def\\x{1}\n" + frame("A"), "{" + frame("A") + "}"])("rejects non-frame or incomplete clipboard text: %s", payload => {
    expect(editBeamerSlides(deck(frame("A")), { kind: "paste", source: payload, destination: { kind: "end" } })).toBeNull();
  });
});

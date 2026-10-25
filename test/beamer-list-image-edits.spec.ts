import { describe, expect, it } from "vitest";
import { applyDeckEditAction, buildBeamerObjectIndex, buildDeckObjectInspector, prepareBeamerDocument, type DeckEditAction, type BeamerObjectNode } from "../packages/core/src/beamer/index.js";
import { applySourcePatches } from "../packages/core/src/edit/source-patches.js";
import { enumerateTemplateText } from "../packages/core/src/text/tex/enumerate-template.js";
import { buildNativeBeamerPageTrace } from "../scripts/lib/beamer-frame-compare.mjs";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/index.js";

const deck = (body: string) => String.raw`\documentclass{beamer}\begin{document}\begin{frame}${body}\end{frame}\end{document}`;
async function target(source: string, kind: BeamerObjectNode["kind"]) {
  const prepared = prepareBeamerDocument(source);
  const page = await prepared.renderFrame({ step: prepared.frameStepCount(0) });
  const node = buildBeamerObjectIndex({ items: page.layout.items, paragraphs: page.layout.paragraphs, source }).nodes.find(node => node.kind === kind);
  if (!node) throw new Error(`Missing ${kind}`);
  return { page, node };
}
async function edited(source: string, kind: BeamerObjectNode["kind"], action: (node: BeamerObjectNode) => DeckEditAction) {
  const { page, node } = await target(source, kind);
  const result = applyDeckEditAction(source, page.layout, action(node));
  if (result.kind !== "success") throw new Error(JSON.stringify(result));
  expect(applySourcePatches(source, result.patches)).toMatchObject({ kind: "success", source: result.newSource });
  const next = await target(result.newSource, kind);
  expect(applyDeckEditAction(result.newSource, next.page.layout, action(next.node))).toMatchObject({ kind: "success", newSource: result.newSource });
  return result.newSource;
}
const reveal = (spec: string | null) => (node: BeamerObjectNode): DeckEditAction => ({ kind: "deckSetListDefaultOverlay", frameId: "frame:0", objectId: node.id, spec });
const labels = (template: string | null) => (node: BeamerObjectNode): DeckEditAction => ({ kind: "deckSetListLabelTemplate", frameId: "frame:0", objectId: node.id, template });
const replace = (path: string) => (node: BeamerObjectNode): DeckEditAction => ({ kind: "deckReplaceGraphics", frameId: "frame:0", objectId: node.id, path });

describe("list defaults and label edits", () => {
  it.each(["[<+->][(a)]", "[(a)][<+->]"])("reads either order and writes native Beamer order: %s", async head => {
    const source = deck(String.raw`\begin{enumerate}${head}\item<3->[Custom] Alpha\item Beta\end{enumerate}`);
    const { node } = await target(source, "list");
    const fields = buildDeckObjectInspector(source, node).fields;
    expect(fields.find(field => field.id === "reveal")).toMatchObject({ value: "+-", write: { kind: "setListDefaultOverlay" } });
    expect(fields.find(field => field.id === "template")).toMatchObject({ value: "(a)", write: { kind: "setListLabelTemplate" } });
    const next = await edited(source, "list", reveal("+-| alert@+"));
    expect(next).toContain(String.raw`\begin{enumerate}[<+-| alert@+>][(a)]`);
    expect(next).toContain(String.raw`\item<3->[Custom] Alpha\item Beta`);
    const labeled = await edited(next, "list", labels("I."));
    expect(labeled).toContain(String.raw`[<+-| alert@+>][I.]`);
    expect(await edited(labeled, "list", reveal(null))).toContain(String.raw`\begin{enumerate}[I.]`);
  });

  it.each(["\n", "\r\n"])("retains header comments and item-specific overlays (%j)", async newline => {
    const source = deck(String.raw`\begin{enumerate}% list note
[<+->]% reveal note
[(a)]\item[Custom]<3-> Alpha\item Beta\end{enumerate}`).replaceAll("\n", newline);
    const next = await edited(source, "list", labels("{Step }1."));
    expect(next).toContain("% list note");
    expect(next).toContain("% reveal note");
    expect(next).toContain(String.raw`\item[Custom]<3-> Alpha\item Beta`);
    const reset = await edited(next, "list", labels(null));
    expect(reset).not.toContain("{Step }1.");
    expect(reset).toContain("% reveal note");
  });

  it("distinguishes inherited defaults from explicit all-at-once reveal", async () => {
    const source = deck(String.raw`\begin{itemize}[<+->]\item Alpha\begin{itemize}\item Nested\end{itemize}\end{itemize}`);
    const next = await edited(source, "list", reveal("1-"));
    expect(next).toContain("[<1->]");
    expect(prepareBeamerDocument(next).frameStepCount(0)).toBe(1);
    const reset = await edited(next, "list", reveal(null));
    expect(reset).not.toContain("[<");
  });

  it("drops enumerate-only labels when renaming to itemize, retaining reveal and comments", async () => {
    const source = deck(String.raw`\begin{enumerate}[(a)% label note
][<+->]\item<2-> Alpha\end{enumerate}`);
    const next = await edited(source, "list", node => ({ kind: "deckRenameEnvironment", frameId: "frame:0", objectId: node.id, name: "itemize" }));
    expect(next).toContain(String.raw`\begin{itemize}[<+->]`);
    expect(next).toContain("% label note");
    expect(next).not.toContain("[(a)");
    expect(next).toContain(String.raw`\item<2-> Alpha\end{itemize}`);
  });

  it.each(["[<+->][<2->]", "[(a)][(i)]", "[<+->][(a)][extra]"])("refuses ambiguous repeated arguments: %s", async head => {
    const source = deck(String.raw`\begin{enumerate}${head}\item Alpha\end{enumerate}`);
    const { page, node } = await target(source, "list");
    expect(applyDeckEditAction(source, page.layout, reveal("*")(node)).kind).toBe("unsupported");
    expect(buildDeckObjectInspector(source, node).fields.find(field => field.id === "reveal")).toMatchObject({ write: null, readOnly: { reason: expect.any(String) } });
  });

  it.each([String.raw`\arabic{enumi}`, "a]bad", "1%bad", "{a", "1\n"])("refuses unsupported templates: %j", async template => {
    const source = deck(String.raw`\begin{enumerate}\item Alpha\end{enumerate}`);
    const { page, node } = await target(source, "list");
    expect(applyDeckEditAction(source, page.layout, labels(template)(node)).kind).toBe("unsupported");
  });

  it.each([["(a)", "(b)"], ["A.", "B."], ["i.", "ii."], ["I.", "II."], ["{Step }1.", "Step 2."], ["{[}1{]}", "[2]"]])("formats native mini templates %s", (template, expected) => {
    expect(enumerateTemplateText(template, 2)).toBe(expected);
  });

  it("retains TeX's repeated thousands in Roman counters", () => {
    expect(enumerateTemplateText("I.", 4000)).toBe("MMMM.");
  });

  it("renders the edited template as label glyphs and preserves a custom item label", async () => {
    const source = deck(String.raw`\begin{enumerate}\item Alpha\item[Custom] Beta\item Gamma\end{enumerate}`);
    const next = await edited(source, "list", labels("(a)"));
    const { page } = await target(next, "list");
    const trace = buildNativeBeamerPageTrace(page, computerModernTexMetricProvider);
    const labelTexts = trace.lines.map(line => line.glyphs.map(glyph => String.fromCodePoint(glyph.code)).join(""));
    expect(labelTexts).toContain("(a)Alpha");
    expect(labelTexts).toContain("CustomBeta");
    expect(labelTexts).toContain("(b)Gamma");
    expect(page.diagnostics).toEqual([]);
  });

  it("edits an item's overlay after its optional label without adding a second overlay", async () => {
    const source = deck(String.raw`\begin{itemize}\item[Custom]<2-> Alpha\end{itemize}`);
    const next = await edited(source, "item", node => ({ kind: "deckSetOverlaySpec", frameId: "frame:0", objectId: node.id, spec: "3-" }));
    expect(next).toContain(String.raw`\item[Custom]<3-> Alpha`);
    expect(buildDeckObjectInspector(next, (await target(next, "item")).node).fields[0]).toMatchObject({ value: "3-" });
  });
});

describe("image replacement edits", () => {
  it("replays list defaults, mini templates and image replacements across fresh layouts", async () => {
    let source = deck(String.raw`\begin{enumerate}[(a)]\item Alpha\item Beta\end{enumerate}\includegraphics[width=2cm,page=3]{old.pdf}`);
    for (let index = 0; index < 18; index++) {
      source = await edited(source, "list", labels(index % 3 === 0 ? null : index % 2 === 0 ? "(i)" : "A."));
      source = await edited(source, "list", reveal(index % 2 === 0 ? "1-" : "+-"));
      source = await edited(source, "graphics", replace(index % 2 === 0 ? "new.png" : "new.pdf"));
      expect((await target(source, "list")).page.diagnostics).toEqual([]);
    }
  });
  it.each(["replacement.png", "replacement.pdf"])("preserves sizing/crop/options, resets PDF page and updates fields: %s", async path => {
    const source = deck(String.raw`\includegraphics[width=.5\textwidth,height=2cm,keepaspectratio,trim=1 2 3 4,clip,page=3,page=4,angle=15]{old.pdf}`);
    const next = await edited(source, "graphics", replace(path));
    expect(next).toContain(String.raw`width=.5\textwidth,height=2cm,keepaspectratio,trim=1 2 3 4,clip,angle=15`);
    expect(next).not.toContain("page=");
    expect(next).toContain(`{${path}}`);
    const fields = buildDeckObjectInspector(next, (await target(next, "graphics")).node).fields;
    expect(fields.some(field => field.id === "page")).toBe(path.endsWith(".pdf"));
  });

  it("retains comments in options and the old filename", async () => {
    const source = deck(String.raw`\includegraphics[page=2,% page note
width=2cm]{old% filename note
.pdf}`);
    const next = await edited(source, "graphics", replace("new.svg"));
    expect(next).toContain("% page note");
    expect(next).toContain("% filename note");
    expect(next).toContain("{new.svg}");
  });

  it.each(["bad%name.png", "bad}name.png", String.raw`C:\bad.png`, "image.gif", "", "image\n.png"])("rejects an unsafe or unsupported path: %j", async path => {
    const source = deck(String.raw`\includegraphics{old.png}`);
    const { page, node } = await target(source, "graphics");
    expect(applyDeckEditAction(source, page.layout, replace(path)(node)).kind).toBe("unsupported");
  });
});

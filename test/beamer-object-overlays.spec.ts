import { describe, expect, it } from "vitest";
import { beamerObjectOverlayTarget, buildBeamerBuildModel, buildBeamerObjectIndex, prepareBeamerDocument, type BeamerObjectNode } from "../packages/core/src/beamer/index.js";
import type { SourcePatch } from "../packages/core/src/edit/types.js";

const document = (body: string) => `\\documentclass{beamer}\n\\begin{document}\n\\begin{frame}{Overlays}\n${body}\n\\end{frame}\n\\end{document}`;
function apply(source: string, patches: readonly SourcePatch[]) {
  return [...patches].reverse().reduce((text, patch) => text.slice(0, patch.oldSpan.from) + patch.replacement + text.slice(patch.oldSpan.to), source);
}
async function target(source: string, kind: BeamerObjectNode["kind"], step = 3) {
  const model = buildBeamerBuildModel(source, "frame:0")!;
  const page = await prepareBeamerDocument(source).renderFrame({ frameIndex: 0, step: Math.min(step, model.stepCount) });
  const index = buildBeamerObjectIndex({ ...page.layout, source });
  const node = index.nodes.find((candidate) => candidate.kind === kind);
  if (!node) throw new Error(`Missing ${kind}`);
  return { ...beamerObjectOverlayTarget(model, node), node, page, model };
}

describe("canvas object overlays", () => {
  it.each([
    ["block", String.raw`\begin{block}{Facts}Content\end{block}`, String.raw`\begin{block}<3->{Facts}Content\end{block}`],
    ["item", String.raw`\begin{itemize}\item[Label] Alpha\item Beta\end{itemize}`, String.raw`\begin{itemize}\item<3->[Label] Alpha\item Beta\end{itemize}`],
    ["graphics", String.raw`\includegraphics[width=2cm]{demo.png}`, String.raw`\uncover<3->{\includegraphics[width=2cm]{demo.png}}`],
    ["tikzpicture", String.raw`\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}`, String.raw`\uncover<3->{\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}}`],
  ] as const)("adds a source-backed reveal to %s", async (kind, body, expected) => {
    const source = document(body);
    const first = await target(source, kind);
    expect(first.canSet).toBe(true);
    const patch = first.setSpec("3-")!;
    const next = apply(source, [patch]);
    expect(next).toBe(document(expected));
    const revealed = await target(next, kind);
    expect(revealed.row).not.toBeNull();
    expect(revealed.canSet).toBe(true);
    expect(apply(next, revealed.removePatches)).toBe(source);
    expect(revealed.node.bounds.width).toBeCloseTo(first.node.bounds.width, 4);
    expect(revealed.node.bounds.height).toBeCloseTo(first.node.bounds.height, 4);
    const hidden = await prepareBeamerDocument(next).renderFrame({ frameIndex: 0, step: 1 });
    expect(hidden.svg).not.toBe(revealed.page.svg);
  });

  it("updates and removes a direct item rule without changing peers or comments", async () => {
    const source = document("\\begin{itemize}\n\\item<2-> % keep\nAlpha\n\\item<3> Beta\n\\end{itemize}");
    const value = await target(source, "item");
    expect(apply(source, [value.setSpec("-3")!])).toBe(source.replace("<2->", "<-3>"));
    expect(apply(source, value.removePatches)).toBe(source.replace("<2->", ""));
  });

  it.each(["+-", "2-"])("routes an inherited list default %s to its owner", async (spec) => {
    const source = document(`\\begin{itemize}[<${spec}>]\\item Alpha\\item Beta\\end{itemize}`);
    const value = await target(source, "item");
    expect(value.canSet).toBe(false);
    expect(value.row?.provenance).toBe("list-default");
    expect(value.setSpec("3-")).toBeNull();
    expect(value.removePatches).toEqual([]);
  });

  it("routes a shared wrapper to its rule without changing its neighbors", async () => {
    const source = document(String.raw`\uncover<2->{\includegraphics{a.png}\includegraphics{b.png}}`);
    const value = await target(source, "graphics");
    expect(value.row?.spec?.source.value).toBe("2-");
    expect(value.canSet).toBe(false);
    expect(value.removePatches).toEqual([]);
  });

  it.each([String.raw`\uncover<+->{\includegraphics{a.png}}`, String.raw`\alt<3>{\includegraphics{a.png}}{Other}`])("keeps a complex owner intact: %s", async (body) => {
    const value = await target(document(body), "graphics");
    expect(value.canSet).toBe(false);
    expect(value.row).not.toBeNull();
    expect(value.removePatches).toEqual([]);
  });

  it("preserves comments when removing a wrapper", async () => {
    const source = document("\\uncover % wrapper\n<2-> % spec\n{ % content\n\\includegraphics{a.png}% tail\n}");
    const value = await target(source, "graphics");
    expect(value.canSet).toBe(true);
    expect(apply(source, value.removePatches)).toBe(document(" % wrapper\n % spec\n % content\n\\includegraphics{a.png}% tail\n"));
  });

  it("removes an overlay environment while retaining its contents", async () => {
    const source = document(String.raw`\begin{uncoverenv}<2->\includegraphics{a.png}\end{uncoverenv}`);
    const value = await target(source, "graphics");
    expect(apply(source, value.removePatches)).toBe(document(String.raw`\includegraphics{a.png}`));
  });

  it("does not wrap a figure's unsupported native overlay syntax", async () => {
    const source = document(String.raw`\includegraphics<2->[width=2cm]{a.png}`);
    const from = source.indexOf("\\includegraphics");
    const model = buildBeamerBuildModel(source, "frame:0")!;
    const node = { id: "figure", kind: "graphics", sourceSpan: { from, to: source.indexOf("\n\\end{frame}") }, bounds: { x: 0, y: 0, width: 1, height: 1 }, parentId: null, childIds: [] } as const;
    const value = beamerObjectOverlayTarget(model, node);
    expect(value.canSet).toBe(false);
    expect(value.row?.kind).toBe("unsupported");
    expect(value.removePatches).toEqual([]);
  });

  it("does not remove a numeric override if that would advance a shared relative counter", async () => {
    const source = document(String.raw`\begin{itemize}[<+->]\item<1-> Alpha\item Beta\end{itemize}`);
    const value = await target(source, "item");
    expect(value.canSet).toBe(true);
    expect(value.removePatches).toEqual([]);
  });
});

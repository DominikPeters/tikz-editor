import { describe, expect, it } from "vitest";

import { prepareBeamerDocument } from "../packages/core/src/beamer/index.js";
import { renderTikzToSvgAsync } from "../packages/core/src/render/index.js";
import { loadAllTexGlyphOutlines } from "../packages/core/src/text/tex/fonts/glyph-outlines.js";
import { texGlyphSvgDefs, texGlyphSvgDefinitions } from "../packages/core/src/text/tex/fonts/glyph-svg.js";

const ids = (svg: string) => [...svg.matchAll(/(?<![\w-])id="([^"]*)"/gu)].map(match => match[1] ?? "");
const references = (svg: string) => [...svg.matchAll(/\bhref="#([^"]*)"/gu)].map(match => match[1] ?? "");
const definedPaths = (svg: string) => [...svg.matchAll(/<path id="(tg-[^"]*)" d="([^"]*)"/gu)];

/** Every reference resolves, and no id is defined twice (as in one HTML document). */
function expectStandalone(svg: string): void {
  const defined = ids(svg);
  expect(new Set(defined).size).toBe(defined.length);
  for (const reference of references(svg)) expect(defined, reference).toContain(reference);
}

describe("glyph outlines are defined once and placed by reference", () => {
  it("defines a repeated glyph once in a picture, at any size", async () => {
    await loadAllTexGlyphOutlines();
    const svg = (await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
\node {AAAA AAA AAAA AAA};
\node[font=\small] at (0,-1) {AAA};
\node[font=\Large] at (0,-2) {A};
\end{tikzpicture}`)).svg.svg;
    const uses = [...svg.matchAll(/<use [^>]*data-tex-glyph="65"[^>]*>/gu)];
    expect(uses.length).toBeGreaterThanOrEqual(11);
    expect(uses.every(use => !/ d="/u.test(use[0]))).toBe(true);
    const defs = definedPaths(svg);
    expect(defs.length).toBeGreaterThan(0);
    // One definition per distinct outline, however often it is used.
    expect(new Set(defs.map(match => match[2])).size).toBe(defs.length);
    const usedByA = new Set(uses.map(use => /href="#([^"]*)"/u.exec(use[0])?.[1]));
    // One outline per optical size: \normalsize lmroman10, \small lmroman9,
    // \Large lmroman12 (tulmr.fd).
    expect(usedByA.size).toBeLessThanOrEqual(3);
    expectStandalone(svg);
    // Far smaller than repeating the outline at each use.
    const outline = defs.find(match => match[1] === [...usedByA][0])?.[2] ?? "";
    expect(svg.length).toBeLessThan(uses.length * outline.length);
  });

  it("gives equal outlines equal ids, so separately rendered fragments agree", async () => {
    await loadAllTexGlyphOutlines();
    const first = (await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}\node {Hello};\end{tikzpicture}`)).svg.svg;
    const second = (await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}\node {Hello Hello};\end{tikzpicture}`)).svg.svg;
    const firstDefs = new Map(definedPaths(first).map(match => [match[1], match[2]]));
    for (const [id, d] of definedPaths(second).map(match => [match[1], match[2]] as const)) {
      if (firstDefs.has(id)) expect(firstDefs.get(id)).toBe(d);
    }
    expect([...firstDefs.keys()].every(id => definedPaths(second).some(match => match[1] === id))).toBe(true);
  });

  it("defines glyphs once in a frame, and keeps its embedded pictures' glyphs apart", async () => {
    await loadAllTexGlyphOutlines();
    const source = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Title}
Hello Hello Hello world
\begin{tikzpicture}\node {Hello $x^2$};\node at (0,-1) {Hello};\end{tikzpicture}
\begin{tikzpicture}\node {Hello $x^2$};\end{tikzpicture}
\end{frame}
\end{document}`;
    const prepared = prepareBeamerDocument(source);
    const { svg } = await prepared.renderFrame({ frameIndex: 0, step: 1 });
    expectStandalone(svg.svg);
    const defs = definedPaths(svg.svg);
    // At frame level, one definition per outline; embedded pictures add their own, namespaced.
    // Glyph definitions live apart from the other defs, once each.
    expect(svg.model.glyphDefs?.length).toBeGreaterThan(0);
    expect(new Set(svg.model.glyphDefs).size).toBe(svg.model.glyphDefs?.length);
    expect(svg.model.defs.some(def => def.startsWith('<path id="tg-'))).toBe(false);
    expect(svg.svg.match(/<use /gu)?.length ?? 0).toBeGreaterThan(defs.length);
    const embedded = svg.svg.match(/id="tikz-[^"]*-tg-/gu) ?? [];
    expect(embedded.length).toBeGreaterThan(0);
    // The model's parts refer to ids its defs define.
    const model = svg.model;
    const modelIds = new Set([...model.defs, ...(model.glyphDefs ?? [])].flatMap(def => ids(def)));
    for (const part of model.parts) for (const reference of references(part.markup)) {
      if (reference.startsWith("tg-")) expect(modelIds, reference).toContain(reference);
    }
  });

  it("defines the glyphs of standalone fragments", async () => {
    await loadAllTexGlyphOutlines();
    const svg = (await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}\node {Hi};\end{tikzpicture}`)).svg.svg;
    const body = svg.replace(/<defs>.*?<\/defs>/su, "");
    const defs = texGlyphSvgDefinitions(body);
    expect(defs.length).toBeGreaterThan(0);
    expect(texGlyphSvgDefs(body)).toBe(`<defs>${defs.join("")}</defs>`);
    expect(texGlyphSvgDefs("<g/>")).toBe("");
  });
});

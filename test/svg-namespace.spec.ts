import { describe, expect, it } from "vitest";
import { namespaceSvgModel } from "../packages/core/src/svg/namespace";
import { renderTikzToSvg } from "../packages/core/src/render/index";
import { renderBeamerFrame } from "../packages/core/src/beamer/index";
import { computeSnapshot } from "../packages/app/src/compute";

function ids(svg: string) { return [...svg.matchAll(/\sid=["']([^"']+)["']/gu)].map(match => match[1]); }

describe("embedded SVG definition namespaces", () => {
  it("rewrites owned definitions, URL fragments, uses and accessibility references", () => {
    const base = renderTikzToSvg(String.raw`\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}`).svg.model;
    const model = { ...base, defs: ['<linearGradient id="paint"/><clipPath id="clip"/><path id="glyph"/>'], parts: [
      { ...base.parts[0], markup: `<g aria-labelledby="label external"><title id='label'>Example</title><rect fill="url(#paint)" style="clip-path:url('#clip');color:#fff"/><use xlink:href="#glyph"/><use href='#external'/></g>` }
    ] };
    const scoped = namespaceSvgModel(model, "frame:0:overlay:0");
    const svg = scoped.defs.join("") + scoped.parts.map(part => part.markup).join("");
    const owned = ids(svg);
    expect(owned).toHaveLength(4);
    expect(owned.every(id => id.startsWith("tikz-frame_3a_0_3a_overlay_3a_0-"))).toBe(true);
    for (const id of owned.slice(0, 3)) expect(svg).toContain(`#${id}`);
    expect(svg).toContain(`aria-labelledby="${owned[3]} external"`);
    expect(svg).toContain("href='#external'");
    expect(svg).toContain("color:#fff");
    expect(scoped.defsFingerprint).toBe(scoped.defs.join(""));
    expect(scoped.parts[0].partId).toBe(model.parts[0].partId);
    expect(scoped.parts[0].fingerprint).toBe(scoped.parts[0].markup);
    expect(namespaceSvgModel(model, "frame:0:overlay:0")).toEqual(scoped);
    expect(ids(namespaceSvgModel(model, "frame_3a_0:overlay:0").defs.join(""))).not.toEqual(owned.slice(0, 3));
  });

  it("isolates clips, shading and patterns across ordinary and overlay pictures", async () => {
    const picture = (options: string, clip: string, color: string) => String.raw`\begin{tikzpicture}[${options}]
\clip ${clip};
\shade[left color=${color},right color=white] (0,0) rectangle (3,3);
\fill[pattern=north east lines] (0,0) rectangle (3,3);
\end{tikzpicture}`;
    const source = String.raw`\documentclass{beamer}\usepackage{tikz}\usetikzlibrary{patterns}\begin{document}\begin{frame}{Namespaces}` +
      picture("", "(0,0) rectangle (1,1)", "red") +
      picture("overlay,remember picture,shift={(current page.south west)}", "(2,2) rectangle (3,3)", "blue") +
      picture("overlay,remember picture,shift={(current page.south west)}", "(4,4) rectangle (5,5)", "green") +
      String.raw`\end{frame}\end{document}`;
    const core = await renderBeamerFrame(source);
    const app = await computeSnapshot({ id: "scoped-pictures", source, activeRootId: "frame:0", includeDrawingLayer: true });
    for (const svg of [core.svg.svg, app.snapshot.deck!.activeFrame!.svg]) {
      const defined = ids(svg);
      expect(defined.length).toBeGreaterThanOrEqual(9);
      expect(new Set(defined).size).toBe(defined.length);
      for (const reference of svg.matchAll(/url\(#([^)]*)\)/gu)) expect(defined).toContain(reference[1]);
      expect(defined.filter(id => id.endsWith("tikz-clip-1"))).toHaveLength(3);
    }
  });
});

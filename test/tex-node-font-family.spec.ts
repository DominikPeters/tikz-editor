import { beforeAll, describe, expect, it } from "vitest";
import { createTexNodeTextEngine } from "../packages/core/src/text/tex-node-text-engine.js";
import { renderTikzToSvgAsync } from "../packages/core/src/render/index.js";
import type { NodeTextEngine, NodeTextMeasureRequest } from "../packages/core/src/text/types.js";

let engine: NodeTextEngine;
beforeAll(async () => { engine = await createTexNodeTextEngine(); });
const request = (text: string, family: NodeTextMeasureRequest["fontFamily"] = "serif"): NodeTextMeasureRequest => ({
  text, textWidthPt: null, fontStyle: "normal", fontWeight: "normal", fontFamily: family, fontSizePt: 10
});
const faces = (body: string) => [...new Set([...body.matchAll(/data-tex-font="([^"]+)"/g)].map(match => match[1]))];
function measure(input: NodeTextMeasureRequest) {
  const metrics = engine.measure(input);
  expect(metrics).not.toBeNull();
  if (!metrics) throw new Error("Expected supported font measurement");
  const payload = engine.renderFromCache(metrics.cacheKey);
  expect(payload).not.toBeNull();
  if (!payload) throw new Error("Expected cached font rendering");
  return { metrics, body: payload.body };
}

describe("initial native node font family", () => {
  it.each([
    [8.49, "lmmono8-regular"], [8.5, "lmmono9-regular"],
    [9.49, "lmmono9-regular"], [9.5, "lmmono10-regular"],
    [10.99, "lmmono10-regular"], [11, "lmmono12-regular"],
  ] as const)("selects the NFSS typewriter optical size at %spt", (size, face) => {
    const rendered = measure({ ...request("URL", "monospace"), fontSizePt: size });
    expect(faces(rendered.body)).toEqual([face]);
  });
  it.each([
    ["serif", "rmfamily", "lmroman10-regular"],
    ["sans", "sffamily", "lmsans10-regular"],
    ["monospace", "ttfamily", "lmmono10-regular"]
  ] as const)("matches an inline %s declaration in face and dimensions", (family, declaration, face) => {
    const initial = measure(request("iii", family));
    const explicit = measure(request(`{\\${declaration} iii}`));
    expect(faces(initial.body)).toEqual([face]);
    expect(initial.metrics.width).toBeCloseTo(explicit.metrics.width, 9);
    expect(initial.metrics.height).toBeCloseTo(explicit.metrics.height, 9);
  });

  it("matches the local LuaLaTeX oracle widths and keeps family cache entries distinct", () => {
    const roman = measure(request("iii"));
    const mono = measure(request("iii", "monospace"));
    expect(roman.metrics.width).toBeCloseTo(8.34, 5);
    expect(mono.metrics.width).toBeCloseTo(15.75, 5);
    expect(mono.metrics.cacheKey).not.toBe(roman.metrics.cacheKey);
    expect(measure(request("iii")).body).toBe(roman.body);
    expect(measure(request("iii", "monospace")).body).toBe(mono.body);
  });

  it.each([
    ["normal", "normal", "", "lmmono10-regular"],
    ["bold", "normal", String.raw`\bfseries`, "lmmonolt10-bold"],
    ["normal", "italic", String.raw`\itshape`, "lmmono10-italic"],
    ["bold", "italic", String.raw`\bfseries\itshape`, "lmmonolt10-boldoblique"]
  ] as const)("preserves typewriter %s/%s styles", (weight, style, declarations, face) => {
    const initial = measure({ ...request("Wide iii", "monospace"), fontWeight: weight, fontStyle: style });
    const explicit = measure(request(String.raw`{\ttfamily` + declarations + " Wide iii}"));
    expect(faces(initial.body)).toEqual([face]);
    expect(initial.metrics.width).toBeCloseTo(explicit.metrics.width, 9);
    expect(initial.metrics.height).toBeCloseTo(explicit.metrics.height, 9);
  });

  it.each([
    ["rmfamily", "lmroman10-regular"], ["sffamily", "lmsans10-regular"],
    ["normalfont", "lmroman10-regular"]
  ] as const)("lets inline %s override the initial monospace family", (declaration, face) => {
    const overridden = measure(request(`{\\${declaration} iii}`, "monospace"));
    expect(faces(overridden.body)).toEqual([face]);
    const explicit = measure(request(`{\\${declaration} iii}`));
    expect(overridden.metrics.width).toBeCloseTo(explicit.metrics.width, 9);
  });

  it("restores initial monospace after a local inline override", () => {
    const mixed = measure(request(String.raw`i{\rmfamily i}i`, "monospace"));
    expect(faces(mixed.body)).toEqual(["lmmono10-regular", "lmroman10-regular"]);
    expect(mixed.metrics.width).toBeCloseTo(5.25 * 2 + 2.78, 5);
  });

  it("wraps fixed-width node text identically to explicit typewriter text", () => {
    const text = "iii iii iii iii iii";
    const initial = measure({ ...request(text, "monospace"), textWidthPt: 40 });
    const explicit = measure({ ...request(String.raw`{\ttfamily ` + text + "}"), textWidthPt: 40 });
    expect(faces(initial.body)).toEqual(["lmmono10-regular"]);
    expect(initial.metrics.width).toBeCloseTo(explicit.metrics.width, 9);
    expect(initial.metrics.height).toBeCloseTo(explicit.metrics.height, 9);
    expect(initial.body.match(/data-tex-linebox="true"/g)?.length).toBeGreaterThan(1);
    expect(initial.body.match(/data-tex-linebox="true"/g)?.length).toBe(explicit.body.match(/data-tex-linebox="true"/g)?.length);
  });

  it.each([8, 12] as const)("matches explicit typewriter optical faces at %spt", size => {
    const initial = measure({ ...request("iii", "monospace"), fontSizePt: size });
    const explicit = measure({ ...request(String.raw`{\ttfamily iii}`), fontSizePt: size });
    expect(faces(initial.body)).toEqual([size === 8 ? "lmmono8-regular" : "lmmono12-regular"]);
    expect(initial.metrics.width).toBeCloseTo(explicit.metrics.width, 9);
  });

  it.each([
    [String.raw`\ttfamily`, "iii", "lmmono10-regular"],
    [String.raw`\ttfamily\bfseries\itshape`, "iii", "lmmonolt10-boldoblique"],
    [String.raw`\ttfamily`, String.raw`{\rmfamily iii}`, "lmroman10-regular"]
  ])("honors node font %s with text %s through the public renderer", async (font, text, face) => {
    const source = String.raw`\begin{tikzpicture}\node[draw,font=` + font + "] {" + text + String.raw`};\end{tikzpicture}`;
    const result = await renderTikzToSvgAsync(source);
    expect(result.parse.diagnostics).toEqual([]);
    expect(result.svg.diagnostics).toEqual([]);
    expect([...result.semantic.diagnostics, ...result.renderDiagnostics]
      .filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
    const sceneText = result.semantic.scene.elements.find(element => element.kind === "Text");
    expect(sceneText?.kind).toBe("Text");
    if (sceneText?.kind !== "Text") throw new Error("Expected public text element");
    expect(sceneText.style.fontFamily).toBe("monospace");
    expect(sceneText.textRenderInfo?.mode).toBe("tex");
    expect(faces(result.svg.svg)).toEqual([face]);
  });
});

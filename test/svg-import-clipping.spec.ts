import { beforeAll, describe, expect, it } from "vitest";
import { installNodeSvgEnvironment } from "svg2tikz/node-env";
import { convertSvgToScopeSnippet, resolveOpenedFileForDocument } from "../packages/app/src/ui/svg-import.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { PT_PER_CM } from "../packages/core/src/coords/source.js";

beforeAll(() => installNodeSvgEnvironment());
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;
const rectangle = '<rect width="100" height="100" fill="red"/>';
const definition = '<defs><clipPath id="clip"><rect width="20" height="100"/></clipPath></defs>';

async function imported(source: string) {
  const result = await convertSvgToScopeSnippet(source);
  if (result.kind !== "success") throw new Error(result.message);
  const rendered = renderTikzToSvg(result.tikzSource);
  expect([...rendered.parse.diagnostics, ...rendered.semantic.diagnostics].filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
  expect(rendered.semantic.diagnostics.filter(diagnostic => diagnostic.code?.startsWith("unsupported-option-key:"))).toEqual([]);
  expect(result.tikzSource).not.toContain("TIKZSVGCLIP");
  expect(rendered.semantic.scene.elements.some(element => element.kind === "Text")).toBe(false);
  const painted = rendered.semantic.scene.elements.filter(element => element.kind === "Path" &&
    ((element.style.stroke && element.style.stroke !== "none") || (element.style.fill && element.style.fill !== "none")));
  return { ...result, rendered, painted };
}

function clipPoints(result: Awaited<ReturnType<typeof imported>>, clipIndex = 0) {
  const clip = result.painted[0].clipChain?.[clipIndex];
  if (!clip) throw new Error("Missing painted clip chain");
  const points = clip.commands.flatMap(command => command.kind === "M" || command.kind === "L" ? [command.to] : []);
  return points.filter((point, index) => !points.slice(0, index).some(previous => previous.x === point.x && previous.y === point.y));
}

function expectSvgPoints(actual: Array<{ x: number; y: number }>, expected: Array<[number, number]>) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((point, i) => {
    expect(point.x).toBeCloseTo(expected[i][0] * PT_PER_CM / 10, 4);
    expect(point.y).toBeCloseTo((100 - expected[i][1]) * PT_PER_CM / 10, 4);
  });
}

describe("SVG import clipping", () => {
  it("retains the reported rectangular clip and isolates following siblings", async () => {
    const result = await imported(svg(`${definition}<g clip-path="url(#clip)">${rectangle}</g><rect x="40" y="40" width="10" height="10" fill="blue"/>`));
    expect(result.tikzSource).toContain("\\clip");
    expect(result.painted).toHaveLength(2);
    expectSvgPoints(clipPoints(result), [[0, 0], [20, 0], [20, 100], [0, 100]]);
    expect(result.painted[1].clipChain).toHaveLength(0);
    expect(result.rendered.svg.svg).toContain("<clipPath");
    expect(result.rendered.svg.svg).toContain('clip-path="url(#tikz-clip-1)"');
  });

  it("uses the referencing element frame and both clip-definition transforms exactly once", async () => {
    const result = await imported(svg('<defs><clipPath id="clip" transform="translate(3 4)"><rect x="1" y="2" width="10" height="12" transform="scale(2)"/></clipPath></defs><g transform="matrix(1 .5 .2 1 7 9)"><rect width="100" height="100" transform="translate(10 5)" fill="red" clip-path="url(#clip)"/></g>'));
    const expected: Array<[number, number]> = [[5, 8], [25, 8], [25, 32], [5, 32]].map(([x, y]) => {
      const tx = x + 10, ty = y + 5;
      return [tx + .2 * ty + 7, .5 * tx + ty + 9];
    });
    expectSvgPoints(clipPoints(result), expected);
  });

  it("keeps a group clip outside each child's own transform", async () => {
    const result = await imported(svg(`${definition}<g clip-path="url(#clip)" transform="translate(10 20)"><rect width="100" height="100" fill="red" transform="scale(2)"/></g>`));
    expectSvgPoints(clipPoints(result), [[10, 20], [30, 20], [30, 120], [10, 120]]);
  });

  it("preserves a clipped child's own skew through the matrix conversion route", async () => {
    const result = await imported(svg(`${definition}<g clip-path="url(#clip)"><rect width="100" height="100" fill="red" transform="skewX(30)"/></g>`));
    const shape = result.painted[0];
    if (shape.kind !== "Path") throw new Error("Missing imported path");
    expect(shape.commands.some(command => command.kind === "L" && Math.abs(command.to.x - (100 + 100 * Math.tan(Math.PI / 6)) * PT_PER_CM / 10) < .00001)).toBe(true);
    expectSvgPoints(clipPoints(result), [[0, 0], [20, 0], [20, 100], [0, 100]]);
  });

  it("conjugates clips and ordered transforms through a nonzero viewBox origin", async () => {
    const source = svg(`${definition}<g transform="translate(15 10) rotate(90) skewX(30)">${rectangle.replace('/>', ' clip-path="url(#clip)"/>')}</g>`)
      .replace('viewBox="0 0 100 100"', 'viewBox="10 -20 100 100"');
    const result = await imported(source);
    const expected: Array<[number, number]> = [[0, 0], [20, 0], [20, 100], [0, 100]].map(([x, y]) => {
      const skewedX = x + Math.tan(Math.PI / 6) * y;
      return [15 - y - 10, skewedX + 10 + 20];
    });
    expectSvgPoints(clipPoints(result), expected);
  });

  it("retains nested group and element clip intersections", async () => {
    const result = await imported(svg(`${definition}<defs><clipPath id="inner"><path d="M0 0H50V50H0Z"/></clipPath></defs><g clip-path="url(#clip)"><rect width="100" height="100" fill="red" transform="translate(10 20)" style="clip-path:url('#inner')"/></g>`));
    expect(result.painted[0].clipChain).toHaveLength(2);
    expectSvgPoints(clipPoints(result, 0), [[0, 0], [20, 0], [20, 100], [0, 100]]);
    expectSvgPoints(clipPoints(result, 1), [[10, 20], [60, 20], [60, 70], [10, 70]]);
    expect(result.rendered.svg.svg).toContain('clip-path="url(#tikz-clip-2)"');
  });

  it.each(["nonzero", "evenodd"])("preserves the clip definition's %s rule with compound curves", async rule => {
    const result = await imported(svg(`<defs><clipPath id="clip" clip-rule="${rule}"><path d="M0 0H100V100H0Z M20 20Q50 0 80 20T80 80C60 90 40 90 20 80Z"/></clipPath></defs><rect width="100" height="100" fill="red" clip-path="url(#clip)" clip-rule="${rule === "evenodd" ? "nonzero" : "evenodd"}"/>`));
    expect(result.painted[0].clipChain?.[0].fillRule).toBe(rule);
    expect(result.painted[0].clipChain?.[0].commands.some(command => command.kind === "C")).toBe(true);
  });

  it("preserves root clipping and empty clipping geometry", async () => {
    const root = svg(`${definition}${rectangle}`).replace('viewBox="0 0 100 100"', 'viewBox="0 0 100 100" clip-path="url(#clip)"');
    expect((await imported(root)).painted[0].clipChain).toHaveLength(1);
    const empty = await imported(svg('<defs><clipPath id="clip"/></defs><rect width="100" height="100" fill="red" clip-path="url(#clip)"/>'));
    expect(empty.painted[0].clipChain).toHaveLength(1);
  });

  it("uses inline none as an override and ignores unreferenced clip definitions", async () => {
    const result = await imported(svg('<defs><clipPath id="unsupported" clipPathUnits="objectBoundingBox"><circle r=".5"/></clipPath></defs><rect width="100" height="100" fill="red" clip-path="url(#unsupported)" style="clip-path:none"/>'));
    expect(result.painted[0].clipChain).toHaveLength(0);
  });

  it("does not leak scopes or paint from hidden clipped groups", async () => {
    const result = await imported(svg(`${definition}<g display="none" clip-path="url(#clip)">${rectangle}</g><rect width="10" height="10" fill="blue"/>`));
    expect(result.painted).toHaveLength(1);
    expect(result.painted[0].clipChain).toHaveLength(0);
  });

  it.each([
    ["objectBoundingBox", '<clipPath id="clip" clipPathUnits="objectBoundingBox"><rect width="1" height="1"/></clipPath>'],
    ["multiple shapes", '<clipPath id="clip"><rect width="20" height="20"/><rect x="40" width="20" height="20"/></clipPath>'],
    ["nested clip", '<clipPath id="clip" clip-path="url(#other)"><rect width="20" height="20"/></clipPath>'],
    ["rounded clip", '<clipPath id="clip"><rect width="20" height="20" rx="5"/></clipPath>'],
    ["arc clip", '<clipPath id="clip"><path d="M0 0A20 20 0 0 1 40 0Z"/></clipPath>'],
    ["malformed finite path", '<clipPath id="clip"><path d="M0 0L20"/></clipPath>'],
    ["unknown path text", '<clipPath id="clip"><path d="M0 0L20 20#Z"/></clipPath>']
  ])("rejects unsupported %s before open or paste returns replacement source", async (_name, clip) => {
    const source = svg(`<defs>${clip}</defs><rect width="100" height="100" fill="red" clip-path="url(#clip)"/>`);
    for (const result of [await convertSvgToScopeSnippet(source), await resolveOpenedFileForDocument({ source, fileRef: { kind: "virtual", name: "clip.svg" } })]) {
      expect(result.kind).toBe("failure");
      if (result.kind === "failure") expect(result.message).toMatch(/Unsupported SVG clipping:.*not imported/u);
      expect(result).not.toHaveProperty("source"); expect(result).not.toHaveProperty("snippet");
    }
  });

  it.each([
    '<style>.clipped { clip-path:url(#clip); }</style><rect class="clipped" width="100" height="100"/>',
    '<style>.shape { transform:translate(10px); }</style><g clip-path="url(#clip)"><rect class="shape" width="100" height="100"/></g>',
    '<use href="#shape" x="10" transform="rotate(30)" clip-path="url(#clip)"/>',
    '<defs><rect id="shape" width="100" height="100"/></defs><g clip-path="url(#clip)"><use href="#shape"/></g>',
    '<defs><g id="shape" clip-path="url(#clip)"><rect width="100" height="100"/></g></defs><use href="#shape" x="10"/>',
    '<defs><g id="shape" clip-path="url(#clip)"><rect width="100" height="100"/></g><use id="alias" href="#shape"/></defs><use href="#alias"/>',
    '<svg viewBox="0 0 10 10"><rect width="10" height="10" clip-path="url(#clip)"/></svg>',
    '<g clip-path="url(#clip)"><svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg></g>',
    '<rect width="100" height="100" style="clip:rect(0 10px 10px 0)"/>',
    '<rect width="100" height="100" clip-path="url(https://example.com/clip.svg#clip)"/>',
    '<rect width="100" height="100" clip-path="url(#missing)"/>',
    '<rect width="100" height="100" transform="translate(NaN)" clip-path="url(#clip)"/>'
  ])("diagnoses unsupported active clipping: %s", async body => {
    const result = await convertSvgToScopeSnippet(svg(`${definition}${body}`));
    expect(result.kind).toBe("failure");
    if (result.kind === "failure") expect(result.message).toContain("Unsupported SVG clipping:");
  });
});

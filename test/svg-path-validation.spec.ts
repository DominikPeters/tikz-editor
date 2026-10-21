import { beforeAll, describe, expect, it } from "vitest";
import { installNodeSvgEnvironment } from "svg2tikz/node-env";
import { svgToTikz } from "svg2tikz";
import { convertSvgToScopeSnippet, resolveOpenedFileForDocument } from "../packages/app/src/ui/svg-import";
import { parseSvgForImport } from "../packages/app/src/ui/svg-path-validation";
import { parseTikz } from "../packages/core/src/parser";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate";

beforeAll(() => { installNodeSvgEnvironment(); });
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 100 100">${body}</svg>`;
const drawableCases = [
  ["rect", '<rect x="10" y="20" width="20" height="30" fill="red"/>'],
  ["ellipse", '<ellipse cx="60" cy="70" rx="20" ry="10" fill="blue"/>'],
  ["relative and smooth", '<path d="M10 20c10 0 10 20 20 20s10 -20 20 -20" fill="none" stroke="black"/>'],
  ["arc flags", '<path d="M10 20A20 10 30 0 1 50 60" fill="none" stroke="black"/>'],
  ["transform", '<g transform="translate(10 5) rotate(20) scale(1.5 .5)"><rect x="10" y="20" width="20" height="30" fill="red"/></g>'],
  ["matrix", '<g transform="matrix(1 .5 0 1 5 10)"><rect x="10" y="20" width="20" height="30" fill="red"/></g>'],
  ["use", '<defs><rect id="r" x="10" y="20" width="20" height="30" fill="red"/></defs><use href="#r" x="20" y="30"/>'],
  ["opacity", '<g opacity=".5"><rect x="10" y="20" width="30" height="40" fill="red"/></g>'],
  ["gradient", '<defs><linearGradient id="g"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><rect x="10" y="20" width="30" height="40" fill="url(#g)"/>']
] as const;

describe("SVG import parser progress boundary", () => {
  it.each(drawableCases)("preserves the accepted drawable %s import", async (_name, body) => {
    const source = svg(body);
    const result = await convertSvgToScopeSnippet(source);
    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error(result.message);
    expect(result.tikzSource).toBe(svgToTikz(source, { standalone: false }));
    const parsed = parseTikz(result.tikzSource);
    expect(parsed.diagnostics.filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
    const scene = evaluateTikzFigure(parsed.figure, result.tikzSource);
    expect(scene.scene.elements.length).toBeGreaterThan(0);
    expect(scene.diagnostics.filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
  });

  it.each([
    ["closed path", "M0 0L10 0L10 10Z"],
    ["exponents and adjacent signs", "M1e1 2E+1l-5.5+.5H10v-2z"],
    ["compact decimals and implicit coordinates", "M.5.5L5-5 7.5.25"],
    ["new command after close", "M0 0Z m2 2l3 3z"],
    ["consecutive close commands", "M0 0L1 1ZZ"],
    ["all curve commands", "M10 10C15 0 20 20 25 10S35 20 40 10Q45 0 50 10T60 10"],
    ["relative arcs", "M0 0A10 5 30 0 1 20 10a8 8 0 1 0 5 5"],
    ["compact arc flags", "M0 0A10 10 0 0110 20"],
    ["finite truncated line", "M0 0L10"],
    ["finite unknown-character recovery", "M0 0L10 10#Z"]
  ])("retains dependency-compatible %s token boundaries", async (_name, data) => {
    const source = svg(`<path d="${data}" fill="none" stroke="black"/>`);
    const expected = svgToTikz(source, { standalone: false });
    const pasted = await convertSvgToScopeSnippet(source);
    const opened = await resolveOpenedFileForDocument({ source, fileRef: { kind: "virtual", name: "valid.svg" } });
    expect(pasted).toMatchObject({ kind: "success", tikzSource: expected });
    expect(opened).toMatchObject({ kind: "success", source: expected, title: "valid.tex", importedFromSvg: true });
  });

  it.each([
    '<desc><![CDATA[<path d="M0 0Z1 2"/>]]></desc>',
    '<!-- <path d="1 2"/> -->',
    '<text x="10" y="30">&lt;path d="1 2"/&gt;</text>',
    '<g d="1 2"><rect x="10" y="20" width="5" height="5"/></g>',
    '<polygon d="M0 0Z1 2" points="10 20 20 20 20 30"/>',
    '<style><![CDATA[.ignored { d: path("M0 0Z1 2"); }]]></style>',
    '<path/><path d=""/>',
    '<defs><marker id="polygon"><polygon d="1 2" points="0 0 5 2 0 4"/></marker></defs>'
  ])("does not treat inert/non-path d text as converter path input: %s", async body => {
    const source = svg(`${body}<rect x="10" y="20" width="10" height="10"/>`);
    const result = await convertSvgToScopeSnippet(source);
    expect(result).toMatchObject({ kind: "success", tikzSource: svgToTikz(source, { standalone: false }) });
  });

  it("passes the exact decoded DOM selection and preserves use targets in its owner document", () => {
    const source = '<root><path id="target" d="M&#49;0 20L20 30"/>' + svg('<use href="#target"/>') + '</root>';
    const selected = parseSvgForImport(source);
    expect(selected.tagName).toBe("svg");
    expect(selected.ownerDocument.getElementById("target")?.getAttribute("d")).toBe("M10 20L20 30");
    expect(svgToTikz(selected, { standalone: false })).toBe(svgToTikz(source, { standalone: false }));
  });

  it("selects the same first SVG as the dependency in an XML container", async () => {
    const source = '<root>' + svg('<rect x="10" y="20" width="10" height="10"/>') + svg('<path d="M0 0L2 2"/>') + '</root>';
    expect(await convertSvgToScopeSnippet(source)).toMatchObject({ kind: "success", tikzSource: svgToTikz(source, { standalone: false }) });
  });

  it("retains the existing structured error for XML without a selectable SVG", async () => {
    expect(await convertSvgToScopeSnippet('<p:svg xmlns:p="http://www.w3.org/2000/svg"/>')).toEqual({ kind: "failure", message: "SVG import failed: No <svg> element found" });
    expect(await convertSvgToScopeSnippet('<svg><path d="1 2"></svg>')).toEqual({ kind: "failure", message: "SVG import failed: No <svg> element found" });
  });
});

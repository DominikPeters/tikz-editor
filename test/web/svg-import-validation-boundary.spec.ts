/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { convertSvgToScopeSnippet } from "../../packages/app/src/ui/svg-import";

const convert = vi.hoisted(() => vi.fn<(input: string | Element, options: { standalone: boolean }) => string>(() =>
  "\\begin{tikzpicture}\n\\draw (0,0)--(1,1);\n\\end{tikzpicture}"
));
vi.mock("svg2tikz", () => ({ svgToTikz: convert }));
beforeEach(() => { convert.mockClear(); });
afterEach(() => { vi.unstubAllGlobals(); });

it("hands the converter the validated decoded tree with its complete owner document", async () => {
  const source = '<root><path id="target" d="M&#49;0 20L20 30"/><svg xmlns="http://www.w3.org/2000/svg"><use href="#target"/></svg></root>';
  expect((await convertSvgToScopeSnippet(source)).kind).toBe("success");
  expect(convert).toHaveBeenCalledTimes(1);
  const element = convert.mock.calls[0][0];
  expect(element).toBeInstanceOf(Element);
  if (typeof element === "string") throw new Error("Conversion must receive the already validated tree");
  expect(element).toBe(element.ownerDocument.querySelector("svg"));
  expect(element.ownerDocument.getElementById("target")?.getAttribute("d")).toBe("M10 20L20 30");
  expect(convert.mock.calls[0][1]).toEqual({ standalone: false });
});

it("rejects malformed decoded path data before any converter call, including a mocked converter", async () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0&#90;&#49; 2"/></svg>';
  expect(await convertSvgToScopeSnippet(source)).toMatchObject({ kind: "failure", message: expect.stringContaining("SVG import failed: Malformed SVG path data:") });
  expect(convert).not.toHaveBeenCalled();
});

it("retains the existing missing-DOM failure in a Node-style environment", async () => {
  vi.stubGlobal("DOMParser", undefined);
  expect(await convertSvgToScopeSnippet('<svg xmlns="http://www.w3.org/2000/svg"/>')).toEqual({ kind: "failure", message: "SVG import failed: DOMParser is not available in this environment" });
  expect(convert).not.toHaveBeenCalled();
});

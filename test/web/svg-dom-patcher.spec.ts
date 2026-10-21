/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SvgDomPatcher } from "../../packages/app/src/ui/canvas-panel/svg-dom-patcher";
import { diffSvgModels } from "../../packages/core/src/svg/patch";
import type { SvgRenderModel, SvgRenderPart } from "../../packages/core/src/svg/types";

const part = (id: string, markup = `<g><text>${id}</text></g>`): SvgRenderPart => ({
  partId: id, sourceId: id, elementId: id, order: 0, markup, fingerprint: markup
});
const model = (parts: SvgRenderPart[]): SvgRenderModel => ({
  parts: parts.map((entry, order) => ({ ...entry, order })),
  viewBox: { x: 0, y: 0, width: 100, height: 100 }, defs: [], defsFingerprint: "", diagnostics: []
});

afterEach(() => vi.restoreAllMocks());

describe("canvas SVG patching", () => {
  it("batches dense changes and preserves unchanged DOM nodes across reordering", () => {
    const host = document.createElement("div");
    const patcher = new SvgDomPatcher(host);
    const parse = vi.spyOn(DOMParser.prototype, "parseFromString");
    const before = model([part("a"), part("b"), part("c")]);
    patcher.applyOperations(diffSvgModels(null, before));
    expect(parse).toHaveBeenCalledTimes(1);
    const unchanged = host.querySelector('[data-part-id="c"]');
    parse.mockClear();

    const after = model([part("c"), part("a", '<g><text data-source-start="37">A &amp; B</text></g>'),
      ...Array.from({ length: 100 }, (_, index) => part(`new-${index}`, '<use xlink:href="#glyph"/>'))]);
    patcher.applyOperations(diffSvgModels(before, after));
    expect(parse).toHaveBeenCalledTimes(1);
    expect(Array.from(host.querySelectorAll("[data-part-id]")).map((node) => node.getAttribute("data-part-id")))
      .toEqual(after.parts.map((entry) => entry.partId));
    expect(host.querySelector('[data-part-id="c"]')).toBe(unchanged);
    expect(host.querySelector('[data-part-id="a"] text')?.textContent).toBe("A & B");
    expect(host.querySelector('[data-part-id="a"] text')?.getAttribute("data-source-start")).toBe("37");
    expect(host.querySelector("use")?.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe("#glyph");
    parse.mockClear();
    patcher.applyOperations(diffSvgModels(after, after));
    expect(parse).not.toHaveBeenCalled();
  });

  it("keeps head, missing-anchor, self-anchor and remove ordering semantics", () => {
    const host = document.createElement("div");
    const patcher = new SvgDomPatcher(host);
    patcher.applyOperations(diffSvgModels(null, model([part("a"), part("b"), part("c")])));
    patcher.applyOperations([
      { kind: "upsertPart", part: part("c"), afterPartId: null },
      { kind: "upsertPart", part: part("a"), afterPartId: "missing" },
      { kind: "upsertPart", part: part("c"), afterPartId: "c" },
      { kind: "removePart", partId: "a" },
      { kind: "upsertPart", part: part("d"), afterPartId: "b" }
    ]);
    expect(Array.from(host.querySelectorAll("[data-part-id]")).map((node) => node.getAttribute("data-part-id")))
      .toEqual(["b", "d", "c"]);
    patcher.dispose();
    expect(host.children).toHaveLength(0);
  });

  it("retains the per-part HTML fallback when a fragment is not XML", () => {
    const host = document.createElement("div");
    const patcher = new SvgDomPatcher(host);
    patcher.applyOperations(diffSvgModels(null, model([part("a", "<g><text>A&nbsp;B</text></g>"), part("b")])));
    expect(host.querySelector('[data-part-id="a"] text')?.textContent).toBe("A\u00a0B");
    expect(host.querySelectorAll("[data-part-id]")).toHaveLength(2);
  });
});

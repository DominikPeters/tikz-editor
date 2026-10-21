import { describe, expect, it } from "vitest";
import { analyzeSimpleTexParagraph, parseSimpleTexParagraphIr } from "../packages/core/src/text/tex/ir.js";

describe("cached TeX paragraph IR", () => {
  it("keeps generated bibliography margins in the cache key", () => {
    const source = String.raw`\begin{bibliography}\item[{[1]}] Entry.\end{bibliography}`;
    const margins = new Map([[0, 2]]);
    const first = parseSimpleTexParagraphIr(source, undefined, { bibliographyMargins: margins });
    parseSimpleTexParagraphIr(source, undefined, { bibliographyMargins: margins });
    margins.set(0, 4);
    const changed = parseSimpleTexParagraphIr(source, undefined, { bibliographyMargins: margins });
    expect(changed).not.toEqual(first);
    expect(changed.blocks[0].listContext?.ownLeftMarginEm).toBe(4);
    expect(first.blocks[0].listContext?.ownLeftMarginEm).toBe(2);
  });
  it("shares immutable IR across parsing, validation, and width changes", () => {
    const text = String.raw`IR cache fixture \textbf{office} $x^2$\\second line`;
    parseSimpleTexParagraphIr(text);
    const ir = parseSimpleTexParagraphIr(text);
    expect(analyzeSimpleTexParagraph(text, 80).ir).toBe(ir);
    expect(analyzeSimpleTexParagraph(text, 300).ir).toBe(ir);
    expect(analyzeSimpleTexParagraph(text, 0).ir).toBeNull();
    expect(Object.isFrozen(ir)).toBe(true);
    expect(Object.isFrozen(ir.nodes)).toBe(true);
    expect(Object.isFrozen(ir.nodes[0])).toBe(true);
  });

  it("keys list margins by value and observes edits to caller-owned settings", () => {
    const text = String.raw`\begin{itemize}\item cache margin\end{itemize}`;
    const margins = [2.5, 2.2];
    analyzeSimpleTexParagraph(text, 80, undefined, { listLeftMarginEmByDepth: margins });
    const first = analyzeSimpleTexParagraph(text, 80, undefined, { listLeftMarginEmByDepth: margins }).ir;
    expect(analyzeSimpleTexParagraph(text, 120, undefined, { listLeftMarginEmByDepth: [...margins] }).ir).toBe(first);
    margins[0] = 4;
    const changed = analyzeSimpleTexParagraph(text, 80, undefined, { listLeftMarginEmByDepth: margins }).ir;
    expect(changed).not.toBe(first);
    expect(changed).not.toEqual(first);
    expect(Object.isFrozen(margins)).toBe(false);
  });

  it("invalidates versioned colors and bypasses unversioned mutable resolver functions", () => {
    const text = String.raw`\textcolor{ir-cache-local}{cached color}`;
    let color = "#ff0000";
    const resolve = () => color;
    parseSimpleTexParagraphIr(text, resolve, { colorResolverCacheKey: "ir-color-v1" });
    const first = parseSimpleTexParagraphIr(text, resolve, { colorResolverCacheKey: "ir-color-v1" });
    expect(parseSimpleTexParagraphIr(text, resolve, { colorResolverCacheKey: "ir-color-v1" })).toBe(first);
    color = "#0000ff";
    const changed = parseSimpleTexParagraphIr(text, resolve, { colorResolverCacheKey: "ir-color-v2" });
    expect(changed).not.toEqual(first);
    const uncached = parseSimpleTexParagraphIr(text, resolve);
    expect(parseSimpleTexParagraphIr(text, resolve)).not.toBe(uncached);
    color = "#00ff00";
    expect(parseSimpleTexParagraphIr(text, resolve)).not.toEqual(uncached);
    expect(parseSimpleTexParagraphIr(text)).not.toEqual(changed);
  });

  it("evicts old IR and does not retain oversized source", () => {
    parseSimpleTexParagraphIr("IR eviction probe");
    const ir = parseSimpleTexParagraphIr("IR eviction probe");
    for (let index = 0; index < 513; index++) {
      parseSimpleTexParagraphIr(`IR fill ${index}`);
      parseSimpleTexParagraphIr(`IR fill ${index}`);
    }
    const repeated = parseSimpleTexParagraphIr("IR eviction probe");
    expect(repeated).toEqual(ir);
    expect(repeated).not.toBe(ir);
    const text = "a".repeat(16385);
    expect(parseSimpleTexParagraphIr(text)).not.toBe(parseSimpleTexParagraphIr(text));
  });
});

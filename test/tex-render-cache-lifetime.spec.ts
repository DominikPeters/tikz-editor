import { describe, expect, it } from "vitest";
import { createTexNodeTextEngine } from "../packages/core/src/text/tex-node-text-engine.js";
import { defaultTexMathFontProfile } from "../packages/core/src/text/tex/math/font-profile.js";
import { getParagraphLayoutReports } from "../packages/core/src/text/knuth-plass/report-registry.js";
import { getTexVListLayout, getTexVListLayouts } from "../packages/core/src/text/tex/vlist/registry.js";
import { renderTikzToSvgAsync } from "../packages/core/src/render/index.js";

const request = (text: string) => ({ text, textWidthPt: null, fontStyle: "normal" as const, fontWeight: "normal" as const, fontFamily: "serif" as const, fontSizePt: 10 });

describe("render cache report ownership", () => {
  it("keeps hot reports alive beyond standalone registry limits and drops evicted metadata", async () => {
    const engine = await createTexNodeTextEngine({ mathFontProfile: { ...defaultTexMathFontProfile, id: "report-lifetime" } });
    const probe = request("Keep this editing report alive");
    const metrics = engine.measure(probe)!;
    const unused = engine.measure(request("Allow this old report to expire"))!;
    const originalLayout = getTexVListLayout(engine.layoutContext, metrics.paragraphId);
    for (let index = 0; index < 4100; index++) {
      engine.measure(request(`lifetime fill ${index}`));
      engine.measure(probe);
    }
    expect(engine.renderFromCache(metrics.cacheKey)).not.toBeNull();
    expect(getParagraphLayoutReports(engine.layoutContext).some((report) => report.paragraphId === metrics.paragraphId)).toBe(true);
    expect(getTexVListLayout(engine.layoutContext, metrics.paragraphId)).toBe(originalLayout);
    expect(engine.renderFromCache(unused.cacheKey)).toBeNull();
    expect(getParagraphLayoutReports(engine.layoutContext).some((report) => report.paragraphId === unused.paragraphId)).toBe(false);
    expect(getTexVListLayout(engine.layoutContext, unused.paragraphId)).toBeNull();
    expect(getTexVListLayouts(engine.layoutContext).length).toBeLessThanOrEqual(2048);
  });

  it("returns each render's report owner even when another engine runs later", async () => {
    const first = await createTexNodeTextEngine({ mathFontProfile: { ...defaultTexMathFontProfile, id: "result-owner-first" } });
    const second = await createTexNodeTextEngine({ mathFontProfile: { ...defaultTexMathFontProfile, id: "result-owner-second" } });
    const source = String.raw`\begin{tikzpicture}\node {Owner};\end{tikzpicture}`;
    const result = await renderTikzToSvgAsync(source, { textEngine: first });
    await renderTikzToSvgAsync(source, { textEngine: second });
    expect(result.textLayoutContext).not.toBeNull();
    expect(result.textLayoutContext).not.toBe(second.layoutContext);
    const text = result.semantic.scene.elements.find((element) => element.kind === "Text");
    const paragraphId = text?.kind === "Text" && text.textRenderInfo?.mode === "tex" ? text.textRenderInfo.paragraphId : null;
    expect(paragraphId).not.toBeNull();
    expect(getTexVListLayout(result.textLayoutContext, paragraphId)).not.toBeNull();
    expect(getTexVListLayout(result.textLayoutContext, paragraphId)).toBe(getTexVListLayout(first.layoutContext, paragraphId));
  });

  it("retains visible text through cache eviction and carries it into incremental scopes", async () => {
    const engine = await createTexNodeTextEngine({ mathFontProfile: { ...defaultTexMathFontProfile, id: "visible-render-lifetime" } });
    const scope = engine.createRenderScope!();
    const first = scope.run(() => engine.measure(request("First visible text")))!;
    const removed = scope.run(() => engine.measure(request("Removed text")))!;
    expect(() => scope.run(() => { throw new Error("abort render"); })).toThrow("abort render");
    const outside = engine.measure(request("Outside aborted scope"))!;
    let last = first;
    scope.run(() => {
      for (let index = 0; index < 2300; index++) last = engine.measure(request(`visible scope fill ${index}`))!;
    });
    expect(engine.renderFromCache(first.cacheKey)).toBeNull();
    expect(scope.run(() => engine.renderFromCache(first.cacheKey))).not.toBeNull();
    expect(scope.run(() => engine.renderFromCache(outside.cacheKey))).toBeNull();
    const recreated = engine.measure(request("First visible text"))!;
    expect(recreated.cacheKey).toBe(first.cacheKey);
    expect(recreated.paragraphId).not.toBe(first.paragraphId);
    scope.retain([first.cacheKey, last.cacheKey]);
    expect(getTexVListLayout(scope.layoutContext, first.paragraphId)).not.toBeNull();
    expect(getTexVListLayout(scope.layoutContext, removed.paragraphId)).toBeNull();
    const incremental = engine.createRenderScope!(scope.layoutContext);
    expect(incremental.run(() => engine.renderFromCache(first.cacheKey))).not.toBeNull();
    expect(incremental.run(() => engine.measure(request("First visible text")))?.paragraphId).toBe(first.paragraphId);
    incremental.retain([first.cacheKey]);
    expect(getTexVListLayout(incremental.layoutContext, first.paragraphId)).toBe(getTexVListLayout(scope.layoutContext, first.paragraphId));
  });
});

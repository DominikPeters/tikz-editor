import { describe, expect, it } from "vitest";
import { createTexNodeTextEngine } from "../packages/core/src/text/tex-node-text-engine.js";
import { createIdentityMappedText } from "../packages/core/src/text/source-map.js";
import { defaultTexMathFontProfile } from "../packages/core/src/text/tex/math/font-profile.js";
import { createBeamerTexMathFontProfile } from "../packages/core/src/beamer/theme/font.js";
import { texLength } from "../packages/core/src/text/tex/coordinates.js";
import { getActiveTextLayoutContext } from "../packages/core/src/text/layout-context.js";
import { getParagraphLayoutReports } from "../packages/core/src/text/knuth-plass/report-registry.js";

function request(text: string) {
  return { text, textWidthPt: null, fontStyle: "normal" as const, fontWeight: "normal" as const, fontFamily: "serif" as const, fontSizePt: 10 };
}

describe("TeX engine cache keys", () => {
  it("separates resolver kinds and embedded separators", async () => {
    const engine = await createTexNodeTextEngine();
    const base = request(String.raw`\textcolor{cache-key-local}{resolver keys}`);
    const graphics = (cacheKey: string) => ({ cacheKey, resolve: () => ({ status: "missing" as const }) });
    const color = (cacheKey: string, value: string) => ({ cacheKey, resolve: () => value });
    const first = engine.measure({ ...base, graphicsResolver: graphics("a|b"), colorResolver: color("c", "#ff0000") });
    const second = engine.measure({ ...base, graphicsResolver: graphics("a"), colorResolver: color("b|c", "#0000ff") });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second?.cacheKey).not.toBe(first?.cacheKey);
    expect(engine.renderFromCache(first!.cacheKey)?.body).toContain("#ff0000");
    expect(engine.renderFromCache(second!.cacheKey)?.body).toContain("#0000ff");
    const onlyColor = engine.measure({ ...base, colorResolver: color("same-revision", "#00ff00") });
    const onlyGraphics = engine.measure({ ...base, graphicsResolver: graphics("same-revision") });
    expect(onlyColor).not.toBeNull();
    expect(onlyGraphics).not.toBeNull();
    expect(onlyGraphics?.cacheKey).not.toBe(onlyColor?.cacheKey);
  });

  it("retains exact requested dimensions instead of rounded key aliases", async () => {
    const engine = await createTexNodeTextEngine();
    const base = request("exact dimension cache fixture");
    const first = engine.measure({ ...base, fontSizePt: 10, textWidthPt: 80 });
    const tinySizeChange = engine.measure({ ...base, fontSizePt: 10.0000001, textWidthPt: 80 });
    const tinyWidthChange = engine.measure({ ...base, fontSizePt: 10, textWidthPt: 80.0000001 });
    expect(first).not.toBeNull();
    expect(tinySizeChange?.cacheKey).not.toBe(first?.cacheKey);
    expect(tinyWidthChange?.cacheKey).not.toBe(first?.cacheKey);
  });

  it("distinguishes source maps whose old 32-bit fingerprints collide", async () => {
    const engine = await createTexNodeTextEngine();
    const text = "Cache collision";
    const maps = [2169, 8071].map((offset) => createIdentityMappedText(text, offset).sourceMap);
    const fingerprint = (source: string) => {
      let hash = 2166136261;
      for (let index = 0; index < source.length; index++) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
      return hash >>> 0;
    };
    expect(fingerprint(JSON.stringify([maps[0].charOrigins, maps[0].boundaryOrigins])))
      .toBe(fingerprint(JSON.stringify([maps[1].charOrigins, maps[1].boundaryOrigins])));
    const first = engine.measure({ ...request(text), sourceMap: maps[0] });
    const second = engine.measure({ ...request(text), sourceMap: maps[1] });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second?.cacheKey).not.toBe(first?.cacheKey);
    expect(second?.paragraphId).not.toBe(first?.paragraphId);
    expect(engine.renderFromCache(first!.cacheKey)?.body).toContain('data-source-start="2169"');
    expect(engine.renderFromCache(second!.cacheKey)?.body).toContain('data-source-start="8071"');
    expect(engine.measure({ ...request(text), sourceMap: maps[0] })?.paragraphId).toBe(first?.paragraphId);
  });

  it("includes projection bounds even when origin arrays are unchanged", async () => {
    const engine = await createTexNodeTextEngine();
    const text = "Projection bounds";
    const original = createIdentityMappedText(text, 1234).sourceMap;
    const shortened = { ...original, inputText: text.slice(0, 1) };
    const first = engine.measure({ ...request(text), sourceMap: original });
    const second = engine.measure({ ...request(text), sourceMap: shortened });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second?.cacheKey).not.toBe(first?.cacheKey);
    expect(engine.renderFromCache(second!.cacheKey)?.body).not.toBe(engine.renderFromCache(first!.cacheKey)?.body);
  });

  it("never recycles source-map tokens after eviction", async () => {
    const engine = await createTexNodeTextEngine({ mathFontProfile: { ...defaultTexMathFontProfile, id: "source-map-key-eviction" } });
    const base = request("X");
    const original = createIdentityMappedText("X", 500).sourceMap;
    const first = engine.measure({ ...base, sourceMap: original });
    for (let index = 0; index < 2049; index++) {
      engine.measure({ ...base, sourceMap: createIdentityMappedText("X", 10000 + index).sourceMap });
    }
    const repeated = engine.measure({ ...base, sourceMap: original });
    expect(first).not.toBeNull();
    expect(repeated).not.toBeNull();
    expect(repeated?.cacheKey).not.toBe(first?.cacheKey);
    expect(repeated?.width).toBe(first?.width);
    expect(engine.renderFromCache(repeated!.cacheKey)?.body).toContain('data-source-start="500"');
    expect(engine.renderFromCache(first!.cacheKey)).toBeNull();
  });

  it("isolates custom profiles with the same ID while reusing the same object", async () => {
    const firstProfile = { ...defaultTexMathFontProfile, id: "custom-profile-cache-key" };
    const secondProfile = { ...firstProfile, layoutParameters: { ...firstProfile.layoutParameters, alignedBaselineSkip: texLength(30) } };
    const first = await createTexNodeTextEngine({ mathFontProfile: firstProfile });
    const second = await createTexNodeTextEngine({ mathFontProfile: secondProfile });
    expect(second).not.toBe(first);
    expect(await createTexNodeTextEngine({ mathFontProfile: firstProfile })).toBe(first);
  });

  it("selects the owning reports when a cached engine is reused", async () => {
    const first = await createTexNodeTextEngine({ mathFontProfile: { ...defaultTexMathFontProfile, id: "report-owner-first" } });
    const firstContext = getActiveTextLayoutContext();
    const second = await createTexNodeTextEngine({ mathFontProfile: { ...defaultTexMathFontProfile, id: "report-owner-second" } });
    const secondContext = getActiveTextLayoutContext();
    expect(firstContext).not.toBe(secondContext);
    const firstMetrics = first.measure(request("First report owner"));
    expect(getActiveTextLayoutContext()).toBe(firstContext);
    expect(getParagraphLayoutReports(firstContext).some((report) => report.paragraphId === firstMetrics?.paragraphId)).toBe(true);
    second.measure(request("Second report owner"));
    expect(getActiveTextLayoutContext()).toBe(secondContext);
    first.renderFromCache(firstMetrics!.cacheKey);
    expect(getActiveTextLayoutContext()).toBe(firstContext);
    second.measure(request("Second report owner"));
    first.measure(request("First report owner"));
    expect(getActiveTextLayoutContext()).toBe(firstContext);
  });

  it("reuses equivalent Beamer profiles and observes line-height and mutable role changes", async () => {
    const role = { family: "sans" as const, series: "medium" as const, shape: "upright" as const, sizePt: 11, lineHeightPt: 13.2 };
    const first = createBeamerTexMathFontProfile(role);
    expect(createBeamerTexMathFontProfile({ ...role })).toBe(first);
    expect(await createTexNodeTextEngine({ mathFontProfile: createBeamerTexMathFontProfile({ ...role }) }))
      .toBe(await createTexNodeTextEngine({ mathFontProfile: first }));
    role.lineHeightPt = 18;
    const changed = createBeamerTexMathFontProfile(role);
    expect(changed).not.toBe(first);
    expect(first.layoutParameters.alignedBaselineSkip).toBe(13.2);
    expect(changed.layoutParameters.alignedBaselineSkip).toBe(18);
    expect(Object.isFrozen(role)).toBe(false);
    expect(Object.isFrozen(first)).toBe(true);
  });
});

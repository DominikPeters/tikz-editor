import { describe, expect, it } from "vitest";

import { createTexNodeTextEngine } from "../packages/core/src/text/tex-node-text-engine.js";

function request(text: string, fontSizePt = 10) {
  return {
    text,
    textWidthPt: null,
    fontStyle: "normal" as const,
    fontWeight: "normal" as const,
    fontFamily: "serif" as const,
    fontSizePt,
  };
}

describe("native TeX node text engine", () => {
  it("measures and renders supported text without an external renderer", async () => {
    const engine = await createTexNodeTextEngine();
    const metrics = engine.measure(request(String.raw`Cost $O(n^2)$`));

    expect(metrics).not.toBeNull();
    expect(metrics?.paragraphId).toMatch(/^tex:/);
    const payload = engine.renderFromCache(metrics?.cacheKey ?? "");
    expect(payload?.body).toContain('data-tex-linebox="true"');
    expect(payload?.body).toContain('data-tex-inline-math="true"');
  });

  it("reports unsupported syntax instead of delegating it to another renderer", async () => {
    const engine = await createTexNodeTextEngine();
    const text = String.raw`Alpha \noindent Beta`;

    expect(engine.validate(text)).toMatchObject({
      code: "unsupported-node-tex",
    });
    const metrics = engine.measure(request(text));
    expect(metrics).toBeNull();
  });

  it("does not create render entries for empty text", async () => {
    const engine = await createTexNodeTextEngine();
    expect(engine.validate("   ")).toBeNull();
    expect(engine.measure(request("   "))).toBeNull();
  });

  it("scales cached native metrics with the requested font size", async () => {
    const engine = await createTexNodeTextEngine();
    const tenPoint = engine.measure(request("native", 10));
    const twentyPoint = engine.measure(request("native", 20));

    expect(twentyPoint?.width).toBeCloseTo((tenPoint?.width ?? 0) * 2, 6);
    expect(twentyPoint?.height).toBeCloseTo((tenPoint?.height ?? 0) * 2, 6);
  });
});

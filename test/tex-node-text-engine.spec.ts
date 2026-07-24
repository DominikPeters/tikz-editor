import { describe, expect, it } from "vitest";

import type { DocumentGraphicsResolver } from "../packages/core/src/graphics/index.js";
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

  it("lays out each requested font size with its TeX-selected face", async () => {
    const engine = await createTexNodeTextEngine();
    const tenPoint = engine.measure(request("native", 10));
    const twentyPoint = engine.measure(request("native", 20));
    const twentyPointPayload = engine.renderFromCache(
      twentyPoint?.cacheKey ?? ""
    );

    expect(twentyPoint?.cacheKey).not.toBe(tenPoint?.cacheKey);
    expect(twentyPointPayload?.body).toContain(
      'data-tex-font="lmroman10-regular"'
    );
    expect(twentyPointPayload?.body).toContain("scale(2)");
  });

  it("treats par as a no-op in natural-width TikZ hbox text", async () => {
    const engine = await createTexNodeTextEngine();
    const restricted = engine.measure(
      request(String.raw`separated\par from`)
    );
    const joined = engine.measure(request("separatedfrom"));

    expect(restricted).not.toBeNull();
    expect(restricted?.width).toBeCloseTo(joined?.width ?? 0, 6);
    expect(restricted?.height).toBeCloseTo(joined?.height ?? 0, 6);
  });

  it("exposes source-backed graphics geometry with the cached render payload", async () => {
    const engine = await createTexNodeTextEngine();
    const text = String.raw`A\includegraphics[width=16pt]{figure.png}Z`;
    const graphicsResolver: DocumentGraphicsResolver = {
      cacheKey: "node-payload-graphics",
      resolve: () => ({
        status: "resolved",
        mimeType: "image/png",
        dataBase64: "aW1hZ2U=",
        naturalWidthPt: 32,
        naturalHeightPt: 16,
        revision: "image-r1",
      }),
    };
    const metrics = engine.measure({
      ...request(text),
      graphicsResolver,
    });
    const payload = engine.renderFromCache(metrics?.cacheKey ?? "");
    const graphic = payload?.graphicsPlacements[0];
    const commandStart = text.indexOf(String.raw`\includegraphics`);
    const filenameStart = text.indexOf("figure.png");

    expect(payload?.graphicsPlacements).toHaveLength(1);
    expect(graphic).toMatchObject({
      sourceCoordinateSpace: "layout",
      asset: {
        filename: "figure.png",
        status: "resolved",
        naturalWidthPt: 32,
        naturalHeightPt: 16,
        revision: "image-r1",
      },
      sourceSpan: {
        start: commandStart,
        end: text.indexOf("}", filenameStart) + 1,
      },
      filenameSpan: {
        start: filenameStart,
        end: filenameStart + "figure.png".length,
      },
      caretPolicy: "filename-linear",
      bounds: {
        width: 16,
        height: 8,
      },
    });
    expect(graphic?.paragraphId).toBe(metrics?.paragraphId);
    expect(graphic?.id.startsWith(`${metrics?.paragraphId}:graphics:`))
      .toBe(true);
  });
});

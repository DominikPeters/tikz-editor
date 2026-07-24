import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  prepareBeamerDocument,
  renderBeamerFrame,
  renderBeamerFramePages,
} from "../packages/core/src/beamer/index.js";

const KKT_FIXTURE_PATH = new URL(
  "./fixtures/beamer/kkt_theorem_beamer.tex",
  import.meta.url
);
const OVERLAY_FIXTURE_PATH = new URL(
  "./fixtures/beamer/overlay_conformance_beamer.tex",
  import.meta.url
);

describe("prepared Beamer document", () => {
  it("renders frames identically to the one-shot entry point", async () => {
    const source = readFileSync(KKT_FIXTURE_PATH, "utf8");
    const prepared = prepareBeamerDocument(source);
    // Layout paragraph reports retain per-render callback references (list
    // marker resolvers), so compare the serialized SVG plus the plain-data
    // layout facts instead of the full report objects.
    const comparableLayout = (layout: {
      paragraphs: readonly { report: unknown; vlistLayout: unknown }[];
    }) => ({
      ...layout,
      paragraphs: layout.paragraphs.map(
        ({ report: _report, vlistLayout: _vlistLayout, ...rest }) => rest
      ),
    });
    for (const frameIndex of [0, 2, 12]) {
      const fromPrepared = await prepared.renderFrame({ frameIndex });
      const oneShot = await renderBeamerFrame(source, { frameIndex });
      expect(fromPrepared.svg.svg).toEqual(oneShot.svg.svg);
      expect(comparableLayout(fromPrepared.layout)).toEqual(
        comparableLayout(oneShot.layout)
      );
      expect(fromPrepared.diagnostics).toEqual(oneShot.diagnostics);
    }
  });

  it("renders overlay pages identically to the one-shot entry point", async () => {
    const source = readFileSync(OVERLAY_FIXTURE_PATH, "utf8");
    const prepared = prepareBeamerDocument(source);
    const fromPrepared = await prepared.renderFramePages({ frameIndex: 1 });
    const oneShot = await renderBeamerFramePages(source, { frameIndex: 1 });
    expect(fromPrepared.stepCount).toEqual(oneShot.stepCount);
    expect(fromPrepared.pages.map((page) => page.svg.svg)).toEqual(
      oneShot.pages.map((page) => page.svg.svg)
    );
  });

  it("exposes the scanned document and resolved theme", () => {
    const source = readFileSync(KKT_FIXTURE_PATH, "utf8");
    const prepared = prepareBeamerDocument(source);
    expect(prepared.document.frames.length).toBeGreaterThan(0);
    expect(prepared.document.frames[0]!.id).toBe("frame:0");
    expect(prepared.theme.id).toBeTruthy();
  });

  it("reports step counts without rendering", async () => {
    const source = readFileSync(OVERLAY_FIXTURE_PATH, "utf8");
    const prepared = prepareBeamerDocument(source);
    const counts = prepared.document.frames.map((_, frameIndex) =>
      prepared.frameStepCount(frameIndex)
    );
    expect(counts.length).toBeGreaterThan(1);
    expect(counts.some((count) => count > 1)).toBe(true);
    for (const [frameIndex, count] of counts.entries()) {
      const rendered = await prepared.renderFrame({ frameIndex });
      expect(rendered.layout.stepCount).toBe(count);
    }
  });

  it("preserves range errors for invalid frame indices and steps", async () => {
    const source = readFileSync(KKT_FIXTURE_PATH, "utf8");
    const prepared = prepareBeamerDocument(source);
    const frameCount = prepared.document.frames.length;
    expect(() => prepared.frameStepCount(frameCount)).toThrow(RangeError);
    await expect(
      prepared.renderFrame({ frameIndex: frameCount })
    ).rejects.toThrow(RangeError);
    await expect(
      prepared.renderFrame({ frameIndex: 0, step: 0 })
    ).rejects.toThrow(RangeError);
    await expect(
      prepared.renderFrame({ frameIndex: 0, step: 99 })
    ).rejects.toThrow(RangeError);
  });

  it("reuses the prepared model across frames faster than re-scanning", async () => {
    const source = readFileSync(KKT_FIXTURE_PATH, "utf8");
    const frameIndexes = [1, 3, 5, 7];

    // Warm shared module-level state (fonts, metrics) before timing.
    await renderBeamerFrame(source, { frameIndex: frameIndexes[0] });

    const oneShotStart = performance.now();
    for (const frameIndex of frameIndexes) {
      await renderBeamerFrame(source, { frameIndex });
    }
    const oneShotMs = performance.now() - oneShotStart;

    const prepared = prepareBeamerDocument(source);
    const preparedStart = performance.now();
    for (const frameIndex of frameIndexes) {
      await prepared.renderFrame({ frameIndex });
    }
    const preparedMs = performance.now() - preparedStart;

    // The prepared path skips scan/theme/macro/navigation/theorem passes.
    // Assert a loose bound so the test stays robust on slow CI machines.
    expect(preparedMs).toBeLessThan(oneShotMs * 1.1);
  });
});

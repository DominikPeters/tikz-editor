import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { expect, test } from "@playwright/test";

let bundle: string;
const root = path.resolve(import.meta.dirname, "../../..");
test.beforeAll(async () => {
  const baseline = process.env.TIKZ_EXPORT_BASELINE_ROOT;
  const result = await build({
    stdin: { contents: `export {renderPngExport} from "./packages/app/src/ui/export-commands";
      export {prepareSvgForPdf} from "./packages/app/src/ui/pdf-svg-preparation";`, resolveDir: root },
    bundle: true, write: false, platform: "browser", format: "iife", globalName: "ExportMemory",
    alias: { "@tikz-editor/core": path.join(root, "packages/core/src") },
    plugins: baseline ? [{ name: "baseline-export", setup(build) {
      // esbuild passes filters to Go's regexp engine, which has no /u flag.
      build.onLoad({ filter: /\/ui\/(export-commands|pdf-svg-preparation)\.ts$/ }, args => ({
        contents: readFileSync(path.join(baseline, path.basename(args.path)), "utf8"), loader: "ts"
      }));
    } }] : []
  });
  bundle = result.outputFiles[0].text;
});

for (const mode of ["png", "pdf-effects"] as const) test(`scratch surfaces after repeated ${mode} export`, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setContent("<!doctype html><body></body>");
  await page.addScriptTag({ content: bundle });
  const report = await page.evaluate(async mode => {
    type ExportApi = { renderPngExport: (svg: unknown, options: { dpi: number }) => Promise<{ blob: Blob; pixelWidth: number; pixelHeight: number }>;
      prepareSvgForPdf: (svg: SVGSVGElement) => Promise<void> };
    const api = (globalThis as unknown as { ExportMemory: ExportApi }).ExportMemory;
    const canvases: HTMLCanvasElement[] = [];
    const createElement = document.createElement.bind(document);
    // Deliberately keep wrappers alive to measure whether scratch surfaces are
    // explicitly released. This is a lifecycle probe, not a post-GC leak claim.
    document.createElement = (...args: Parameters<typeof document.createElement>) => {
      const element = createElement(...args);
      if (element instanceof HTMLCanvasElement) canvases.push(element);
      return element;
    };
    const svg = { viewBox: { x: 0, y: 0, width: 512, height: 512 }, svg: "", diagnostics: [],
      model: { viewBox: { x: 0, y: 0, width: 512, height: 512 }, defs: [], defsFingerprint: "", diagnostics: [],
        parts: [{ partId: "rectangle", sourceId: "rectangle", elementId: null, order: 0, fingerprint: "rect",
          markup: '<rect width="512" height="512" fill="blue"/>' }] } };
    const iterations = mode === "png" ? 12 : 6;
    let outputBytes = 0;
    const started = performance.now();
    try {
      for (let index = 0; index < iterations; index++) {
        if (mode === "png") {
          const result = await api.renderPngExport(svg, { dpi: 288 });
          if (result.pixelWidth !== 2048 || result.pixelHeight !== 2048) throw new Error("Incorrect encoded dimensions");
          outputBytes += result.blob.size;
        } else {
          const element = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><mask id="m"><rect width="512" height="512" fill="white"/></mask></defs><g mask="url(#m)"><rect width="512" height="512" fill="blue"/></g></svg>', "image/svg+xml").documentElement as unknown as SVGSVGElement;
          await api.prepareSvgForPdf(element);
          outputBytes += element.querySelector("image")?.getAttribute("href")?.length ?? 0;
        }
      }
      return { mode, iterations, durationMs: performance.now() - started, outputBytes, canvasCount: canvases.length,
        remainingScratchSurfaceBytes: canvases.reduce((sum, canvas) => sum + canvas.width * canvas.height * 4, 0),
        scope: "Actual browser rasterization; canvas wrappers deliberately retained to verify prompt surface release, not GC peak/RSS" };
    } finally {
      document.createElement = createElement;
      for (const canvas of canvases) { canvas.width = 0; canvas.height = 0; }
    }
  }, mode);
  const traces = path.join(root, "apps/web/profiling/traces");
  mkdirSync(traces, { recursive: true });
  const reportPath = path.join(traces, `memory-export-${mode}${process.env.TIKZ_EXPORT_BASELINE_ROOT ? "-baseline" : ""}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  await testInfo.attach("export-memory", { path: reportPath, contentType: "application/json" });
  console.log(`[memory-export] ${JSON.stringify(report)}`);
  expect(report.outputBytes).toBeGreaterThan(0);
  if (!process.env.TIKZ_EXPORT_BASELINE_ROOT) expect(report.remainingScratchSurfaceBytes).toBe(0);
});

import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

let bundle: string;

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: 'export {prepareSvgForPdf} from "./packages/app/src/ui/pdf-svg-preparation";',
      resolveDir: path.resolve(import.meta.dirname, "../../.."),
    },
    bundle: true, write: false, platform: "browser", format: "iife", globalName: "PdfFidelity",
  });
  bundle = result.outputFiles[0].text;
});

test.beforeEach(async ({ page }) => {
  await page.setContent("<!doctype html><body></body>");
  await page.addScriptTag({ content: bundle });
});

async function prepareAndCompare(page: Page, markup: string) {
  return page.evaluate(async (markup) => {
    async function pixels(svg: string) {
      const image = new Image();
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      try {
        await new Promise<void>((resolve, reject) => {
          image.onload = () => { resolve(); };
          image.onerror = () => { reject(new Error("Invalid fixture SVG")); };
          image.src = url;
        });
        const canvas = document.createElement("canvas");
        canvas.width = 240; canvas.height = 160;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      } finally { URL.revokeObjectURL(url); }
    }
    const svg = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement as unknown as SVGSVGElement;
    const before = await pixels(markup);
    const vector = svg.querySelector("#vector")?.cloneNode(true);
    await (globalThis as unknown as { PdfFidelity: { prepareSvgForPdf(svg: SVGSVGElement): Promise<void> } }).PdfFidelity.prepareSvgForPdf(svg);
    const prepared = new XMLSerializer().serializeToString(svg);
    const after = await pixels(prepared);
    let difference = 0, changed = 0;
    for (let i = 0; i < before.length; i++) {
      difference += Math.abs(before[i] - after[i]);
      if (before[i] !== after[i]) changed++;
    }
    return { meanDifference: difference / before.length, changed,
      imageCount: svg.querySelectorAll("image").length,
      vectorUnchanged: vector?.isEqualNode(svg.querySelector("#vector")) ?? true,
      connected: svg.isConnected, temporaryHosts: document.body.querySelectorAll("div").length,
      prepared };
  }, markup);
}

for (const [x, y, transform] of [[-4, -4, "rotate(-30)"], [3, 5, "translate(8 3) rotate(25)"], [-6, 2, "matrix(1 .2 .3 1 4 -2)"], [0, 0, ""]] as const) {
  test(`PDF tile normalization preserves phase at ${x},${y} with ${transform || "identity"}`, async ({ page }) => {
    const result = await prepareAndCompare(page, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><defs><pattern id="p" patternUnits="userSpaceOnUse" x="${x}" y="${y}" width="12" height="10" patternTransform="${transform}"><path d="M0 5L12 5" stroke="black" stroke-width="2"/></pattern></defs><rect width="120" height="80" fill="url(#p)"/></svg>`);
    expect(result.changed).toBe(0);
    expect(result.imageCount).toBe(0);
  });
}

for (const [name, content] of [
  ["transformed group and inherited opacity", '<g transform="translate(22 8) rotate(12)" opacity=".4"><g mask="url(#m)"><rect width="60" height="50" fill="red"/></g></g>'],
  ["nested masks", '<g mask="url(#m)"><g mask="url(#m)"><rect width="60" height="50" fill="red"/></g></g>'],
  ["filter", '<g filter="url(#f)"><rect x="12" y="10" width="40" height="32" fill="red"/></g>'],
] as const) {
  test(`PDF fallback preserves ${name} while retaining unrelated vectors`, async ({ page }) => {
    const result = await prepareAndCompare(page, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><defs><mask id="m" maskUnits="userSpaceOnUse"><circle cx="30" cy="25" r="20" fill="white"/></mask><filter id="f"><feGaussianBlur stdDeviation="2"/></filter></defs>${content}<path id="vector" d="M80 10H110V50H80Z" fill="blue"/></svg>`);
    expect(result.imageCount).toBe(1);
    expect(result.vectorUnchanged).toBe(true);
    expect(result.meanDifference).toBeLessThan(2);
    expect(result.connected).toBe(false);
    expect(result.temporaryHosts).toBe(0);
  });
}

test("PDF fallback handles a nonzero viewBox with root opacity", async ({ page }) => {
  const result = await prepareAndCompare(page, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 120 80" opacity=".6"><defs><mask id="m" maskUnits="userSpaceOnUse"><circle cx="45" cy="50" r="25" fill="white"/></mask></defs><g mask="url(#m)"><rect x="10" y="20" width="120" height="80" fill="red"/></g></svg>');
  expect(result.imageCount).toBe(1);
  expect(result.meanDifference).toBeLessThan(2);
  expect(result.connected).toBe(false);
  expect(result.temporaryHosts).toBe(0);
});

for (const attributes of ['filter="blur(2px)"', 'style="filter:blur(2px)"', 'style="mask-image:url(#m)"']) {
  test(`PDF preparation rejects unsupported root effects (${attributes}) and cleans up`, async ({ page }) => {
    const result = await page.evaluate(async (attributes) => {
      const svg = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" ${attributes}><defs><mask id="m"><rect width="100" height="100" fill="white"/></mask></defs><rect width="100" height="100"/></svg>`, "image/svg+xml").documentElement as unknown as SVGSVGElement;
      let message = "";
      try {
        await (globalThis as unknown as { PdfFidelity: { prepareSvgForPdf(svg: SVGSVGElement): Promise<void> } }).PdfFidelity.prepareSvgForPdf(svg);
      } catch (error) { message = error instanceof Error ? error.message : String(error); }
      return { message, connected: svg.isConnected, hosts: document.body.querySelectorAll("div").length };
    }, attributes);
    expect(result.message).toContain("root SVG");
    expect(result.connected).toBe(false);
    expect(result.hosts).toBe(0);
  });
}

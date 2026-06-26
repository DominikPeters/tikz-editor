import { expect, test, type Page } from "@playwright/test";
import {
  expectSourceCanvasConsistency,
  gotoApp,
  readCanvasTransform,
  readFigureCount,
  resetStorageBeforeNavigation,
  setSource,
  tabSwitchButtons
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

async function disableFitModeByZoom(page: Page): Promise<void> {
  await expect(page.getByTestId("canvas-viewport")).toBeVisible();
  const before = await readCanvasTransform(page);
  await page.evaluate(() => {
    const viewport = document.querySelector("[data-testid='canvas-viewport']");
    if (!(viewport instanceof HTMLElement)) {
      throw new Error("Canvas viewport not found.");
    }
    const rect = viewport.getBoundingClientRect();
    viewport.dispatchEvent(new WheelEvent("wheel", {
      deltaY: -120,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    }));
  });
  await expect.poll(async () => {
    const after = await readCanvasTransform(page);
    return Math.abs(after.scale - before.scale) > 0.0001;
  }, {
    timeout: 2_000,
    intervals: [50, 100, 200]
  }).toBe(true);
}

async function settleCanvasTransform(
  page: Page,
  requested: { translateX: number; translateY: number; scale: number }
): Promise<{ translateX: number; translateY: number; scale: number }> {
  await expect.poll(async () => {
    await page.evaluate((nextTransform) => {
      const api = (globalThis as unknown as {
        __TIKZ_EDITOR_APP_TEST_API__?: {
          setCanvasTransform?: (transform: { translateX: number; translateY: number; scale: number }) => void;
        };
      }).__TIKZ_EDITOR_APP_TEST_API__;
      if (typeof api?.setCanvasTransform !== "function") {
        throw new Error("App test API setCanvasTransform is unavailable.");
      }
      api.setCanvasTransform(nextTransform);
    }, requested);
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    }));
    const transform = await readCanvasTransform(page);
    return (
      Math.abs(transform.translateX - requested.translateX) < 0.05 &&
      Math.abs(transform.translateY - requested.translateY) < 0.05 &&
      Math.abs(transform.scale - requested.scale) < 0.005
    );
  }, {
    timeout: 8_000,
    intervals: [50, 100, 200, 400]
  }).toBe(true);
  return await readCanvasTransform(page);
}

function figuresSource(count: number, label: string): string {
  return Array.from({ length: count }, (_, index) => String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {${label} ${index + 1}};
\end{tikzpicture}`).join("\n");
}

test("viewport is remembered per figure and first visit auto-fits", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \draw (-0.5,-0.5) rectangle (0.5,0.5);
\end{tikzpicture}
\begin{tikzpicture}
  \draw (-8,-5) rectangle (8,5);
\end{tikzpicture}
`);

  await expect.poll(async () => readFigureCount(page)).toBe(2);
  await expect(page.getByTestId("figure-navigator")).toBeVisible();

  await disableFitModeByZoom(page);
  const figure1Transform = await settleCanvasTransform(page, { translateX: 130, translateY: 70, scale: 1.8 });

  await page.getByRole("button", { name: "Figure 2" }).click();
  await expectSourceCanvasConsistency(page, { assertNoPendingRequest: true });

  await expect.poll(async () => {
    const transform = await readCanvasTransform(page);
    const sameX = Math.abs(transform.translateX - figure1Transform.translateX) < 0.05;
    const sameY = Math.abs(transform.translateY - figure1Transform.translateY) < 0.05;
    const sameScale = Math.abs(transform.scale - figure1Transform.scale) < 0.005;
    return !(sameX && sameY && sameScale);
  }, {
    timeout: 8_000,
    intervals: [50, 100, 200, 400]
  }).toBe(true);

  await disableFitModeByZoom(page);
  const figure2Transform = await settleCanvasTransform(page, { translateX: 25, translateY: 48, scale: 0.82 });

  await page.getByRole("button", { name: "Figure 1" }).click();
  await expectSourceCanvasConsistency(page, { assertNoPendingRequest: true });
  await expect.poll(async () => {
    const transform = await readCanvasTransform(page);
    return (
      Math.abs(transform.translateX - figure1Transform.translateX) < 0.05 &&
      Math.abs(transform.translateY - figure1Transform.translateY) < 0.05 &&
      Math.abs(transform.scale - figure1Transform.scale) < 0.005
    );
  }, {
    timeout: 8_000,
    intervals: [50, 100, 200, 400]
  }).toBe(true);

  await page.getByRole("button", { name: "Figure 2" }).click();
  await expectSourceCanvasConsistency(page, { assertNoPendingRequest: true });
  await expect.poll(async () => {
    const transform = await readCanvasTransform(page);
    return (
      Math.abs(transform.translateX - figure2Transform.translateX) < 0.05 &&
      Math.abs(transform.translateY - figure2Transform.translateY) < 0.05 &&
      Math.abs(transform.scale - figure2Transform.scale) < 0.005
    );
  }, {
    timeout: 8_000,
    intervals: [50, 100, 200, 400]
  }).toBe(true);
});

test("carousel remembers scroll position per document across tab switches", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, figuresSource(14, "Doc A"));
  await expect.poll(async () => readFigureCount(page)).toBe(14);
  await expect(page.getByTestId("figure-navigator")).toBeVisible();
  await expect.poll(async () => page.getByTestId("figure-navigator").getByRole("button").count()).toBeGreaterThan(5);

  const docAScroll = await page.evaluate(() => {
    const strip = document.querySelector("[data-testid='figure-navigator-strip']");
    if (!(strip instanceof HTMLElement)) {
      throw new Error("Figure navigator strip not found.");
    }
    strip.scrollLeft = 900;
    strip.dispatchEvent(new Event("scroll", { bubbles: true }));
    return strip.scrollLeft;
  });
  expect(docAScroll).toBeGreaterThan(0);

  await page.getByTestId("tab-new").click();
  await setSource(page, figuresSource(12, "Doc B"));
  await expect.poll(async () => readFigureCount(page)).toBe(12);
  await expect(page.getByTestId("figure-navigator")).toBeVisible();
  await expect.poll(async () => page.getByTestId("figure-navigator").getByRole("button").count()).toBeGreaterThan(5);

  const docBScroll = await page.evaluate(() => {
    const strip = document.querySelector("[data-testid='figure-navigator-strip']");
    if (!(strip instanceof HTMLElement)) {
      throw new Error("Figure navigator strip not found.");
    }
    strip.scrollLeft = 320;
    strip.dispatchEvent(new Event("scroll", { bubbles: true }));
    return strip.scrollLeft;
  });
  expect(docBScroll).toBeGreaterThan(0);

  await expect(tabSwitchButtons(page)).toHaveCount(2);
  await tabSwitchButtons(page).nth(0).click();
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const strip = document.querySelector("[data-testid='figure-navigator-strip']");
      return strip instanceof HTMLElement ? strip.scrollLeft : -1;
    });
  }).toBeGreaterThan(docAScroll - 10);

  await tabSwitchButtons(page).nth(1).click();
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const strip = document.querySelector("[data-testid='figure-navigator-strip']");
      return strip instanceof HTMLElement ? strip.scrollLeft : -1;
    });
  }).toBeGreaterThan(docBScroll - 10);
});

test("switching documents clears old thumbnails immediately", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {DocA-1};
\end{tikzpicture}
\begin{tikzpicture}
  \node[draw] at (0,0) {$x^2 + y^2$};
\end{tikzpicture}
`);
  await expect.poll(async () => readFigureCount(page)).toBe(2);
  await expect(page.getByTestId("figure-navigator")).toBeVisible();
  await expect.poll(
    async () => page.getByTestId("figure-navigator").locator("img").count(),
    { timeout: 20_000 }
  ).toBeGreaterThan(0);

  const firstDocThumbnailSrc = await page.getByTestId("figure-navigator").locator("img").first().getAttribute("src");
  expect(firstDocThumbnailSrc).toBeTruthy();

  await page.getByTestId("tab-new").click();
  await setSource(page, figuresSource(10, "Doc B thumb"));
  await expect.poll(async () => readFigureCount(page)).toBe(10);

  const hasOldThumbnail = await page.evaluate((oldSrc) => {
    const images = Array.from(document.querySelectorAll("[data-testid='figure-navigator'] img"));
    return images.some((image) => image.getAttribute("src") === oldSrc);
  }, firstDocThumbnailSrc);
  expect(hasOldThumbnail).toBe(false);

  await expect.poll(
    async () => page.getByTestId("figure-navigator").locator("img").count(),
    { timeout: 20_000 }
  ).toBeGreaterThan(0);
});

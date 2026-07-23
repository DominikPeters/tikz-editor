import { expect, test } from "@playwright/test";
import { gotoApp, readFigureCount, resetStorageBeforeNavigation, setSource } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

test("figure thumbnails render math text through worker pipeline", async ({ page }) => {
  await page.addInitScript(() => {
    const originalWorker = window.Worker;
    const workerPosts: string[] = [];
    class SpyWorker extends originalWorker {
      postMessage(message: unknown, transfer?: Transferable[]): void {
        const type = (message as { type?: unknown } | null)?.type;
        workerPosts.push(typeof type === "string" ? type : "unknown");
        super.postMessage(message, transfer ?? []);
      }
    }
    Object.defineProperty(window, "Worker", {
      configurable: true,
      writable: true,
      value: SpyWorker
    });
    (globalThis as { __PW_THUMB_WORKER_POSTS__?: string[] }).__PW_THUMB_WORKER_POSTS__ = workerPosts;
  });

  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \node at (0,0) {Plain};
\end{tikzpicture}
\begin{tikzpicture}
  \node at (0,0) {$x$};
\end{tikzpicture}
`);

  await expect.poll(async () => readFigureCount(page)).toBe(2);
  await expect(page.getByTestId("figure-navigator")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Figure 2" }).locator("img"),
    "the math figure thumbnail should eventually render even under suite-wide load"
  ).toHaveCount(1, { timeout: 45_000 });

  await expect.poll(async () => {
    return await page.evaluate(() => {
      const images = Array.from(document.querySelectorAll("[data-testid='figure-navigator'] img"));
      return images.some((img) => {
        const src = img.getAttribute("src") ?? "";
        if (!src.includes(",")) {
          return false;
        }
        const payload = decodeURIComponent(src.slice(src.indexOf(",") + 1));
        return payload.includes('data-text-renderer="tex"');
      });
    });
  }).toBe(true);

  await expect.poll(async () => {
    return await page.evaluate(() => {
      const posts = (globalThis as { __PW_THUMB_WORKER_POSTS__?: string[] }).__PW_THUMB_WORKER_POSTS__ ?? [];
      return posts.includes("render");
    });
  }).toBe(true);
});

test("figure thumbnails lazy-load by horizontal scroll position", async ({ page }) => {
  await page.addInitScript(() => {
    const originalWorker = window.Worker;
    const workerPosts: string[] = [];
    class SpyWorker extends originalWorker {
      postMessage(message: unknown, transfer?: Transferable[]): void {
        const type = (message as { type?: unknown } | null)?.type;
        workerPosts.push(typeof type === "string" ? type : "unknown");
        super.postMessage(message, transfer ?? []);
      }
    }
    Object.defineProperty(window, "Worker", {
      configurable: true,
      writable: true,
      value: SpyWorker
    });
    (globalThis as { __PW_THUMB_WORKER_POSTS__?: string[] }).__PW_THUMB_WORKER_POSTS__ = workerPosts;
  });

  await gotoApp(page);
  const figures = Array.from({ length: 14 }, (_, index) => String.raw`\begin{tikzpicture}
  \node at (0,0) {Figure ${index + 1}};
\end{tikzpicture}`).join("\n");
  await setSource(page, figures);

  await expect.poll(async () => readFigureCount(page)).toBe(14);
  const navigator = page.getByTestId("figure-navigator");
  await expect(navigator).toBeVisible();

  await expect.poll(async () => {
    return await page.evaluate(() => {
      const posts = (globalThis as { __PW_THUMB_WORKER_POSTS__?: string[] }).__PW_THUMB_WORKER_POSTS__ ?? [];
      return posts.filter((type) => type === "render").length;
    });
  }).toBeGreaterThan(0);

  const initialRenderPosts = await page.evaluate(() => {
    const posts = (globalThis as { __PW_THUMB_WORKER_POSTS__?: string[] }).__PW_THUMB_WORKER_POSTS__ ?? [];
    return posts.filter((type) => type === "render").length;
  });
  expect(initialRenderPosts).toBeGreaterThan(0);

  const lastFigureButton = navigator.getByRole("button", { name: "Figure 14" });
  await lastFigureButton.scrollIntoViewIfNeeded();
  await lastFigureButton.click();

  await expect.poll(async () => {
    return await page.evaluate(() => {
      const posts = (globalThis as { __PW_THUMB_WORKER_POSTS__?: string[] }).__PW_THUMB_WORKER_POSTS__ ?? [];
      return posts.filter((type) => type === "render").length;
    });
  }).toBeGreaterThan(initialRenderPosts);
});

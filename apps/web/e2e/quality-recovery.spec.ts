import { expect, test } from "@playwright/test";
import { gotoApp, openMenuCommand, readStoreSource, setSource, tabSwitchButtons } from "./helpers";

const SOURCE = String.raw`\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}`;

test("denied storage still permits editor startup and settings", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { configurable: true, get() {
      throw new DOMException("Storage disabled", "SecurityError");
    } });
  });
  await gotoApp(page);
  await setSource(page, SOURCE);
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
  await openMenuCommand(page, "file", "file.open-settings");
  await page.getByTestId("settings-category-canvas").click();
  await expect(page.locator("#setting-grid-size")).toBeVisible();
});

test("malformed layout and settings recover without hiding source", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("tikz-editor:dock-layout", JSON.stringify({ layout: { type: "row", children: "invalid" } }));
    localStorage.setItem("tikz-editor:settings", JSON.stringify({ settingsVersion: 1, settings: {
      general: { colorScheme: "invalid", uiFontSizePx: "huge" }, canvas: { gridSize: "invalid", zoomSpeed: null }
    } }));
  });
  await gotoApp(page);
  await expect(page.locator(".cm-content").first()).toBeVisible();
  await setSource(page, SOURCE);
  await openMenuCommand(page, "file", "file.open-settings");
  await page.getByTestId("settings-category-canvas").click();
  await expect(page.locator("#setting-grid-size")).toHaveValue("standard");
  await expect(page.locator("#setting-zoom-speed")).toBeVisible();
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
  const recovered = await page.evaluate(() => JSON.parse(localStorage.getItem("tikz-editor:dock-layout")!));
  expect(Array.isArray(recovered.layout.children)).toBe(true);
});

test("partial persisted tab order retains every document across a save", async ({ page }) => {
  await page.addInitScript((source) => {
    if (window.name.includes("quality-seeded")) return;
    window.name += "quality-seeded";
    localStorage.setItem("tikz-editor:workspace", JSON.stringify({ workspaceVersion: 4,
      documents: [{ id: "a", title: "First", source, savedSource: "" },
        { id: "b", title: "Recovered", source: source + "\n% second recovery", savedSource: "" }],
      tabOrder: ["a"], activeDocumentId: "a", recentDocumentIds: ["a"]
    }));
  }, SOURCE);
  await gotoApp(page);
  await expect(tabSwitchButtons(page)).toHaveCount(2);
  await setSource(page, SOURCE + "\n% newer first");
  await expect.poll(async () => page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("tikz-editor:workspace")!);
    return stored.documents.map((document: { id: string }) => document.id);
  })).toEqual(["a", "b"]);
  await page.reload();
  await expect(tabSwitchButtons(page)).toHaveCount(2);
  await page.getByTestId("tab-switch-b").click();
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE + "\n% second recovery");
});

test("returning to system theme samples the current OS preference", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await gotoApp(page);
  await openMenuCommand(page, "file", "file.open-settings");
  await page.selectOption("#setting-color-scheme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light");
  await page.selectOption("#setting-color-scheme", "system");
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark");
});

test("cancelled supported file picker does not open a fallback picker", async ({ page }) => {
  await page.addInitScript(() => {
    const state = { opens: 0, fallbackClicks: 0 };
    (window as typeof window & { __qualityPicker?: typeof state }).__qualityPicker = state;
    Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: async () => {
      state.opens += 1;
      throw new DOMException("Cancelled", "AbortError");
    } });
    const click = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function() {
      if (this.type === "file") state.fallbackClicks += 1;
      else click.call(this);
    };
  });
  await gotoApp(page);
  await setSource(page, SOURCE);
  await openMenuCommand(page, "file", "file.open-document");
  await expect.poll(() => page.evaluate(() => (window as typeof window & {
    __qualityPicker?: { opens: number; fallbackClicks: number }
  }).__qualityPicker)).toEqual({ opens: 1, fallbackClicks: 0 });
  await expect(page.locator("input[type=file]")).toHaveCount(0);
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
});

import { expect, test, type Page } from "@playwright/test";
import { gotoApp, resetStorageBeforeNavigation } from "./helpers";

// Alt, F10 and Alt+letter reach the in-app menu bar on Windows and Linux, as
// in a native menu bar. The browser runs on a Mac here, so it claims Windows.
test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "Win32" });
    Object.defineProperty(navigator, "userAgentData", { get: () => ({ platform: "Windows" }) });
  });
});

function focusedTestId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
}

function trigger(page: Page, section: string) {
  return page.getByTestId(`menu-section-${section}`);
}

test("F10 focuses the menu bar, arrows move along it and Escape gives focus back", async ({ page }) => {
  await gotoApp(page);
  await page.locator(".cm-content").first().click();

  await page.keyboard.press("F10");
  await expect.poll(() => focusedTestId(page)).toBe("menu-section-file");
  await expect(page.getByTestId("app-menubar")).toHaveAttribute("data-access-keys", "true");

  await page.keyboard.press("ArrowRight");
  await expect.poll(() => focusedTestId(page)).toBe("menu-section-edit");

  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains("cm-content") ?? false)).toBe(true);
  await expect(page.getByTestId("app-menubar")).not.toHaveAttribute("data-access-keys");
});

test("Alt on its own focuses the menu bar, and Alt+letter opens a menu", async ({ page }) => {
  await gotoApp(page);

  await page.keyboard.press("Alt");
  await expect.poll(() => focusedTestId(page)).toBe("menu-section-file");
  await page.keyboard.press("Alt");
  await expect.poll(() => focusedTestId(page)).not.toBe("menu-section-file");

  await page.keyboard.press("Alt+e");
  await expect(trigger(page, "edit")).toHaveAttribute("aria-expanded", "true");
  const first = await focusedTestId(page);
  expect(first).toMatch(/^menu-cmd-/u);

  await page.keyboard.press("ArrowDown");
  await expect.poll(() => focusedTestId(page)).not.toBe(first);

  // Right moves to the next menu, Escape closes it and leaves the bar focused.
  await page.keyboard.press("ArrowRight");
  await expect(trigger(page, "path")).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(trigger(page, "path")).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => focusedTestId(page)).toBe("menu-section-path");
});

test("a letter in an open menu opens its submenu, and Left closes it again", async ({ page }) => {
  await gotoApp(page);

  await page.keyboard.press("Alt+v");
  await expect(trigger(page, "view")).toHaveAttribute("aria-expanded", "true");
  const snapping = page.locator('[data-menu-popup="view"] [data-submenu]').filter({ hasText: "Snapping" });
  const key = await snapping.getAttribute("data-access-key");
  expect(key).toMatch(/^[a-z]$/u);

  await page.keyboard.press(key ?? "");
  await expect(snapping).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => focusedTestId(page)).toMatch(/^menu-cmd-/u);

  await page.keyboard.press("ArrowLeft");
  await expect(snapping).toHaveAttribute("aria-expanded", "false");
  await expect(snapping).toBeFocused();
});

test("Enter on a menu item runs it and closes the menu", async ({ page }) => {
  await gotoApp(page);
  const tabs = page.getByTestId("tab-strip").getByRole("tab");
  const before = await tabs.count();

  await page.keyboard.press("Alt+f");
  await expect(page.getByTestId("menu-cmd-file.new-document")).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(trigger(page, "file")).toHaveAttribute("aria-expanded", "false");
  await expect(tabs).toHaveCount(before + 1);
});

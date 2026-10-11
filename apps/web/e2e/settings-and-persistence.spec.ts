import { expect, test } from "@playwright/test";
import { gotoApp, openMenuCommand, resetStorageBeforeNavigation } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

test("settings modal opens and category navigation works", async ({ page }) => {
  await gotoApp(page);
  await openMenuCommand(page, "file", "file.open-settings");

  await expect(page.getByTestId("settings-modal")).toBeVisible();
  await expect(page.getByTestId("settings-category-general")).toBeVisible();
  await expect(page.getByTestId("settings-category-editor")).toBeVisible();
  await expect(page.getByTestId("settings-category-canvas")).toBeVisible();

  await page.getByTestId("settings-category-editor").click();
  await expect(page.locator("#setting-word-wrap")).toBeVisible();

  await page.getByTestId("settings-category-canvas").click();
  await expect(page.locator("#setting-grid-size")).toBeVisible();

  await page.getByTestId("settings-modal").getByRole("button", { name: "Close settings" }).click();
  await expect(page.getByTestId("settings-modal")).toHaveCount(0);
});

test("settings persist across reload and formatter line length is clamped", async ({ page }) => {
  await gotoApp(page);
  await openMenuCommand(page, "file", "file.open-settings");

  await page.selectOption("#setting-ui-font-size", "14");
  await page.selectOption("#setting-color-scheme", "dark");
  await page.getByTestId("settings-category-editor").click();
  await page.click("#setting-word-wrap");
  await page.selectOption("#setting-font-size", "16");

  await page.fill("#setting-formatter-max-line-length", "999");
  await page.locator("#setting-formatter-max-line-length").blur();
  await expect(page.locator("#setting-formatter-max-line-length")).toHaveValue("240");

  await page.getByTestId("settings-category-canvas").click();
  await page.selectOption("#setting-grid-size", "coarse");
  await page.selectOption("#setting-handle-size", "11");

  await page.getByTestId("settings-modal").getByRole("button", { name: "Close settings" }).click();
  await page.reload();

  await openMenuCommand(page, "file", "file.open-settings");
  await expect(page.locator("#setting-ui-font-size")).toHaveValue("14");
  await expect(page.locator("#setting-color-scheme")).toHaveValue("dark");
  await page.getByTestId("settings-category-editor").click();
  await expect(page.locator("#setting-word-wrap")).not.toBeChecked();
  await expect(page.locator("#setting-font-size")).toHaveValue("16");
  await expect(page.locator("#setting-formatter-max-line-length")).toHaveValue("240");

  await page.getByTestId("settings-category-canvas").click();
  await expect(page.locator("#setting-grid-size")).toHaveValue("coarse");
  await expect(page.locator("#setting-handle-size")).toHaveValue("11");
});

test("codemirror mod plus and minus adjust editor font size", async ({ page }) => {
  await gotoApp(page);

  const scroller = page.locator(".cm-scroller").first();
  await expect(scroller).toHaveCSS("font-size", "12px");

  await page.locator(".cm-content").first().click();
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${modifier}+Shift+=`);
  await expect(scroller).toHaveCSS("font-size", "13px");

  await page.keyboard.press(`${modifier}+-`);
  await expect(scroller).toHaveCSS("font-size", "12px");

  await openMenuCommand(page, "file", "file.open-settings");
  await page.getByTestId("settings-category-editor").click();
  await page.selectOption("#setting-font-size", "16");
  await page.getByTestId("settings-modal").getByRole("button", { name: "Close settings" }).click();
  await expect(scroller).toHaveCSS("font-size", "16px");

  await page.locator(".cm-content").first().click();
  await page.keyboard.press(`${modifier}+Shift+=`);
  await expect(scroller).toHaveCSS("font-size", "17px");

  await openMenuCommand(page, "file", "file.open-settings");
  await page.getByTestId("settings-category-editor").click();
  await expect(page.locator("#setting-font-size")).toHaveValue("17");
});

test("settings reset buttons restore defaults for the active page only", async ({ page }) => {
  await gotoApp(page);
  await openMenuCommand(page, "file", "file.open-settings");

  await page.selectOption("#setting-ui-font-size", "14");
  await page.selectOption("#setting-color-scheme", "dark");
  await page.getByTestId("settings-category-editor").click();
  await page.click("#setting-word-wrap");
  await page.selectOption("#setting-font-size", "16");
  await page.getByTestId("settings-category-canvas").click();
  await page.selectOption("#setting-grid-size", "coarse");
  await page.selectOption("#setting-handle-size", "11");

  await page.getByTestId("settings-reset-canvas").click();
  await expect(page.locator("#setting-grid-size")).toHaveValue("standard");
  await expect(page.locator("#setting-handle-size")).toHaveValue("9");

  await page.getByTestId("settings-category-editor").click();
  await expect(page.locator("#setting-word-wrap")).not.toBeChecked();
  await expect(page.locator("#setting-font-size")).toHaveValue("16");
  await page.getByTestId("settings-reset-editor").click();
  await expect(page.locator("#setting-word-wrap")).toBeChecked();
  await expect(page.locator("#setting-font-size")).toHaveValue("12");

  await page.getByTestId("settings-category-general").click();
  await expect(page.locator("#setting-ui-font-size")).toHaveValue("14");
  await expect(page.locator("#setting-color-scheme")).toHaveValue("dark");
  await page.getByTestId("settings-reset-general").click();
  await expect(page.locator("#setting-ui-font-size")).toHaveValue("11");
  await expect(page.locator("#setting-color-scheme")).toHaveValue("system");
});

test("settings modal controls follow dark theme colors", async ({ page }) => {
  await gotoApp(page);
  await openMenuCommand(page, "file", "file.open-settings");
  await page.selectOption("#setting-color-scheme", "dark");

  const expectedThemeColors = await page.evaluate(() => {
    const probe = document.createElement("div");
    document.body.appendChild(probe);

    probe.style.backgroundColor = "var(--bg-pane)";
    const paneBackground = getComputedStyle(probe).backgroundColor;

    probe.style.color = "var(--text)";
    const textColor = getComputedStyle(probe).color;

    probe.style.borderColor = "var(--border)";
    const borderColor = getComputedStyle(probe).borderColor;

    probe.style.backgroundColor = "var(--scrollbar-track)";
    const scrollbarTrack = getComputedStyle(probe).backgroundColor;

    probe.style.backgroundColor = "var(--scrollbar-thumb)";
    const scrollbarThumb = getComputedStyle(probe).backgroundColor;

    document.body.removeChild(probe);
    return { paneBackground, textColor, borderColor, scrollbarTrack, scrollbarThumb };
  });

  const generalSelectStyles = await page.locator("#setting-color-scheme").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      borderColor: style.borderColor
    };
  });

  expect(generalSelectStyles.backgroundColor).toBe(expectedThemeColors.paneBackground);
  expect(generalSelectStyles.color).toBe(expectedThemeColors.textColor);
  expect(generalSelectStyles.borderColor).toBe(expectedThemeColors.borderColor);

  await page.getByTestId("settings-category-editor").click();

  const numberInputStyles = await page.locator("#setting-formatter-max-line-length").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      borderColor: style.borderColor
    };
  });

  expect(numberInputStyles.backgroundColor).toBe(expectedThemeColors.paneBackground);
  expect(numberInputStyles.color).toBe(expectedThemeColors.textColor);
  expect(numberInputStyles.borderColor).toBe(expectedThemeColors.borderColor);

  const rootScrollbarStyles = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      colorScheme: style.colorScheme,
      scrollbarColor: style.scrollbarColor,
      supportsScrollbarColor: CSS.supports("scrollbar-color", "red blue")
    };
  });

  expect(rootScrollbarStyles.colorScheme).toBe("dark");
  if (rootScrollbarStyles.supportsScrollbarColor) {
    expect(rootScrollbarStyles.scrollbarColor).toBe(
      `${expectedThemeColors.scrollbarThumb} ${expectedThemeColors.scrollbarTrack}`
    );
  }
});

test("codemirror search controls follow dark theme colors", async ({ page }) => {
  await gotoApp(page);
  await openMenuCommand(page, "file", "file.open-settings");
  await page.selectOption("#setting-color-scheme", "dark");
  await page.getByTestId("settings-modal").getByRole("button", { name: "Close settings" }).click();

  await page.locator(".cm-content").first().click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+F" : "Control+F");

  const searchPanel = page.locator(".cm-panel.cm-search");
  await expect(searchPanel).toBeVisible();

  const searchInputStyles = await searchPanel.locator("input[name='search']").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      borderColor: style.borderColor,
      colorScheme: style.colorScheme
    };
  });

  expect(searchInputStyles.backgroundColor).toBe("rgb(37, 37, 37)");
  expect(searchInputStyles.color).toBe("rgb(212, 212, 212)");
  expect(searchInputStyles.borderColor).toBe("rgb(86, 86, 86)");
  expect(searchInputStyles.colorScheme).toBe("dark");

  const nextButtonStyles = await searchPanel.locator("button[name='next']").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      borderColor: style.borderColor,
      colorScheme: style.colorScheme
    };
  });

  expect(nextButtonStyles.backgroundColor).toBe("rgb(37, 37, 37)");
  expect(nextButtonStyles.color).toBe("rgb(212, 212, 212)");
  expect(nextButtonStyles.borderColor).toBe("rgb(86, 86, 86)");
  expect(nextButtonStyles.colorScheme).toBe("dark");

  const matchCaseStyles = await searchPanel.locator("input[name='case']").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      accentColor: style.accentColor,
      colorScheme: style.colorScheme
    };
  });

  expect(matchCaseStyles.accentColor).toBe("rgb(88, 152, 208)");
  expect(matchCaseStyles.colorScheme).toBe("dark");
});

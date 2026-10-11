import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { gotoApp, openMenuCommand, readStoreSource, resetStorageBeforeNavigation, setSource, tabSwitchButtons } from "./helpers";

const SOURCE = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Opening}First build.\pause Second build.\note<1>{Private opening note.}\note<2>{Private next note.}\end{frame}
\begin{frame}{Middle}Middle content.\end{frame}
\begin{frame}{Closing}Last content.\end{frame}
\end{document}`;

test.use({ viewport: { width: 1450, height: 1000 } });
test.beforeEach(async ({ page }) => { await resetStorageBeforeNavigation(page); await gotoApp(page); });

async function windowFor(context: BrowserContext, role: "audience" | "presenter"): Promise<Page> {
  await expect.poll(() => context.pages().filter(page => page.url().includes(`presentation=${role}`)).length).toBe(1);
  const page = context.pages().find(page => page.url().includes(`presentation=${role}`))!;
  await expect(page.getByTestId(`${role}-window`)).toBeVisible();
  return page;
}
async function start(page: Page, showPresenter = true, mode = "window") {
  await setSource(page, SOURCE);
  await page.getByRole("button", { name: "Presentation actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Presentation Options…", exact: true }).click();
  const options = page.getByTestId("presentation-options");
  await options.getByRole("combobox", { name: "Presentation mode" }).selectOption(mode);
  await options.getByRole("checkbox", { name: "Show Presenter View" }).setChecked(showPresenter);
  await options.getByRole("spinbutton", { name: "Countdown budget" }).fill("5");
  await options.getByRole("button", { name: mode === "rehearse" ? "Rehearse" : "Start Presentation", exact: true }).click();
}
const slide = (page: Page) => page.getByRole("img", { name: page.url().includes("presentation=audience") ? "Audience slide" : "Current slide", exact: true });

test("native-style menus and toolbar follow document type, with separate saved panel layouts", async ({ page }) => {
  await expect(page.getByTestId("menu-section-present")).toHaveCount(0);
  await openMenuCommand(page, "view", "view.toggle-source-panel");
  await expect(page.locator(".cm-content")).toHaveCount(0);
  await openMenuCommand(page, "file", "file.new-beamer-document");
  await expect(page.getByTestId("present-button")).toBeVisible();
  await expect(page.getByTestId("menu-section-present")).toBeVisible();
  await expect(page.getByTestId("menu-section-slide")).toHaveCount(0);
  await expect(page.getByTestId("menu-section-path")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(page.getByRole("button", { name: "＋ New Slide", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "＋ New Slide", exact: true }).click();
  await expect.poll(async () => (await readStoreSource(page)).match(/\\begin\{frame\}/g)?.length).toBe(2);
  await openMenuCommand(page, "view", "view.toggle-builds-panel");
  await tabSwitchButtons(page).first().click();
  await expect(page.getByTestId("present-button")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toHaveCount(0);
  await tabSwitchButtons(page).last().click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(page.locator(".flexlayout__tab_button_content").filter({ hasText: /^Overlays$/u })).toHaveCount(0);
});

test("audience and presenter synchronize builds, timer, blanking, jumps, and live edits", async ({ page, context }, testInfo) => {
  const errors: string[] = [];
  context.on("page", child => { child.on("pageerror", error => errors.push(error.message)); });
  await start(page);
  const audience = await windowFor(context, "audience"), presenter = await windowFor(context, "presenter");
  await expect(slide(audience)).toHaveAttribute("data-frame", "0");
  await expect(slide(presenter)).toHaveAttribute("data-step", "1");
  await expect(presenter.locator('[aria-label="Next build or page"]')).toHaveAttribute("data-step", "2");
  await expect(presenter.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(presenter.locator("svg[data-paragraph-id], [data-paragraph-id=presenter-notes]").last()).toBeVisible();
  expect(await audience.locator("body").innerHTML()).not.toContain("Private opening note");
  await presenter.getByRole("button", { name: "Next", exact: true }).click();
  await expect(slide(audience)).toHaveAttribute("data-step", "2");
  await expect(presenter.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await presenter.getByRole("button", { name: "Pause", exact: true }).click();
  await presenter.keyboard.press("ArrowRight");
  await expect(slide(audience)).toHaveAttribute("data-frame", "1");
  await expect(presenter.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await presenter.keyboard.press("b");
  await expect(audience.getByTestId("audience-window")).toHaveAttribute("data-blank", "black");
  await presenter.keyboard.press("w");
  await expect(audience.getByTestId("audience-window")).toHaveAttribute("data-blank", "white");
  await presenter.keyboard.press("w");
  await expect(slide(audience)).toHaveAttribute("data-frame", "1");
  await presenter.getByTestId("presenter-thumbnail").filter({ hasText: "Closing" }).click();
  await expect(slide(audience)).toHaveAttribute("data-frame", "2");
  await page.bringToFront();
  const editorRoot = await page.evaluate(() => (globalThis as unknown as { __TIKZ_EDITOR_APP_TEST_API__: { getActiveFigureId(): string | null } }).__TIKZ_EDITOR_APP_TEST_API__.getActiveFigureId());
  expect(editorRoot).toBe("frame:0");
  const previousSvg = await slide(audience).innerHTML();
  const corrected = SOURCE.replace("Last content.", "Live correction.");
  await setSource(page, corrected);
  await expect.poll(() => slide(audience).innerHTML()).not.toBe(previousSvg);
  await expect(slide(audience)).toHaveAttribute("data-frame", "2");
  const reordered = corrected.replace("\\begin{frame}{Closing}Live correction.\\end{frame}\n", "").replace("\\begin{document}\n", "\\begin{document}\n\\begin{frame}{Closing}Live correction.\\end{frame}\n");
  await setSource(page, reordered);
  await expect(slide(audience)).toHaveAttribute("data-frame", "0");
  await setSource(page, reordered.replace("\\begin{frame}{Closing}Live correction.\\end{frame}\n", ""));
  await expect(slide(audience)).toHaveAttribute("data-frame", "0");
  await expect(slide(audience)).toHaveAttribute("data-step", "1");
  await presenter.screenshot({ path: testInfo.outputPath("presenter.png") });
  await audience.screenshot({ path: testInfo.outputPath("audience.png") });
  await page.bringToFront();
  await openMenuCommand(page, "file", "file.new-tikz-document");
  await expect(page.getByText(/Presenting:/u)).toBeVisible();
  await expect(page.getByTestId("menu-section-present")).toBeVisible();
  await expect(slide(audience)).toHaveAttribute("data-frame", "0");
  await presenter.getByRole("button", { name: "End Presentation", exact: true }).click();
  await expect.poll(() => context.pages().filter(child => child.url().includes("presentation=")).length).toBe(0);
  expect(errors).toEqual([]);
});

test("audience-only playback retains its position after output closure and reconnects", async ({ page, context }) => {
  await start(page, false);
  let audience = await windowFor(context, "audience");
  await expect(slide(audience)).toHaveAttribute("data-step", "1");
  expect(context.pages().some(child => child.url().includes("presentation=presenter"))).toBe(false);
  await audience.keyboard.press("PageDown");
  await expect(slide(audience)).toHaveAttribute("data-step", "2");
  await audience.close();
  await page.bringToFront();
  await expect(page.getByText("Audience output is closed.")).toBeVisible();
  await page.getByRole("button", { name: "Presentation actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Audience Display…", exact: true }).click();
  await page.getByTestId("presentation-options").getByRole("button", { name: "Show Audience Output", exact: true }).click();
  audience = await windowFor(context, "audience");
  await expect(slide(audience)).toHaveAttribute("data-step", "2");
  await audience.keyboard.press("Escape").catch(error => { if (!audience.isClosed()) throw error; });
  await expect.poll(() => audience.isClosed()).toBe(true);
  await expect(page.getByTestId("present-button")).toHaveText("▶ Present");
});

test("rehearsal opens a presenter without an audience window", async ({ page, context }) => {
  await setSource(page, SOURCE);
  await page.getByRole("button", { name: "Presentation actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Rehearse", exact: true }).click();
  const presenter = await windowFor(context, "presenter");
  await expect(slide(presenter)).toHaveAttribute("data-frame", "0");
  expect(context.pages().some(child => child.url().includes("presentation=audience"))).toBe(false);
  await presenter.getByRole("button", { name: "End Presentation", exact: true }).click();
});

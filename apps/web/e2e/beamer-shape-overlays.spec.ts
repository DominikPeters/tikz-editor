import { expect, test, type Page } from "@playwright/test";
import { gotoApp, readStoreSource, resetStorageBeforeNavigation, setSource } from "./helpers";

const SOURCE = String.raw`\documentclass{beamer}
\usepackage{tikz}
\begin{document}
\begin{frame}{Diagram}
\begin{tikzpicture}
\draw (0,0) rectangle (6,3);
\node[draw] (a) at (1.5,1.5) {Alpha};
\node<2->[draw] (b) at (4.5,1.5) {Beta};
\draw<3>[->] (a) -- (b);
\end{tikzpicture}
\end{frame}
\end{document}`;
const MOD = process.platform === "darwin" ? "Meta" : "Control";

const api = <T>(page: Page, call: string) => page.evaluate((code) =>
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function("api", `return ${code}`)((window as unknown as { __TIKZ_EDITOR_APP_TEST_API__: unknown }).__TIKZ_EDITOR_APP_TEST_API__) as T, call);

test.use({ viewport: { width: 1600, height: 1000 } });
test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  await setSource(page, SOURCE);
  await page.locator(".cm-line").filter({ hasText: "\\begin{frame}" }).click();
  const picture = page.locator("[data-hit-region-deck-object-id$=':tikz:0']").first();
  await expect(picture).toHaveCount(1, { timeout: 30_000 });
  // Hit regions are rebuilt with each render; the click repeats until it takes.
  await expect(async () => {
    await picture.click({ force: true, timeout: 2_000 });
    await expect(page.getByRole("button", { name: "Edit Drawing" })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: "Edit Drawing" }).click();
  await expect(page.getByTestId("nested-figure-breadcrumb")).toBeVisible();
});

test("a picture opened from its slide shows the slide's step and can change it", async ({ page }) => {
  // The slide opens on its last step, with everything there.
  await expect(page.getByTestId("deck-step-3")).toHaveAttribute("aria-current", "step");
  await expect.poll(() => api<string[]>(page, "api.getSceneSourceIds()")).toEqual(["path:0", "path:1", "path:2", "path:3"]);
  await page.getByTestId("deck-step-1").click();
  await expect.poll(() => api<string[]>(page, "api.getSceneSourceIds()")).toEqual(["path:0", "path:1"]);
  await page.getByTestId("deck-step-2").click();
  await expect.poll(() => api<string[]>(page, "api.getSceneSourceIds()")).toEqual(["path:0", "path:1", "path:2"]);
  expect(await readStoreSource(page)).toBe(SOURCE);
});

test("the inspector sets, changes and clears a shape's steps, each as one undo step", async ({ page }) => {
  await api(page, "api.selectSourceIds(['path:1'])");
  const field = page.getByRole("textbox", { name: "Overlay steps" });
  await expect(field).toHaveValue("");
  await field.fill("2-");
  await field.press("Enter");
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE.replace(String.raw`\node[draw] (a)`, String.raw`\node<2->[draw] (a)`));
  // The shape stays selected, and the field shows what the source now says.
  await expect(page.getByRole("textbox", { name: "Overlay steps" })).toHaveValue("2-");
  await page.getByRole("textbox", { name: "Overlay steps" }).fill("x");
  await expect(page.getByRole("textbox", { name: "Overlay steps" })).toHaveAttribute("aria-invalid", "true");
  await page.getByRole("textbox", { name: "Overlay steps" }).press("Escape");
  await expect(page.getByRole("textbox", { name: "Overlay steps" })).toHaveValue("2-");

  await api(page, "api.selectSourceIds(['path:2'])");
  await expect(page.getByRole("textbox", { name: "Overlay steps" })).toHaveValue("2-");
  await page.getByRole("textbox", { name: "Overlay steps" }).fill("");
  await page.getByRole("textbox", { name: "Overlay steps" }).press("Enter");
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE.replace(String.raw`\node[draw] (a)`, String.raw`\node<2->[draw] (a)`).replace(String.raw`\node<2->[draw] (b)`, String.raw`\node[draw] (b)`));

  await page.getByTestId("canvas-viewport").focus();
  await page.keyboard.press(`${MOD}+z`);
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
});

test("the canvas menu sets and removes a shape's rule for the step shown", async ({ page }) => {
  await page.getByTestId("deck-step-1").click();
  await expect(page.getByTestId("deck-step-1")).toHaveAttribute("aria-current", "step");
  const alpha = page.locator("[data-hit-region-target-id='path:1']").first();
  await alpha.click({ button: "right", force: true });
  await page.getByRole("menuitem", { name: /^Overlays/u }).hover();
  await page.getByTestId("canvas-context-cmd-overlay.next").click();
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE.replace(String.raw`\node[draw] (a)`, String.raw`\node<2->[draw] (a)`));
  // The picture moves to the step the shape now appears on, and the shape stays selected.
  await expect(page.getByTestId("deck-step-2")).toHaveAttribute("aria-current", "step");
  await expect.poll(() => api<string[]>(page, "api.getSelectedSourceIds()")).toEqual(["path:1"]);

  await alpha.click({ button: "right", force: true });
  await page.getByRole("menuitem", { name: /^Overlays/u }).hover();
  await page.getByTestId("canvas-context-cmd-overlay.remove").click();
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
});

test("a shape under a shared rule is offered that rule, not a rule of its own", async ({ page }) => {
  const shared = SOURCE.replace(String.raw`\node[draw] (a) at (1.5,1.5) {Alpha};`, String.raw`\only<2->{\node[draw] (a) at (1.5,1.5) {Alpha}; \node at (1.5,2.5) {Top};}`);
  await setSource(page, shared);
  await expect.poll(() => api<string[]>(page, "api.getSceneSourceIds()")).toContain("path:2");
  await api(page, "api.selectSourceIds(['path:2'])");
  await expect(page.getByRole("textbox", { name: "Overlay steps" })).toHaveCount(0);
  await page.getByRole("button", { name: "2- · shared" }).click();
  await expect(page.getByTestId("build-row").filter({ hasText: "Shapes · Alpha, Top" })).toHaveAttribute("data-selected", "true");
  expect(await readStoreSource(page)).toBe(shared);
});

test("step tags show for every rule while the Overlays panel is shown, and for the shape the pointer rests on otherwise", async ({ page }) => {
  await expect(page.getByTestId("step-tag")).toHaveCount(0);
  // Resting on a shape with a rule shows its tag, as a tooltip would.
  const beta = page.locator("[data-hit-region-target-id='path:2']").first();
  const box = (await beta.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
  await expect(page.getByTestId("step-tag")).toHaveText(["2-"]);
  const alpha = (await page.locator("[data-hit-region-target-id='path:1']").first().boundingBox())!;
  await page.mouse.move(alpha.x + alpha.width / 2, alpha.y + alpha.height / 2);
  await expect(page.getByTestId("step-tag")).toHaveCount(0);

  await page.locator(".flexlayout__tab_button_content").filter({ hasText: /^Overlays$/u }).first().click();
  await expect(page.getByTestId("step-tag")).toHaveText(["2-", "3"]);
  await page.getByTestId("deck-step-2").click();
  await expect(page.getByTestId("step-tag")).toHaveText(["2-"]);
  await page.locator(".flexlayout__tab_button_content").filter({ hasText: /^Inspector$/u }).first().click();
  await expect(page.getByTestId("step-tag")).toHaveCount(0);
});

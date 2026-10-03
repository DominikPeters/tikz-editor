import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoApp, readStoreSource, resetStorageBeforeNavigation, setSource } from "./helpers";

const SOURCE = String.raw`\documentclass{beamer}
\begin{document}
\section{One}
% Keep with A
\begin{frame}[label=a]{A}First.\only<2>{Later.}\end{frame}
\begin{frame}{B}\hyperlink{a}{Back}\end{frame}
\section{Two}
\subsection{Details}
\begin{frame}{C}Third.\end{frame}
\begin{frame}{D}Fourth.\end{frame}
\end{document}`;
const nav = (page: Page) => page.getByTestId("figure-navigator");
const card = (page: Page, title: string) => nav(page).getByRole("button", { name: new RegExp(`^\\d+\\. ${title}$`, "u") });
const selected = (page: Page) => nav(page).locator('[data-slide-id] button[aria-pressed="true"]');
const activeFrame = (page: Page) => page.evaluate(() =>
  (window as unknown as { __TIKZ_EDITOR_APP_TEST_API__: { getActiveFigureId: () => string | null } }).__TIKZ_EDITOR_APP_TEST_API__.getActiveFigureId());

async function dock(page: Page, width: number) {
  await page.evaluate(slideWidth => {
    const tab = (id: string, name: string) => ({ type: "tab", id, component: id, name });
    localStorage.setItem("tikz-editor:dock-layout", JSON.stringify({
      global: {}, borders: [], layout: { type: "row", children: [
        { type: "tabset", weight: slideWidth, children: [tab("figure-navigator", "Slides")] },
        { type: "tabset", weight: 100 - slideWidth, children: [tab("canvas", "Canvas")] }
      ] }
    }));
  }, width);
  await page.reload();
  await setSource(page, SOURCE);
}
async function dragTo(page: Page, from: Locator, to: Locator, edge: "before" | "after") {
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await from.dispatchEvent("dragstart", { dataTransfer: transfer });
  const box = (await to.boundingBox())!;
  const position = { clientX: box.x + box.width / 2, clientY: box.y + (edge === "before" ? 2 : box.height - 2) };
  await to.dispatchEvent("dragover", { ...position, dataTransfer: transfer });
  await expect.poll(() => to.evaluate(element => element.closest("[data-slide-id], [data-section-id]")?.getAttribute("data-drop"))).toBe(edge);
  await to.dispatchEvent("drop", { ...position, dataTransfer: transfer });
  await transfer.dispose();
}

test.beforeEach(async ({ page }) => { await resetStorageBeforeNavigation(page); });

test("reuses the strip, shows final-overlay thumbnails, and keeps an empty deck editable", async ({ page }) => {
  await gotoApp(page); await setSource(page, SOURCE);
  await card(page, "A").click();
  await expect(nav(page)).toHaveAttribute("data-layout", "strip");
  await expect(nav(page).locator("img")).toHaveCount(4);
  const image = await card(page, "A").locator("img").getAttribute("src");
  expect(decodeURIComponent(image!).includes(`data-source-start="${SOURCE.indexOf("Later.")}"`)).toBe(true);
  await expect(card(page, "A").getByTestId("navigator-step-badge")).toHaveText("2");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await expect(nav(page)).toBeVisible();
  await expect(nav(page).getByText("No slides", { exact: true })).toBeVisible();
  await expect(nav(page).getByRole("button", { name: "New slide" })).toBeFocused();
  expect(await readStoreSource(page)).toContain("\\section{Two}");
  await nav(page).getByRole("button", { name: "New slide" }).click();
  await expect(nav(page).getByRole("button", { name: "Slide 1", exact: true })).toBeFocused();
  expect(await readStoreSource(page)).toContain("\\begin{frame}\n\n\\end{frame}");
});

test("selects ranges and toggles, duplicates through the menu, and restores selection on undo", async ({ page }) => {
  await gotoApp(page); await setSource(page, SOURCE); await dock(page, 18);
  await expect(nav(page)).toHaveAttribute("data-layout", "vertical");
  await card(page, "A").click();
  await card(page, "C").click({ modifiers: ["Shift"] });
  await expect(selected(page)).toHaveCount(3);
  await expect.poll(() => activeFrame(page)).toBe("frame:0");
  await card(page, "B").click({ modifiers: ["ControlOrMeta"] });
  await expect(selected(page)).toHaveCount(2);
  await card(page, "A").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Duplicate slides" }).click();
  await expect(nav(page).locator("[data-slide-id]")).toHaveCount(6);
  await expect(selected(page)).toHaveCount(2);
  expect(await readStoreSource(page)).toContain("label=a-copy");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
  await expect(selected(page)).toHaveCount(2);
  await expect(card(page, "A")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(nav(page).locator("[data-slide-id]")).toHaveCount(6);
});

test("moves a group across a section boundary and preserves active overlay through undo", async ({ page }) => {
  await gotoApp(page); await setSource(page, SOURCE); await dock(page, 18);
  await card(page, "A").click();
  await page.getByRole("button", { name: "Next overlay" }).click();
  await card(page, "B").click({ modifiers: ["ControlOrMeta"] });
  const section = nav(page).locator('[data-section-id="section:2"]');
  await dragTo(page, card(page, "A"), section, "after");
  await expect.poll(() => readStoreSource(page)).not.toBe(SOURCE);
  const moved = await readStoreSource(page);
  expect(moved.indexOf("\\subsection{Details}")).toBeLessThan(moved.indexOf("% Keep with A"));
  expect(moved.indexOf("{A}First")).toBeLessThan(moved.indexOf("{B}\\hyperlink"));
  await expect(selected(page)).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Next overlay" })).toBeDisabled();
  await card(page, "A").focus(); await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
  await expect(page.getByRole("button", { name: "Next overlay" })).toBeDisabled();
  await nav(page).getByRole("button", { name: "One", exact: true }).click();
  await expect(card(page, "A")).toHaveCount(0);
  await nav(page).getByRole("button", { name: "One", exact: true }).click();
  await expect(card(page, "A")).toBeVisible();
});

test("uses a grid in a wide panel and ignores a drag after the source changes", async ({ page }) => {
  await gotoApp(page); await setSource(page, SOURCE); await dock(page, 40);
  await expect(nav(page)).toHaveAttribute("data-layout", "grid");
  await card(page, "A").click();
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await card(page, "A").dispatchEvent("dragstart", { dataTransfer: transfer });
  const changed = SOURCE.replace("Third.", "Edited in source.");
  await setSource(page, changed);
  await card(page, "D").dispatchEvent("dragover", { dataTransfer: transfer });
  await card(page, "D").dispatchEvent("drop", { dataTransfer: transfer });
  expect(await readStoreSource(page)).toBe(changed);
  await transfer.dispose();
});

test("reorders with a native pointer drag and keeps the moved slide active", async ({ page }) => {
  await gotoApp(page); await setSource(page, SOURCE); await dock(page, 18);
  await card(page, "D").click();
  await card(page, "D").dragTo(card(page, "A"), { targetPosition: { x: 30, y: 3 } });
  await expect.poll(() => readStoreSource(page)).not.toBe(SOURCE);
  const moved = await readStoreSource(page);
  expect(moved.indexOf("{D}Fourth")).toBeLessThan(moved.indexOf("% Keep with A"));
  await expect.poll(() => activeFrame(page)).toBe("frame:0");
  await expect(card(page, "D")).toHaveAttribute("aria-pressed", "true");
});

const WARNING_SOURCE = String.raw`\documentclass{beamer}
\begin{document}
\def\unit{ms}
\begin{frame}{Latency}12\unit\end{frame}
\def\unit{s}
\begin{frame}{Throughput}Results\end{frame}
\end{document}`;
const review = (page: Page) => page.getByTestId("slide-move-review");

test("reviews a dragged move with exact definitions, supports cancel and confirmation, and undoes once", async ({ page }) => {
  await gotoApp(page); await dock(page, 18); await setSource(page, WARNING_SOURCE);
  await card(page, "Latency").click();
  await dragTo(page, card(page, "Latency"), card(page, "Throughput"), "after");
  await expect(review(page)).toBeVisible();
  await expect(review(page)).toContainText("would use a different definition of \\unit");
  await expect(review(page).locator("code")).toHaveText(["\\unit", "\\def\\unit{ms}", "\\def\\unit{s}"]);
  expect(await readStoreSource(page)).toBe(WARNING_SOURCE);
  await review(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(review(page)).toHaveCount(0);
  expect(await readStoreSource(page)).toBe(WARNING_SOURCE);
  await card(page, "Latency").focus(); await page.keyboard.press("Alt+ArrowDown");
  await expect(review(page)).toBeVisible();
  await page.keyboard.press("Delete");
  expect(await readStoreSource(page)).toBe(WARNING_SOURCE);
  await review(page).getByRole("button", { name: "Move anyway", exact: true }).click();
  await expect.poll(() => readStoreSource(page)).not.toBe(WARNING_SOURCE);
  const moved = await readStoreSource(page);
  expect(moved.indexOf("{Throughput}")).toBeLessThan(moved.indexOf("{Latency}"));
  await card(page, "Latency").focus(); await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readStoreSource(page)).toBe(WARNING_SOURCE);
});

test("opens the source panel and selects the clicked definition without moving the slide", async ({ page }) => {
  await gotoApp(page); await dock(page, 18); await setSource(page, WARNING_SOURCE);
  await card(page, "Latency").click(); await page.keyboard.press("Alt+ArrowDown");
  await review(page).getByRole("button", { name: "Show source: Current definition, line 3", exact: true }).click();
  await expect(review(page)).toHaveCount(0);
  await expect(page.locator(".cm-content")).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("\\def\\unit{ms}");
  expect(await readStoreSource(page)).toBe(WARNING_SOURCE);
});

test("blocks crossing a conditional and expires review after a source edit", async ({ page }) => {
  await gotoApp(page); await dock(page, 18);
  const conditional = WARNING_SOURCE.replace("\\def\\unit{ms}", "\\iffalse").replace("\\def\\unit{s}", "\\fi");
  await setSource(page, conditional);
  await card(page, "Latency").click(); await page.keyboard.press("Alt+ArrowDown");
  await expect(review(page)).toContainText("crosses a conditional branch");
  await expect(review(page).getByRole("button", { name: "Move anyway" })).toHaveCount(0);
  expect(await readStoreSource(page)).toBe(conditional);
  await review(page).getByRole("button", { name: "Close", exact: true }).click();
  const owned = conditional.replace("\\iffalse", "\\begin{onlyenv}<1>").replace("\\fi\n", "\\end{onlyenv}\n");
  await setSource(page, owned);
  await card(page, "Latency").click(); await page.keyboard.press("Alt+ArrowDown");
  await expect(review(page)).toContainText("split an enclosing command");
  await expect(review(page).getByRole("button", { name: "Move anyway" })).toHaveCount(0);
  expect(await readStoreSource(page)).toBe(owned);
  await review(page).getByRole("button", { name: "Close", exact: true }).click();
  await setSource(page, WARNING_SOURCE);
  await card(page, "Latency").click(); await page.keyboard.press("Alt+ArrowDown");
  await expect(review(page)).toBeVisible();
  await setSource(page, WARNING_SOURCE + "\n% edited");
  await expect(review(page)).toHaveCount(0);
  await setSource(page, WARNING_SOURCE);
  await expect(review(page)).toHaveCount(0);
});

test("carries a private macro through keyboard reordering without a dialog and undoes it together", async ({ page }) => {
  await gotoApp(page); await dock(page, 18);
  const source = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Overview}Overview\end{frame}
% Number of samples
\newcommand{\sampleSize}{128}
\begin{frame}{Results}N=\sampleSize\end{frame}
\end{document}`;
  await setSource(page, source);
  await card(page, "Results").click(); await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(() => readStoreSource(page)).not.toBe(source);
  await expect(review(page)).toHaveCount(0);
  const moved = await readStoreSource(page);
  expect(moved.indexOf("% Number of samples")).toBeLessThan(moved.indexOf("{Results}"));
  expect(moved.indexOf("{Results}")).toBeLessThan(moved.indexOf("{Overview}"));
  await card(page, "Results").focus(); await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readStoreSource(page)).toBe(source);
});


test("reorders KKT slides 2 and 3 without a warning and restores their source on undo", async ({ page }) => {
  const source = readFileSync(new URL("../../../test/fixtures/beamer/kkt_theorem_beamer.tex", import.meta.url), "utf8");
  await gotoApp(page); await dock(page, 18); await setSource(page, source);
  const from = card(page, "Why KKT conditions matter"), to = card(page, "Problem form and notation");
  await from.click();
  await dragTo(page, from, to, "after");
  await expect.poll(() => readStoreSource(page)).not.toBe(source);
  await expect(review(page)).toHaveCount(0);
  const moved = await readStoreSource(page);
  expect(moved.indexOf("\\begin{frame}{Problem form and notation}")).toBeLessThan(moved.indexOf("\\begin{frame}{Why KKT conditions matter}"));
  await from.focus(); await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readStoreSource(page)).toBe(source);
  await from.focus(); await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => readStoreSource(page)).toBe(moved);
  await expect(review(page)).toHaveCount(0);
});

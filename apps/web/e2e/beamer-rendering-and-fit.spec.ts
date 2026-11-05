import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { gotoApp, resetStorageBeforeNavigation, setSource } from "./helpers";

test.beforeEach(async ({ page }) => { await resetStorageBeforeNavigation(page); });

test("distinguishes absolute values from norms in the KKT slide deck", async ({ page }) => {
  const fixture = readFileSync(new URL("../../../test/fixtures/beamer/kkt_theorem_beamer.tex", import.meta.url), "utf8");
  const title = String.raw`\begin{frame}{Why KKT conditions matter}`;
  const formula = String.raw`$|X|\quad\|X\|$\par`;
  const source = fixture.replace(title, `${title}\n${formula}\n`);
  await gotoApp(page); await setSource(page, source);
  await page.getByTestId("figure-navigator").getByRole("button", { name: "2. Why KKT conditions matter", exact: true }).click();
  const start = source.indexOf(formula) + 1;
  const glyph = (offset: number) => page.getByTestId("canvas-svg-layer").locator(`path[data-source-start="${start + offset}"]`);
  for (const offset of [0, 2]) {
    await expect(glyph(offset)).toHaveAttribute("data-tex-glyph", "106");
    await expect(glyph(offset)).toHaveAttribute("data-tex-font", /^cmsy/u);
  }
  for (const offset of [8, 11]) await expect(glyph(offset)).toHaveAttribute("data-tex-glyph", "107");
});

test("fits a Beamer page with a small margin and keeps it centered after resizing", async ({ page }) => {
  const source = String.raw`\documentclass[aspectratio=169]{beamer}
\begin{document}
\begin{frame}{Fit}Slide content.\end{frame}
\end{document}`;
  await gotoApp(page); await setSource(page, source);
  await page.getByTestId("figure-navigator").getByRole("button", { name: "1. Fit", exact: true }).click();
  const viewport = page.getByTestId("canvas-viewport");
  const fitGeometry = () => viewport.evaluate(element => {
    // Read both boxes in one layout state, then wait for the ResizeObserver
    // and React fit update to settle all three invariants together.
    const outer = element.getBoundingClientRect();
    const inner = element.querySelector('[data-testid="canvas-world-stage"]')?.getBoundingClientRect();
    if (!inner) return null;
    return { margin: Math.min((outer.width - inner.width) / 2, (outer.height - inner.height) / 2),
      x: inner.x + inner.width / 2 - outer.x - outer.width / 2,
      y: inner.y + inner.height / 2 - outer.y - outer.height / 2 };
  });
  const fit = page.getByRole("button", { name: "Fit to content", exact: true });
  if (await fit.getAttribute("aria-pressed") === "true") await fit.click();
  await fit.click();
  for (const size of [{ width: 1280, height: 800 }, { width: 1600, height: 900 }]) {
    await page.setViewportSize(size);
    await expect.poll(fitGeometry).toEqual({
      margin: expect.closeTo(12, 0),
      x: expect.closeTo(0, 0),
      y: expect.closeTo(0, 0)
    });
  }
});

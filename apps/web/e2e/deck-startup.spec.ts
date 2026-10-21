import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { gotoApp } from "./helpers";

const KKT = readFileSync(new URL("../../../test/fixtures/beamer/kkt_theorem_beamer.tex", import.meta.url), "utf8");

for (const scenario of [
  { name: "saved KKT slide", source: KKT, rootId: "frame:15" },
  { name: "empty deck", source: String.raw`\documentclass{beamer}\begin{document}\end{document}`, rootId: null }
]) {
  test(`starts and reloads ${scenario.name} without runtime errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(({ source, rootId }) => {
      localStorage.clear();
      localStorage.setItem("tikz-editor:workspace", JSON.stringify({
        workspaceVersion: 4,
        documents: [{ id: "saved-deck", title: "Saved deck", source, activeRootId: rootId }],
        tabOrder: ["saved-deck"], activeDocumentId: "saved-deck", recentDocumentIds: ["saved-deck"]
      }));
    }, scenario);
    await gotoApp(page);
    for (let pass = 0; pass < 2; pass++) {
      if (pass) await page.reload();
      await expect(page.getByTestId("tab-strip")).toBeVisible();
      if (scenario.rootId) {
        await expect(page.getByTestId("canvas-svg-layer").locator(`[data-part-id="${scenario.rootId}:background"]`)).toHaveCount(1);
      } else {
        await expect(page.getByTestId("figure-navigator").getByText("No slides", { exact: true })).toBeVisible();
      }
      await expect.poll(() => page.evaluate(() => {
        const api = (window as unknown as {
          __TIKZ_EDITOR_APP_TEST_API__: { getSource: () => string; getSnapshotSource: () => string };
        }).__TIKZ_EDITOR_APP_TEST_API__;
        return api.getSource() === api.getSnapshotSource();
      })).toBe(true);
      expect(errors).toEqual([]);
    }
  });
}

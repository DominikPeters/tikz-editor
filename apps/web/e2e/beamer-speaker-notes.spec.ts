import { expect, test, type Page } from "@playwright/test";
import { gotoApp, openMenuCommand, readStoreSource, resetStorageBeforeNavigation, setSource } from "./helpers";

const SOURCE = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Eggs}
  First.\pause Second.
\end{frame}
\begin{frame}{Plants}
  Text.
  \note<2->{Later}
  \note[item]{Point}
\end{frame}
\note{After}
\end{document}`;

const card = (page: Page, title: string) =>
  page.getByTestId("figure-navigator").getByRole("button", { name: new RegExp(`^\\d+\\. ${title}$`, "u") });

test.beforeEach(async ({ page }) => { await resetStorageBeforeNavigation(page); await gotoApp(page); });

test("the notes panel writes a slide's notes as \\note commands, holding back text that would end one early", async ({ page }) => {
  await setSource(page, SOURCE);
  await openMenuCommand(page, "view", "view.toggle-notes-panel");
  const field = page.getByRole("textbox", { name: "Speaker notes", exact: true });
  await field.click();
  await page.keyboard.type("Start with eggs. 50");
  await expect.poll(() => readStoreSource(page)).toContain("  First.\\pause Second.\n  \\note{Start with eggs. 50}\n\\end{frame}");

  // A % on the note's last line would comment out its closing brace.
  await page.keyboard.type("%");
  await expect(page.getByRole("alert")).toContainText("Write \\% for a percent sign");
  await expect(field).toHaveValue("Start with eggs. 50%");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("\\%");
  await expect.poll(() => readStoreSource(page)).toContain("\\note{Start with eggs. 50\\%}");
  await expect(page.getByRole("alert")).toHaveCount(0);

  // ⌘Z in the field steps the document's history.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readStoreSource(page)).not.toContain("50\\%");
  await expect(field).not.toHaveValue(/%/u);

  await card(page, "Plants").click();
  await expect(page.getByRole("textbox", { name: "Speaker note: From build 2" })).toHaveValue("Later");
  await expect(page.getByRole("textbox", { name: "Speaker note: Page after the slide" })).toHaveValue("After");
  const item = page.getByRole("textbox", { name: "Speaker note: Every build · list item" });
  await expect(item).toHaveValue("Point");
  // A note left empty goes, with its line.
  await item.fill("");
  await item.blur();
  await expect.poll(() => readStoreSource(page)).toContain("  \\note<2->{Later}\n\\end{frame}");
});
